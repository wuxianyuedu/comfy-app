/**
 * ship-platform.mjs — `pnpm ship` 的**平台侧四段**：建 / 复用 PR → 轮询 build →
 * 出判决 → 显式合并并回读主干顶端（规范 §13.6 的阶段 3~6）。
 *
 * ── 为什么单独一件 ─────────────────────────────────────────────
 *
 * 这四段的共同点：它们**只经 `run` / `cnbJson` 与世界打交道**，自己不起进程、
 * 不写文件、不读 git 目录。所以整段可以在用例里用同一份假执行者跑完（见
 * `tests/ship.test.ts` 注入 `run` 的那一组）。而 `ship.mjs` 里剩下的 preflight /
 * commit / push 三段都摸的是**本检出**（HEAD、工作树、碎片、证明），两者混在
 * 一个函数里时，「加一个平台动作」就会把本地那几段的行数一起推过 900 硬闸。
 *
 * ── 本层的形状约定 ────────────────────────────────────────────
 *
 * 每个函数**返回结论，不改调用方的状态**：要么回一个 `CODE`（三态退出码之一），
 * 要么回 `{ number }` / `{ buildState, buildSn, stop }` 这种中间事实。
 * 往 `codes` 里追加、以及退 0 时那句「结论：exit N」的收口，全留给编排入口 ——
 * 那样「哪一段跑了、各段结论是什么」只有一处记账，函数自己不抢着下总结论。
 *
 * 终态依旧只认两个原值：build 的 `data.status`、PR 的 `is_merged`（取自
 * `ship-core.mjs` 的那两个 reader）。本层一次也不自己判「绿不绿」。
 */
import {
  asArray,
  buildPullBody,
  CODE,
  findPullForBranch,
  pickBuildForSha,
  readBuildVerdict,
  readPullVerdict,
} from "./ship-core.mjs";
import { cnbJson, short } from "./ship-exec.mjs";

/**
 * 编排入口注入给本层的执行面。
 *
 * @typedef {Object} PlatformIO
 * @property {(cmd:string,args:string[])=>import("./ship-exec.mjs").ExecResult} run 外部命令执行者
 * @property {(s:string)=>void} log 输出通道（用例里指到数组）
 * @property {(name:string,text:string)=>string | null} mkTmp 写一份待回收的临时文件
 * @property {string} root 仓库根（PR 正文里读碎片原文要用）
 * @property {string} slug `org/repo`
 */

/**
 * 「远端叫什么、主干基线是哪条」那份解析结果。
 *
 * @typedef {Object} Upstream
 * @property {string | null} remote 远端名
 * @property {string | null} base 基线引用（如 `origin/master`）
 * @property {string} source 来源档位（`upstream` / `sole-remote` / `origin` / `none`）
 */

/**
 * 阶段 3：拿这条分支的 PR —— 已有开放的复用，没有就建。
 *
 * 幂等是必需的：同一条分支上第二次 `pnpm ship`（第一次只推到建 PR、CI 还没绿）
 * 不能长出第二个 PR，也不能因为「已经有了」而报失败。
 *
 * @param {PlatformIO & {
 *   branch: string,
 *   frags: string[],
 *   baseRef: string | null,
 *   baseBranch: string | null,
 * }} ctx
 * @returns {{number: any}} PR 号；拿不到时是 falsy，由调用方按 `CODE.NOT_RUN` 收
 */
