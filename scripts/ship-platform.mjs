/**
 * ship-platform.mjs — `pnpm ship` 的**平台侧三段 + 分支清理**：建 / 复用 PR →
 * 出判决 → 显式合并并回读主干顶端（规范 §13.6 的阶段 3、5、6），以及阶段 8 的
 * 分支清理（远端与本地 ref 各问一次事实）。
 *
 * ── 为什么单独一件 ─────────────────────────────────────────────
 *
 * 这几段的共同点：它们**只经 `run` / `cnbJson` 与世界打交道**，自己不起进程、
 * 不写文件、不读 git 目录。所以整段可以在用例里用同一份假执行者跑完（见
 * `tests/ship.test.ts` 注入 `run` 的那一组）。而 `ship.mjs` 里剩下的 preflight /
 * commit / push 三段都摸的是**本检出**（HEAD、工作树、碎片、证明），两者混在
 * 一个函数里时，「加一个平台动作」就会把本地那几段的行数一起推过 900 硬闸。
 *
 * 阶段 4（轮询 build）在 `ship-poll.mjs`：它与这里三段**不是同一个变化方向** ——
 * 轮询跟着「一条 build 怎么被读、等多久才算没有结论」动，这里三段跟着「平台对我们
 * 动作的应答」动。拆点与那次 900 行硬闸的现场见该文件头（ISSUE #2258）。
 *
 * ── 本层的形状约定 ────────────────────────────────────────────
 *
 * 每个函数**返回结论，不改调用方的状态**：要么回一个 `CODE`（三态退出码之一），
 * 要么回 `{ number }` 这种中间事实（轮询那一份形状留在 `ship-poll.mjs`）。
 * 往 `codes` 里追加、以及退 0 时那句「结论：exit N」的收口，全留给编排入口 ——
 * 那样「哪一段跑了、各段结论是什么」只有一处记账，函数自己不抢着下总结论。
 *
 * 终态依旧只认两个原值：build 的 `data.status`、PR 的 `is_merged`（取自
 * `ship-core.mjs` 的那两个 reader）。本层一次也不自己判「绿不绿」。
 *
 * ⚠️ 「逐格读数优先于构建级状态」那一层（平台把「被取消」记成构建级 `error`）
 * 跟着轮询一起在 `ship-poll.mjs`；本层只按已分好的三态念结论（ISSUE #2158 第 2 条 /
 * 规范 §13.5.26）。
 */
import path from "node:path";

import { asArray } from "./ship-build.mjs";
import {
  classifyPrMergeable,
  CODE,
  codeTag,
  combineShipCodes,
  conflictAdviceLines,
  decideCleanBranch,
  findMergedPullForHeadSha,
  findPullForBranch,
  readPullCreateError,
  readPullVerdict,
} from "./ship-core.mjs";
import { openScanReadout, scanPullPages } from "./ship-scan.mjs";
import { planCreateBody, updatePullBodyOnReuse } from "./ship-pr-body.mjs";
import { diffBaseRef, pickTitle } from "./ship-title.mjs";
import { cnbJson, short } from "./ship-exec.mjs";
import { reportConflictStage, reportStage } from "./ship-stage.mjs";
import { DEV_HANDLE_ENV_KEY, handlerLabel } from "./ship-ticket.mjs";

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
 * 给 PR 补 `处理人:<短名>` 标签，并**独立回读**再下结论（ISSUE #2204）。
 *
 * `post-pull-labels` 的回执不算结论：issue 侧实测 `create-issue --labels` 不落地，
 * PR 侧同样只认 `list-pull-labels` 里看得见那个名字（与合并 / 关单同一条纪律）。
 *
 * 但它是**留痕读数，不是判据**：未配 handle、或平台没把标签落地，都不改退码 ——
 * 做成硬闸的后果与 #2175 同型（逼人随手填一个值，而假留痕比没留痕难查）。
 * 未配时把这一份检出的 `.env` 绝对路径与命令念出来：四份并行检出时，
 * 「去 `.env` 加一行」指不出是哪一份（#2186 的现场）。
 *
 * @param {{
 *   run: PlatformIO["run"],
 *   log: PlatformIO["log"],
 *   slug: string,
 *   number: any,
 *   handle: string | null | undefined,
 *   root: string,
 * }} ctx
 */
