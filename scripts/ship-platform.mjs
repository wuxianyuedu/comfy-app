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
  combineShipCodes,
  decideCleanBranch,
  decideCloseIssue,
  deriveTitle,
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
 *   run: PlatformIO["run"],
 *   log: PlatformIO["log"],
 *   baseRef: string | null,
 *   explicit?: string | null,
 * }} ctx
 * @returns {{title:string,source:string}} 标题与它的来源
 */
function pickTitle({ run, log, baseRef, explicit = null }) {
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
  const t = deriveTitle({ subjects, head, explicit });
  log(
    `[ship] 标题取自 ${t.source}${baseRef ? `（比的是 ${baseRef}..HEAD）` : ""}：${
      t.title || "(空)"
    }`,
  );
  return t;
}

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
 *   explicitTitle?: string | null,
 * }} ctx
 * @returns {{number: any}} PR 号；拿不到时是 falsy，由调用方按 `CODE.NOT_RUN` 收
 */
export function createOrReusePull(ctx) {
  const {
    run,
    log,
    mkTmp,
    root,
    slug,
    branch,
    frags,
    baseRef,
    baseBranch,
    explicitTitle,
  } = ctx;
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
  const { title } = pickTitle({
    run,
    log,
    baseRef,
    explicit: explicitTitle,
  });
  if (!title) {
    log(
      '[ship] 标题两处都取不到 ⇒ 不建 PR：`--title ""` 建出来的是一条没有标题的 PR，' +
        "而读者第一件事读的就是它。这一格按「没有执行者」处理，不是「已建」。",
    );
    return { number: null };
  }
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
 *   explicitTitle?: string | null,
 *   landed?: {title: string, sha: string, verified: boolean} | null,
 * }} ctx
 *   `landed` 是「落进主干的那一行」的快照，由本函数在**验真之后**填 —— 阶段 7（关单）
 *   要的标题本体取自它，不在那里回推（原因见成功路径上那处注释）。
 * @returns {number} 三态退出码之一
 */
export function mergeAndVerify(ctx) {
  const {
    run,
    log,
    slug,
    number,
    frags,
    baseRef,
    up,
    merge,
    buildState,
    explicitTitle,
    /* 一份「落进主干的那一行」的快照，由本函数在**验真之后**填。
     * 传不传都行（不传就是没人要这份读数），所以老的调用形状不会坏。 */
    landed = null,
  } = ctx;
  if (!merge) {
    log("[ship] 未给 --merge ⇒ 停在判决处。合并是显式动作。");
    return CODE.GREEN;
  }
  if (buildState !== "green") {
    log("[ship] 拒绝合并：CI 不是绿的（当前是 " + buildState + "）。");
    return CODE.RED;
  }
  const { title } = pickTitle({
    run,
    log,
    baseRef,
    explicit: explicitTitle,
  });
  if (!title) {
    log(
      "[ship] 标题两处都取不到 ⇒ 不合并：squash 那一行是主干上读者第一眼读到的东西，" +
        "给它一个空串等于留下一行没有内容的历史。这一格按「没有执行者」处理。",
    );
    return CODE.NOT_RUN;
  }
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
  /* 验真过了才写这份读数 —— 并且**在这里**写，不留给阶段 7 去回推：
   * 下面两行 `git checkout master` + `pull` 会把 HEAD 挪走，而
   * `pickTitle` 取的是「这条分支相对主干带进来的第一笔」，跳过了这一步就再也算不出来。
   * 阶段 7（关单）要的正是「落进主干的那一行标题本体」，所以它是**这一刻**的快照。 */
  if (landed) {
    landed.title = title;
    landed.sha = mergeData.sha ?? "";
    landed.verified = true;
  }
  run("git", ["checkout", "master"]);
  run("git", ["pull", "--ff-only"]);
  log(
    "[ship] 本地 master 已同步。远端分支**没删**（那不在本脚本的动作面里）。",
  );
  return CODE.GREEN;
}

