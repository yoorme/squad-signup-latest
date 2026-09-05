import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { fail, ok, withErrorHandler } from "@/lib/api";
import { pushEventReminder, jpushConfigured } from "@/lib/push";
import { autoArchiveExpiredEvents } from "@/lib/event-auto-archive";

// 比赛临近提醒扫描（由 systemd timer 每分钟通过 curl 调用，需 CRON_SECRET）
// 逻辑：
//   1. 过期赛事自动归档（无网页访问时也能及时归档）
//   2. 扫描未来 24 小时内开始的 UPCOMING 赛事
//   3. 对每个有效报名者，按其 reminderLeadMinutes 判断是否已进入提醒窗口
//   4. PushLog 去重（userId + event_reminder:<eventId>:<lead>），只提醒一次
// 未配置 JPush 时同样执行（日志照记），仅推送环节静默跳过，便于调试与后续接入

// 进程内互斥：防止上一轮扫描未结束时重复执行（单进程 standalone 下足够）
const g = globalThis as unknown as { notifyTickRunning?: boolean };

export const GET = withErrorHandler(async (req: NextRequest) => {
  const secret = process.env.CRON_SECRET;
  const provided = req.headers.get("x-cron-secret");
  if (!secret || !provided || provided !== secret) {
    return fail("未授权", 401);
  }

  if (g.notifyTickRunning) {
    return ok({ skipped: true, reason: "上一轮扫描尚未结束" });
  }
  g.notifyTickRunning = true;
  try {
    return await runScan();
  } finally {
    g.notifyTickRunning = false;
  }
});

async function runScan() {
  const now = Date.now();
  const horizonMs = 24 * 60 * 60 * 1000; // 扫描未来 24 小时（提前量上限 120 分钟，留足余量）

  await autoArchiveExpiredEvents().catch(() => {});

  const events = await prisma.event.findMany({
    where: { status: "UPCOMING", eventTime: { gt: new Date(now), lte: new Date(now + horizonMs) } },
    select: { id: true, title: true, eventTime: true },
  });
  if (events.length === 0) return ok({ checked: 0, sent: 0 });

  const eventIds = events.map((e) => e.id);
  const registrations = await prisma.registration.findMany({
    where: { eventId: { in: eventIds }, status: "REGISTERED" },
    select: { eventId: true, userId: true, user: { select: { disabled: true } } },
  });
  // 仅保留未禁用账号的报名
  const regs = registrations.filter((r) => !r.user.disabled);
  if (regs.length === 0) return ok({ checked: events.length, sent: 0 });

  const userIds = [...new Set(regs.map((r) => r.userId))];
  const settings = await prisma.notificationSetting.findMany({
    where: { userId: { in: userIds } },
  });
  const settingMap = new Map(settings.map((s) => [s.userId, s]));

  // 查询已有提醒日志（这些 用户×赛事×提前量 组合不再重发）
  const dedupKeys: string[] = [];
  for (const r of regs) {
    const lead = settingMap.get(r.userId)?.reminderLeadMinutes ?? 60;
    dedupKeys.push(`event_reminder:${r.eventId}:${lead}`);
  }
  const existingLogs = await prisma.pushLog.findMany({
    where: { userId: { in: userIds }, dedupKey: { in: dedupKeys } },
    select: { userId: true, dedupKey: true },
  });
  const sentSet = new Set(existingLogs.map((l) => `${l.userId}:${l.dedupKey}`));

  if (!jpushConfigured()) {
    return ok({ checked: events.length, sent: 0, pushConfigured: false });
  }

  // 按赛事×提前量分组发送（同一组共用一次推送调用）
  let sent = 0;
  const logsToWrite: { userId: string; dedupKey: string }[] = [];
  const eventMap = new Map(events.map((e) => [e.id, e]));
  const groups = new Map<string, { userIds: string[]; logs: { userId: string; dedupKey: string }[] }>();

  for (const r of regs) {
    const event = eventMap.get(r.eventId);
    if (!event) continue;
    const setting = settingMap.get(r.userId);
    if (setting && !setting.notifyEventReminder) continue;

    const lead = setting?.reminderLeadMinutes ?? 60;
    const dueAt = event.eventTime.getTime() - lead * 60_000;
    if (now < dueAt) continue; // 还没到提醒窗口

    const dedupKey = `event_reminder:${r.eventId}:${lead}`;
    if (sentSet.has(`${r.userId}:${dedupKey}`)) continue;

    const minutesLeft = Math.max(1, Math.ceil((event.eventTime.getTime() - now) / 60_000));
    const groupKey = `${r.eventId}:${lead}:${minutesLeft}`;
    const group = groups.get(groupKey) ?? { userIds: [], logs: [] };
    group.userIds.push(r.userId);
    group.logs.push({ userId: r.userId, dedupKey });
    groups.set(groupKey, group);
  }

  for (const [groupKey, group] of groups) {
    const [eventId, , minutesStr] = groupKey.split(":");
    const event = eventMap.get(eventId);
    if (!event) continue;
    const okSent = await pushEventReminder(
      eventId,
      event.title,
      Number(minutesStr),
      group.userIds
    );
    // 发送成功才记日志（失败则下一轮重试，PushLog 唯一索引兜底防止重复提醒）
    if (okSent) {
      sent += group.userIds.length;
      logsToWrite.push(...group.logs);
    }
  }

  if (logsToWrite.length > 0) {
    await prisma.pushLog
      .createMany({ data: logsToWrite, skipDuplicates: true })
      .catch(() => {});
  }

  return ok({ checked: events.length, sent, pushConfigured: true });
}
