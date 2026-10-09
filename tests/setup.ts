/**
 * 测试全局 setup：每个测试文件运行前执行。
 * - 注册 @testing-library/jest-dom 匹配器（toBeInTheDocument、toBeDisabled 等）
 * - 重置内存限流桶，避免用例间互相污染
 * - **每用例卸载已挂载的组件**（见下）
 */
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";
import { resetRateLimitBuckets } from "~/server/api/middleware/rate-limit";

/* RTL 的自动清理**在本仓库是死的**：`@testing-library/react` 只在
 * `typeof afterEach === "function"` 时才 `afterEach(cleanup)`，而本仓库
 * `globals: false`（`vitest.config.ts`）⇒ `globalThis.afterEach` 是 `undefined`
 * ⇒ 那行注册**从不执行**。
 *
 * 后果不是「少卸载一次」这么轻：一次用例里挂上的组件会留到同一文件的下一条用例，
 * 其间 React 的 scheduler 可能还排着活（`setImmediate` / 微任务），环境先被拆掉、
 * 回调再落地 ⇒ `ReferenceError: window is not defined`。它以 **unhandled error**
 * 的形式被打成全量跑的**非零退出码**（`pnpm test` 红、而用例本身全绿），
 * 也就是「判红指向的东西不是判据」那一族。
 *
 * 实测：`globalThis.afterEach === undefined`；全量跑里那条未处理错误就来自
 * 一份 `renderHook` 的用例。仓里此前已有两份用例各自手写 `afterEach(cleanup)`
 * 绕过它 —— 那是各自补地基，收在这里一处写一次（§12.18）。
 *
 * 放 setup 而不是「要求每份用例自己写」：`cleanup` 是**幂等**的（没挂载就什么都不做），
 * 对不渲染的 node 用例零代价；而要求 169 份用例各自记得写，正是这套机制当初失效的形态。 */
afterEach(() => {
  cleanup();
});

beforeEach(() => {
  resetRateLimitBuckets();
});
