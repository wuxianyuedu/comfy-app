/**
 * 测试全局 setup：每个测试文件运行前执行。
 * - 重置内存限流桶，避免用例间互相污染
 */
import { beforeEach } from "vitest";
import { resetRateLimitBuckets } from "~/server/api/middleware/rate-limit";

beforeEach(() => {
  resetRateLimitBuckets();
});
