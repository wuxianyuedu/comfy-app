#!/usr/bin/env node
/**
 * ship-branches.mjs —— 「这条分支的内容**落地了没有**」的**只读**入口（规范 §13.6.5，ISSUE #2427）。
 *
 * 为什么要有这一件：删分支之前必须回答「它合了没」，而这件事在本仓**没有入口**，
 * 于是每个人自己挑一个命令当判据 —— 实测挑错的代价是不对称的：squash 拓扑下
 * `git branch -d` 的祖先判据恒假（SKILL 第 6 条已记），所以真删下去用的是 `-D`，
 * **删错了没有护栏**（对象还在 reflog 里，但那不是设计出来的出口）。
 *
 * ── 哪些命令**不是**这件事的判据（都被实测推翻过，写在这里是为了不再被第二次误用）──
 *
 *   · `git diff --stat origin/master...<分支>`（三点）—— 它答的是「这条分支自己改了什么」，
 *     起点是 **merge-base**，与主干无关。squash 把整条分支压成主干上一笔**新提交**
 *     （父提交不是分支头），所以这条 diff **永远非空**：实测九条全部已合并的分支
 *     逐条都显示「有独有差异」。拿它当筛选器 = 「谁都不能删」；反过来图省事直接 `-D`
 *     = 「谁都可以删」。两个方向都错。
 *   · `git branch -d` 能不能删 —— 它是**祖先**判据，同一原因恒假，不构成「没合并」的证据。
 *   · 提交信息里有没有 `(#N)` —— 那是人写的字，不是平台的终态。
 *
 * ── 唯一的依据 ─────────────────────────────────────────────────────────
 *
 *   PR 记录上的 **`is_merged === true`**（取自 `cnb pulls list-pulls -v` 的 `data.*`）。
 *   与 `ship-close.mjs` 的落地反查、`findMergedPullForHeadSha` 同一条取法：
 *   `--state` **没有 `merged` 这一档**（实测只有 `open|closed|all`），而 `closed` 里
 *   混着「合了」与「关了没合」，所以**只认逐条 `is_merged`，不认状态词**。
 *   分支名要按 **`head.ref === "refs/heads/<分支名>"`** 匹配（裸名字匹配会全条落空，
 *   而那份读数的长相和「这些分支没提过 PR」逐字相同 —— 匹配形状复用
 *   `ship-core.mjs` 的 `pullRecordForBranch`，不在这里重抄）。
 *
 * ── 取数窗口要自证 ─────────────────────────────────────────────────────
 *
 *   `list-pulls` 没有按 head 分支过滤的旗标，只能翻页。所以每一跑都报
 *   「翻了几页 / 取了多少条 / 最老到第几号」，并对**落在窗口外**的分支给
 *   `no-pull-in-window` ⇒ 那是「**没取到**」，不是「没合并」，整跑退 `2` 不念绿
 *   （同 `check-daily-attendance.mjs` 那句「取不到读数 ≠ 缺勤」）。
 *
 * 这一件**一次也不删**：删仍是人逐条点名，或 `--clean-branch`（只跟在验真的合并之后）。
 * 硬规则 28① —— 显式动作不许被读数推断出来。
 */
import { cnbJson } from "./ship-exec.mjs";
import { asArray } from "./ship-build.mjs";
import { CODE, pullRecordForBranch } from "./ship-core.mjs";

/** 翻页上限：8 页 = 800 条 PR。到顶会明说「只看了前 N 条」，不把截断念成全部。 */
export const BRANCH_PULL_MAX_PAGES = 8;

/** 每页条数（平台侧 page-size 上限按 100 用，与 `--claims` 同形）。 */
export const BRANCH_PULL_PAGE_SIZE = 100;

/**
 * 三种结论。**没有第四种**：`no-pull-in-window` 是「没取到」，不许被读成「没合并」。
 *
 * @typedef {"landed" | "not-merged" | "no-pull-in-window"} LandingVerdict
 */

