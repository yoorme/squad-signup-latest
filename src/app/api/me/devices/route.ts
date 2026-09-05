import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-server";
import { ok, fail, withErrorHandler } from "@/lib/api";

// 注册/更新当前设备的推送绑定（App 登录后调用）
export const POST = withErrorHandler(async (req: NextRequest) => {
  const user = await requireUser();
  const body = await req.json();
  const registrationId = String(body?.registrationId ?? "").trim();
  if (!registrationId) return fail("缺少 registrationId");
  if (registrationId.length > 255) return fail("registrationId 无效");

  const model = body?.model ? String(body.model).slice(0, 100) : null;
  const appVersion = body?.appVersion ? String(body.appVersion).slice(0, 50) : null;

  const device = await prisma.device.upsert({
    where: { userId_registrationId: { userId: user.id, registrationId } },
    create: { userId: user.id, registrationId, model, appVersion },
    update: { enabled: true, model, appVersion, lastSeenAt: new Date() },
  });
  return ok({ id: device.id });
});

// 解绑设备推送（App 退出登录时调用）
// query: ?registrationId=xxx
export const DELETE = withErrorHandler(async (req: NextRequest) => {
  const user = await requireUser();
  const registrationId = req.nextUrl.searchParams.get("registrationId");
  if (!registrationId) return fail("缺少 registrationId");

  await prisma.device.deleteMany({
    where: { userId: user.id, registrationId },
  });
  return ok({ success: true });
});
