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
 *
 * ⚠️ 但 build 那一侧多了一层：**逐格读数优先于构建级状态**。平台把「被取消」的
 * 那一跑记成构建级 `error`，而它与「某一格真失败」的处置完全不同（后者去查产物，
 * 前者去重跑）。分类只有一份，在 `ci-build-readout.mjs` —— 单跑口与 PR 口共用同一份
 * 判据，不许两处各写一套（ISSUE #2158 第 2 条 / 规范 §13.5.26）。
 */
import path from "node:path";

import {
  asArray,
  buildSignature,
  pickBuildForSha,
} from "./ship-build.mjs";
import {
  buildPullBody,
  CODE,
  combineShipCodes,
  decideCleanBranch,
  deriveTitle,
  findPullForBranch,
  PULL_BODY_LIMIT,
  readPullCreateError,
  readPullVerdict,
} from "./ship-core.mjs";
import { cnbJson, short } from "./ship-exec.mjs";
import { classifyBuildOutcome, inFlightStages } from "./ci-build-readout.mjs";
import { DEV_HANDLE_ENV_KEY, handlerLabel } from "./ship-ticket.mjs";

/**
 * 轮询的**同签名断流**上限：连续这么多次读到同一件事就不再读。
 * 定在 10 的理由是形状：20 秒一眼 ⇒ 连着 10 眼（≈3 分 20 秒）一个读数都没动，
 * 继续轮下去只是把同一句话多刷几遍。45 分钟墙钟预算保留，兜「动得很慢」那条路。
 *
 * ⚠️ 那句「一条真的在推进的流水线在这个窗口里至少会动一次」**只在配上一个前提时成立**：
 * 签名是离散计数，而一格**长** stage 在内部推进时不产生任何新计数（ISSUE #2184 实测：
 * `cnb-akv-1k5hh712q/pending/0-1+11/33` 连着 10 眼一模一样而 `受影响用例` 那一格正在跑，
 * 几分钟后同一条构建是 28/33；本仓组 C 单跑实测过 1411s）。所以断流的判据是
 * **签名不变 且 没有任何一格在飞**（`inFlightStages`），而不是「签名不变」——
 * 也不是把上限调大：那只是把误掐概率换小，两件事仍然分不开。
 */
const POLL_STALL_MAX = 10;

/**
 * 平台侧那份分类 → 这一层用的形状。
 *
 * 「真失败」在这一层仍叫 `red`（那一族的处置一个字没变：去查产物）；新增的
 * `cancelled` 是**第三种形状**——那一跑没跑完，既不是绿也不是红。
 *
 * @param {"green"|"failed"|"cancelled"|"running"|"unknown"} state
 * @returns {"green"|"red"|"cancelled"|"running"|"unknown"}
 */
