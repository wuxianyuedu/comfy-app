/**
 * 内存滑动窗口限流（单实例部署友好）：本地 SQLite 单机无需 Redis/Upstash；纯函数、零 tRPC 依赖，
 * 避免与 trpc.ts 循环引用，由其 `rateLimitedProcedure` 中间件消费；多副本时把 `checkRateLimit` 内部
 * 换成 Redis/Upstash 滑动窗口（@upstash/ratelimit），接口不变。匿名限流依赖 `x-forwarded-for`，直连回退 "anon"。
 */

type SlidingWindowEntry = {
  timestamps: Array<number>;
};

const buckets = new Map<string, SlidingWindowEntry>();

const MAX_BUCKETS = 10_000;

/**
 * 检查并记录一次请求。窗口内超过 max 次则拒绝。
 * @returns true = 放行；false = 超限拒绝
 */
export function checkRateLimit(key: string, max = 20, windowMs = 10_000): boolean {
  const now = Date.now();

  let entry = buckets.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    buckets.set(key, entry);
  }

  // 滑出窗口的旧时间戳剔除
  entry.timestamps = entry.timestamps.filter((timestamp) => now - timestamp < windowMs);

  if (entry.timestamps.length >= max) {
    return false;
  }

  entry.timestamps.push(now);

  // 防御：桶数量过大时做一次全量清理
  if (buckets.size > MAX_BUCKETS) {
    for (const [k, v] of buckets) {
      v.timestamps = v.timestamps.filter((timestamp) => now - timestamp < windowMs);
      if (v.timestamps.length === 0) {
        buckets.delete(k);
      }
    }
  }

  return true;
}

/** 测试辅助：清空所有限流桶。 */
export function resetRateLimitBuckets(): void {
  buckets.clear();
}
