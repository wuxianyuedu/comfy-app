#!/usr/bin/env node
/**
 * changed-scope.mjs — 「这次改动面」的**唯一出处**
 *
 * ── 它收的是哪一件事 ───────────────────────────────────────────────────
 *
 * 「这次改动改了哪些文件」这件事，本仓现在有**两个消费点**：
 *
 *   · `scripts/ci-affected-tests.mjs`（「受影响用例」那一格）—— 拿改动面选用例；
 *   · `scripts/shell-gate.mjs`（桌面壳门禁）—— 拿改动面判「这次碰没碰壳」。
 *
 * 两者问的是**同一个问题**，而答案的形态必须一致：一条 PR 的改动面在两处各算一次，
 * 两处的口径就会在某一次改动里漂开（改名的旧路径算不算？三点 diff 还是两点？）。
 * ⇒ 本模块把「算改动面」这一跳收成一处，两边各调它。
 *
 * ── 口径（三条，逐条都有出处）──────────────────────────────────────────
 *
 *   ① **基线怎么来**：PR 事件上平台给 `CNB_PULL_REQUEST_TARGET_SHA`（官方
 *      `build-in-env.md`；`.cnb.yml` 的分支守卫一格早已在用同一族变量）；
 *      非 PR 事件 / 手工触发时退回「要并进去的那条」（各 remote 的 `master`，
 *      再退回本地 `master`）与 HEAD 的分叉点。
 *   ② **diff 形态**：一律**三点**（`<base>...HEAD` = 与基线的 merge-base 之差）。
 *      基线是分叉点时三点与两点等价，所以两档能并成一条命令。
 *   ③ **改名怎么读**：`--name-status -M`，改名的 **R 行两侧都进面**（只给新路径时，
 *      按旧路径读文件的用例会随改名整条漏跑，ISSUE #2226）。
 *   ④ **路径必须原样**：`git diff` 默认（`core.quotePath=true`，git 的默认值）把**含非 ASCII
 *      字符**的路径按 C 风格转义并**加引号** —— 实测输出是
 *      `M\t"docs/standards/15-\351\231\204\345\275\225.md"`。本仓**38 份被跟踪文件的
 *      文件名带非 ASCII**（全在 `docs/` 下）⇒ 不关掉它，改动面里那一条与真实路径对不上。
 *      而机器之间还**各不相同**：本机全局配了 `core.quotepath=false`，CI runner 是 git
 *      默认值 ⇒ **同一份代码在平台与本机是两种判决**（ISSUE #2272）。
 *      ⇒ 本模块的每一条 `git diff` 都带 `-c core.quotePath=false`。
 *
 * ── 拿不到基线 / 拿不到清单 ⇒ 「没判」而不是「空」 ─────────────────────
 *
 * 两者都返回 `{ok:false, reason}`，由调用方按**各自那一档的退出码**处理
 * （`ci-affected-tests.mjs` 退 2；`shell-gate.mjs` 在 `--base` 形态下退 2）。
 * 刻意**不**返回空清单冒充「这次没改任何东西」—— 空清单若放行，
 * 「受影响用例」那一格会把 vitest 跑成全量，而全量绿在 PR 这一跳上是被否掉的读数。
 *
 * 用法（一般不直接跑）：
 *   · `resolveBaseRef(deps)`        ⇒ 「基线是哪一条」
 *   · `changedFilesForBaseRef(ref)` ⇒ 「相对那条基线改了哪些文件」
 *   · `resolveChangedFiles(deps)`   ⇒ 前两件事合起来（按环境选基线）
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { changedPathsFromNameStatus } from "./affected-tests.mjs";
import { resolveMergeBaseRef } from "./base-check/git-ref.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

/**
 * 跑一条 git 命令（`{ ok, stdout }`：失败与「空输出」必须分得开 —— `git diff`
 * 没有差异时也是空输出，而那不是故障）。
 *
 * @param {string[]} args
 * @param {{cwd?: string, runGit?: (args: string[], cwd: string) => {ok: boolean, stdout: string}}} [deps]
 * @returns {{ok: boolean, stdout: string}}
 */
