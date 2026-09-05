// 轻量内存滑动窗口限流（单进程内生效）
// 适用于 standalone 单实例部署；多实例/Serverless 场景需换成 Redis 等共享存储

type Bucket = {
  timestamps: number[];
};

const buckets = new Map<string, Bucket>();

// 定期清理过期 bucket，避免内存缓慢增长（每 10 分钟）
const CLEANUP_INTERVAL = 10 * 60 * 1000;
let lastCleanup = Date.now();

function cleanup(windowMs: number) {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;
  for (const [key, bucket] of buckets) {
    bucket.timestamps = bucket.timestamps.filter((t) => now - t < windowMs);
    if (bucket.timestamps.length === 0) buckets.delete(key);
  }
}

export type RateLimitResult =
  | { success: true }
  | { success: false; retryAfterSeconds: number };

/**
 * 滑动窗口限流
 * @param key 限流维度（如 `login:1.2.3.4`）
 * @param limit 窗口内最大请求数
 * @param windowMs 窗口时长（毫秒）
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): RateLimitResult {
  cleanup(windowMs);
  const now = Date.now();
  const bucket = buckets.get(key) ?? { timestamps: [] };
  bucket.timestamps = bucket.timestamps.filter((t) => now - t < windowMs);

  if (bucket.timestamps.length >= limit) {
    const oldest = bucket.timestamps[0];
    const retryAfterSeconds = Math.ceil((oldest + windowMs - now) / 1000);
    buckets.set(key, bucket);
    return { success: false, retryAfterSeconds };
  }

  bucket.timestamps.push(now);
  buckets.set(key, bucket);
  return { success: true };
}

// 从请求中提取客户端 IP 维度。
// TRUST_PROXY=true：信任反向代理传入的 X-Forwarded-For（取第一跳）。
// TRUST_PROXY=false（直接暴露）：忽略所有可伪造的转发头，返回固定值。
// 此时 IP 维度退化为共享桶（防爆破靠登录接口的「用户名」维度限流兜底），
// 共享桶阈值应放宽，避免正常用户互相挤兑（见 auth 路由）。
const TRUST_PROXY = process.env.TRUST_PROXY === "true";

export function clientIp(req: Request): string {
  if (TRUST_PROXY) {
    const xff = req.headers.get("x-forwarded-for");
    if (xff) return xff.split(",")[0].trim();
  }
  return "direct";
}

// 是否信任代理（登录接口据此选择阈值：代理后按真实 IP 收紧；直连时共享桶放宽）
export function isTrustingProxy(): boolean {
  return TRUST_PROXY;
}