function stampHandlerLabel({ run, log, slug, number, handle, root }) {
  const label = handlerLabel(handle);
  if (!label) {
    log(
      `[ship] 取不到留痕短名 ⇒ PR #${number} 没有 \`处理人:\` 标签` +
        "（这一格是读数，不参与退码）。名字本来有取值链（`dev-handle.mjs`：人填的 → " +
        "`CNB_NPC_NAME` / `CNB_TOKEN_USER_NAME` → `git config user.name` → `cnb`），走到空只可能是" +
        `装配层没传；要人填就写 \`${path.join(root, ".env")}\` 那一行 \`${DEV_HANDLE_ENV_KEY}="<短名>"\`。` +
        " 再 `pnpm ship` 重跑会补上。",
    );
    return;
  }
  cnbJson(run, [
    "pulls",
    "post-pull-labels",
    "--repo",
    slug,
    "--number",
    String(number),
    "--labels",
    label,
    "-v",
  ]);
  const read = cnbJson(run, [
    "pulls",
    "list-pull-labels",
    "--repo",
    slug,
    "--number",
    String(number),
    "-v",
  ]);
  const names = read ? (asArray(read.json) ?? []).map((x) => String(x?.name ?? "")) : [];
  if (names.includes(label)) {
    log(`[ship] ✓ PR #${number} 标签 ${label} 已回读（list-pull-labels）`);
    return;
  }
  log(
    `[ship] PR #${number} 的标签 ${label} **没有落地证明**` +
      `（${read ? "回读里没有这个名字" : "回读没跑起来"}）⇒ 不念「已打上」；` +
      "这一格是读数、不改退码。手工补：",
  );
  log(`[ship]   cnb pulls post-pull-labels --repo ${slug} --number ${number} --labels ${label} -v`);
}

/**
 * 落地判定（ISSUE #2250）：这一笔 HEAD 是不是已经随某条**已合并**的 PR 进过主干。
 *
 * 为什么问平台而不问 diff 或 `merge-base`：squash 合并只保证**内容**相同，主干那笔 sha
 * 与分支头不同，祖先判据对它恒假（实测：今天两条已合并分支的三点 diff 仍给出 7 / 4 个文件，
 * 而分支头都不是 master 的祖先）。平台在 PR 记录里留着 `head.sha` 与 `is_merged`，
 * 这两件才是正面事实，且与 `ship-close.mjs` 的落地反查同一套取法。
 *
 * 有界扫（页参数与那一路一致）：扫不到就照实念，**不撤销结论** —— 「取不到」不等于「没落地」，
 * 那一格照常建 PR。
 *
 * @param {{run:(cmd:string,args:string[])=>import("./ship-exec.mjs").ExecResult, slug:string, headSha:string, pages?:number, pageSize?:number}} ctx
 * @returns {{prNumber: number | null, unknownPr: number | null, scanned: number, ran: boolean}}
 *   `unknownPr`：head.sha 逐字相同而 `is_merged` 缺键的那条（ISSUE #3059，判读交给调用方）。
 */
function findLandedPull(ctx) {
  const { slug, headSha } = ctx;
  /** @type {{unknownPr?: number|null}} */
  const sink = {};
  const scan =
    slug && headSha
      ? scanPullPages(ctx, {
          state: "closed",
          visit: (json) => findMergedPullForHeadSha(json, headSha, sink) ?? sink.unknownPr ?? null,
        })
      : { hit: null, scanned: 0, ran: false };
  return {
    prNumber: sink.unknownPr ? null : scan.hit,
    unknownPr: sink.unknownPr ?? null,
    scanned: scan.scanned,
    ran: scan.ran,
  };
}

/**
 * 建 / 复用 PR 之后那一眼（ISSUE #3083）：这条 PR 是不是已经因为与 base 冲突而
 * **永远不会**被平台派生 CI。
 *
 * 为什么在这里读：冲突的 PR 平台不派生构建（#3075 现场），而冲突读数在建 PR 那一刻
 * 就能拿到 —— 等到轮询第一眼再看，是把「立刻能说的真因」推迟一拍，还押给「人刚好
 * 没给 --no-wait」。读到冲突就当场收口（调用方按「没跑起来」退 2），出口是人工解
 * 冲突：脚本不自动改代码（#3075 那类取舍要人判）。
 *
 * 读不到 / 缺键 ⇒ 按「未知」处理、**不拦**：缺读数不新增结论，轮询那一眼还会再看。
 * 同一眼顺带报「走到哪了」的 PR 身份（标题是**平台回读**的现标题；不为它发第二次 get-pull）。
 *
 * @param {{run: PlatformIO["run"], log: PlatformIO["log"], slug: string, number: any, baseRef: string | null, via: "新建" | "复用"}} ctx
 * @returns {boolean} true = 冲突（调用方按 `CODE.CONFLICT` 收口）
 */