/**
 * 阶段 7：把这一行点名的 issue 置为 `closed / completed`，并**回读**再下结论。
 *
 * 与合并那一格同一条纪律：平台回执只是半个结论。所以这里调完 `update-issue` 之后
 * 走一次独立的 `get-issue`，认三件原值 —— `state` / `state_reason` / `closed_at`，
 * 并把它们原样打出来（`closed_at` 在场意味着这不是一句「我发了个请求」）。
 *
 * 幂等：对一张**已经关着**的单子再跑一次，回读照样是那三件（`closed_at` 是第一次
 * 关它的那个时刻）—— 所以「重跑一遍 ship」不会把状态改坏，也不会谎报。
 *
 * 效应与判断分家：该不该关、以什么码落，全在 `decideCloseIssue`（纯函数，判得动
 * 「要求了但这一跳没合并」那一档）；这里只负责发请求、回读、把原值打出来。
 *
 * @param {{
 *   run: PlatformIO["run"],
 *   log: PlatformIO["log"],
 *   slug: string,
 *   closeIssue: boolean,
 *   landed?: {title: string, sha: string, verified: boolean} | null,
 * }} ctx
 * @returns {number} `CODE` 之一
 */
export function closeIssues(ctx) {
  const { run, log, slug, closeIssue, landed = null } = ctx;
  const plan = decideCloseIssue({
    requested: closeIssue === true,
    landedVerified: landed?.verified === true,
    title: landed?.title ?? "",
  });
  if (!plan.act) {
    if (plan.code === CODE.NOT_RUN) {
      log(`[ship] 关单这一格**没有执行**：${plan.reason}`);
      return CODE.NOT_RUN;
    }
    return CODE.GREEN;
  }

  /** @type {number[]} */
  const codes = [];
  for (const number of plan.numbers) {
    const put = cnbJson(run, [
      "issues",
      "update-issue",
      "--repo",
      slug,
      "--number",
      String(number),
      "--state",
      "closed",
      "--state-reason",
      "completed",
      "-v",
    ]);
    if (!put) {
      log(
        `[ship] #${number}：关闭调用没有拿到 JSON 回执（cnb 不在 / 输出不是 JSON）` +
          " ⇒ 记「没有执行者」，不去猜它成没成。",
      );
      codes.push(CODE.NOT_RUN);
      continue;
    }
    /* **独立回读**：不看 update 的返回值当结论。 */
    const back = cnbJson(run, [
      "issues",
      "get-issue",
      "--repo",
      slug,
      "--number",
      String(number),
      "-v",
    ]);
    const d = back?.json?.data ?? null;
    const state = d?.state ?? "(取不到)";
    const reason = d?.state_reason ?? "(无)";
    const at = d?.closed_at ?? "(无)";
    log(
      `[ship] #${number} 回读：state=${state} state_reason=${reason} closed_at=${at}` +
        ` · 落地那一行 sha=${short(landed?.sha ?? "")}`,
    );
    codes.push(state === "closed" ? CODE.GREEN : CODE.RED);
  }
  return combineShipCodes(codes);
}

