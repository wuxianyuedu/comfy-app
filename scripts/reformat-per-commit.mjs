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
 * `mergedIn` / `deduped` / `viaFallback` 是**合并行**的三格读数（ISSUE #3035）：
 * 是不是合并、从账上减掉了几份已判重排、空 patch 是否走了「`<基线>..第二父`」退路。
 * 判定只看 `files` / `reformatOnly`（去重后的数），这三格只服务读数。
 *
 * @typedef {{rev: string, files: number, reformatOnly: number, unknown?: boolean,
 *   mergedIn?: boolean, deduped?: number, viaFallback?: boolean}} CommitShape
 * @typedef {{commits: Array<CommitShape>, ok: boolean, offenders: Array<string>}} PerCommitReport
 */

/**
 * 逐提交判「重排占不占得住这一条」（护栏 ②）。
 *
 * **合并提交入表**（ISSUE #3035）：从前 `--no-merges` 把合并整条摘掉，而重排恰恰
 * 常坐在合并那一笔里（同步 master、并行线互合）—— 摘掉它，「重排有没有独占一条」
 * 在 `--range` 口径下永远问不出答案（现场 PR #2990：118 份纯格式化一次都没被判）。
 * 合并行补丁取「**目标分支那一侧 .. 合并提交**」—— 与 `git merge --squash` 落到
 * 默认分支上的形态逐字相同；目标侧由 `landedTip` 定位（取「是 `landedTip` 祖先的
 * 那个父」，认不出退第一父）。目标侧 .. 合并**读出来是空的**（这一笔整份取了目标侧 /
 * 两父同树）时，按单子的退路改判「`<基线> .. 第二父`」—— 这次合并从另一侧带进来了
 * 什么，以 `spanBase`（区间起点）当基线。
 *
 * **合并行与已判行去重**：同步 master 的合并，它对目标侧的 diff 是「本分支的全部
 * 净工作」，其中被更早的提交判定过、声明过的重排会整批重现 —— 不去重，#3054 刚
 * 修好的「合规迁移 PR 被永久拦红」会换个方向复发（现场 `a1eb6022`：159 份里 120 份
 * 是 `8d052468` 已判过的重排）。合并行里「此前提交已经以纯格式化判定过的文件」
 * 从 `files` / `reformatOnly` 两个数里同时减掉（`deduped` 记减了几份，读数照念），
 * 剩下的才是这一笔**自己**带来的 —— 手工解冲突混进的新重排照样现形。
 *
 * @param {string} range `A..B` 区间（`entries` 在场时不用它）
 * @param {number} limit 触发阈值
 * @param {string} root 工作区
 * @param {PerCommitDeps} deps 判定注入面
 * @param {Array<{rev: string, parents: Array<string>}> | null} [entries] 自测入口用
 * @param {{landedTip?: string, spanBase?: string}} [shape] 合并行的定位件：
 *   `landedTip` 是目标分支那一侧的 tip（判定合并的「目标侧父」），`spanBase` 是
 *   区间起点（空 patch 退路的基线）。都不给 ⇒ 合并行退第一父、无退路 —— 与
 *   改动前逐字一致的保守形态。
 * @returns {PerCommitReport}
 */