function reportPullConflict({ run, log, slug, number, baseRef, via }) {
  const pr = cnbJson(run, ["pulls", "get-pull", "--repo", slug, "--number", String(number), "-v"]);
  const pv = pr ? readPullVerdict(pr.json) : null;
  if (!pv) {
    reportStage(log, `${via} PR`, { pr: number, title: "(回读没跑起来)" });
    log(
      "[ship] PR 可合并状态回读没跑起来（get-pull 取不到）⇒ 这一眼按「未知」处理，不拦：" +
        "缺读数不新增结论，轮询那一格还会再看。",
    );
    return false;
  }
  reportStage(log, `${via} PR`, { pr: number, title: pv.title || "(空)", state: pv.state });
  log(
    `[ship] PR #${number}：mergeable_state=${pv.mergeableState} blocked_on=${pv.blockedOn || "(无)"}`,
  );
  if (classifyPrMergeable(pv) !== "conflict") {
    return false;
  }
  log(
    `[ship] ✗ PR #${number} 与 base 冲突 ⇒ 平台不会为这条 PR 派生 CI` +
      `（${codeTag(CODE.CONFLICT)}；这不是「还在排队」，干等到超时也没有结论）。`,
  );
  reportConflictStage({ run, log, number, baseRef, blockedOn: pv.blockedOn });
  for (const line of conflictAdviceLines({ number, baseRef })) {
    log(line);
  }
  return true;
}

/**
 * 阶段 3：拿这条分支的 PR —— 已有开放的复用，**已落地的不建**，两种都不是才建。
 *
 * 幂等是必需的：同一条分支上第二次 `pnpm ship`（第一次只推到建 PR、CI 还没绿）
 * 不能长出第二个 PR，也不能因为「已经有了」而报失败。
 *
 * ⚠️ 但「开放清单里没有」不等于「这条分支没合过」：合并成功那一刻 PR 转 `closed`，
 * 只认开放的那条幂等就在那一刻失效，于是合并之后再跑一次会长出一条**内容已在主干的
 * 幽灵 PR**（能被再 squash 一次，主干落重复提交 + 白烧一轮 CI）—— 这一格由落地判定拦下
 * （ISSUE #2250）。
 *
 * @param {PlatformIO & {
 *   branch: string,
 *   frags: string[],
 *   baseRef: string | null,
 *   baseBranch: string | null,
 *   explicitTitle?: string | null,
 *   handle?: string | null,
 *   prBody?: string | null,
 * }} ctx
 * @returns {{number: any, stop: number | null}} PR 号与收口码。`stop` 非 null 时
 *   调用方直接以此码收尾：冲突（`CODE.CONFLICT`，ISSUE #3083，出口话术这一格已念）、
 *   已落地守卫（`CODE.GUARD_REFUSED`，ISSUE #2250）、建不出来（`CODE.NOT_RUN`）。
 *   `stop` 为 null 时 `number` 一定拿得到（继续往下走）。
 *   `prBody` 是 `--pr-body-file` 读进来的原文：建 PR 时注入；复用已有 PR 时
 *   **整篇更新**（不给就一个字节都不动，见 `ship-pr-body.mjs` 的口径）。
 */