export function toShipBuildState(state) {
  if (state === "failed") return "red";
  return state;
}

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
      `[ship] 未配 ${DEV_HANDLE_ENV_KEY} ⇒ PR #${number} 没有 \`处理人:\` 标签` +
        "（这一格是读数，不参与退码）。在 " +
        `\`${path.join(root, ".env")}\` 填一行 \`${DEV_HANDLE_ENV_KEY}="<短名>"\`` +
        "（整行不在时先跑 `pnpm env:init`），再 `pnpm ship` 重跑会补上。",
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
  const names = read
    ? (asArray(read.json) ?? []).map((x) => String(x?.name ?? ""))
    : [];
  if (names.includes(label)) {
    log(`[ship] ✓ PR #${number} 标签 ${label} 已回读（list-pull-labels）`);
    return;
  }
  log(
    `[ship] PR #${number} 的标签 ${label} **没有落地证明**` +
      `（${read ? "回读里没有这个名字" : "回读没跑起来"}）⇒ 不念「已打上」；` +
      "这一格是读数、不改退码。手工补：",
  );
  log(
    `[ship]   cnb pulls post-pull-labels --repo ${slug} --number ${number} --labels ${label} -v`,
  );
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
 *   handle?: string | null,
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
    handle,
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
    stampHandlerLabel({ run, log, slug, number, handle, root });
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
    handle,
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
  /* 正文仍然超上限 ⇒ 一次网络往返都不发。到这里 diffstat 已经被裁过，剩下的只会是
   * 碎片清单那一段（几千份碎片的形态本就说明这次该拆），而发出去只会拿到一条 400：
   * 已经量到的上限不该押给执行者去替我重新发现（ISSUE #2248）。 */
  if (body.length > PULL_BODY_LIMIT) {
    log(
      `[ship] PR 正文拼出来 ${body.length} 字节，超过上限 ${PULL_BODY_LIMIT} ⇒ 不建 PR：` +
        "这一格没有执行者（不是「已建」）。出口是把这次变更拆小，或自己写正文手工建一条。",
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
    return { number: null };
  }
  log(`[ship] ✓ 已建 PR #${number}`);
  stampHandlerLabel({ run, log, slug, number, handle, root });
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
 * @returns {Promise<{buildState:"green"|"red"|"cancelled"|"running"|"unknown",buildSn:string|null,stop:number|null}>}
 *   `stop` 非 null 时调用方直接以此码收尾 —— 两种形状都落这里：执行者不在（取不到列表），
 *   以及**同签名断流**（连着 `POLL_STALL_MAX` 眼读数没变、**且此刻没有任何一格在飞**，
 *   再等下去只是重复同一句话）。
 */
export async function pollUntilTerminal(ctx) {
  const { run, log, slug, newSha, now, sleep } = ctx;
  let buildState =
    /** @type {"green"|"red"|"cancelled"|"running"|"unknown"} */ ("unknown");
  let buildSn = null;
  const deadline = now() + 45 * 60 * 1000;
  /* 同一签名**连续**读了多少次：第一条就把计数设成 1，所以「连续 10 次」= 第 10 次读到同一件事
   * 就断流。签名里任何一件变了（sn / data.status / pipeline 完成数 / **stage 完成数**）就归零，
   * **有格在飞也归零**（下面那段）—— 掐掉的只是「每 20 秒重复同一句话直到烧完预算」那种等待。
   * stage 级那一件不是锦上添花：本仓的 PR 是一条 pipeline / 三十几个 stage，只看 pipeline 级
   * 计数时，一条推进到 28/33 的流水线读数一直是 `…/pending/0-1`，会被这条当成「没在动」掐掉
   * （2026-10-22 实测 `cnb-7d9-1k5h9edct`）；而运行中那一格的 `duration` 是占位 `0`，
   * 也当不了进度。
   * 但**光补 stage 计数还不够**：计数是离散的，一格跑得久（组 C 单跑实测 1411s）时它自己不动，
   * 于是 #2167 之后仍然误掐过一次（`…/pending/0-1+11/33` 连满 10 眼，ISSUE #2184）
   * ⇒ 断流现在要**两件同时成立**：签名不变，且这一刻没有一格处在「在飞」那一族状态里。 */
  let lastSig = null;
  let sameSig = 0;
  /** 「这一轮已经因为格数续过命」的标记：每轮只念一次那句说明（见下面计数那一段）。 */
  let announcedFlight = false;
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
    /** 这一眼的状态 JSON；没解析到 build 时为 null（签名照样成立）。 */
    let statusJson = null;
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
      statusJson = st ? st.json : null;
      /* 逐格读数优先于构建级状态 —— 平台把「被取消」记成构建级 `error`，而它与
       * 「真失败」的处置完全不同（前者重跑，后者查产物）。分类只有一份，
       * 在 `ci-build-readout.mjs`（ISSUE #2158 第 2 条 / 规范 §13.5.26）。 */
      const outcome = st ? classifyBuildOutcome(st.json) : null;
      /** @type {{state:"green"|"red"|"cancelled"|"running"|"unknown",raw:string|null}} */
      const v = outcome
        ? { state: toShipBuildState(outcome.state), raw: outcome.raw }
        : { state: "unknown", raw: null };
      buildState = v.state;
      log(`[ship] build ${picked.sn} → data.status = ${v.raw ?? "(取不到)"}`);
      if (v.state === "cancelled" && outcome) {
        const first = outcome.cancelled[0];
        const skipped = outcome.skipped
          .filter((s) => (first ? s.index > first.index : true))
          .map((s) => s.name || s.id);
        log(
          `[ship]   这一跑**被取消**（不是产物坏了）：${first ? first.name : "(不知哪一格)"}` +
            " 被顶掉 ⇒ 下面那几格根本没跑" +
            (skipped.length > 0 ? `（${skipped.join("、")}）` : "") +
            "，这一跑没有 CI 结论",
        );
      }
      if (v.state !== "running" && v.state !== "unknown") break;
    }
    const sig = buildSignature(statusJson, picked ? picked.sn : "");
    /* 「同签名」只是**没产生新计数**，不等于「没在动」：一格长 stage 在内部推进时签名逐字不变
     * （ISSUE #2184 实测 `…/pending/0-1+11/33` 连着 10 眼，而 `受影响用例` 正在跑；几分钟后
     * 同一条构建是 28/33）。所以停滞要同时满足两件：签名不变 **且** 此刻没有任何一格在飞。
     * 在飞那一判每轮只念一次 —— 它是「还在跑」这一事实的说明，不是每 20 秒要复述一遍的进度条。 */
    const flying = inFlightStages(statusJson);
    if (sig !== lastSig) {
      sameSig = 1;
      announcedFlight = false;
    } else if (flying.count > 0) {
      sameSig = 1;
      if (!announcedFlight) {
        announcedFlight = true;
        log(
          `[ship]   签名没变（${sig}），但有 ${flying.count} 格在飞：` +
            `${flying.names.slice(0, 3).join("、")} ⇒ 还在跑，继续轮`,
        );
      }
    } else {
      sameSig += 1;
    }
    lastSig = sig;
    if (sameSig >= POLL_STALL_MAX) {
      /* 落 **2**（没跑起来）而不是红：签名含 stage 级进度之后，「连着 10 眼一模一样」意味着
       * 这条流水线**一个格都没推进过**，那就不是「测出一个红」而是「这一格没有终态结论」——
       * 与 `base-check` 的 `inconclusive` 同一口径（拿不到测量 ≠ 测量结果是红的）。
       * #2152 当初把它落红，理由是「它拿到了读数」；那句话在只看 pipeline 级计数的签名下成立
       * （推进中的流水线也会被念成没动），签名补上 stage 级之后不再成立，业主定：改记 2。
       * 下一动作仍然给人（看那一格的日志，或过一会儿再跑一次 `pnpm ship`，PR 复用不重建）。 */
      log(
        `[ship] build ${buildSn ?? "(未解析到 build)"} 连续 ${sameSig} 次读数没变、` +
          `且此刻没有一格在飞（${sig}）⇒ 不再轮询：这一格没有终态结论`,
      );
      log(
        `[ship]   接着看：https://cnb.cool/${slug}/-/build/logs/${buildSn || "<sn>"}` +
          "，或过一会儿再 `pnpm ship`（PR 已存在会复用，不重建）",
      );
      return { buildState, buildSn, stop: CODE.NOT_RUN };
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
  if (buildState === "cancelled") {
    log(
      `[ship] ✗ CI 那一跑**被取消**（build ${buildSn}）—— 不是产物坏了：那一跑没跑完，下游格根本没跑。`,
    );
    log(
      "[ship] 下一动作：重跑这一跑（锁被另一跑顶掉 / 人为终止）再读一次；不要去查产物。",
    );
    log(`[ship] 日志：https://cnb.cool/${slug}/-/build/logs/${buildSn}`);
    return CODE.NOT_RUN;
  }
  if (buildState === "red") {
    log(
      `[ship] ✗ CI 红（build ${buildSn}）。日志：https://cnb.cool/${slug}/-/build/logs/${buildSn}`,
    );
    log(
      `[ship] 失败格与失败行：pnpm ship --diagnose ${buildSn}（只读，不用再手抄 stage 日志）。`,
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
 *   buildState: "green"|"red"|"cancelled"|"running"|"unknown",
 *   explicitTitle?: string | null,
 *   landed?: {title: string, sha: string, verified: boolean} | null,
 *   cleanBranch?: boolean,
 * }} ctx
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
  } = ctx;
  if (!merge) {
    log("[ship] 未给 --merge ⇒ 停在判决处。合并是显式动作。");
    return CODE.GREEN;
  }
  if (buildState !== "green") {
    log(
      "[ship] 拒绝合并：CI 不是绿的（当前是 " +
        buildState +
        (buildState === "cancelled" ? " = 那一跑被取消，没有结论" : "") +
        "）。",
    );
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
