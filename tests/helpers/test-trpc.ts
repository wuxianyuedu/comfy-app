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

/**
 * 测试 tRPC client 该拨的**端点**（`setupTrpcServer()` 的 handler 与各用例的
 * `httpBatchStreamLink({ url })` 共用这一份口径）。
 *
 * ## 为什么不能写死 `http://localhost:3100`
 *
 * 那个常量是**按 jsdom 的行为挑的**，而 jsdom 的 `fetch` 不做同源检查：
 * 它允许页面代码发一个跨源请求，于是 MSW 照样拦得到。换到 happy-dom 之后同一行
 * 常量会**当场换一种红**：happy-dom 的 `window.fetch` 会先做 SOP 判定
 * （目标 origin ≠ `window.location.origin` ⇒
 * `Cross-Origin Request Blocked …`），请求**根本没到 MSW** ——
 * 表现是集成用例集体「数据永远不回来」，而报错里一个字都不提 origin。
 *
 * ## 口径：跟着**运行环境的 origin** 走
 *
 * `window.location.origin` 在 jsdom 与 happy-dom 下都是
 * `http://localhost:3000`（两个环境各自的默认值），所以按它拼出来的 URL
 * **恒为同源**，两种环境行为一致；`setupTrpcServer()` 的 handler 本来就是
 * host 无关的（`*` 通配段 + `/api/trpc/` 前缀），因此这条口径同时把
 * 「handler 匹配」与「fetch 放行」两件事都满足了。
 *
 * ⚠️ 别改回写死的 `127.0.0.1:3100`：那在 happy-dom 下是与应用同源的**反面**
 * （异源），红法同上。生产侧的对应物是 `~/trpc/base-url` 的 `getBaseUrl()`
 * —— 它在 DOM 宿主下同样取 `window.location.origin`，这里是它的测试版对偶。
 */
export function testTrpcEndpoint(): string {
  const origin =
    typeof window === "undefined" ? "http://localhost" : window.location.origin;
  return `${origin}/api/trpc`;
}