export function createOrReusePull(ctx) {
  const {
    run,
    log,
    mkTmp,
    root,
    slug,
    branch,
    baseRef,
    baseBranch,
    explicitTitle,
    handle,
    prBody = null,
  } = ctx;
  /* 开放清单按页扫（ISSUE #2964）：只看第一页的匹配在「目标 PR 被更新的条目挤出
   * 首页」时静默失效 —— 开放 PR 一多，最老那条永远匹配不到，幂等退化成「没就建」，
   * 撞平台 409 才露头。页界与落地判定同一口径，命中行为不变。 */
  const open = scanPullPages(ctx, {
    state: "open",
    visit: (json) => findPullForBranch(json, branch),
  });
  /* 三种「没命中」分开念（ISSUE #2964）：读数与话术在 `ship-scan.mjs`，
   * 这里只负责把它们原样打出来。 */
  for (const line of openScanReadout(open)) {
    log(line);
  }
  let number = open.hit;
  if (number) {
    log(`[ship] 已有开放 PR #${number} ⇒ 复用，不重建（幂等）`);
    /* 给了 `--pr-body-file` 就整篇更新（口径见 `ship-pr-body.mjs`）；写没落地就停在这里，
     * 不带着一份旧正文去等 CI（那等于让人照着过期正文评审）。 */
    const bodyStop = updatePullBodyOnReuse({ ...ctx, prBody, number });
    if (bodyStop !== null) {
      return { number, stop: bodyStop };
    }
    stampHandlerLabel({ run, log, slug, number, handle, root });
    return {
      number,
      stop: reportPullConflict({ run, log, slug, number, baseRef, via: "复用" })
        ? CODE.CONFLICT
        : null,
    };
  }
  /* 开放清单里没有 ⇒ 还不能直接建：这条分支可能**已经合过了**（ISSUE #2250）。 */
  const headSha = run("git", ["rev-parse", "HEAD"]).stdout.trim();
  const landed = findLandedPull({ run, slug, headSha });
  if (landed.prNumber) {
    log(
      `[ship] 不建新 PR：HEAD ${short(headSha)} 已随 PR #${landed.prNumber} 落地（平台逐条认的 \`is_merged\`；${codeTag(CODE.GUARD_REFUSED)}）。`,
    );
    log(
      "[ship]   这一批内容已经在主干里 ⇒ 要接着改请开新分支（`pnpm ship --branch feat/<描述>`）。" +
        "把同一批内容再合一次，主干上就多一笔重复提交，还白烧一轮 CI。",
    );
    return { number: null, stop: CODE.GUARD_REFUSED };
  }
  if (landed.unknownPr) {
    /* ISSUE #3059：sha 相同而 `is_merged` 缺键 ⇒ 没有读数；当「未落地」就会长出 #2250 拦的幽灵 PR。 */
    log(
      `[ship] 落地判读缺数：closed 清单里 PR #${landed.unknownPr} 的 head.sha 与 HEAD 逐字相同，` +
        `而 \`is_merged\` 缺键 ⇒ 落没落地**没有读数**，不按「未落地」建 PR（${codeTag(CODE.READOUT_MISSING)}）。核平台那条 PR 的页面；键补上了再重跑。`,
    );
    return { number: null, stop: CODE.READOUT_MISSING };
  }
  if (!landed.ran) {
    log(
      "[ship] 落地判定没读到 closed 清单（平台没答）⇒ 按**未判定**处理，照旧建 PR：" +
        "缺读数不新增结论、也不撤销结论（「取不到」不等于「没落地」）。",
    );
  }
  /* 区间跟 PR 的目标分支走（ISSUE #3021）：新建时目标就是下面 `--base` 传出去的那条，
   * 取数前先刷新它的远端跟踪引用 —— 过期的 `origin/<父分支>` 会把别人的提交算进来。 */
  const baseForDiff = diffBaseRef({
    run,
    log,
    baseRef,
    targetBranch: baseBranch,
    remote: baseRef ? (baseRef.split("/")[0] ?? null) : null,
  });
  const { title } = pickTitle({
    run,
    log,
    baseRef: baseForDiff,
    explicit: explicitTitle,
  });
  if (!title) {
    log(
      '[ship] 标题两处都取不到 ⇒ 不建 PR：`--title ""` 建出来的是一条没有标题的 PR，' +
        "而读者第一件事读的就是它。这一格按「没有执行者」处理，不是「已建」。",
    );
    return { number: null, stop: CODE.NOT_RUN };
  }
  /* 正文拼装在 `ship-pr-body.mjs`：`--pr-body-file` 注进来的那一份在**前**，
   * 自动事实段在后（分隔与口径见那一份文件头）。不给旗标时输出与从前逐字节相同。 */
  const plan = planCreateBody({ ...ctx, baseForDiff });
  /* 守卫排在落临时文件**之前**：`mkTmp` 的回收挂在 `main` 的 `finally` 上，
   * 先建再退虽然不会留垃圾，但会让「这次没建 PR」那一次也在盘上写过一份
   * 提交信息原文 —— 而 #2037 修的就是这类东西不该留在盘上。 */
  if (!baseBranch) {
    log(
      "[ship] 推不出主干分支名（基线引用不可用）⇒ 不建 PR：拿一个猜的 `--base` 建出去，" +
        "得到的是「PR 指向一条不存在的主干」，而平台会照建不误。这一格退 NOT_RUN。",
    );
    return { number: null, stop: CODE.NOT_RUN };
  }
  /* 正文仍然超上限 ⇒ 一次网络往返都不发（ISSUE #2248）：已经量到的上限不该押给
   * 执行者去替我重新发现。`plan.reason` 会把「人写的正文有多大」一起念出来。 */
  if (plan.stop !== null) {
    log(plan.reason);
    return { number: null, stop: plan.stop };
  }
  const body = plan.body;
  const bf = mkTmp("ship-pr-body", body);
  if (!bf) {
    /* 正文可能上千行，`--body <串>` 会撞上 Windows 的 32k argv 上限，
     * 所以这一格只能走文件。取不到 git 目录 = 不在真检出里 ⇒ 说清楚
     * 而不是往工作区猜一个落点。 */
    log("[ship] 取不到 git 目录 ⇒ PR 正文没有落点，这一格没有执行者（不是「不需要」）。");
    return { number: null, stop: CODE.NOT_RUN };
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
    log("[ship] 建 PR 没拿到可解析的响应 ⇒ 这一格没有结论（不是「失败」也不是「成功」）");
    return { number: null, stop: CODE.NOT_RUN };
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
    log(`[ship]   退码 ${made.code} · 响应原文（截 500 字）：${made.raw.slice(0, 500)}`);
    const platErr = readPullCreateError(made.json);
    if (platErr) {
      /* 单独一行，不靠上面那个字符窗口：拒绝理由是平台给的原值，念得出就不该让人
       * 再去数一遍截断截到哪儿（ISSUE #2248：`2000003 body length exceeded …`）。 */
      log(
        `[ship]   平台给的拒绝：errcode=${platErr.errcode || "(无)"} · ${platErr.errmsg || "(无)"}`,
      );
    }
    if (made.stderr.trim()) {
      log(`[ship]   stderr：${made.stderr.trim().slice(0, 500)}`);
    }
    return { number: null, stop: CODE.NOT_RUN };
  }
  log(`[ship] ✓ 已建 PR #${number}`);
  stampHandlerLabel({ run, log, slug, number, handle, root });
  return {
    number,
    stop: reportPullConflict({ run, log, slug, number, baseRef, via: "新建" })
      ? CODE.CONFLICT
      : null,
  };
}

