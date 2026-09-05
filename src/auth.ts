import NextAuth, { type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { verifyCredentials } from "@/lib/credentials";

export const authConfig: NextAuthConfig = {
  session: { strategy: "jwt" },
  // 会话 Cookie 名按实例隔离：同一 IP 上部署多个战队站点时，
  // Cookie 域不含端口，若共用默认名会互相覆盖（登录 A 站即踢掉 B 站）。
  // 各实例通过环境变量 AUTH_COOKIE_NAME 配置独立名称（生产由 install.sh/update.sh 写入）。
  cookies: {
    sessionToken: {
      name: process.env.AUTH_COOKIE_NAME || "authjs.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.AUTH_COOKIE_SECURE === "true",
      },
    },
  },
  providers: [
    Credentials({
      credentials: {
        username: {},
        password: {},
      },
      async authorize(credentials) {
        const verified = await verifyCredentials(
          String(credentials?.username ?? ""),
          String(credentials?.password ?? "")
        );
        if (!verified) return null;
        // name 供 NextAuth 写入 JWT（session.user.name 展示完整用户名）
        return {
          id: verified.id,
          name: verified.username,
          email: null,
          role: verified.role,
          nickname: verified.nickname,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.nickname = user.nickname;
      }
      // 前端调用 update() 时（如修改昵称/资料后），不信任客户端传入的
      // session 数据，统一从数据库重读，防止伪造 token 中的身份信息，
      // 同时保证 nickname/role 变更后 token 同步刷新
      if (trigger === "update" && token.id) {
        const dbUser = await prisma.user.findUnique({
          where: { id: token.id as string },
        });
        if (dbUser) {
          token.name = dbUser.username;
          token.nickname = dbUser.nickname;
          token.role = dbUser.role;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as Role;
        session.user.nickname = token.nickname as string;
        session.user.name = token.name ?? session.user.name;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
};

export const { auth, handlers, signIn, signOut } = NextAuth(authConfig);
