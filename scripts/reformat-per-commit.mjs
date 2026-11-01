#!/usr/bin/env node
/**
 * reformat-per-commit.mjs — 「逐提交看重排占不占得住这一条」的**机制层**
 * （护栏 ②，规范 §13.5）。
 *
 * ── 为什么单独一份模块 ────────────────────────────────────────────────
 *
 * 它是 `check-reformat-only.cjs` 里唯一**逐提交取数**的那一段（每条提交一次
 * `git diff <父>..<rev>` + 每批一次 oxfmt），也是那份脚本贴近 900 行硬闸时的自然
 * 切面（§12.6 R5 / §12.13）—— 与 `merged-side-loss-core.mjs` 同一条理由：拆的是
 * **职责**，不是行数，所以搬走之后两边的判据都不动。
 *
 * ## 这一份不做什么
 *
 * 它不读 `process.argv`、不打印判决行、不碰阈值来源（`limit` 由调用方给）——
 * 判决话术与三态出口仍只有 `check-reformat-only.cjs` 一处（`report()`）。
 * 取数件（`collectChangedFiles` / `collectPairs` / `classifyReformatOnly` /
 * `gitOrEmpty`）由入口**注入**：内核不反过来依赖执行者（§18.4）。
 *
 * ## 为什么单独导出 `perCommitShapeOf`
 *
 * 自测要造的是「这条提交的父读不到」那一档，而 `git log <父>..<rev>` 要求区间两端
 * 都能解析成提交（悬空父当场 `fatal: Invalid revision range`）⇒ 那一档在**进程外**
 * 没有入口。入口是薄的：它把这条提交交给同一份 `perCommitShape` 的循环，判定不分叉。
 *
 * @module scripts/reformat-per-commit.mjs — 判据机制层（取数 + 判定，无输出）
 */
import { execFileSync } from "node:child_process";

/**
 * 指定工作区跑一条 git；取不到就回 `null`（**不折成空串**）。
 *
 * `gitOrEmpty`（入口那一侧）把「取不到」折成空串，对它绝大多数调用点是对的
 * （新增文件在 HEAD 里本就不存在是**预期分支**）。但这一支要区分「这条提交没改文件」
 * 与「这条提交的 diff 没读到」—— 折成空串就让后者静默变成前者。
 *
 * @param {string} root 工作区
 * @param {string[]} args git 参数
 * @returns {string | null}
 */
export function runGit(root, args) {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      /* 「对象不存在」是可预期的跳过分支，git 的 `fatal:` 不该冒充门禁的失败输出。 */
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

/**
 * 判定注入面（`check-reformat-only.cjs` 那一侧递下来）。
 *
 * @typedef {{
 *   limit: number,
 *   collectChangedFiles: (patch: string) => Array<{before: string, after: string}>,
 *   collectPairs: (
 *     files: Array<{before: string, after: string}>,
 *     beforeRev: string,
 *     readAfter: (f: {before: string, after: string}) => string,
 *   ) => Array<{file: string, before: string, after: string}>,
 *   classifyReformatOnly: (entries: Array<{file: string, before: string, after: string}>) =>
 *     Set<string>,
 *   gitOrEmpty: (args: string[]) => string,
 * }} PerCommitDeps
 */

/**
 * 一条提交在护栏 ② 眼里的读数。
 *
 * @typedef {{rev: string, files: number, reformatOnly: number, unknown?: boolean}} CommitShape
 * @typedef {{commits: Array<CommitShape>, ok: boolean, offenders: Array<string>}} PerCommitReport
 */

/**
 * 逐提交判「重排占不占得住这一条」（护栏 ②）。
 *
 * @param {string} range `A..B` 区间（`entries` 在场时不用它）
 * @param {number} limit 触发阈值
 * @param {string} root 工作区
 * @param {PerCommitDeps} deps 判定注入面
 * @param {Array<{rev: string, parents: Array<string>}> | null} [entries] 自测入口用
 * @returns {PerCommitReport}
 */
export function perCommitShape(range, limit, root, deps, entries = null) {
  /* `%H %P`:提交 + 它的父提交(差分要的是**第一父提交**);`--no-merges` 把合并
   * 提交整条摘出去 —— 理由见入口文件那份头注与 `migrationDeclaration` 里同一条。
   *
   * `entries` 只给**自测入口**用（`perCommitShapeOf`）：那一档要判的提交，它和父的
   * 区间在某些仓库形态下根本解析不出来（`fatal: Invalid revision range`），而这一支
   * 的判定与「从区间里读出来」逐字相同 —— 收在同一个循环里，两处不会漂。 */
  const revs =
    entries ??
    (runGit(root, ["log", "--reverse", "--no-merges", "--format=%H %P", range]) ?? "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((line) => {
        const [rev = "", ...parents] = line.split(/\s+/);
        return { rev, parents };
      });
  const commits = [];
  const offenders = [];
  for (const { rev, parents } of revs) {
    if (parents.length === 0) {
      // 没有可比父提交(根提交 / 浅克隆):拿不到读数就不是「干净」,fail-closed。
      commits.push({ rev, files: 0, reformatOnly: 0, unknown: true });
      offenders.push(`${rev.slice(0, 8)}(无可比父提交)`);
      continue;
    }
    const parent = parents[0] ?? "";
    const patch = runGit(root, ["diff", "--no-color", "--unified=0", `${parent}..${rev}`]) ?? "";
    if (!patch.trim()) {
      /* **空 patch 有两种**：这条提交本来没改文件，或者**它和父的 diff 根本没读到**
       * （悬空父 / 对象缺失 / 浅克隆边界）。前者是真读数，后者是**没测** —— 折成同一支
       * 就是「没测」被读成「干净」，而 `ok` 只看 `offenders`，于是它在「一条都没读到」
       * 时照样说通过。现场（`cnb-rmn-1k6bqsdfg`，平台那一格判的是**合成合并预览**）
       * 一屏全是「声明了但重排没独占」，一个指纹都没有。
       *
       * 「父对象在不在」用 `rev-parse <父>^{commit}` 问：它不遍历历史、不走区间解析，
       * 所以悬空父这一档**答得出来**（`git diff A..B` 恰恰答不出来 —— 它要求区间两端
       * 都能解析成提交，那是同一个「取不到」的第二种形态）。答不出来 ⇒ 记 `unknown`
       * （与「无可比父提交」同档）并点名。 */
      if (
        (runGit(root, ["rev-parse", "--verify", "--quiet", `${parent}^{commit}`]) ?? "").trim() ===
        ""
      ) {
        commits.push({ rev, files: 0, reformatOnly: 0, unknown: true });
        offenders.push(`${rev.slice(0, 8)}(取不到与父提交的 diff)`);
      }
      continue;
    }
    const files = deps.collectChangedFiles(patch);
    const pairs = deps.collectPairs(files, parent, (f) =>
      deps.gitOrEmpty(["show", `${rev}:${f.after}`]),
    );
    const reformatOnly = deps.classifyReformatOnly(pairs);
    commits.push({ rev, files: files.length, reformatOnly: reformatOnly.size });
    const clean =
      reformatOnly.size < limit || (files.length > 0 && reformatOnly.size === files.length);
    if (!clean) {
      offenders.push(
        `${rev.slice(0, 8)}(${files.length} 个源文件里 ${reformatOnly.size} 个纯格式化)`,
      );
    }
  }
  return { commits, ok: commits.length > 0 && offenders.length === 0, offenders };
}

