import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, fail, withErrorHandler } from "@/lib/api";
import { verifyCredentials } from "@/lib/credentials";
import { signAppToken, APP_TOKEN_EXPIRES_IN } from "@/lib/auth-server";
import { rateLimit, clientIp, isTrustingProxy } from "@/lib/rate-limit";

// App 登录：账号密码换取长期 Bearer Token（30 天）
// 与 Web 会话并存：Token 携带 tokenVersion，改密/被管理员重置密码后立即失效
export const POST = withErrorHandler(async (req: NextRequest) => {
  const rlIp = rateLimit(
    `login:${clientIp(req)}`,
    isTrustingProxy() ? 5 : 30,
    60_000
  );
  if (!rlIp.success) {
    return fail("尝试过于频繁，请稍后再试", 429);
  }

  const body = await req.json().catch(() => null);
  const username = String(body?.username ?? "").trim();
  const password = String(body?.password ?? "");
  if (!username || !password) return fail("请输入用户名和密码");

  // 用户名维度限流：伪造 IP 头也无法提高单账号爆破速度
  const rlUser = rateLimit(`loginuser:${username.toLowerCase()}`, 10, 60_000);
  if (!rlUser.success) {
    return fail("尝试过于频繁，请稍后再试", 429);
  }

  const user = await verifyCredentials(username, password);
  if (!user) return fail("用户名或密码错误", 401);

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { tokenVersion: true },
  });
  const token = await signAppToken(user.id, dbUser?.tokenVersion ?? 0);

  return ok({
    token,
    expiresIn: APP_TOKEN_EXPIRES_IN,
    user: {
      id: user.id,
      username: user.username,
      nickname: user.nickname,
      role: user.role,
    },
  });
});
