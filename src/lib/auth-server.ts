import { auth } from "@/auth";
import { Role } from "@prisma/client";
import { jwtVerify } from "jose";
import { prisma } from "@/lib/prisma";

export interface SessionUser {
  id: string;
  username: string;
  nickname: string;
  role: Role;
  disabled: boolean;
}

// App 端 Bearer Token：HS256 JWT（uid + ver），AUTH_SECRET 签发（见 /api/auth/app-login）
// ver 对应 User.tokenVersion，改密/重置密码后 +1，旧令牌立即失效
const APP_TOKEN_ISSUER = "squad-signup-app";
const APP_TOKEN_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

function appTokenKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET 未配置");
  return new TextEncoder().encode(secret);
}

export async function signAppToken(userId: string, tokenVersion: number): Promise<string> {
  const { SignJWT } = await import("jose");
  return new SignJWT({ uid: userId, ver: tokenVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(APP_TOKEN_ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${APP_TOKEN_MAX_AGE_SECONDS}s`)
    .sign(appTokenKey());
}

export const APP_TOKEN_EXPIRES_IN = APP_TOKEN_MAX_AGE_SECONDS;

async function getUserFromBearerToken(): Promise<SessionUser | null> {
  const { headers } = await import("next/headers");
  const authorization = (await headers()).get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice(7).trim();
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, appTokenKey(), { issuer: APP_TOKEN_ISSUER });
    const uid = String(payload.uid ?? "");
    const ver = Number(payload.ver ?? -1);
    if (!uid) return null;
    return await loadActiveUser(uid, ver);
  } catch {
    return null; // 签名/过期校验失败 → 视为未登录
  }
}

// 实时从数据库校验账号状态（禁用/删除/令牌版本），保证注销与改密即时生效
async function loadActiveUser(uid: string, tokenVersion = Number.NaN): Promise<SessionUser | null> {
  const dbUser = await prisma.user.findUnique({
    where: { id: uid },
    select: {
      id: true,
      username: true,
      nickname: true,
      role: true,
      disabled: true,
      tokenVersion: true,
    },
  });
  if (!dbUser || dbUser.disabled) return null;
  if (!Number.isNaN(tokenVersion) && dbUser.tokenVersion !== tokenVersion) return null;
  return dbUser;
}

// 获取当前登录用户（Web Cookie 会话或 App Bearer Token），
// 并实时从数据库校验账号状态与角色。
// 这样禁用/降级用户后，旧 JWT 也会立即失效。
export async function getSessionUser(): Promise<SessionUser | null> {
  const bearerUser = await getUserFromBearerToken();
  if (bearerUser) return bearerUser;

  const session = await auth();
  if (!session?.user) return null;
  return loadActiveUser(session.user.id);
}

// 强制要求登录，否则抛错
export async function requireUser() {
  const user = await getSessionUser();
  if (!user) {
    throw new Error("UNAUTHORIZED");
  }
  return { ...user, name: user.username };
}

// 强制要求管理员，否则抛错
export async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== Role.ADMIN) {
    throw new Error("FORBIDDEN");
  }
  return user;
}
