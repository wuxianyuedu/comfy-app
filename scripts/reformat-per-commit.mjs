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

/**
 * 区间里每个提交的正文（**空提交不进这份名单**，ISSUE #3034）。
 *
 * 这是护栏 ①（迁移声明）的取数：它判的是「区间里每个**有内容**的提交都带
 * `format-migration:` 尾注」。空提交一份文件都没碰，对「这次重排有没有独占」
 * 不提供任何信息 —— 而它又经常出现：`pnpm ship --rerun-ci` 推的就是一笔空提交，
 * 正文固定为 `ci: rerun (ship --rerun-ci)`、不带任何尾注。把它数进来，代价是
 * 「重跑一次 CI」这个动作本身会改变门禁读数：PR #2990 重跑三次之后，一个原本合规的
 * 迁移 PR 被 `166 份里 118 份纯格式化` 判红（构建 `cnb-4ig-1k6csckqj`），
 * 同一区间摘掉那三笔就 `[ok] 按迁移放行`。
 *
 * 与 `perCommitShape()` 同一个切面、同一条理由留在这里（§12.6 R5 / §12.13）。
 *
 * @param {string} root 工作区
 * @param {string} revRange `A..B` 区间
 * @returns {Array<string>} 每个有内容提交的正文（`commits.length` 可直接当计数用）
 */
export function commitBodies(root, revRange) {
  /* `--no-merges`：平台侧跑的是**合并预览**（HEAD 是合并提交），而合并提交那一条
   * 自动生成的正文不会带尾注 —— 把它算进「每个提交都要声明」等于这条门在 CI 上
   * 永远不成立。合并提交本来就是本门禁豁免的那一档（见 `perCommitShape()` 的头注）。
   *
   * 正文与文件清单一次取回（`%x01` 起头、`%x00` 分隔）：判「空提交」只需要
   * 「这一笔有没有文件名」，而多起一次 `git show` 是逐提交一次进程。 */
  /* `core.quotePath=false` 是本仓读 git 路径的统一守卫（ISSUE #2272）：`--name-only`
   * 默认会把非 ASCII 路径转义成 `\351\231\204` 并加引号，清单当场对不上真文件名。 */
  const raw = runGit(root, [
    "-c",
    "core.quotePath=false",
    "log",
    "--no-merges",
    "--format=%x01%B%x00",
    "--name-only",
    revRange,
  ]);
  if (raw === null) {
    return [];
  }
  const bodies = [];
  for (const chunk of raw.split("\u0001")) {
    const text = chunk.trim();
    if (!text) {
      continue;
    }
    const [body = "", ...rest] = text.split("\u0000");
    const files = rest.join("\u0000").split("\n").filter(Boolean);
    if (!files.length) {
      continue;
    }
    bodies.push(body.trim());
  }
  return bodies;
}

/**
 * 区间里每个**有内容**提交的「rev → 正文」表（护栏 ① 的取数，ISSUE #3054）。
 *
 * 与 `commitBodies()` 同一份 `git log`、同一套筛选（空提交与合并提交都不进名单），
 * 差别只在形状：那一份丢掉 rev、只能按**下标**配对，而护栏 ① 要问的是「**这一笔**
 * 带没带尾注」—— 拿下标去对是两条各自会漂的清单之间的暗契约（一次筛选口径变动就
 * 静默错位）。这里把 rev 与正文一起交出去，配对由取数本身保证。
 *
 * @param {string} root 工作区
 * @param {string} revRange `A..B` 区间
 * @returns {Map<string, string>} rev → 正文；取不到时是空表（调用方按 fail-closed 读）
 */
export function commitBodyByRev(root, revRange) {
  /* `%x01` 起头、`%x00` 分隔 —— 与 `commitBodies()` 同一个形状，两次取数不会各自
   * 漂一份筛选口径。`--no-merges` 的理由同那一份：合并提交那一条自动生成的正文
   * 不带尾注，把它算进「要声明」等于这条门在 CI 上永远不成立。 */
  const raw = runGit(root, [
    "-c",
    "core.quotePath=false",
    "log",
    "--no-merges",
    "--format=%x01%H%x00%B%x00",
    "--name-only",
    revRange,
  ]);
  if (raw === null) {
    return new Map();
  }
  const out = new Map();
  for (const chunk of raw.split("\u0001")) {
    const text = chunk.trim();
    if (!text) {
      continue;
    }
    const [rev = "", body = "", ...rest] = text.split("\u0000");
    const files = rest.join("\u0000").split("\n").filter(Boolean);
    if (!rev || !files.length) {
      continue;
    }
    out.set(rev.trim(), body.trim());
  }
  return out;
}