export function perCommitShape(range, limit, root, deps, entries = null, shape = {}) {
  const landedTip = shape.landedTip ?? "";
  const spanBase = shape.spanBase ?? "";
  /* `%H %P`:提交 + 它的全部父提交(差分要的就是它们;合并行的「目标侧」从这里挑)。
   * **不再 `--no-merges`**（ISSUE #3035，理由见上）。
   *
   * `entries` 只给**自测入口**用（`perCommitShapeOf`）：那一档要判的提交，它和父的
   * 区间在某些仓库形态下根本解析不出来（`fatal: Invalid revision range`），而这一支
   * 的判定与「从区间里读出来」逐字相同 —— 收在同一个循环里，两处不会漂。 */
  const revs =
    entries ??
    (runGit(root, ["log", "--reverse", "--format=%H %P", range]) ?? "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((line) => {
        const [rev = "", ...parents] = line.split(/\s+/);
        return { rev, parents };
      });
  const commits = [];
  const offenders = [];
  /** 此前各行的纯格式化文件并集 —— 合并行去重的「已判」账（ISSUE #3035）。 */
  const seenPure = new Set();
  for (const { rev, parents } of revs) {
    if (parents.length === 0) {
      // 没有可比父提交(根提交 / 浅克隆):拿不到读数就不是「干净」,fail-closed。
      commits.push({ rev, files: 0, reformatOnly: 0, unknown: true });
      offenders.push(`${rev.slice(0, 8)}(无可比父提交)`);
      continue;
    }
    const isMerge = parents.length >= 2;
    /* 合并行拿「目标分支那一侧」当改动前：是 `landedTip` 祖先的那个父；认不出
     * （本地无 env / 拓扑对不上）退第一父 —— 与改动前逐字一致的保守形态。 */
    let before = parents[0] ?? "";
    if (isMerge && landedTip !== "") {
      const onTarget = parents.find(
        (p) => p !== "" && runGit(root, ["merge-base", "--is-ancestor", p, landedTip]) !== null,
      );
      if (onTarget) {
        before = onTarget;
      }
    }
    let patch = runGit(root, ["diff", "--no-color", "--unified=0", `${before}..${rev}`]) ?? "";
    let patchBase = before;
    let viaFallback = false;
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
        (runGit(root, ["rev-parse", "--verify", "--quiet", `${before}^{commit}`]) ?? "").trim() ===
        ""
      ) {
        commits.push({ rev, files: 0, reformatOnly: 0, unknown: true });
        offenders.push(`${rev.slice(0, 8)}(取不到与父提交的 diff)`);
        continue;
      }
      /* 合并行空 patch 的**退路**（ISSUE #3035）：目标侧 .. 合并读出来是空的
       * （整份取了目标侧 / 两父同树）⇒ 改判「`<基线> .. 第二父`」—— 这次合并从
       * 另一侧带进来了什么。退路也是空的（两侧真没动）才是真的「没有可判改动」。 */
      if (isMerge) {
        const second = parents.find((p) => p !== "" && p !== before) ?? "";
        const fallbackBase = spanBase === "" ? before : spanBase;
        const fallback =
          second === ""
            ? ""
            : (runGit(root, ["diff", "--no-color", "--unified=0", `${fallbackBase}..${second}`]) ??
              "");
        if (fallback.trim()) {
          patch = fallback;
          patchBase = fallbackBase;
          viaFallback = true;
        } else {
          continue;
        }
      } else {
        continue;
      }
    }
    const files = deps.collectChangedFiles(patch);
    const pairs = deps.collectPairs(files, patchBase, (f) =>
      deps.gitOrEmpty(["show", `${rev}:${f.after}`]),
    );
    const reformatOnlySet = deps.classifyReformatOnly(pairs);
    /* 合并行去重（ISSUE #3035，理由见函数头注）：此前行判定过的纯格式化文件
     * 不算这一笔的账 —— `files` 与 `reformatOnly` 同减，剩下的才是它自己带来的。 */
    let filesCount = files.length;
    let reformatOnly = reformatOnlySet.size;
    let deduped = 0;
    if (isMerge) {
      const fresh = [...reformatOnlySet].filter((f) => !seenPure.has(f));
      deduped = reformatOnlySet.size - fresh.length;
      filesCount = files.length - deduped;
      reformatOnly = fresh.length;
    }
    for (const f of reformatOnlySet) {
      seenPure.add(f);
    }
    commits.push({
      rev,
      files: filesCount,
      reformatOnly,
      ...(isMerge ? { mergedIn: true } : {}),
      ...(deduped > 0 ? { deduped } : {}),
      ...(viaFallback ? { viaFallback: true } : {}),
    });
    const clean = reformatOnly < limit || (filesCount > 0 && reformatOnly === filesCount);
    if (!clean) {
      offenders.push(`${rev.slice(0, 8)}(${filesCount} 个源文件里 ${reformatOnly} 个纯格式化)`);
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
 * 「生产行为」是同一件事。它唯一多做的一步是把这条提交的**全部父提交**从提交对象里
 * 读（`cat-file` 不解析父，悬空父也读得到）—— 那正是「历史形状在、对象不全」那一档
 * 与 `perCommitShape` 之间差的那层；ISSUE #3035 起合并行按父数分叉，所以这里必须
 * 读全（只读第一父会把合并判成普通提交，两种判面就在自测与生产之间漂开了）。
 *
 * @param {string} rev 提交
 * @param {{root: string, limit: number, deps: PerCommitDeps, landedTip?: string, spanBase?: string}} spec
 *   工作区 / 阈值 / 判定注入；`landedTip` / `spanBase` 原样递给 `perCommitShape` 的
 *   `shape`（合并行定位件，见那边的函数头注）
 * @returns {PerCommitReport}
 */
export function perCommitShapeOf(rev, spec) {
  const { root, limit, deps, landedTip = "", spanBase = "" } = spec;
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
  const parents = [...raw.matchAll(/^parent (?<parent>[0-9a-f]{40})$/gm)].map(
    (m) => m.groups?.parent ?? "",
  );
  if (parents.length === 0) {
    return {
      commits: [{ rev, files: 0, reformatOnly: 0, unknown: true }],
      ok: false,
      offenders: [`${rev.slice(0, 8)}(无可比父提交)`],
    };
  }
  /* ⚠️ **不能**走 `git log <父>..<rev>`：区间两端都要能解析成**提交**，而这一档的父
   * 恰恰读不到（`fatal: Invalid revision range`）—— 那样「逐提交取不到 diff」这一支
   * 永远到不了。所以把这一条提交**直接**交给 `perCommitShape` 的 entries 形态。 */
  return perCommitShape("", limit, root, deps, [{ rev, parents }], { landedTip, spanBase });
}

/**
 * 区间里每个**有内容**提交的「rev → 正文」表（护栏 ① 的取数，ISSUE #3054）。
 *
 * 护栏 ① 要问的是「**这一笔**带没带尾注」—— rev 与正文一起交出去，配对由取数本身
 * 保证（按**下标**去对是两条各自会漂的清单之间的暗契约，一次筛选口径变动就静默错位）。
 *
 * **合并提交也要能进表**（ISSUE #3035）：`perCommitShape` 不再把合并整条摘掉，
 * 合并行里「去重之后仍有新重排」的那几笔要带尾注 —— 取不到它们的正文 ⇒ fail-closed
 * 按「缺声明」红。`-m` 让合并按**每个父各出一份** diff（同名条目幂等，正文相同），
 * 于是合并的文件清单与正文都进表：手工解冲突改了重排、正文里写了
 * `format-migration:` 的合并认得出声明；自动生成的合并正文不带尾注 ⇒ 照样红 ——
 * 与普通提交同一把尺。普通合并行（去重后零新重排）不在「含重排」名单里，
 * 进不进表都不参与判定。
 *
 * @param {string} root 工作区
 * @param {string} revRange `A..B` 区间
 * @returns {Map<string, string>} rev → 正文；取不到时是空表（调用方按 fail-closed 读）
 */
export function commitBodyByRev(root, revRange) {
  /* `%x01` 起头、`%x00` 分隔：正文与文件清单一次取回，判「空提交」只需要
   * 「这一笔有没有文件名」（`-m` 的理由见头注：不给它，合并一行文件都不列，
   * 带了尾注的合并也读不到 ⇒ 它永远「缺声明」）。 */
  /* `core.quotePath=false` 是本仓读 git 路径的统一守卫（ISSUE #2272）：`--name-only`
   * 默认会把非 ASCII 路径转义成 `\351\231\204` 并加引号，清单当场对不上真文件名。 */
  const raw = runGit(root, [
    "-c",
    "core.quotePath=false",
    "log",
    "-m",
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
 * 这是同一条口径的**第二次**收窄：#3034 摘掉的是**空提交**（正文表只收
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
  /* 空提交不进名单的理由写在 `commitBodyByRev()` 的头注里（#3034）；合并提交
   * 自 #3035 起经 `-m` 也能进表（带尾注的合并要认得出声明）。 */
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
