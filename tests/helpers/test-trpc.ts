/**
 * `tests/helpers/test-trpc.ts` — 供前端集成用例现造「测试 tRPC router」的基建。transformer
 * 与 `src/server/api/trpc.ts` 一致（superjson），但不对接真实 db / 文件系统：procedure 返回
 * 测试可控的预设值，用于驱动被测组件走 loading → data → error / 缓存失效等数据态流转。
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

/**
 * 测试 tRPC client 的**端点**（handler 与用例共用口径）：不能写死 `http://localhost:3100`，那是按 jsdom 挑的 ——
 * 其 fetch 不做同源检查（MSW 照样拦），而 happy-dom 的 `window.fetch` 先做 SOP 判定，请求**根本没到 MSW**，
 * 表现是「数据永远不回来」而报错不提 origin；`window.location.origin` 两环境均 `localhost:3000` ⇒ 恒同源，别改回 `127.0.0.1:3100`。
 */
export function testTrpcEndpoint(): string {
  const origin = typeof window === "undefined" ? "http://localhost" : window.location.origin;
  return `${origin}/api/trpc`;
}
