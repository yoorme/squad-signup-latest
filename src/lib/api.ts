import { NextResponse } from "next/server";

// 统一错误处理
export type ApiResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ ok: true, data }, init);
}

export function fail(error: string, status: number = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

// 业务校验错误：抛出后由 withErrorHandler 原样返回给客户端（默认 400）
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number = 400) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

// 兼容历史代码：部分路由直接 throw new Error("UNAUTHORIZED"/"FORBIDDEN")
const AUTH_ERRORS: Record<string, { message: string; status: number }> = {
  UNAUTHORIZED: { message: "未登录", status: 401 },
  FORBIDDEN: { message: "无权限", status: 403 },
};

// 包装 API 处理函数，统一处理权限错误与异常响应
// 业务错误（ApiError / 历史字符串标记）原样返回；
// 其余非预期异常只记服务端日志，对外一律返回"服务器错误"，避免内部实现细节外泄
export function withErrorHandler<TArgs extends any[]>(
  handler: (...args: TArgs) => Promise<Response>
) {
  return async (...args: TArgs): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const authError = AUTH_ERRORS[msg];
      if (authError) {
        return fail(authError.message, authError.status);
      }
      if (e instanceof ApiError) {
        return fail(e.message, e.status);
      }
      console.error("[API Error]", e);
      return fail("服务器错误，请稍后重试", 500);
    }
  };
}