export function createOrReusePull(ctx) {
  const { run, log, mkTmp, root, slug, branch, frags, baseRef, baseBranch } =
    ctx;
  const list = cnbJson(run, [
    "pulls",
    "list-pulls",
    "--repo",
    slug,
    "--state",
    "open",
    "-v",
  ]);
  let number = list ? findPullForBranch(list.json, branch) : null;
  if (number) {
    log(`[ship] 已有开放 PR #${number} ⇒ 复用，不重建（幂等）`);
    return { number };
  }
  const title = run("git", ["log", "-1", "--pretty=%s"]).stdout.trim();
  const body = buildPullBody({
    root,
    fragments: frags,
    /* 基线取不到时这一格就是空 —— 宁缺：拿 `HEAD...HEAD` 会得到一份「什么都没有」
     * 的 diffstat，而 PR 正文里那句「这次改了哪些文件」正是读者判断成本的入口。 */
    diffstat: baseRef
      ? run("git", ["diff", "--stat", `${baseRef}...HEAD`]).stdout.trim()
      : "",
  });
  /* 守卫排在落临时文件**之前**：`mkTmp` 的回收挂在 `main` 的 `finally` 上，
   * 先建再退虽然不会留垃圾，但会让「这次没建 PR」那一次也在盘上写过一份
   * 提交信息原文 —— 而 #2037 修的就是这类东西不该留在盘上。 */
  if (!baseBranch) {
    log(
      "[ship] 推不出主干分支名（基线引用不可用）⇒ 不建 PR：拿一个猜的 `--base` 建出去，" +
        "得到的是「PR 指向一条不存在的主干」，而平台会照建不误。这一格退 NOT_RUN。",
    );
    return { number: null };
  }
  const bf = mkTmp("ship-pr-body", body);
  if (!bf) {
    /* 正文可能上千行，`--body <串>` 会撞上 Windows 的 32k argv 上限，
     * 所以这一格只能走文件。取不到 git 目录 = 不在真检出里 ⇒ 说清楚
     * 而不是往工作区猜一个落点。 */
    log(
      "[ship] 取不到 git 目录 ⇒ PR 正文没有落点，这一格没有执行者（不是「不需要」）。",
    );
    return { number: null };
  }
  const made = cnbJson(run, [
    "pulls",
    "post-pull",
    "--repo",
    slug,
    "--base",
    baseBranch,
    "--head",
    branch,
    "--head-repo",
    slug,
    "--title",
    title,
    "--body-file",
    bf,
    "-v",
  ]);
  if (!made) {
    log(
      "[ship] 建 PR 没拿到可解析的响应 ⇒ 这一格没有结论（不是「失败」也不是「成功」）",
    );
    return { number: null };
  }
  number = readPullVerdict(made.json).number;
  if (!number) {
    /* ⚠️ 这一格错过一次，而且是最重的那一类：响应**能解析**、`data` 里却没有号
     * （实测 `cnb pulls post-pull` 带一个含 `--xxx=yyy` 的 `--title` 经 PowerShell 宿主
     * 转发时失败），上一版把 `✓ 已建 PR #null` 先打了出去 —— 平台上根本没有那个 PR，
     * 而屏幕上写着成功。取值之后**先验再念**：念出来的一句「已建」必须有一个号撑着。
     * 原文与 stderr 一起给：这个工具的职责是如实转述执行者，不是替它总结。 */
    log(
      "[ship] 建 PR 的响应解析出来了，但里面**没有 PR 号** ⇒ 不打印「已建」，" +
        "这一格按「没跑起来」处理（exit 2）。",
    );
    log(
      `[ship]   退码 ${made.code} · 响应原文（截 500 字）：${made.raw.slice(0, 500)}`,
    );
    if (made.stderr.trim()) {
      log(`[ship]   stderr：${made.stderr.trim().slice(0, 500)}`);
    }
    return { number: null };
  }
  log(`[ship] ✓ 已建 PR #${number}`);
  return { number };
}

