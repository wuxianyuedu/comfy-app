/**
 * branch-clean.mjs —— 安全删掉**一条已落地**的分支（ISSUE #5166）。
 *
 * 为什么不能手敲：squash 拓扑下 `git branch -d` 的祖先判据恒假（实测六条已合并分支全被拒），
 * 真删要用 `-D`，而 `-D` 没有护栏 —— 删错只能靠 reflog；远端那半还要 `push --delete` +
 * `ls-remote` 回读。本仓已有两条现成判据，这里只把它们接上执行面：
 *   · 「落地没落地」只认 PR 的 `is_merged`（`ship-branches.mjs` 的 `branchLandingRows`）；
 *   · 「删 + 两边回读 + 拒删归因」直接复用 `ship-platform.mjs` 的 `cleanBranch`，不写第二套。
 *
 * 用法：`pnpm ship:branch-clean <分支名> [--yes]`
 *   - 不带 `--yes` 只念判定与计划，一次也不删（与 `--reap` 默认只念读数同一纪律）；
 *   - 显式拒绝批量：一次只收一个分支名；
 *   - 当前检出占着这条分支时，删之前先 `git checkout --detach <sha>`（恢复线由读数打出）。
 *
 * 退出码沿用 ship 的三态：0 = 已删（或只读判定为可删）；1 = 有事实是红的（未落地却要删 /
 * 删没删掉）；2 = 没结论（分支不在本地 / slug 或 PR 窗口取不到 / 用法错）。
 */
import { pathToFileURL } from "node:url";

import { branchLandingRows, fetchPullsForBranches, readLocalRefs } from "../ship/ship-branches.mjs";
import { CODE, parseSlug } from "../ship/ship-core.mjs";
import { makeRunner } from "../ship/ship-exec.mjs";
import { cleanBranch } from "../ship/ship-platform.mjs";

/**
 * 纯判断：这一条允许不允许进入删除那一步。
 *
 * @param {{verdict:string|null, confirmed:boolean, current:boolean}} input
 * @returns {{act:boolean, code:number, reason:string}}
 */
export function decideBranchClean({ verdict, confirmed, current }) {
  if (verdict === "no-pull-in-window" || verdict === null) {
    return { act: false, code: CODE.NOT_RUN, reason: "没取到这条分支的 PR ⇒ 没有结论，不删" };
  }
  if (verdict !== "landed") {
    return {
      act: false,
      code: CODE.RED,
      reason: "PR 没合并（或没提过 PR）⇒ 不许删",
    };
  }
  if (!confirmed) {
    return {
      act: false,
      code: CODE.GREEN,
      reason: current
        ? "只读判定：可删；当前检出占着它，真删会先 checkout --detach，加 --yes 执行"
        : "只读判定：可删；加 --yes 执行",
    };
  }
  return { act: true, code: CODE.GREEN, reason: "已落地且人点名 --yes ⇒ 执行删除" };
}

/**
 * @param {{
 *   run:(cmd:string,args:string[])=>{stdout:string,stderr:string,status:number,error:string|null},
 *   log:(s:string)=>void, slug:string|null, remote?:string, name:string, confirmed?:boolean,
 * }} ctx
 * @returns {number} `CODE` 之一
 */
export function runBranchClean({ run, log, slug, remote = "origin", name, confirmed = false }) {
  if (!slug) {
    log("[branch-clean] 取不到仓库 slug ⇒ 无法向平台问 PR，这一格没有结论（不是「可删」）。");
    return CODE.NOT_RUN;
  }
  const targetName = String(name ?? "").trim();
  if (!targetName || targetName === "HEAD" || targetName === "master") {
    log(`[branch-clean] 分支名不可用（「${targetName || "(空)"}」）⇒ 不猜名字、不删别的东西。`);
    return CODE.NOT_RUN;
  }
  const refs = readLocalRefs(run, remote);
  if (!refs.ok) {
    log(`[branch-clean] ${refs.note} ⇒ 这一格没有结论。`);
    return CODE.NOT_RUN;
  }
  const target = refs.branches.find((b) => b.name === targetName);
  if (!target) {
    log(`[branch-clean] 本地没有 \`${targetName}\` 这条分支 ⇒ 不猜、不动远端同名 ref。`);
    return CODE.NOT_RUN;
  }
  const fetched = fetchPullsForBranches(run, slug);
  if (!fetched.ok) {
    log(`[branch-clean] ${fetched.note} ⇒ 这一格没有结论（退 2 不是「没合并」）。`);
    return CODE.NOT_RUN;
  }
  const [row] = branchLandingRows([target], fetched.pulls, refs.remoteRefs, refs.current, {
    windowComplete: fetched.windowComplete,
  });
  const current = row?.current === true;
  log(
    `[branch-clean] ${targetName} · sha ${String(target.sha).slice(0, 8)} · PR ${
      row?.pr ? `#${row.pr}` : "无"
    } · is_merged=${row?.isMerged === null || row?.isMerged === undefined ? "?" : String(row.isMerged)}` +
      ` · 远端=${row?.remote ? "在" : "无"}${current ? " · ← 当前检出占着" : ""}`,
  );
  const plan = decideBranchClean({ verdict: row?.verdict ?? null, confirmed, current });
  if (!plan.act) {
    log(`[branch-clean] ${plan.reason}${confirmed ? "" : "（只读，一条也没删）"}`);
    return plan.code;
  }
  if (current) {
    const switched = run("git", ["checkout", "--detach", target.sha]);
    if (switched.status !== 0) {
      log(
        `[branch-clean] 切到恢复线 \`git checkout --detach ${target.sha}\` 退 ${String(switched.status)}` +
          " ⇒ 不删（分支还占着，原样保留）。",
      );
      return CODE.NOT_RUN;
    }
    log(`[branch-clean] 已切到恢复线 ${String(target.sha).slice(0, 8)}，接着删 ${targetName}。`);
  }
  return cleanBranch({
    run,
    log,
    remote,
    branch: targetName,
    landedVerified: true,
    cleanBranch: true,
  });
}

/** @param {string[]} argv */
function main(argv) {
  const args = argv.filter((a) => a !== "--yes");
  const confirmed = argv.includes("--yes");
  if (args.length !== 1 || args[0]?.startsWith("-")) {
    process.stderr.write(
      "用法：pnpm ship:branch-clean <分支名> [--yes]\n" +
        "  一次只收一个分支；落地判据只认 PR 的 is_merged；不带 --yes 只念判定，不删。\n",
    );
    return CODE.NOT_RUN;
  }
  const root = process.cwd();
  /* cnb 在 Windows 是 .cmd 垫片，必须用 ship 的执行器（它会解析命令形态）；
   * 自己 spawn 会 ENOENT，而「没跑起来」会被翻页判据读成「没结论」。 */
  const run = makeRunner(root);
  const slug = parseSlug(run("git", ["remote", "get-url", "origin"]).stdout);
  return runBranchClean({
    run,
    log: (s) => process.stdout.write(`${s}\n`),
    slug,
    name: args[0] ?? "",
    confirmed,
  });
}

/* 只在直接执行时跑：测试 import 纯函数 / 注入 run 不应产生任何 git / 平台副作用。 */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
