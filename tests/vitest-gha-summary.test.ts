/**
 * `vitest.config.ts` 的 `reporters: ["default"]`（2026-11-09）：**在 GA 的 Job Summary
 * 里不许再出现 `## Vitest Test Report`**。
 *
 * 为什么值得一条正面用例：那次乱页（GA `Daily (mirror)` / PR 判据页）的主角不是
 * `ci-step-verdict.mjs`，而是 vitest 5 的 `github-actions` reporter —— `GITHUB_ACTIONS`
 * 一开它就自动追加，**每个 vitest 进程各往 `$GITHUB_STEP_SUMMARY` 写一份**
 * `## Vitest Test Report`（用例级计数表）。一次 job 跑几个 vitest 进程，摘要里就有
 * 几段，数字还互相矛盾（3 passes 与 1 pass 并排）—— 读者没法判断哪份是这次的总账。
 *
 * 本用例按「终态行为」正面判：起一个带 `GITHUB_ACTIONS=true` + 真 `$GITHUB_STEP_SUMMARY`
 * 的 vitest 子进程跑一条已知绿用例，读回摘要文件，断言：
 *   ① 文件存在且非空（管道真的接上了 —— 没接上时这条会静默通过，所以先验管道）；
 *   ② 摘要里没有 `Vitest Test Report`（reporter 的自动追加已被配置关掉）。
 * 配置那一行被谁改回 `["default", "github-actions"]` 时，② 会红。
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

describe("GA 摘要里不许出现 vitest 的自动报表（vitest.config.ts 的 reporters）", () => {
  test("GITHUB_ACTIONS=true 跑一次，$GITHUB_STEP_SUMMARY 里没有 `Vitest Test Report`", () => {
    const dir = mkdtempSync(join(tmpdir(), "vitest-gha-summary-"));
    const summaryPath = join(dir, "step-summary.md");
    try {
      execFileSync(
        process.execPath,
        [
          join("node_modules", "vitest", "vitest.mjs"),
          "run",
          "tests/ci-step-verdict.test.ts",
          /* ⚠️ **不许**在这里传 `--reporter=...`：命令行 reporter 会**整个覆盖**
           * `test.reporters`，vitest 的「GITHUB_ACTIONS 下自动追加 github-actions」
           * 也随之消失 —— 那样这条用例测的是「我们自己在命令行关了它」，永远绿，
           * 配置被人改回去它也发现不了（本用例落地前实骂过一次：带
           * `--reporter=dot` 跑，反向验证不红；摘掉才红）。安静靠 stdio:"ignore"。 */
        ],
        {
          encoding: "utf8",
          cwd: process.cwd(),
          stdio: "ignore",
          env: {
            ...process.env,
            GITHUB_ACTIONS: "true",
            GITHUB_STEP_SUMMARY: summaryPath,
            GITHUB_REPOSITORY: "wuxianyuedu/comfy-app",
            GITHUB_SHA: "0000000000000000000000000000000000000000",
            GITHUB_WORKSPACE: process.cwd(),
          },
        },
      );
      const summary = readFileSync(summaryPath, "utf8");
      /* ① 管道在场：GITHUB_ACTIONS=true 下至少 ci-step-verdict 的那几段会写进来。
       * 摘要为空说明环境变量没传进去，这条用例就失去意义 —— 先红在这里。 */
      expect(summary.trim().length).toBeGreaterThan(0);
      /* ② 正面判据：reporter 的自动追加不许回来。 */
      expect(summary).not.toContain("Vitest Test Report");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
