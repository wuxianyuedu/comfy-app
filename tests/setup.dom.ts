/**
 * DOM 测试栈：jest-dom 匹配器 + RTL 卸载 + jsdom 能力缺口处置。
 *
 * **这一份由 `tests/setup.ts` 在「这份文件有 `document`」时动态载入**，node 档不载 ——
 * 实测那是一条每份文件都要交的固定税（数字与「为什么不按 project 分配」都写在
 * `tests/setup.ts` 的注释里：按 project 分会漏掉靠文件头改环境的那批 `tests/**` 用例）。
 */
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach } from "vitest";

import { installJsdomCapabilityGate } from "./helpers/jsdom-capability";

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
 * 而对不渲染的 node 档来说，这一句本身就是它不该载整份 DOM 栈的理由。 */
afterEach(() => {
  cleanup();
});

/* jsdom 的能力缺口（没有字体度量的 `getContext`、带伪元素的 `getComputedStyle`）走的是
 * `VirtualConsole` 那条 `jsdomError`，而默认通道把它原样打进 stderr —— 于是
 * 「宿主缺能力」与「被测代码真出错」在日志里**逐字同形**。这里接一次处置器：
 * 白名单内计数、白名单外逐字照 jsdom 默认形态转发，文件结束时把吞掉的条数与理由打出来
 * （没有这一行，「安静」与「被关掉」同形）。三条口径与为什么不装原生 `canvas` 包，
 * 写在 `helpers/jsdom-capability.ts` 文件头。
 *
 * 返回 `null` 表示这一档没有 jsdom（happy-dom 或文件头没改档）—— 那是环境事实，
 * 不是失败；`tests/jsdom-capability-gate.test.ts` 判的是处置器本身。 */
const jsdomCapability = installJsdomCapabilityGate(globalThis);
afterAll(() => {
  for (const line of jsdomCapability?.summaryLines() ?? []) {
    console.info(line);
  }
  jsdomCapability?.detach();
});
