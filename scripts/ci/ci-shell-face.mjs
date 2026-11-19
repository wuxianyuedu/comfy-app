#!/usr/bin/env node
/**
 * `ci-shell-face.mjs` —— 回答「这次改动要不要装 Tauri 的 Linux 系统依赖」（#4309）。
 *
 * ## 它补的那一格
 *
 * `pr-gate.yml` 的「装 Tauri 的 Linux 系统依赖」过去**无条件**装 12 个包：判据的
 * 触发面在判据内部算，workflow 层拿不到那个面 ⇒ 只能每个 PR 都付。实测（15 次
 * pr-gate）里 7 次这一步超过 8 分钟、2 次撞死在 15 分钟步级超时上；慢的时候不是
 * 拉索引（13.2MB 只要 3s），是 install 阶段 `-qq` 之下整段静默——慢样本里
 * 「Reading package lists...」到第一行 dpkg 输出之间 **561 秒一行日志都没有**。
 *
 * 而那些库只有「壳门禁真的要编 Tauri」时才被问到，壳门禁只在改动面命中
 * `SHELL_INPUT_RE`（src-tauri 的四类壳输入）时才编。本脚本把同一个问题提前到
 * workflow 层回答：改动面走 `scripts/lib/changed-scope.mjs` 的**同一条链**
 * （`resolveBaseRef` → `changedFilesForBaseRef` → `reconcileSyntheticMergeFace`，
 * 与 shell-gate 逐字同源），匹配直接 import shell-gate 的 `SHELL_INPUT_RE` ——
 * 不抄第二份模式。于是：判据说要编，这里必然说「要装」；这里说「不用装」，
 * 判据必然跳过编译。没碰壳的 PR 从此不付这笔 apt（快跑 30s、慢跑十几分钟都不付）。
 *
 * ## 失败语义：fail-open
 *
 * 这一步是**省钱**的，不是闸。基线拿不到 / diff 没跑起来 / 改动面读不全 ⇒
 * 一律按「要装」处理（`shell=true`，exit 0）。误装 = 多付一次 apt；
 * 误跳 = 壳门禁红在缺库上，那才是事故。workflow 侧的条件也写成
 * `!= 'false'`：本步没跑到 / 输出缺席时同样装。
 *
 * ## 用法
 *
 * ```text
 * node scripts/ci/ci-shell-face.mjs   # 往 $GITHUB_OUTPUT 写 shell=true|false，恒退 0
 * ```
 */
import fs from "node:fs";
import process from "node:process";

import {
  changedFilesForBaseRef,
  reconcileSyntheticMergeFace,
  resolveBaseRef,
} from "../lib/changed-scope.mjs";
import { SHELL_INPUT_RE } from "../gates/shell-gate.mjs";

/**
 * 判这次改动命没命中壳输入。任何读数拿不全都折成「要装」（fail-open，见文件头）。
 *
 * @param {{
 *   env?: Record<string, string | undefined>,
 *   log?: (s: string) => void,
 *   runGit?: (args: string[], cwd: string) => {ok: boolean, stdout: string},
 *   fallbackRef?: string | null,
 * }} [deps] env 供 changed-scope 读 `CNB_PULL_REQUEST_TARGET_SHA` / `CNB_COMMIT`；
 *   runGit / fallbackRef 是测试注入口（不传 = 真 git、真兜底）；用例不碰真机。
 * @returns {{shell: boolean, total: number, hits: string[], via: string}}
 *   `shell` = 要不要装；`total` = 改动面条数（fail-open 时 -1）；`hits` = 命中的壳输入；
 *   `via` = 改动面从哪来（读数）。
 */
export function shellFace({
  env = process.env,
  log = (s) => {
    console.log(s);
  },
  runGit,
  fallbackRef,
} = {}) {
  /** @type {(reason: string) => {shell: boolean, total: number, hits: string[], via: string}} */
  const failOpen = (reason) => {
    log(`[shell-face] ${reason} ⇒ 按「要装」处理（fail-open：这一步是省钱，不是闸）。`);
    return { shell: true, total: -1, hits: [], via: `fail-open（${reason}）` };
  };
  const base = resolveBaseRef({ env, runGit, fallbackRef });
  if (!base.ok) {
    return failOpen(base.reason);
  }
  const got = changedFilesForBaseRef(base.ref, { runGit }, base.dots);
  if (!got.ok) {
    return failOpen(got.reason);
  }
  /* 改名的旧路径会在 files 与 renamedFrom 里各出现一次：读数去重，判定是存在性语义，
   * 重复项只会让读数难看。 */
  let files = [...new Set([...got.files, ...got.renamedFrom])];
  let via = `${base.via} · 改动面 ${files.length} 条`;
  /* 合成 merge 提交的对账与 shell-gate 同一把：剔掉「目标分支在基线之后自己落地的」
   * 那部分，别把别人的壳改动算成这个 PR 的（ISSUE #2325）。对不上账就不动面
   * （reconcile 自己会说明为什么），宁可多装一次也不误跳。 */
  const face = reconcileSyntheticMergeFace(base.ref, { env, runGit });
  if (face.used) {
    files = [...new Set([...face.files, ...face.renamedFrom])];
    via += ` · 合成合并对账后 ${files.length} 条`;
  }
  const hits = files.filter((f) => SHELL_INPUT_RE.test(f));
  return { shell: hits.length > 0, total: files.length, hits, via };
}

/**
 * workflow 步骤入口：打读数 + 写 `$GITHUB_OUTPUT`，**恒退 0**（fail-open 见文件头）。
 *
 * @param {{
 *   env?: Record<string, string | undefined>,
 *   log?: (s: string) => void,
 *   runGit?: (args: string[], cwd: string) => {ok: boolean, stdout: string},
 *   fallbackRef?: string | null,
 * }} [deps]
 * @returns {number} 恒 0
 */
export function main({
  env = process.env,
  log = (s) => {
    console.log(s);
  },
  runGit,
  fallbackRef,
} = {}) {
  const out = shellFace({ env, log, runGit, fallbackRef });
  log(
    `[shell-face] ${out.via}；命中壳输入 ${out.hits.length} 条${
      out.hits.length > 0 ? `：${out.hits.join(" ")}` : ""
    } ⇒ ${out.shell ? "要装 Tauri 的 Linux 系统依赖。" : "不装（这次没碰壳，apt 那一步跳过）。"}`,
  );
  const path = env.GITHUB_OUTPUT;
  if (path) {
    try {
      fs.appendFileSync(path, `shell=${out.shell ? "true" : "false"}\n`, "utf8");
    } catch {
      log("[shell-face] GITHUB_OUTPUT 没写成 ⇒ workflow 侧按输出缺席处理（也是装）。");
    }
  }
  return 0;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(import.meta.filename)) {
  process.exit(main());
}
