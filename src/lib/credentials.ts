import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { getSiteSettings, buildUsername } from "@/lib/site-settings";

// 登录凭据校验（Web Credentials 登录与 App app-login 共用）
// 兼容用户输入「昵称」或「前缀+昵称」（前缀为战队管理中配置的全局值）
export interface VerifiedUser {
  id: string;
  username: string;
  nickname: string;
  role: "ADMIN" | "MEMBER";
}

export async function verifyCredentials(
  rawUsername: string,
  password: string
): Promise<VerifiedUser | null> {
  const username = rawUsername.trim();
  if (!username || !password) return null;

  const { teamPrefix } = await getSiteSettings();
  const fullUsername =
    teamPrefix && username.startsWith(teamPrefix)
      ? username
      : buildUsername(username, teamPrefix);

  const user = await prisma.user.findUnique({
    where: { username: fullUsername },
  });

  if (!user) return null;
  if (user.disabled) return null;
  if (!user.passwordHash) return null;

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return null;

  return {
    id: user.id,
    username: user.username,
    nickname: user.nickname,
    role: user.role,
  };
}
