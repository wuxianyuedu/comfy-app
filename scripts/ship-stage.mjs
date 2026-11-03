#!/usr/bin/env node
/**
 * ship-stage.mjs —— 「走到哪了」那一行的**唯一出处**（ISSUE #3083）。
 *
 * ── 为什么单独一件 ─────────────────────────────────────────────
 *
 * 在 #3083 之前，`pnpm ship` 的输出只有两类：各阶段散落的读数行，与最后那句
 * 「结论：exit N」。前者没有统一形状（想知道走到哪只能把整段日志从头读到尾），
 * 后者只说**结果分类**、不说**停在哪一格**。用户拍板：每个阶段都要有一句结构化
 * 进度 —— 阶段名 + 关键身份（PR 号 + 平台回读的标题、分支名 + 头 sha、构建号 +
 * 状态、issue 号 + 回读 state/state_reason），让人不用翻日志就知道走到哪了。
 *
 * 这句话的形状只有这一份（`reportStage`）：
 *
 *   [ship] ▶ <阶段名> | key=value | key=value …
 *
 * `▶` 是进度（**走到哪**），与 `✓` / `✗`（**那一格的结论**）和「结论：exit N」
 * （**这一轮的退码分类**）是三套信息，互不替代：进度不押韵结论，结论不回头改
 * 进度。前缀沿用 `[ship] `，分隔沿用 `|`，机器可读字段（PR 号、sha、构建号、
 * issue 号）保持 `key=value`，可 grep。
 *
 * 不放 `ship-core.mjs` 的两条理由：① 它在 #3083 落地后已 865 行，离
 * `check-infra-file-size.cjs` 的 900 硬闸只剩 35 行；② `ship-core` 是纯函数层
 * （不起进程），而 `conflictFiles` 要发一次 `git merge-tree` —— 变化方向不同，
 * 与本仓「拆的是变化方向」同一条口径（与 `ship-codes.mjs` 的落点同理）。
 *
 * 与 `ship-codes.mjs` 的分工：那份管「退码是什么」（结果分类），这份管
 * 「走到哪了」（阶段进度）。两者在一次跑里同时出现，互不包含。
 */

/**
 * 一次 `run` 的最小形状（与 `ship-exec.mjs` 的 `ExecResult` 同形，不另立判据）。
 *
 * @typedef {(cmd: string, args: string[]) => import("./ship-exec.mjs").ExecResult} StageRun
 */

/**
 * 阶段进度那一行：`[ship] ▶ <阶段名> | key=value | …`。
 *
 * 空值（null / undefined / 空串）**不落**：缺读数那一格由调用方自己念「取不到」，
 * 进度行不许出现 `title=` 这种看起来像有值其实是空的键 —— 那是拿占位冒充读数。
 * 值的形状调用方负责（标题原样、sha 自己 short）；这一格只管排版，不改事实。
 *
 * @param {(s: string) => void} log 输出通道
 * @param {string} stage 阶段名（预检通过 / 分支推送 / 新建 PR / 复用 PR / 等 CI /
 *   冲突 / 合并 / 关单 / 清分支 —— 新阶段名加到 ship 规范 §13.6 那份清单里）
 * @param {Record<string, unknown>} facts 关键身份（`pr` / `title` / `branch` /
 *   `sha` / `build` / `issue` / `state` …），按序排版
 */
export function reportStage(log, stage, facts) {
  const parts = Object.entries(facts)
    .filter(([, v]) => v !== null && v !== undefined && String(v) !== "")
    .map(([k, v]) => `${k}=${String(v)}`);
  log(`[ship] ▶ ${stage}${parts.length > 0 ? ` | ${parts.join(" | ")}` : ""}`);
}

/**
 * 冲突面探测：`git merge-tree --write-tree --name-only <基线> HEAD` 列出冲突文件。
 *
 * 为什么是这一跳：冲突的 PR 平台不派生 CI，平台上「哪些文件在打架」要人自己点开
 * PR 页才看得见；而本地一次 merge-tree 就能给出同一份清单 —— 它**不改工作树、
 * 不改任何 ref**（`--write-tree` 只往对象库落一棵树，与「不静默自动解冲突」
 * 不冲突：这是只读探测，不是 merge）。
 *
 * 输出的真实形状（实测）：**退 1 = 有冲突**、**退 0 = 干净合并**、其余（128/129，
 * 老 git < 2.38 没有 `--write-tree`、基线缺）才是「探测不到」。stdout 三段：
 * 首行是 write-tree 落下的 tree OID（**不是文件名**），随后逐行冲突文件名，
 * 空行之后是 informational messages（`Auto-merging …` 那些）—— 只取空行之前、
 * 首行之后那一段。退 0 时 stdout 只有 OID 一行：把它当文件名念出来就是
 * 「冲突文件：a6348597…」那类笑话（首轮实测踩到，彼时本地基线还是旧引用）。
 *
 * @param {{run: StageRun, baseRef: string | null}} ctx
 * @returns {string[] | null} 冲突文件清单；`[]` = 本地基线眼下探测不出冲突
 *   （基线引用可能是旧的，不是「没有冲突」的结论）；`null` = 探测不到
 */
export function conflictFiles({ run, baseRef }) {
  if (!baseRef) {
    return null;
  }
  /* `core.quotePath=false`：`--name-only` 输出的是**路径**，默认会按 C 风格转义
   * 并加引号（ISSUE #2272 / tests/git-path-quoting.test.ts 的全仓判据）。 */
  const r = run("git", [
    "-c",
    "core.quotePath=false",
    "merge-tree",
    "--write-tree",
    "--name-only",
    baseRef,
    "HEAD",
  ]);
  if (r.status === 0) {
    return [];
  }
  if (r.status !== 1 || !r.stdout.trim()) {
    return null;
  }
  /* 首行 tree OID 丢掉，名字段到第一个空行为止（空行后是 informational messages）。 */
  const lines = r.stdout.split("\n").slice(1);
  const end = lines.findIndex((l) => l.trim() === "");
  return (end === -1 ? lines : lines.slice(0, end)).filter((l) => l.trim() !== "");
}

/**
 * 「冲突」那一格的进度输出：阶段行 + 冲突面清单（每文件一行，**不截断** ——
 * 日志要全，解冲突的人按这份清单逐个开文件）。
 *
 * 与 `conflictAdviceLines` 分工：这份说「**是什么**」（哪条 PR、与哪条基线、
 * 哪几个文件），那份说「**下一步干什么**」（fetch + merge + push + 重跑）。
 * 两个出口各念一遍而内容只有一处，靠的就是两个函数各自只有一份。
 *
 * @param {{run: StageRun, log: (s: string) => void, number: any, baseRef: string | null, blockedOn?: string}} ctx
 */
export function reportConflictStage({ run, log, number, baseRef, blockedOn = "" }) {
  const files = conflictFiles({ run, baseRef });
  reportStage(log, "冲突", {
    pr: number,
    base: baseRef ?? "(基线取不到)",
    blocked_on: blockedOn || "(无)",
    files: files
      ? files.length > 0
        ? `${files.length} 个`
        : "0 个（本地基线探测不出 —— 引用可能是旧的，先 git fetch 再核）"
      : "(探测不到，去平台 PR 页核)",
  });
  for (const f of files ?? []) {
    log(`[ship]   冲突文件：${f}`);
  }
}