export function gitRun(args, deps = {}) {
  const cwd = deps.cwd ?? ROOT;
  const runGit =
    deps.runGit ??
    ((/** @type {string[]} */ a, /** @type {string} */ c) => {
      const r = spawnSync("git", a, {
        cwd: c,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      return {
        ok: r.status === 0,
        stdout:
          r.status === 0 ? String(r.stdout ?? "") : String(r.stderr ?? ""),
      };
    });
  return runGit(args, cwd);
}

/**
 * 基线是哪一条 —— 「这次改动面」的那一端。
 *
 * 两档的顺序不能换：PR 事件上**平台给的**目标 sha 才是「这个 PR 要并进去的那条」，
 * 而本地的 `master` 在 PR 事件上可能已经前进（跑完这一格时它常常已经含了别的 PR）。
 *
 * `dots` 那一格是**逐字沿用**既有实现的两档形态（PR 三点 / 兜底两点）：那两档在
 * 语义上等价（兜底档的基线本身就是分叉点），但形态是既有用例钉着的判据 —— 改它
 * 等于改判决链（§12.18「不改判据」）。
 *
 * @param {{env?: Record<string, string | undefined>, cwd?: string, runGit?: (args: string[], cwd: string) => {ok: boolean, stdout: string}, fallbackRef?: string | null}} [deps]
 * @returns {{ok: true, ref: string, via: string, dots: "..." | ".."} | {ok: false, reason: string}}
 */
export function resolveBaseRef(deps = {}) {
  const env = deps.env ?? process.env;
  /* ① PR 事件：平台给的目标分支 sha。 */
  const target = String(env.CNB_PULL_REQUEST_TARGET_SHA ?? "").trim();
  if (target !== "") {
    return {
      ok: true,
      ref: target,
      via: "CNB_PULL_REQUEST_TARGET_SHA（三点 diff）",
      dots: "...",
    };
  }
  /* ② 非 PR 事件 / 手工触发：退回「要并进去的那条」的 merge-base。 */
  const remoteRef =
    deps.fallbackRef !== undefined
      ? deps.fallbackRef
      : resolveMergeBaseRef(deps.cwd ?? ROOT);
  if (!remoteRef) {
    return {
      ok: false,
      reason:
        "取不到 PR 目标 sha、也取不到要并进去的那条（各 remote 的 master / 本地 master）—— 先 fetch 再跑",
    };
  }
  const mb = gitRun(["merge-base", remoteRef, "HEAD"], deps);
  if (!mb.ok || mb.stdout.trim() === "") {
    return {
      ok: false,
      reason: `算不出 ${remoteRef} 与 HEAD 的分叉点（浅克隆 / 历史不全）`,
    };
  }
  return {
    ok: true,
    ref: mb.stdout.trim(),
    via: `${remoteRef} 的分叉点`,
    dots: "..",
  };
}

/**
 * 相对给定基线改了哪些文件（含改名的旧路径）。
 *
 * 读法 `--name-status -M`：改名的 **R 行两侧都进面** —— 只给新路径时，
 * 按旧路径消费该文件的用例与判据会随改名整条漏掉（ISSUE #2226）。
 *
 * @param {string} ref 基线（一条 ref 或一个 sha）
 * @param {{cwd?: string, runGit?: (args: string[], cwd: string) => {ok: boolean, stdout: string}}} [deps]
 * @param {"..." | ".."} [dots] diff 形态：三点（`ref...HEAD`）/ 两点（`ref..HEAD`）
 * @returns {{ok: true, files: string[], renamedFrom: string[]} | {ok: false, reason: string}}
 */
export function changedFilesForBaseRef(ref, deps = {}, dots = "...") {
  /* `-c core.quotePath=false` 是**必须的**（ISSUE #2272，机制写在本文件头「口径 ④」）：
   * 不带它，git 会把非 ASCII 路径转义加引号（`"docs/standards/15-\351\231\204..."`），
   * 改动面里那一条与真实路径对不上 ⇒ 「改了文档源、镜像没同批带上」在平台上永远判不出来，
   * 而本机（全局配了 `core.quotepath=false`）看不出来 —— 同一份代码两种判决。 */
  const got = gitRun(
    ["-c", "core.quotePath=false", "diff", "--name-status", "-M", `${ref}${dots}HEAD`],
    deps,
  );
  if (!got.ok) {
    return {
      ok: false,
      reason:
        `${ref} 的 diff 没跑起来` +
        "（浅克隆 / 该 sha 不在本地对象库里；先 fetch 再跑）",
    };
  }
  const parsed = changedPathsFromNameStatus(got.stdout);
  return { ok: true, files: parsed.paths, renamedFrom: parsed.renamedFrom };
}

/**
 * 按环境选基线、取出这次的改动面。
 *
 * @param {{env?: Record<string, string | undefined>, cwd?: string, runGit?: (args: string[], cwd: string) => {ok: boolean, stdout: string}, fallbackRef?: string | null}} [deps]
 * @returns {{ok: true, files: string[], renamedFrom: string[], via: string} | {ok: false, reason: string}}
 */
export function resolveChangedFiles(deps = {}) {
  const base = resolveBaseRef(deps);
  if (!base.ok) return { ok: false, reason: base.reason };
  const got = changedFilesForBaseRef(base.ref, deps, base.dots);
  if (!got.ok) return { ok: false, reason: got.reason };
  return {
    ok: true,
    files: got.files,
    renamedFrom: got.renamedFrom,
    via: base.via,
  };
}