/**
 * **判一条提交**（自测入口）。生产路径不走它。
 *
 * 为什么需要它：`perCommitShape` 只接 `A..B` 区间，而区间那一跳在入口的 `main()` 里
 * 先跑 `git diff <A>..<B>` —— 当区间里那条提交的父对象读不全（浅克隆边界 / 悬空父）
 * 时，那一跳会整条 skip，于是「逐提交取不到 diff」这个分支**在进程外根本没有入口**。
 *
 * 判据本身是薄的：把这条提交交给同一份 `perCommitShape`，所以「自测通过」与
 * 「生产行为」是同一件事。它唯一多做的一步是把「这条提交的父」**从提交对象里读**
 * （`cat-file` 不解析父，悬空父也读得到）—— 那正是「历史形状在、对象不全」那一档
 * 与 `perCommitShape` 之间差的那一层。
 *
 * @param {string} rev 提交
 * @param {{root: string, limit: number, deps: PerCommitDeps}} spec 工作区 / 阈值 / 判定注入
 * @returns {PerCommitReport}
 */
export function perCommitShapeOf(rev, spec) {
  const { root, limit, deps } = spec;
  /* ⚠️ 父提交从**提交对象**里读（`cat-file` 不解析父）。`git log` / `rev-list`
   * 在悬空父上会整条拒绝遍历（`fatal: Failed to traverse parents`），拿它当
   * 「读得到这条提交」的判据会把这件事测成另一件事。 */
  const raw = runGit(root, ["cat-file", "commit", rev]);
  if (raw === null) {
    /* 连提交对象本身都读不到：与「无可比父提交」同档，fail-closed。 */
    return {
      commits: [{ rev, files: 0, reformatOnly: 0, unknown: true }],
      ok: false,
      offenders: [`${rev.slice(0, 8)}(读不到这条提交)`],
    };
  }
  const parent = /^parent ([0-9a-f]{40})$/m.exec(raw)?.[1];
  if (!parent) {
    return {
      commits: [{ rev, files: 0, reformatOnly: 0, unknown: true }],
      ok: false,
      offenders: [`${rev.slice(0, 8)}(无可比父提交)`],
    };
  }
  /* ⚠️ **不能**走 `git log <父>..<rev>`：区间两端都要能解析成**提交**，而这一档的父
   * 恰恰读不到（`fatal: Invalid revision range`）—— 那样「逐提交取不到 diff」这一支
   * 永远到不了。所以把这一条提交**直接**交给 `perCommitShape` 的 entries 形态。 */
  return perCommitShape("", limit, root, deps, [{ rev, parents: [parent] }]);
}