/**
 * 阶段 4：轮询这条 sha 的 build，直到出终态或预算到顶。
 *
 * 选 build 只按 **sha + `event === "pull_request"`** 取最新一条（`pickBuildForSha`），
 * 不拿「列表里第一条」兜底 —— 同一台节点上会并存多条 PR build，取错那条等于
 * 用别人的流水线给自己的代码作证。
 *
 * @param {{
 *   run: PlatformIO["run"],
 *   log: PlatformIO["log"],
 *   slug: string,
 *   newSha: string,
 *   now: ()=>number,
 *   sleep: (ms:number)=>void | Promise<void>,
 * }} ctx
 * @returns {Promise<{buildState:"green"|"red"|"running"|"unknown",buildSn:string|null,stop:number|null}>}
 *   `stop` 非 null 时调用方直接以此码收尾（那一格没跑起来）
 */
export async function pollUntilTerminal(ctx) {
  const { run, log, slug, newSha, now, sleep } = ctx;
  let buildState = /** @type {"green"|"red"|"running"|"unknown"} */ ("unknown");
  let buildSn = null;
  const deadline = now() + 45 * 60 * 1000;
  for (;;) {
    const logs = cnbJson(run, [
      "build",
      "get-build-logs",
      "--repo",
      slug,
      "-v",
    ]);
    const builds = logs ? asArray(logs.json) : null;
    if (!builds) {
      log(
        "[ship] 取不到 build 列表 ⇒ 没跑起来，不当成「还在跑」也不当成「绿」",
      );
      return { buildState, buildSn, stop: CODE.NOT_RUN };
    }
    const picked = pickBuildForSha(builds, newSha);
    if (!picked) {
      log(
        `[ship] 按 sha ${short(newSha)} 还没解析到 build（平台可能尚未开跑）…`,
      );
    } else {
      buildSn = picked.sn;
      const st = cnbJson(run, [
        "build",
        "get-build-status",
        "--repo",
        slug,
        "--sn",
        picked.sn,
        "-v",
      ]);
      /** @type {{state:"green"|"red"|"running"|"unknown",raw:string|null}} */
      const v = st
        ? readBuildVerdict(st.json)
        : { state: "unknown", raw: null };
      buildState = v.state;
      log(`[ship] build ${picked.sn} → data.status = ${v.raw ?? "(取不到)"}`);
      if (v.state !== "running" && v.state !== "unknown") break;
    }
    if (now() > deadline) {
      log("[ship] 轮询到预算上限仍未出终态 ⇒ 记「没跑起来」，不猜结论");
      buildState = "unknown";
      break;
    }
    await sleep(20000);
  }
  return { buildState, buildSn, stop: null };
}

/**
 * 阶段 5：把 CI 终态与 PR 的可合并状态一起念出来，并给出下一动作。
 *
 * 红的时候**不自己归因** —— 点名既有执行者 `base-check.mjs`。这一格是整条链上
 * 最容易顺手加一句「大概是你哪条改动导致的」的地方，而那句话没有执行者。
 *
 * @param {{
 *   run: PlatformIO["run"],
 *   log: PlatformIO["log"],
 *   slug: string,
 *   number: any,
 *   buildState: "green"|"red"|"running"|"unknown",
 *   buildSn: string | null,
 * }} ctx
 * @returns {number} 三态退出码之一
 */
export function reportVerdict(ctx) {
  const { run, log, slug, number, buildState, buildSn } = ctx;
  const pr = cnbJson(run, [
    "pulls",
    "get-pull",
    "--repo",
    slug,
    "--number",
    String(number),
    "-v",
  ]);
  const pv = pr ? readPullVerdict(pr.json) : null;
  if (pv) {
    log(
      `[ship] PR #${number}：mergeable_state=${pv.mergeableState} blocked_on=${pv.blockedOn || "(无)"} is_merged=${pv.isMerged}`,
    );
  }
  if (buildState === "green") {
    log(`[ship] ✓ CI 绿（build ${buildSn}）。下一动作：pnpm ship --merge`);
    return CODE.GREEN;
  }
  if (buildState === "red") {
    log(
      `[ship] ✗ CI 红（build ${buildSn}）。日志：https://cnb.cool/${slug}/-/build/logs/${buildSn}`,
    );
    log(
      "[ship] 归因交给既有执行者：`node scripts/base-check.mjs <拦住你的那条>` —— 本脚本不自己判「是我的还是主干的」。",
    );
    return CODE.RED;
  }
  log("[ship] 没拿到 build 终态 ⇒ 这一格没有结论，不进入合并。");
  return CODE.NOT_RUN;
}

