/**
 * ship-title.mjs — `pnpm ship` 的**标题与比对基线**那一格：PR 标题 / squash 那一行
 * 取自哪一笔，以及 `..HEAD` / `...HEAD` 的区间按哪条引用算（ISSUE #3021）。
 *
 * ── 为什么单独一件 ─────────────────────────────────────────────
 *
 * 这一段与 `ship-platform.mjs` 里那三段**不是同一个变化方向**：那边跟着「平台对我们
 * 动作的应答」动，这里跟着「标题该取哪一笔、跟哪条分支比」动。上一次它住在
 * `ship-platform.mjs` 里时，加一条「目标分支不是本地 upstream」就把那个文件推过了
 * 900 行硬闸（与 ISSUE #2258 那次拆点的同一条理由）。
 *
 * 本层只做取数与推导：不判绿不绿、不改调用方状态。推导本身仍是 `ship-core.mjs`
 * 的纯函数 `deriveTitle`，这里只负责把读数取出来并念出口。
 */
import { deriveTitle } from "./ship-core.mjs";

/**
 * 标题的取数（PR 标题与 squash 那一行共用这一份），并把来源念出口。
 *
 * 为什么不在调用点各写一遍 `git log -1 --pretty=%s`：那一格取的是分支**当前顶端**那一笔，
 * 于是「先把 master 合进来再 `--merge`」把主干那一行写成 `Merge branch 'master' into …`，
 * 「最后补一笔碎片」把它写成 `docs(changelog): …` —— 两条都已上了主干（#2057 / #2055）。
 * 推导本身在 `ship-core.mjs` 的 `deriveTitle`（纯函数），这里只负责取读数。
 *
 * 念出口排在返回**之前**：标题坏了要当场看得见，而不是等 squash 落进历史再回头读 log。
 *
 * @param {{
 *   run: (cmd:string,args:string[])=>import("./ship-exec.mjs").ExecResult,
 *   log: (s:string)=>void,
 *   baseRef: string | null,
 *   explicit?: string | null,
 *   platform?: string | null,
 * }} ctx
 *   `platform` 是平台上这条 PR 的现标题（只有合并那一跳回读得到，建 PR 时没有；
 *   给了它，它排在 branch-first 推导之前，ISSUE #2806）
 * @returns {{title:string,source:string}} 标题与它的来源
 */
export function pickTitle({ run, log, baseRef, explicit = null, platform = null }) {
  const subjects = baseRef
    ? run("git", [
        "log",
        "--no-merges",
        "--reverse",
        "--format=%s",
        `${baseRef}..HEAD`,
      ]).stdout.split("\n")
    : [];
  const head = run("git", ["log", "-1", "--pretty=%s"]).stdout.trim();
  const t = deriveTitle({ subjects, head, explicit, platform });
  log(
    `[ship] 标题取自 ${t.source}${baseRef ? `（比的是 ${baseRef}..HEAD）` : ""}：${
      t.title || "(空)"
    }`,
  );
  return t;
}

/**
 * 「这次比对的基线引用」：跟着 PR 的目标分支走，不跟着本地 upstream 走（ISSUE #3021）。
 *
 * 现场（PR #3017）：分支 `git push -u` 把 upstream 置成了父分支在远端的副本，
 * 而本地的 `origin/<父分支>` 停在父分支的旧点 —— 于是 `A..HEAD` 把父分支上**别人后加的**
 * 提交也算进来：标题取成别人的那一笔，diffstat 涨到 999 个文件，而平台按 `base.ref`
 * 的当前顶端算出来只有 3 个。两处区间（`..HEAD` 与 `...HEAD`）本来是同一份取数，
 * 所以这里只做一次解析。
 *
 * 三步：① 取「PR 的目标分支」（新建时就是传给 `--base` 的同一条；复用时是平台回读的
 * `base.ref`）；② 取之前先 `git fetch` 刷新这条远端跟踪引用，**过期引用正是那次的真因**；
 * ③ 刷新/解析不成就照实退回 upstream 并明念一句 —— 这一格不静默，也不猜成主干。
 *
 * @param {{run:(cmd:string,args:string[])=>import("./ship-exec.mjs").ExecResult, log:(s:string)=>void, baseRef:string|null, targetBranch:string|null, remote:string|null}} ctx
 * @returns {string|null} 拿去做 `..HEAD` / `...HEAD` 的那个引用；取不到就是 `baseRef`（可能也是 null）
 */
export function diffBaseRef({ run, log, baseRef, targetBranch, remote }) {
  const branch = (targetBranch ?? "").trim();
  if (!branch || !remote) {
    log(
      `[ship] PR 的目标分支取不到 ⇒ 比对区间退回 ${baseRef ?? "(取不到)"}：` +
        "这一格没有跟随 `base.ref`，读数可能串味（栈式 PR 会算进上游那一段别人的提交）。",
    );
    return baseRef;
  }
  const ref = `${remote}/${branch}`;
  /* fetch 只看它跑没跑起来，不拿退码当结论：真结论是「`ref` 解析得到吗」那一次 verify。 */
  const fetched = run("git", ["fetch", remote, branch]).status === 0;
  const usable = run("git", ["rev-parse", "--verify", "--quiet", ref]).status === 0;
  if (usable) {
    const differs = baseRef !== null && ref !== baseRef;
    log(
      `[ship] 比对区间跟 PR 的目标分支：${ref}..HEAD` +
        (differs ? `（本地 upstream 是 ${baseRef}，不是目标分支）` : "") +
        (fetched ? "（已 fetch 刷新）" : "（fetch 没跑起来，用的是本地那份远端跟踪引用）"),
    );
    return ref;
  }
  log(
    `[ship] 目标分支 ${branch} 的 ${ref} 在本地解析不到（fetch ${fetched ? "跑起来了" : "没跑起来"}）⇒ ` +
      `比对区间退回 ${baseRef ?? "(取不到)"}：这一格没有跟随 PR 的 base.ref。`,
  );
  return baseRef;
}