/**
 * 把「本地分支 + PR 记录 + 远端引用」折成逐条读数。**纯函数**（不碰 git、不碰网络）——
 * 同 `runGate({staged, selfTest})` 的取舍：让判断可被执行者直接喂形状。
 *
 * @param {{name: string, sha: string}[]} branches `git for-each-ref` 那一份清单
 * @param {any[]} pulls 翻到的 PR 记录（原样，字段按平台形状读）
 * @param {Set<string>} remoteRefs 远端**存在**的分支名集合
 * @param {string} current 当前所在分支（它不该被算进「可删」的建议里）
 * @param {{windowComplete: boolean}} [meta] 取数窗口是否取满（没取满时窗口外的分支只能给「没取到」）
 * @returns {{name:string, sha:string, pr:number|null, isMerged:boolean|null, state:string|null, mergedBy:boolean, remote:boolean, current:boolean, verdict:LandingVerdict}[]}
 */
export function branchLandingRows(
  branches,
  pulls,
  remoteRefs,
  current,
  meta = { windowComplete: true },
) {
  return branches.map((b) => {
    const rec = pullRecordForBranch({ data: pulls }, b.name);
    const isMerged = rec ? rec.is_merged === true : null;
    /** @type {LandingVerdict} */
    let verdict;
    if (rec) {
      verdict = isMerged ? "landed" : "not-merged";
    } else {
      /* 窗口取满还没有 ⇒ 「这条分支没提过 PR」是**正面事实**；
       * 没取满 ⇒ 只能说没取到。两种必须在账上长得不一样。 */
      verdict = meta.windowComplete ? "not-merged" : "no-pull-in-window";
    }
    return {
      name: b.name,
      sha: b.sha,
      pr: rec ? Number(rec.number) : null,
      isMerged,
      state: rec ? String(rec.state ?? "") : null,
      mergedBy: Boolean(rec && rec.merged_by),
      remote: remoteRefs.has(b.name),
      current: b.name === current,
      verdict,
    };
  });
}

/**
 * 本地分支清单（`refs/heads/*`）。
 *
 * @param {(cmd:string,args:string[])=>{status:number|null,stdout:string}} run
 * @param {string} remote 远端名（用来同时取远端引用集合）
 * @returns {{branches:{name:string,sha:string}[], remoteRefs:Set<string>, current:string, ok:boolean, note:string|null}}
 */
export function readLocalRefs(run, remote = "origin") {
  const list = run("git", [
    "for-each-ref",
    "--format=%(refname:lstrip=2)\t%(objectname)",
    "refs/heads",
  ]);
  const head = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (list.status !== 0 || !list.stdout) {
    return {
      branches: [],
      remoteRefs: new Set(),
      current: "",
      ok: false,
      note: `读不到本地分支清单（git for-each-ref 退 ${String(list.status)}）`,
    };
  }
  const branches = list.stdout
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "")
    .map((l) => {
      const at = l.indexOf("\t");
      return { name: l.slice(0, at), sha: l.slice(at + 1).trim() };
    });
  const remoteList = run("git", ["ls-remote", "--heads", remote]);
  const remoteRefs = new Set(
    remoteList.status === 0
      ? remoteList.stdout.split(/\r?\n/).flatMap((l) => {
          const name = /refs\/heads\/(.+)$/.exec(l.trim())?.[1];
          return name ? [name] : [];
        })
      : [],
  );
  return {
    branches,
    remoteRefs,
    current: (head.stdout || "").trim(),
    ok: true,
    note:
      remoteList.status === 0
        ? null
        : `远端引用取不到（git ls-remote 退 ${String(remoteList.status)}）——「远端在不在」那一列不作数`,
  };
}

