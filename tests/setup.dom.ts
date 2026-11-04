/**
 * DOM 测试栈：jest-dom 匹配器 + RTL 卸载 + jsdom 能力缺口处置。**由 `tests/setup.ts` 在
 * 「这份文件有 `document`」时动态载入**，node 档不载（那是一条每份文件都要交的固定税；为何不按
 * project 分配见 `tests/setup.ts`：按 project 分会漏掉靠文件头改环境的那批 `tests/**` 用例）。
 */
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach } from "vitest";

import { installJsdomCapabilityGate } from "./helpers/jsdom-capability";

/* RTL 的自动清理**在本仓库是死的**：`@testing-library/react` 只在 `typeof afterEach === "function"`
 * 时才注册 `afterEach(cleanup)`，而 `globals: false`（`vitest.config.ts`）⇒ `globalThis.afterEach` 是
 * `undefined` ⇒ 那行注册从不执行。后果不是「少卸载一次」：组件留到下一条用例、scheduler 还排着活而环境
 * 先拆 ⇒ `ReferenceError: window is not defined`，以 unhandled error 打成全量跑的**非零退出码**（`pnpm
 * test` 红而用例全绿；实测来自一份 `renderHook` 用例）。放 setup：`cleanup` 幂等（§12.18）。 */
afterEach(() => {
  cleanup();
});

/* jsdom 的能力缺口（无字体度量的 `getContext`、带伪元素的 `getComputedStyle`）走 `VirtualConsole` 的
 * `jsdomError`，而默认通道把它原样打进 stderr —— 「宿主缺能力」与「被测代码真出错」在日志里**逐字同形**。
 * 这里接一次处置器：白名单内计数、白名单外逐字照 jsdom 默认形态转发，文件结束打出吞掉的条数与理由（没有这一行，「安静」与「被关掉」同形）；三条口径与为何不装原生 `canvas` 见 `helpers/jsdom-capability.ts` 文件头。
 * 返回 `null` 表示这一档没有 jsdom（happy-dom 或没改文件头）—— 环境事实，不是失败。 */
const jsdomCapability = installJsdomCapabilityGate(globalThis);
afterAll(() => {
  for (const line of jsdomCapability?.summaryLines() ?? []) {
    console.info(line);
  }
  jsdomCapability?.detach();
});
