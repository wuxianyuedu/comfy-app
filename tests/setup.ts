/**
 * 测试全局 setup：每个测试文件运行前执行。
 * - 剥掉从钩子继承来的 git 环境
 * - 重置内存限流桶
 * - **只在有 DOM 的那份文件里**载 DOM 测试栈（jest-dom 匹配器 / RTL 卸载 / jsdom 缺口处置）
 */
import { beforeEach } from "vitest";
import { resetRateLimitBuckets } from "~/server/api/middleware/rate-limit";

import { stripInheritedGitEnv } from "./helpers/git-sandbox-env";

/* 剥掉从钩子继承来的 git 环境（清单与机制见 `helpers/git-sandbox-env.ts`）。
 *
 * 放在这里而不是每份用例里：pre-commit 的 C 组跑在 `git commit` 的钩子进程内，
 * `GIT_DIR` / `GIT_INDEX_FILE` 一路继承进测试 worker。实测 20 份用例文件会自己
 * `git init` 一个临时仓库，带着那份环境时它们操作的是**调用方的真仓库** ——
 * 探针文件被写进真索引，下一次提交报 `Error building trees` 而报错一个字都不指向
 * 那条测试。这一处同时覆盖这些用例 spawn 的子进程（含被测判据脚本内部再起的 git）。 */
stripInheritedGitEnv();

beforeEach(() => {
  resetRateLimitBuckets();
});

/**
 * DOM 栈按「这份文件到底有没有 `document`」决定载不载 —— **不是按 project 分**。
 *
 * 代价的实测形状（同一份配置、60 份**最便宜**的 node 档文件，断言合计只有 1.4s）：
 *
 * ```
 * 之前：Duration 25.69s (setup 70%, import 24%, transform 4%, tests 1%)
 * 之后：Duration 13.22s (import 73%, transform 14%, setup 8%, tests 3%, worker 3%)
 * ```
 *
 * 也就是便宜文件上 94% 的时间在每份文件的固定装载，而 `setup` 那 70% 里最大一块是
 * `@testing-library/react` + jest-dom 匹配器 —— node 档没有 `document`，载了用不上，
 * 但每份文件都要各交一次（全量 782 份 × 每份约 0.2s 墙钟）。
 *
 * ⚠️ 为什么写成条件而不是给 DOM 档单独配一份 `setupFiles`：**带
 * `// @vitest-environment jsdom` 文件头的那些 `tests/**` 用例不在 DOM project 里**
 * （它们由 node 档 include、靠文件头改环境，见 `vitest.config.ts` 的 projects 那一段与
 * `scripts/check-test-environment.cjs`）。按 project 分配 setup 会让这一批**静默**拿不到
 * RTL 卸载与 jsdom 缺口处置器 —— 而后者恰好在自己的用例里断言「接线没断」，
 * 红起来看着像处置器坏了，真原因是分配漏了一类文件。按 `document` 判就没有这一格。
 *
 * 顶层 `await import()` 在这里是安全的：`tsconfig` 是 `target: es2022` + `module: ESNext`，
 * 而 setup 文件在测试文件的模块图之前跑完。
 */
if (typeof globalThis.document !== "undefined") {
  await import("./setup.dom");
}
