#!/usr/bin/env node
/**
 * ci-affected-tests.mjs — 「受影响用例」在**平台侧**的执行入口（跑法脚本）。
 *
 * ── 这一格是哪来的（2026-10-20）────────────────────────────────────────
 *
 * 「固定清单 + 受影响用例」这一档原本有两个本地执行者：`.githooks/pre-commit` 的
 * C 组，与 2026-10-19 从那里搬来的 `.githooks/pre-push`（`premerge-check.mjs` 的
 * `unitTests` 段）。两个都被撤了，合成这一格 —— 原因不是「想省本地时间」，是
 * **本地这一跳在最需要它给出结论的机器上给的恰是最不可信的读数**：
 *
 *   它会起 vitest 子进程，而共享机（另一条检出并发推自己的分支 + 多个 dev server
 *   抢核）上的失效形态不是用例红，是 `Failed to start forks worker /
 *   Timeout waiting for worker to respond`。实测：pre-push 的那一档被这种调度超时
 *   拦下，隔离复跑 88 个用例文件 / 1116 条**全绿** —— 也就是说拦与放都和代码无关。
 *
 * 判决链一个字没改：本脚本只做三件事（算改动面 → 起 `run-affected-tests.mjs` →
 * 把退出码转出去），判据与启动逻辑仍是那一份（§12.18 / §12.12：不发明第二套编排）。
 *
 * ── 三件口径，都与既有机制逐字同源 ─────────────────────────────────────
 *
 *   ① **改动面**：PR 事件上平台给 `CNB_PULL_REQUEST_TARGET_SHA`（官方
 *      `build-in-env.md`；`.cnb.yml` 的分支守卫一格早已在用同一族变量），按
 *      **三点** diff（`<target>...HEAD` = 与目标的 merge-base 之差，正是「这个 PR
 *      改了什么」）取改动清单。读法 `--name-status -M`：改名的 **R 行两侧都进面**
 *      （只给新路径时，按旧路径读文件的用例会随改名整条漏跑，ISSUE #2226）。没有它
 *      （非 PR 事件 / 手工触发）时退回 `<remote>/master` 或本地 `master` 的
 *      merge-base 两点 diff —— 与撤掉的 `premerge-check.mjs#pushBatchFiles` 同一个口径。
 *   ② **拿不到改动面 ⇒ 退 2**，不是退 0：这一格没判 = 没有证据（§13.6.2）。
 *      清单为空（diff 为空）同样退 2 —— 空清单若放行，`vitest run` 会跑成全量，
 *      而「全量绿」在 PR 这一跳上是被 §13.5.21 明确否掉的那个读数。
 *   ③ **并发按现场核数收敛**：`scripts/ci-load.mjs` 的 `resolveCiWorkers()`
 *      （§13.5.21 的唯一出处）折算后经 `COMFY_PRECOMMIT_MAX_WORKERS` 交给启动器 ——
 *      这个变量只调并发、不碰任何判据（`resolveMaxWorkers()` 的注释写明）。
 *      超时形态的「等待负载回落 → 隔离复跑 → 仍超时则点名未校验」话术仍由
 *      `run-affected-tests.mjs` 自己负责，本脚本不重写一遍。
 *
 * 退出码与 `base-check` / `premerge` 逐字同口径：0 全绿（或未校验但已点名）/
 * 1 有档红 / 2 没跑起来。
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { resolveChangedFiles } from "./changed-scope.mjs";
import { resolveCiWorkers } from "./ci-load.mjs";

/* 「改动面怎么算」那一跳已经搬进 `scripts/changed-scope.mjs` —— 桌面壳门禁
 * （`scripts/shell-gate.mjs` 的 `--base` 形态）也要问同一个问题，两边各算一次
 * 就会在某一次改动里漂开（改名的旧路径算不算？三点 diff 还是两点？）。
 * 这里是**转出**，不是复制一份实现（§12.12 / §12.18）。 */
export { resolveChangedFiles };

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

