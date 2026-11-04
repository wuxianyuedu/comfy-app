/**
 * 测试全局 setup：每个测试文件运行前执行 —— 剥掉从钩子继承来的 git 环境、重置内存限流桶，且**只在有
 * DOM 的那份文件里**载 DOM 测试栈（jest-dom 匹配器 / RTL 卸载 / jsdom 缺口处置）。
 */
import { beforeEach } from "vitest";
import { resetRateLimitBuckets } from "~/server/api/middleware/rate-limit";

import { stripInheritedGitEnv } from "./helpers/git-sandbox-env";

/* 剥掉从钩子继承来的 git 环境（清单与机制见 `helpers/git-sandbox-env.ts`）。放这里而非每份用例：pre-commit
 * 的 C 组跑在 `git commit` 钩子进程内，`GIT_DIR` / `GIT_INDEX_FILE` 继承进 worker —— 实测 20 份会自己
 * `git init` 的用例带着它操作的是**调用方的真仓库**，探针文件写进真索引、下次提交报 `Error building trees`
 * 而报错一个字都不指向那条测试。这一处同时覆盖这些用例 spawn 的子进程（含判据脚本内部再起的 git）。 */
stripInheritedGitEnv();

beforeEach(() => {
  resetRateLimitBuckets();
});

/**
 * DOM 栈按「这份文件到底有没有 `document`」决定载不载 —— **不是按 project 分**。实测 60 份最便宜 node 档文件（断言合计 1.4s）：总时长 25.69s→13.22s、setup 占比 70%→8%，因 94% 时间在每份文件的固定装载，最大一块是 `@testing-library/react` + jest-dom（全量 782 份 × 约 0.2s 墙钟）。
 * ⚠️ 不能按 project 分配 `setupFiles`：带 `// @vitest-environment jsdom` 文件头的 `tests/**` 用例由 node 档 include、不在 DOM project 里（见 `vitest.config.ts` 与 `scripts/check-test-environment.cjs`），否则这批**静默**拿不到 RTL 卸载与 jsdom 缺口处置器，而后者恰在自己的用例里断言「接线没断」，红起来像处置器坏了、真因是分配漏了一类文件。
 * 顶层 `await import()` 安全：`tsconfig` 是 `target: es2022` + `module: ESNext`，setup 在测试文件的模块图之前跑完。
 */
if (typeof globalThis.document !== "undefined") {
  await import("./setup.dom");
}