/**
 * 「格式化迁移」声明：区间里**每一笔含重排的**提交都带 `format-migration:` 尾注（护栏 ①）。
 *
 * 为什么需要这一扇门：换格式化器时（2026-10-28 prettier → oxfmt），格式判据是**硬闸
 * 且没有基线** ⇒ 全量重排必须**和切换同批**落地；而本判据的阈值（10）又会拦住同批里
 * 的重排 —— 两条硬闸互锁，迁移没有可落地的形状。于是给迁移一条**显式的、一次性的**
 * 声明：声明了就按「这是一次格式化器迁移」读，不阻断，但清单照打、读数照报（可审计）。
 *
 * **护栏 ① 只问「含重排的提交」，不问「每一个提交」**（ISSUE #3054）。
 * 迁移 PR 的生命周期里**必然**会追加与迁移无关的功能提交 —— 修判据自己、补文档、
 * 解冲突（都是正常动作），它们不碰重排、也不该撒谎写 `format-migration:`。
 * 拿 `every()` 去要求它们，等于让合规的迁移 PR 永远凑不齐这一关。
 *
 * 这是同一条口径的**第二次**收窄：#3034 摘掉的是**空提交**（`commitBodies()` 只收
 * 有内容的提交），理由一样 —— 它一份文件都没碰，对「这次重排有没有独占」不提供任何
 * 信息，却能否决整个人证。功能提交不是空提交、摘不掉，于是同一个冲突换了一副面孔
 * 回来（PR #2990 上 5 笔修判据的提交，把 `172 份里 118 份` 判成不走迁移）。
 * 两次的病根是同一个：**让与迁移无关的提交参与迁移的判定**。
 *
 * 「含重排」的取数现成：护栏 ② 的逐提交表里 `reformatOnly > 0` 就是它 —— 这里不
 * 另算一份（同一把尺，两处不会各自漂）。
 *
 * 与 `perCommitShape()` 同一个切面、同一条理由留在这里（§12.6 R5 / §12.13）。
 *
 * @param {string} root 工作区
 * @param {string} revRange `A..B` 区间
 * @param {PerCommitReport | null | undefined} perCommit 护栏 ② 的逐提交读数
 * @param {RegExp} declarationRe 尾注正则（由入口给，口径只有一处）
 * @returns {{declared: boolean, commits: number, missing: string[]}}
 */
export function migrationDeclaration(root, revRange, perCommit, declarationRe) {
  /* 空提交 / 合并提交不进名单的理由各写在 `commitBodyByRev()` 的头注里（#3034）。 */
  const bodies = commitBodyByRev(root, revRange);
  if (bodies.size === 0) {
    return { declared: false, commits: 0, missing: [] };
  }
  /* 没有逐提交读数 ⇒ 退回「每一条都要声明」（fail-closed）：判不出哪一笔含重排时，
   * 放宽等于把这一关静默拆掉。 */
  if (!perCommit) {
    const missing = [...bodies].filter(([, body]) => !declarationRe.test(body)).map(([rev]) => rev);
    return { declared: missing.length === 0, commits: bodies.size, missing };
  }
  /* **只问含重排的那批提交**（ISSUE #3054）：「这一笔有没有碰重排」取自护栏 ② 的
   * 逐提交表（`reformatOnly > 0`），与那一关同一把尺 —— 这里不另算一份。
   * 与迁移无关的功能提交（修判据、补文档、解冲突）不参与判定：它们不碰重排，
   * 也不该撒谎写 `format-migration:`。 */
  const reformatting = perCommit.commits.filter((c) => c.reformatOnly > 0).map((c) => c.rev);
  if (reformatting.length === 0) {
    return { declared: false, commits: bodies.size, missing: [] };
  }
  /* 逐提交表里点名、而正文表里取不到的那一笔按**缺声明**记（fail-closed）：两张表
   * 不一致说明取数有洞，不许当成「已经声明过」。 */
  const missing = reformatting.filter((rev) => !declarationRe.test(bodies.get(rev) ?? ""));
  return { declared: missing.length === 0, commits: bodies.size, missing };
}

/**
 * 护栏 ② 的**读数**（一行；`null` = 这一档没有逐提交读数，不必念）。
 *
 * ## 它治的是哪一件事
 *
 * 护栏 ② 只有「通过 / 不通过」两个出口，于是两种**下一动作截然相反**的形态在屏幕上
 * 逐字相同：
 *
 *   · 某条提交**整条都是重排**、只是没带 `format-migration:` 声明 ⇒ 补声明；
 *   · 重排散在几十条提交里、没有一条独占 ⇒ 形态就有问题，该拆历史。
 *
 * 现场（ISSUE #3038）连着两跑只有一张 `118 份` 的名单，一个「哪条提交是怎么读的」
 * 都没有 —— 读者只能去猜是哪一种。这一格把**极值**念出来，那一句就足以分开两种形态。
 *
 * ## 为什么留在这里
 *
 * 本文件是护栏 ② 的机制层，而 `check-reformat-only.cjs` 已到 900 行硬闸（§12.6 R5）——
 * 判决话术留在 `report()`，取数与措辞在这里。它**不改任何判定**：`ok` 仍由
 * `perCommitShape()` 的 `offenders` 决定。
 *
 * @param {PerCommitReport | null | undefined} perCommit 逐提交读数
 * @returns {string | null}
 */
export function perCommitReading(perCommit) {
  if (!perCommit) {
    return null;
  }
  if (perCommit.offenders.length > 0) {
    return `护栏 ② 没通过：${perCommit.offenders.join("、")}`;
  }
  if (perCommit.commits.length === 0) {
    return null;
  }
  const max = perCommit.commits.reduce(
    (acc, c) => (c.reformatOnly >= acc.reformatOnly && c.reformatOnly > 0 ? c : acc),
    { rev: "", files: 0, reformatOnly: 0 },
  );
  if (max.rev === "") {
    return null;
  }
  const share = max.files ? `（${((max.reformatOnly / max.files) * 100).toFixed(0)}%）` : "";
  return (
    `护栏 ② 没拦：区间 ${perCommit.commits.length} 个提交里，单条纯格式化最多的是 ` +
    `${max.rev.slice(0, 8)} 的 ${max.reformatOnly}/${max.files} 个${share}（逐提交读数，不参与判决）`
  );
}