/**
 * 阶段 5：把 CI 终态与 PR 的可合并状态一起念出来，并给出下一动作。
 *
 * 红的时候**不自己归因** —— 点名既有执行者 `base-check.mjs`。这一格是整条链上
 * 最容易顺手加一句「大概是你哪条改动导致的」的地方，而那句话没有执行者。
 *
 * ⚠️ 「被取消」**不算红**：那一跑没跑完，产物一个字都没被验证过 —— 说它红就是
 * 替平台编了一个不存在的产物问题。它落在「没跑到结论」那一档（`CODE.NOT_RUN`），
 * 处置是重跑，不是查产物（ISSUE #2158 第 2 条 / 规范 §13.5.26）。
 *
 * @param {{
 *   run: PlatformIO["run"],
 *   log: PlatformIO["log"],
 *   slug: string,
 *   number: any,
 *   buildState: "green"|"red"|"cancelled"|"running"|"unknown",
 *   buildSn: string | null,
 *   baseRef?: string | null,
 * }} ctx
 *   `baseRef` 只用于「冲突」那一支的出口话术（点名该合哪条基线）；不给就念占位写法。
 * @returns {number} 三态退出码之一
 */
export function reportVerdict(ctx) {
  const { run, log, slug, number, buildState, buildSn, baseRef = null } = ctx;
  const pr = cnbJson(run, ["pulls", "get-pull", "--repo", slug, "--number", String(number), "-v"]);
  const pv = pr ? readPullVerdict(pr.json) : null;
  if (pv) {
    log(
      `[ship] PR #${number}：mergeable_state=${pv.mergeableState} blocked_on=${pv.blockedOn || "(无)"} is_merged=${pv.isMergedTri === "unknown" ? "(缺键)" : pv.isMerged}`,
    );
  }
  if (buildState === "green") {
    log(`[ship] ✓ CI 绿（build ${buildSn}）。下一动作：pnpm ship --merge`);
    return CODE.GREEN;
  }
  if (buildState === "cancelled") {
    log(
      `[ship] ✗ CI 那一跑**被取消**（build ${buildSn}）—— 不是产物坏了：那一跑没跑完，下游格根本没跑。`,
    );
    log("[ship] 下一动作：重跑这一跑（锁被另一跑顶掉 / 人为终止）再读一次；不要去查产物。");
    log(`[ship] 日志：https://cnb.cool/${slug}/-/build/logs/${buildSn}`);
    return CODE.NOT_RUN;
  }
  if (buildState === "red") {
    log(
      `[ship] ✗ CI 红（build ${buildSn}）。日志：https://cnb.cool/${slug}/-/build/logs/${buildSn}`,
    );
    log(`[ship] 失败格与失败行：pnpm ship --diagnose ${buildSn}（只读，不用再手抄 stage 日志）。`);
    log(
      "[ship] 归因交给既有执行者：`node scripts/base-check.mjs <拦住你的那条>` —— 本脚本不自己判「是我的还是主干的」。",
    );
    return CODE.RED;
  }
  /* ISSUE #3083：「没拿到终态」必须分型 —— 冲突（平台**永不**派生，出口是解冲突）、
   * 可合并（才可能真在排队）、取不到（缺键 / 回读没跑起来，照实念，不猜）。
   * 三种念法三个码（同属「没跑起来家族」，压过红、不是失败）。 */
  const cls = classifyPrMergeable(pv);
  if (cls === "conflict") {
    log(
      `[ship] ✗ PR #${number} 与 base 冲突 ⇒ 平台不会为这条 PR 派生 CI：` +
        `「没拿到 build 终态」的真因是冲突，不是「还在排队」（${codeTag(CODE.CONFLICT)}）。`,
    );
    for (const line of conflictAdviceLines({ number, baseRef })) {
      log(line);
    }
    return CODE.CONFLICT;
  }
  if (cls === "unknown") {
    log(
      `[ship] 没拿到 build 终态，且 PR #${number} 的可合并状态取不到` +
        "（mergeable_state 缺键 / 平台还在算 / 回读没跑起来）⇒ 这一格没有结论，" +
        `不进入合并；不猜「还在排队」（${codeTag(CODE.READOUT_MISSING)}）。`,
    );
    return CODE.READOUT_MISSING;
  }
  log(
    "[ship] 没拿到 build 终态（PR 可合并，可能仍在排队）⇒ 这一格没有结论，不进入合并" +
      `（${codeTag(CODE.CI_PENDING)}）。`,
  );
  return CODE.CI_PENDING;
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
 *   buildState: "green"|"red"|"cancelled"|"running"|"unknown",
 *   explicitTitle?: string | null,
 *   branch?: string | null,
 *   landed?: {title: string, sha: string, verified: boolean} | null,
 *   cleanBranch?: boolean,
 * }} ctx
 *   `branch` 是 preflight 钉住的分支名：给了它，合并动作前会再复核一次当前分支
 *   （跑期内漂移的第二道；第一道在 ship.mjs 进平台段前，ISSUE #2812）。
 *   不给（老的调用形状）就跳过这一格 —— 本函数唯一的调用方是 ship.mjs，那里会给。
 *   `landed` 是「落进主干的那一行」的快照，由本函数在**验真之后**填 —— 阶段 7（关单）
 *   要的标题本体取自它，不在那里回推（原因见成功路径上那处注释）。
 *   `cleanBranch` 只是「人这一跳给了哪个旗标」的读数 —— 判断不在这里，本函数只把它念对。
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
    /* 同上：不传按「没要清理」念，与旗标默认关的口径一致。 */
    cleanBranch = false,
    /* preflight 钉住的分支名（见 JSDoc）：不传则跳过合并前的漂移复核。 */
    branch = null,
  } = ctx;
  if (!merge) {
    log("[ship] 未给 --merge ⇒ 停在判决处。合并是显式动作。");
    return CODE.GREEN;
  }
  if (buildState !== "green") {
    /* ISSUE #3083：「CI 未绿」不再只有「红了」一种念法 —— 按码表分型：
     * 冲突（平台**根本不派生**，退 3）、cancelled（那一跑没有结论，退 2）、
     * 无终态且可合并（还在排队，退 4）、无终态且读数缺失（退 5）。
     * 只有「buildState 本身是红的」才退 1；回读没跑起来 / 缺键都不新增结论。 */
    if (buildState === "red") {
      log("[ship] 拒绝合并：CI 是红的 ⇒ 修红的那一格再重跑。");
      return CODE.RED;
    }
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
    const cls = classifyPrMergeable(pv);
    if (cls === "conflict") {
      log(
        `[ship] 拒绝合并：PR #${number} 与 base 冲突 ⇒ 平台不会为这条 PR 派生 CI` +
          `（${codeTag(CODE.CONFLICT)}；没跑起来 ≠ 失败，这不是「CI 红了」）。`,
      );
      for (const line of conflictAdviceLines({ number, baseRef })) {
        log(line);
      }
      return CODE.CONFLICT;
    }
    if (buildState === "cancelled") {
      log(`[ship] 拒绝合并：那一跑被取消，没有结论（${codeTag(CODE.NOT_RUN)}）。`);
      return CODE.NOT_RUN;
    }
    /* buildState = unknown / running：CI 没出终态。可合并 ⇒ 排队；取不到 ⇒ 读数缺失。 */
    if (cls === "mergeable") {
      log(
        `[ship] 拒绝合并：CI 没出终态（当前是 ${buildState}，PR 可合并 ⇒ 还在排队，` +
          `${codeTag(CODE.CI_PENDING)}）。`,
      );
      return CODE.CI_PENDING;
    }
    log(
      `[ship] 拒绝合并：CI 没出终态（当前是 ${buildState}），且 PR 可合并状态取不到` +
        `（${codeTag(CODE.READOUT_MISSING)}；不猜「红了」也不猜「排队」）。`,
    );
    return CODE.READOUT_MISSING;
  }
  /* 跑期内漂移的**第二道**复核（第一道在 ship.mjs 进平台段前，ISSUE #2812）：
   * 第一道拦在轮询之前，而轮询最长 45 分钟 —— 期间一次 `git checkout`，
   * squash 合进去的就是**新分支的头**，这条 PR 的读数却全是旧分支的。
   * 合并是不可回退动作，所以在它之前再读一次分支名；本地读，成本近零。
   * 与第一道不会重复触发成误报：第一道命中就停在那里，走不到这里；
   * 这里命中说明切换发生在第一道之后。 */
  if (branch) {
    const branchNow = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]).stdout.trim();
    if (branchNow !== branch) {
      log(
        `[ship] 合并前复核：跑期内分支被切换（${branch} → ${branchNow || "(取不到)"}）⇒ 不合并：` +
          "合进去的头已经不是这一轮读数记的那条分支。" +
          `回到原来的分支重跑（PR 已存在会复用，CI 结论沿用，不会白烧；${codeTag(CODE.GUARD_REFUSED)}）。`,
      );
      return CODE.GUARD_REFUSED;
    }
  }
  /* squash 标题的权威顺序：人给的 `--title` > **平台上这条 PR 的现标题** > branch-first
   * 推导（ISSUE #2806）。复用一条已在平台上改过标题的 PR 时，照 branch-first 写 squash
   * 那一行，主干上就落一条「标题与内容不符」的历史 —— 评审在平台上读到的标题与
   * `git log` 里那一行本该是同一句。没给 `--title` 才回读：给了就以人为准，省一次往返。 */
  let platformTitle = null;
  /* 标题要用的区间基线：复用的 PR 可能指向另一条特性分支（栈式 PR），
   * 这时本地 upstream 不是它的目标分支 —— 以平台回读的 `base.ref` 为准（ISSUE #3021）。 */
  let baseForTitle = baseRef;
  if (!(explicitTitle ?? "").trim()) {
    const prNow = cnbJson(run, [
      "pulls",
      "get-pull",
      "--repo",
      slug,
      "--number",
      String(number),
      "-v",
    ]);
    const pvNow = prNow ? readPullVerdict(prNow.json) : null;
    platformTitle = pvNow ? pvNow.title : null;
    baseForTitle = diffBaseRef({
      run,
      log,
      baseRef,
      targetBranch: pvNow ? pvNow.baseBranch : null,
      remote: up.remote,
    });
    if (!prNow) {
      /* 「回读没跑起来」与「这条 PR 没在平台上改过标题」必须在屏幕上长得不一样：
       * 前者是读数缺失（退回 branch-first 是权宜，标题可能真的被人改过），
       * 后者退回 branch-first 就是正确结论。混成一格，出问题时人无法分辨走的是什么。 */
      log(
        "[ship] 平台标题回读没跑起来（get-pull 取不到）⇒ squash 标题退回 branch-first 推导；" +
          "这一句是**读数缺失**，不是「这条 PR 没在平台上改过标题」。",
      );
    }
  }
  const { title } = pickTitle({
    run,
    log,
    baseRef: baseForTitle,
    explicit: explicitTitle,
    platform: platformTitle,
  });
  if (!title) {
    log(
      "[ship] 标题几处都取不到 ⇒ 不合并：squash 那一行是主干上读者第一眼读到的东西，" +
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
  const mergeData = mg?.json ? (mg.json.data ?? null) : null;
  if (mergeData?.merged !== true) {
    log("[ship] 合并调用没给出 merged:true ⇒ 不假定它成功了，去平台上核对。");
    return CODE.RED;
  }
  // 回读两件事：平台说合上了，**且**碎片真的在主干顶端（只看平台回执 = 半个结论）。
  const baseParts = (baseRef ?? "").split("/");
  const trunkBranch = baseParts.slice(1).join("/");
  run("git", ["fetch", baseParts[0] ?? up.remote ?? "origin", trunkBranch || "master"]); // oxlint-disable-line typescript/no-unnecessary-condition -- baseParts[0] 在 noUncheckedIndexedAccess 下带 undefined 分量，兜底链为类型收窄服务
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
    `[ship] 合并回执 sha=${short(mergeData.sha)} 回读 is_merged=${back ? (back.isMergedTri === "unknown" ? "(缺键)" : back.isMerged) : "?"} 碎片在主干顶端=${fragOnMaster}`,
  );
  /* ISSUE #3059：回读没跑起来 / 缺 `is_merged` 键 ⇒ 没有读数，不落红（行为变更：此前退 1）。 */
  if (!back || back.isMergedTri === "unknown") {
    log(
      `[ship] 合并后回读${back ? "缺 `is_merged` 键" : "没跑起来"} ⇒ 合没合上**没有读数**，不按「没合上」处理（${codeTag(CODE.READOUT_MISSING)}）。`,
    );
    return CODE.READOUT_MISSING;
  }
  if (!(back.isMerged && fragOnMaster)) {
    return CODE.RED;
  }
  /* 「走到哪了」（ISSUE #3083）：形态 + 合并提交 sha + 目标分支，全取自平台回执。 */
  reportStage(log, "合并", {
    pr: number,
    form: "squash",
    sha: short(mergeData.sha ?? ""),
    target: trunkBranch || "master",
  });
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
  /* 那句边界声明按**这一跳实际做了什么**来说：`--clean-branch` 落地之前它是事实，
   * 落地之后如果还照原样念，就成了「在这一轮里被自己的下一行推翻」的声明 ——
   * 形态与 `check-commit-claims.mjs` 治的那一类相同，只是它落在运行期输出里、照不到。 */
  log(
    cleanBranch
      ? "[ship] 本地 master 已同步。远端分支交给下一段（--clean-branch）收。"
      : "[ship] 本地 master 已同步。远端分支**没删**（这一跳没要 --clean-branch）。",
  );
  return CODE.GREEN;
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
  const { run, log, remote, branch, landedVerified, cleanBranch: requested } = ctx;
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
  /* 两边回读结果各记一笔，收尾合成「走到哪了」那一行（ISSUE #3083），不新发问世界。 */
  let remoteOutcome = "读数缺失";
  /* 本地侧三分支都赋值（`show-ref` 非零按「已删」算），故不给初值（no-useless-assignment）。 */
  /** @type {string} */
  let localOutcome;
  const del = run("git", ["push", remote, "--delete", name]);
  const echo = [del.stdout, del.stderr].map((s) => (s || "").trim()).filter(Boolean);
  for (const line of echo) {
    log(`[ship]   ${line.split("\n").join("\n[ship]   ")}`);
  }
  const back = run("git", ["ls-remote", "--heads", remote, name]);
  if (back.status !== 0) {
    log(`[ship] 远端回读没跑起来（exit ${back.status}）⇒ 这一格不判「已删」，也不判「还在」`);
    codes.push(CODE.NOT_RUN);
  } else if (back.stdout.trim()) {
    log(`[ship] 远端回读：${remote} 的 heads 里**仍然有** ${name}（删没掉）`);
    remoteOutcome = "仍在";
    codes.push(CODE.RED);
  } else {
    log(`[ship] ✓ 远端回读：${remote} 的 heads 里已无 ${name}`);
    remoteOutcome = "已删";
    codes.push(CODE.GREEN);
  }

  const rm = run("git", ["branch", "-D", name]);
  const rmEcho = [rm.stdout, rm.stderr].map((s) => (s || "").trim()).filter(Boolean);
  for (const line of rmEcho) {
    log(`[ship]   ${line.split("\n").join("\n[ship]   ")}`);
  }
  const verify = run("git", ["show-ref", "--verify", "--quiet", `refs/heads/${name}`]);
  if (rm.status !== 0 && verify.status === 0) {
    log(`[ship] 本地那一半没删掉（exit ${rm.status}）⇒ 这一格是红的，不记「已清理」`);
    localOutcome = "仍在";
    codes.push(CODE.RED);
  } else if (verify.status === 0) {
    log(`[ship] 本地回读：refs/heads/${name} **还在**`);
    localOutcome = "仍在";
    codes.push(CODE.RED);
  } else {
    log(`[ship] ✓ 本地回读：refs/heads/${name} 已不在（恢复线见上面那行 sha）`);
    localOutcome = "已删";
    codes.push(CODE.GREEN);
  }
  reportStage(log, "清分支", { branch: name, remote: remoteOutcome, local: localOutcome });
  return combineShipCodes(codes);
}