/**
 * 阶段 6：合并（只在显式 `--merge` 且 CI 绿时），并**回读两件事**再下结论。
 *
 * 平台回执 `merged:true` 只是半个结论：只看它就退 0，等于把「合上了」建立在
 * 一次调用的返回值上。所以再取两件独立事实 —— PR 的 `is_merged`，以及这份碎片
 * 真的在**解析出的主干基线顶端**（`cat-file -e`）。回读那条引用同样来自
 * `resolveUpstream`，写死任何远端名都会在「远端名不是它」的那台克隆上
 * 让 fetch 与 cat-file 双双失败 ⇒ 报成红；反过来若某处吞了失败，就会报成「都在」。
 *
 * @param {{
 *   run: PlatformIO["run"],
 *   log: PlatformIO["log"],
 *   slug: string,
 *   number: any,
 *   frags: string[],
 *   baseRef: string | null,
 *   up: Upstream,
 *   merge: boolean,
 *   buildState: "green"|"red"|"running"|"unknown",
 * }} ctx
 * @returns {number} 三态退出码之一
 */
export function mergeAndVerify(ctx) {
  const { run, log, slug, number, frags, baseRef, up, merge, buildState } = ctx;
  if (!merge) {
    log("[ship] 未给 --merge ⇒ 停在判决处。合并是显式动作。");
    return CODE.GREEN;
  }
  if (buildState !== "green") {
    log("[ship] 拒绝合并：CI 不是绿的（当前是 " + buildState + "）。");
    return CODE.RED;
  }
  const title = run("git", ["log", "-1", "--pretty=%s"]).stdout.trim();
  const mg = cnbJson(run, [
    "pulls",
    "merge-pull",
    "--repo",
    slug,
    "--number",
    String(number),
    "--merge-style",
    "squash",
    "--commit-title",
    `${title} (#${number})`,
    "-v",
  ]);
  /** @type {{merged?:boolean,sha?:string} | null} */
  const mergeData = mg && mg.json ? (mg.json.data ?? null) : null;
  if (!mergeData || mergeData.merged !== true) {
    log("[ship] 合并调用没给出 merged:true ⇒ 不假定它成功了，去平台上核对。");
    return CODE.RED;
  }
  // 回读两件事：平台说合上了，**且**碎片真的在主干顶端（只看平台回执 = 半个结论）。
  const baseParts = (baseRef ?? "").split("/");
  const trunkBranch = baseParts.slice(1).join("/");
  run("git", [
    "fetch",
    baseParts[0] ?? up.remote ?? "origin",
    trunkBranch || "master",
  ]);
  const stillOpen = cnbJson(run, [
    "pulls",
    "get-pull",
    "--repo",
    slug,
    "--number",
    String(number),
    "-v",
  ]);
  const back = stillOpen ? readPullVerdict(stillOpen.json) : null;
  const readRef = baseRef ?? `${up.remote ?? "origin"}/master`;
  const fragOnMaster = frags.every(
    (f) => run("git", ["cat-file", "-e", `${readRef}:${f}`]).status === 0,
  );
  log(
    `[ship] 合并回执 sha=${short(mergeData.sha)} 回读 is_merged=${back ? back.isMerged : "?"} 碎片在主干顶端=${fragOnMaster}`,
  );
  if (!(back && back.isMerged && fragOnMaster)) return CODE.RED;
  run("git", ["checkout", "master"]);
  run("git", ["pull", "--ff-only"]);
  log(
    "[ship] 本地 master 已同步。远端分支**没删**（那不在本脚本的动作面里）。",
  );
  return CODE.GREEN;
}