/**
 * 阶段 8：把**这一次跑的**那条分支收掉 —— 远端与本地各删一次，各自独立回读。
 *
 * 与合并、关单同一条纪律：**回执不算结论**。所以两边都不看 `git push --delete` /
 * `git branch -D` 的退码，而是各问一次事实 ——
 *   · 远端：`git ls-remote --heads <远端> <分支>` 里还有没有那条；
 *   · 本地：`git show-ref --verify refs/heads/<分支>` 还查不查得到。
 * 回读本身没跑起来（网络 / 非零）落 `NOT_RUN` 而不是「已删」—— 「没拿到测量」与
 * 「测量结果是红的」是两件事，这一族从头到尾就是在守这一条。
 *
 * 本地为什么用 `-D` 而不是 `-d`：本仓 PR 是 **squash 合并**，本地那笔永远不是主干那笔的
 * 祖先，`-d` 的祖先判据在这条形状下**恒假**（实测六条已合并分支全部被拒）。写成 `-d`
 * 等于把这条能力做成"永远不生效"。代价由前两道守卫承担：只在 `landedVerified` 为真时才走到，
 * 且**删之前先把那笔 sha 打出来**当恢复线（`git branch <名> <sha>`）。
 *
 * @param {{
 *   run: PlatformIO["run"],
 *   log: PlatformIO["log"],
 *   remote: string | null,
 *   branch: string,
 *   landedVerified: boolean,
 *   cleanBranch: boolean,
 * }} ctx
 * @returns {number} `CODE` 之一
 */
export function cleanBranch(ctx) {
  const {
    run,
    log,
    remote,
    branch,
    landedVerified,
    cleanBranch: requested,
  } = ctx;
  const plan = decideCleanBranch({ requested, landedVerified, branch });
  if (!plan.act) {
    if (plan.code === CODE.NOT_RUN) {
      log(`[ship] 分支清理**没有执行**：${plan.reason}`);
      return CODE.NOT_RUN;
    }
    return CODE.GREEN;
  }
  const name = plan.branch;
  if (!remote) {
    log(
      "[ship] 推不出远端名 ⇒ 远端那一半没有执行者，这一格按「没跑起来」处理，" +
        "不去删本地那一半冒充「清理完成」。",
    );
    return CODE.NOT_RUN;
  }
  const sha = run("git", ["rev-parse", "--short", name]).stdout.trim();
  log(
    `[ship] 清理分支 ${name} · 被删那笔 ${sha || "(取不到)"} —— 要恢复：` +
      `git branch ${name} ${sha || "<sha>"}`,
  );

  /** @type {number[]} */
  const codes = [];
  const del = run("git", ["push", remote, "--delete", name]);
  const echo = [del.stdout, del.stderr]
    .map((s) => (s || "").trim())
    .filter(Boolean);
  for (const line of echo) {
    log(`[ship]   ${line.split("\n").join("\n[ship]   ")}`);
  }
  const back = run("git", ["ls-remote", "--heads", remote, name]);
  if (back.status !== 0) {
    log(
      `[ship] 远端回读没跑起来（exit ${back.status}）⇒ 这一格不判「已删」，也不判「还在」`,
    );
    codes.push(CODE.NOT_RUN);
  } else if (back.stdout.trim()) {
    log(`[ship] 远端回读：${remote} 的 heads 里**仍然有** ${name}（删没掉）`);
    codes.push(CODE.RED);
  } else {
    log(`[ship] ✓ 远端回读：${remote} 的 heads 里已无 ${name}`);
    codes.push(CODE.GREEN);
  }

  const rm = run("git", ["branch", "-D", name]);
  const rmEcho = [rm.stdout, rm.stderr]
    .map((s) => (s || "").trim())
    .filter(Boolean);
  for (const line of rmEcho) {
    log(`[ship]   ${line.split("\n").join("\n[ship]   ")}`);
  }
  const verify = run("git", [
    "show-ref",
    "--verify",
    "--quiet",
    `refs/heads/${name}`,
  ]);
  if (rm.status !== 0 && verify.status === 0) {
    log(
      `[ship] 本地那一半没删掉（exit ${rm.status}）⇒ 这一格是红的，不记「已清理」`,
    );
    codes.push(CODE.RED);
  } else if (verify.status === 0) {
    log(`[ship] 本地回读：refs/heads/${name} **还在**`);
    codes.push(CODE.RED);
  } else {
    log(`[ship] ✓ 本地回读：refs/heads/${name} 已不在（恢复线见上面那行 sha）`);
    codes.push(CODE.GREEN);
  }
  return combineShipCodes(codes);
}
