/**
 * 测试全局 setup：每个测试文件运行前执行。
 * - 注册 @testing-library/jest-dom 匹配器（toBeInTheDocument、toBeDisabled 等）
 * - 重置内存限流桶，避免用例间互相污染
 */
import "@testing-library/jest-dom/vitest";
import { beforeEach } from "vitest";
import { resetRateLimitBuckets } from "~/server/api/middleware/rate-limit";

beforeEach(() => {
  resetRateLimitBuckets();
});