/**
 * 这一次要判的改动面（仓库相对路径清单）。
 *
 * 实现搬进 `scripts/changed-scope.mjs`（桌面壳门禁共用同一份口径）；这里保留
 * 它的转出，调用方的形状与行为一字未变。
 *
 * @param {{env?: Record<string, string | undefined>, cwd?: string, runGit?: (args: string[], cwd: string) => {ok: boolean, stdout: string}, fallbackRef?: string | null}} [deps]
 * @returns {{ok: true, files: string[], renamedFrom: string[], via: string} | {ok: false, reason: string}}
 */

/**
 * 主流程。
 *
 * @param {{env?: Record<string, string | undefined>, cwd?: string, runGit?: (args: string[], cwd: string) => {ok: boolean, stdout: string}, fallbackRef?: string | null, spawn?: (script: string, env: NodeJS.ProcessEnv) => {status: number}}} [deps]
 * @returns {number} 退出码（0 / 1 / 2，与 base-check、premerge 同口径）
 */
export function main(deps = {}) {
  const env = deps.env ?? process.env;
  const changed = resolveChangedFiles(deps);
  if (!changed.ok) {
    process.stderr.write(
      `[ci-affected] ✗ ${changed.reason}（退 2 —— 这一格没判，不构成证据）\n`,
    );
    return 2;
  }
  if (changed.files.length === 0) {
    process.stderr.write(
      `[ci-affected] ✗ 改动面为空（${changed.via}）—— 退 2。空清单若放行，` +
        "启动器会把 vitest 跑成全量，而全量绿在 PR 这一跳上是被 §13.5.21 否掉的读数。\n",
    );
    return 2;
  }
  const { workers, cores, source } = resolveCiWorkers({ env });
  process.stdout.write(
    `[ci-affected] 改动面：${changed.files.length} 个文件（${changed.via}）；` +
      `并发 --maxWorkers=${workers}（${cores} 核，${source}）\n`,
  );
  if (changed.renamedFrom.length > 0) {
    process.stdout.write(
      `[ci-affected] 其中 ${changed.renamedFrom.length} 处是改名：旧路径也进了改动面` +
        `（${changed.renamedFrom.join(" ")}）—— 按旧路径引用那个文件的用例靠这一条才选得中\n`,
    );
  }
  const spawn =
    deps.spawn ??
    ((/** @type {string} */ script, /** @type {NodeJS.ProcessEnv} */ e) => {
      const r = spawnSync(process.execPath, [script], {
        cwd: ROOT,
        stdio: "inherit",
        env: { ...e, CI: "1" },
      });
      return { status: typeof r.status === "number" ? r.status : 2 };
    });
  /* 子进程 env：以进程环境为底，补两件（改动面 + 并发），注入的 env 覆盖同名项。
   * （.mjs 里写不了 `as`，收窄成 ProcessEnv 用 JSDoc 声明 —— spawnSync 的形参要它。） */
  /** @type {NodeJS.ProcessEnv} */
  const childEnv = {
    ...process.env,
    ...env,
    COMFY_AFFECTED_CHANGED: changed.files.join("\n"),
    COMFY_PRECOMMIT_MAX_WORKERS: String(workers),
  };
  const r = spawn(path.join(HERE, "run-affected-tests.mjs"), childEnv);
  /* 原值透传，**不改写**（三档：0 通过/已确认全是超时，1 真红，2 未判定）。
   * 平台把非零读成 stage 失败，所以 2 这一档在这一侧**不会被算进绿** —— 那正是
   * ISSUE #2225 要的：旧实现里「同块里一份超时 + 一份真断言红」被块级指纹读成退 0，
   * stage 报 success，那次真红没有任何一格会看见。
   * ⚠️ 这一档在本地钩子里**没有落点**：`run_group C` 早在档位开关之前 `return 0`
   * （2026-10-20 起本地不跑这一档，§13.5.25），所以本地只有手工 / `pnpm check:all`
   * 那一跳会读到 2 —— 按「未判定」念，不是绿也不是红。 */
  return r.status;
}

/* 只在被直接执行时跑 main（被 import 时只暴露纯函数给用例）。 */
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  process.exit(main());
}
