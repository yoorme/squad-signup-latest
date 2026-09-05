import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-server";
import { ok, fail, ApiError, withErrorHandler } from "@/lib/api";

// 允许的提前提醒分钟数档位
const ALLOWED_LEAD_MINUTES = [15, 30, 60, 120];

// 读取通知设置（无记录时返回默认值，不落库）
export const GET = withErrorHandler(async () => {
  const user = await requireUser();
  const setting = await prisma.notificationSetting.findUnique({
    where: { userId: user.id },
  });
  return ok(
    setting ?? {
      userId: user.id,
      notifyNewEvent: true,
      notifyEventReminder: true,
      reminderLeadMinutes: 60,
      notifyAnnouncement: true,
    }
  );
});

// 更新通知设置（懒创建）
export const PATCH = withErrorHandler(async (req: NextRequest) => {
  const user = await requireUser();
  const body = await req.json();

  const data: {
    notifyNewEvent?: boolean;
    notifyEventReminder?: boolean;
    reminderLeadMinutes?: number;
    notifyAnnouncement?: boolean;
  } = {};

  if (body.notifyNewEvent !== undefined) {
    if (typeof body.notifyNewEvent !== "boolean") return fail("notifyNewEvent 必须是布尔值");
    data.notifyNewEvent = body.notifyNewEvent;
  }
  if (body.notifyEventReminder !== undefined) {
    if (typeof body.notifyEventReminder !== "boolean") return fail("notifyEventReminder 必须是布尔值");
    data.notifyEventReminder = body.notifyEventReminder;
  }
  if (body.notifyAnnouncement !== undefined) {
    if (typeof body.notifyAnnouncement !== "boolean") return fail("notifyAnnouncement 必须是布尔值");
    data.notifyAnnouncement = body.notifyAnnouncement;
  }
  if (body.reminderLeadMinutes !== undefined) {
    const minutes = Number(body.reminderLeadMinutes);
    if (!ALLOWED_LEAD_MINUTES.includes(minutes)) {
      throw new ApiError(`提前提醒时间仅支持：${ALLOWED_LEAD_MINUTES.join(" / ")} 分钟`);
    }
    data.reminderLeadMinutes = minutes;
  }
  if (Object.keys(data).length === 0) return fail("没有需要修改的字段");

  const setting = await prisma.notificationSetting.upsert({
    where: { userId: user.id },
    create: { userId: user.id, ...data },
    update: data,
  });
  return ok(setting);
});
