/**
 * tests/helpers/test-trpc.ts — 供前端集成用例现造「测试 tRPC router」的基建。
 *
 * 与 `src/server/api/trpc.ts` 保持一致的 transformer（superjson），但不对接真实
 * db / 文件系统 —— procedure 返回测试脚本可控的预设值，用于驱动被测组件走
 * loading → data → error / 缓存失效等数据态流转。
 *
 * @module tests/helpers/test-trpc — 供前端集成用例现造「测试 tRPC router」的基建
 */
import { initTRPC } from "@trpc/server";
import superjson from "superjson";

/**
 * 无 context 的测试版 tRPC 实例（与 src/server/api/trpc.ts 同款 superjson transformer）。
 * procedure 内部无需读取 ctx，因此以空对象作 context 类型即可。
 */
export function createTestTRPC() {
  return initTRPC.context<object>().create({
    transformer: superjson,
    errorFormatter({ shape }) {
      return shape;
    },
  });
}