/**
 * 翻 PR 列表。**取不到就是取不到**：返回 `ok:false` 让调用方落「没结论」，
 * 不许拿一份空列表去判「这些分支都没提过 PR」。
 *
 * @param {(cmd:string,args:string[])=>any} run
 * @param {string} slug
 * @param {{maxPages?: number, pageSize?: number}} [opts]
 * @returns {{ok: boolean, pulls: any[], pages: number, windowComplete: boolean, oldest: number|null, note: string|null}}
 */
export function fetchPullsForBranches(run, slug, opts = {}) {
  const maxPages = opts.maxPages ?? BRANCH_PULL_MAX_PAGES;
  const pageSize = opts.pageSize ?? BRANCH_PULL_PAGE_SIZE;
  /** @type {any[]} */
  const pulls = [];
  let pages = 0;
  for (let page = 1; page <= maxPages; page += 1) {
    const got = cnbJson(run, [
      "pulls",
      "list-pulls",
      "--repo",
      slug,
      "--state",
      "all",
      "--page",
      String(page),
      "--page-size",
      String(pageSize),
      "-v",
    ]);
    if (!got) {
      return {
        ok: false,
        pulls,
        pages,
        windowComplete: false,
        oldest: null,
        note: `第 ${page} 页取不到（cnb 没跑起来或响应不是 JSON）⇒ 整格没有结论`,
      };
    }
    const list = asArray(got.json);
    if (!list) {
      return {
        ok: false,
        pulls,
        pages,
        windowComplete: false,
        oldest: null,
        note: `第 ${page} 页的形状认不出来 ⇒ 整格没有结论`,
      };
    }
    pulls.push(...list);
    pages = page;
    if (list.length < pageSize) {
      return {
        ok: true,
        pulls,
        pages,
        windowComplete: true,
        oldest: oldestNumber(pulls),
        note: null,
      };
    }
  }
  return {
    ok: true,
    pulls,
    pages,
    windowComplete: false,
    oldest: oldestNumber(pulls),
    note: `只翻了 ${pages} 页（${pages * pageSize} 条）就到顶 —— 窗口外的分支只能给「没取到」`,
  };
}

/** 一批 PR 记录里最小的编号（用来把「窗口下探到哪」念出来）。 */
/** @param {any[]} list @returns {number|null} */
function oldestNumber(list) {
  let n = null;
  for (const p of list) {
    const v = Number(p?.number);
    if (Number.isFinite(v) && (n === null || v < n)) {
      n = v;
    }
  }
  return n;
}

const VERDICT_TEXT = {
  landed: "已落地可删",
  "not-merged": "**别删**（PR 未合并或没提过 PR）",
  "no-pull-in-window": "**没有结论**（在取数窗口外 —— 不等于没合并）",
};

/**
 * `--branches` 的入口：只读，一次也不删。
 *
 * 退码口径（与仓库三态一致）：`0` = 每条分支都有结论；`1` = 有分支明确未落地
 * （那一行同时是「别删」的提醒）；`2` = 取不到（git 或平台那一侧没跑起来 / 窗口没取满）。
 *
 * @param {{run:(cmd:string,args:string[])=>any, log:(s:string)=>void, slug:string|null, remote?:string, trunk?:string, maxPages?:number}} ctx
 *        `trunk` = 主干名（排除出待删清单，并念出这一次排除）；`maxPages` 只为用例可注入。
 * @returns {number} `CODE` 之一
 */
