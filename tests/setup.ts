/**
 * 测试全局 setup：每个测试文件运行前执行。
 * - 注册 @testing-library/jest-dom 匹配器（toBeInTheDocument、toBeDisabled 等）
 * - 重置内存限流桶，避免用例间互相污染
 * - **每用例卸载已挂载的组件**（见下）
 * - 处置 jsdom 的能力缺口噪音（见文件末那一段）
 */
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeEach } from "vitest";
import { resetRateLimitBuckets } from "~/server/api/middleware/rate-limit";

import { installJsdomCapabilityGate } from "./helpers/jsdom-capability";
import { stripInheritedGitEnv } from "./helpers/git-sandbox-env";

/* 剥掉从钩子继承来的 git 环境（清单与机制见 `helpers/git-sandbox-env.ts`）。
 *
 * 放在这里而不是每份用例里：pre-commit 的 C 组跑在 `git commit` 的钩子进程内，
 * `GIT_DIR` / `GIT_INDEX_FILE` 一路继承进测试 worker。实测 20 份用例文件会自己
 * `git init` 一个临时仓库，带着那份环境时它们操作的是**调用方的真仓库** ——
 * 探针文件被写进真索引，下一次提交报 `Error building trees` 而报错一个字都不指向
 * 那条测试。这一处同时覆盖这些用例 spawn 的子进程（含被测判据脚本内部再起的 git）。 */
stripInheritedGitEnv();

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

/* jsdom 的能力缺口（没有字体度量的 `getContext`、带伪元素的 `getComputedStyle`）走的
 * 是 `VirtualConsole` 那条 `jsdomError`，而默认通道把它原样打进 stderr —— 于是
 * 「宿主缺能力」与「被测代码真出错」在日志里**逐字同形**，全量跑那一跑的读数被两行
 * 噪音占掉。这里接一次处置器：白名单内计数、白名单外逐字照 jsdom 默认形态转发，
 * 文件结束时把吞掉的条数与理由打出来（没有这一行，「安静」与「被关掉」同形）。
 * 三条口径与为什么不装原生 `canvas` 包，写在 `helpers/jsdom-capability.ts` 文件头。
 *
 * 返回 `null` 表示这一档根本没有 jsdom（node / happy-dom project）—— 那是环境事实，
 * 不是失败；判据面在 `tests/jsdom-capability-gate.test.ts`。 */
const jsdomCapability = installJsdomCapabilityGate(globalThis);
afterAll(() => {
  for (const line of jsdomCapability?.summaryLines() ?? []) {
    console.info(line);
  }
  jsdomCapability?.detach();
});
