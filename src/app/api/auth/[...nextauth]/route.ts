import { NextRequest, NextResponse } from "next/server";
import { handlers } from "@/auth";
import { rateLimit, clientIp, isTrustingProxy } from "@/lib/rate-limit";

export const { GET } = handlers;

// 仅对 credentials 登录回调限流，防止密码爆破。
// 双维度：
//   1. IP 维度 —— 反代后按真实 IP 5 次/分钟；直接暴露时所有客户端共享桶放宽到 30 次/分钟
//      （直连时 IP 可被伪造头轮换绕过，真正防线是下面的用户名维度）
//   2. 用户名维度 —— 同一账号 10 次/分钟，伪造任何头都无法提高单账号爆破速度
// 其他 POST（如 signout、session 刷新）不受影响
export async function POST(req: NextRequest) {
  if (req.nextUrl.pathname.endsWith("/callback/credentials")) {
    const clone = req.clone();
    let username = "";
    try {
      const form = await clone.formData();
      username = String(form.get("username") ?? "").trim().toLowerCase();
    } catch {
      // 表单解析失败交给 NextAuth 返回标准错误
    }

    const ipLimit = isTrustingProxy() ? 5 : 30;
    const rlIp = rateLimit(`login:${clientIp(req)}`, ipLimit, 60_000);
    if (!rlIp.success) {
      return tooMany(rlIp.retryAfterSeconds);
    }
    if (username) {
      const rlUser = rateLimit(`loginuser:${username}`, 10, 60_000);
      if (!rlUser.success) {
        return tooMany(rlUser.retryAfterSeconds);
      }
    }
  }
  return handlers.POST(req);
}

function tooMany(retryAfterSeconds: number) {
  return NextResponse.json(
    { ok: false, error: "尝试过于频繁，请稍后再试" },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } }
  );
}