export function runBranches(ctx) {
  const { run, log, slug } = ctx;
  const remote = ctx.remote ?? "origin";
  if (!slug) {
    log("[ship] 取不到仓库 slug ⇒ 无法向平台问 PR，这一格没有结论（不是「都落地了」）。");
    return CODE.NOT_RUN;
  }
  const refs = readLocalRefs(run, remote);
  if (!refs.ok) {
    log(`[ship] ${refs.note} ⇒ 这一格没有结论，不念「没有可删的分支」`);
    return CODE.NOT_RUN;
  }
  /* 主干不是待删项 —— 把它留在清单里只会产出一条永远读不懂的「没有 PR」。
   * 排除这件事要**念出来**，不念就等于「清单少了一条而没人知道」（§13.5.12 那一族）。
   * ⚠️ 传进来的 `trunk` 是 `resolveTrunk()` 那份**带远端前缀**的基线（实测
   * `origin/master`，狗食这一跑就是这么漏掉主干的），而清单里是裸分支名 ⇒ 先剥前缀再比。
   * 只剥一层：分支名自己可以带斜杠（`fix/2403-…`），第二层斜杠之后是名字的一部分。 */
  const rawTrunk = String(ctx.trunk ?? "").trim();
  const trunk = rawTrunk.startsWith(`${remote}/`) ? rawTrunk.slice(remote.length + 1) : rawTrunk;
  const candidates = trunk ? refs.branches.filter((b) => b.name !== trunk) : refs.branches;
  if (trunk && refs.branches.length !== candidates.length) {
    log(
      `[ship] 已排除主干 \`${trunk}\`${rawTrunk === trunk ? "" : `（基线原值是 \`${rawTrunk}\`）`}——它不是待删项。`,
    );
  }
  if (candidates.length === 0) {
    log("[ship] 本地只有主干这一条，没有要看的东西。");
    return CODE.GREEN;
  }
  if (refs.note) {
    log(`[ship] ⚠ ${refs.note}`);
  }
  const fetched = fetchPullsForBranches(run, slug, { maxPages: ctx.maxPages });
  if (!fetched.ok) {
    log(`[ship] ${fetched.note} ⇒ 这一格没有结论（退 2 不是「都清了」）`);
    return CODE.NOT_RUN;
  }
  const rows = branchLandingRows(candidates, fetched.pulls, refs.remoteRefs, refs.current, {
    windowComplete: fetched.windowComplete,
  });
  log(
    `[ship] 本地分支 ${rows.length} 条 · 判据只认 PR 的 \`is_merged\` 原值` +
      `（` +
      `git diff master…branch 与 \`branch -d\` 在 squash 拓扑下恒假，不是判据）`,
  );
  for (const r of rows) {
    const pr = r.pr ? `#${r.pr}` : "无 PR";
    log(
      `  ${r.verdict.padEnd(18)} ${VERDICT_TEXT[r.verdict]} · ${r.name}` +
        ` · ${pr} is_merged=${r.isMerged === null ? "?" : String(r.isMerged)}` +
        ` merged_by=${r.mergedBy ? "有" : "无"} 远端=${r.remote ? "在" : "无"}` +
        (r.current ? " · ← 当前分支" : "") +
        ` (sha ${r.sha.slice(0, 8)})`,
    );
  }
  log(
    `[ship] 取数覆盖：翻了 ${fetched.pages} 页 / ${fetched.pulls.length} 条 PR` +
      (fetched.oldest === null ? "" : ` · 最老 #${fetched.oldest}`) +
      (fetched.windowComplete
        ? " · 窗口取满"
        : ` · **没取满**${fetched.note ? ` —— ${fetched.note}` : ""}`),
  );
  const landed = rows.filter((r) => r.verdict === "landed" && !r.current);
  const open = rows.filter((r) => r.verdict === "not-merged");
  const blind = rows.filter((r) => r.verdict === "no-pull-in-window");
  log(
    `[ship] 小结：已落地 ${landed.length} · 未落地 ${open.length} · 没结论 ${blind.length} —— ` +
      `这一趟一条也没删；要删请逐条点名（` +
      `本地 \`git branch -D <名>\`，远端是共享动作、要单独说）。`,
  );
  if (blind.length > 0) {
    log("[ship] 有分支落在窗口外 ⇒ 「我没取到」不等于「它没合并」，按没结论收（退 2）。");
    return CODE.NOT_RUN;
  }
  if (open.length > 0) {
    log("[ship] 有分支的 PR 没合并或不存在 ⇒ 那些条不许删（退 1 是提醒，不是失败）。");
    return CODE.RED;
  }
  return CODE.GREEN;
}
