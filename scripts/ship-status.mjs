#!/usr/bin/env node
/**
 * ship-status.mjs —— `pnpm ship --status [<PR号|分支名>]`：一条 ship 流程「每一格现在
 * 什么状态」的**只读**统一查询口（ISSUE #3811）。
 *
 * ── 为什么要有这一格 ────────────────────────────────────────────
 *
 * ship 跑完（或跑到一半）之后，「PR 建了没 / CI 绿没绿 / 合了没 / 单子关了没」这些
 * 状态此前没有统一出口：实测的用法是拿一份 grep 模式去翻自己的运行日志
 * （`grep -nE "PR #|CI 绿|CI 红|合并 \| pr|关单|结论" <日志> | tail`）。那条路的三个毛病：
 * 模式要靠口口相传，拼错一次就白等一轮；日志是**那一块屏幕的过去**，不是平台的现在；
 * 判断散在每个人手里，谁都可以挑一个错的判据（这正是 §13.6.5 立案时的同一类现场）。
 *
 * 这一格把「查状态」收成一个有名字的入口。**判定一个不发明**：CI 终态走
 * `classifyBuildOutcome`（与轮询 / `--diagnose` 同一份实现，取消与真失败的分界原话
 * 同一条补读链）、合并只认 `readPullVerdict` 的 `is_merged` 三态、关单读的是
 * `issues get-issue` 的原值 —— 本模块只负责「把既有执行者的原值摆到同一张屏上」，并给
 * 下一步动作（全部是既有动作，一次也不推断执行）。
 *
 * ── 边界（与 `--diagnose` / `--branches` 同一条纪律）─────────────
 *
 *   · **一次也不写平台**：只发 `get-pull` / `list-pulls` / `get-build-logs` /
 *     `get-build-status` / `get-build-stage` / `issues get-issue` 六条读命令。
 *   · **一次只做一件**：与任何显式动作同行退 2（互斥守卫在 `ship-standalone.mjs`）。
 *   · **不归因、不深挖**：CI 红只念一行判决 + 指向 `pnpm ship --diagnose <sn>`；
 *     逐格红因是那一格的事，这里不抄第二份。
 *   · **取不到就是取不到**：清单扫到上界没命中 ≠「没提过 PR」（#2964 同款三态）。
 *   · **不占用保留前缀**：汇总行不用 `[ship] 结论：`（那是主流程 `finish()` 的形状，
 *     落盘回读点按它提取结论）—— 本格的行都带 `--status` 标识。
 *
 * ── 退码（复用 `ship-codes.mjs` 的既有码，映射只在本格这份表）────
 *
 *   · `0`：读数齐，没有红事实 —— 已合并（落地是正面事实），或未合并且 CI 终态绿。
 *   · `1`：有红事实 —— CI 终态红；或这条分支**没提过 PR**（内容未落地的提醒，
 *     与 `--branches` 的 not-merged 同判，不是「查询失败」）。
 *   · `2`：没有结论 —— 目标不存在（PR 号查无） / 清单读不到 / 扫到上界没命中 /
 *     `is_merged` 缺键（#3059：缺键不按 false）/ 在主干上且没有可查对象。
 *   · `3`：PR 与 base 冲突（平台不派生 CI，出口是解冲突 —— 与 `--diagnose` 同判）。
 *   · `4`：CI 无终态 —— 在跑 / 被取消 / 还没解析到 build（等待中，读数本身是齐的）。
 */
import { claimNumbersFromTitle, pullTitleBody, referencedNotClaimed } from "./ship-close.mjs";
import {
  classifyBuildOutcome,
  enrichStageErrors,
  fetchBuildStatus,
  gaReadoutStage,
  resolveBuildSn,
} from "./ci-build-readout.mjs";
import { formatDurationMs } from "../src/lib/time-format.ts";
import {
  CODE,
  classifyPrMergeable,
  conflictAdviceLines,
  pullRecordForBranch,
  readPullVerdict,
} from "./ship-core.mjs";
import { readShipResult } from "./ship-result.mjs";
import { toShipBuildState } from "./ship-poll.mjs";
import { cnbJson } from "./ship-exec.mjs";
import { scanPullPages } from "./ship-scan.mjs";

/** 本格输出行的前缀（带旗标名，不与主流程的阶段行混排）。 */
const TAG = "[ship] --status";

/**
 * 解析 `--status` 的目标 token。**像不像号只在这一处判**（与 `parseIssueNumberToken`
 * 同一条纪律）：`#3804` / `3804` 是 PR 号；其余原样当分支名（剥掉可能的 `refs/heads/`
 * 前缀 —— 平台的 head.ref 带它，人不带）。
 *
 * @param {string | null} raw 命令行上的目标 token（可空）
 * @returns {{kind:"pr", number:number} | {kind:"branch", name:string} | null} 空 token ⇒ null（走「当前分支」缺省）
 */
export function parseStatusTarget(raw) {
  const t = String(raw ?? "").trim();
  if (t === "") {
    return null;
  }
  const m = /^#?(?<number>\d{2,})$/.exec(t);
  if (m) {
    return { kind: "pr", number: Number(m.groups?.number) };
  }
  return { kind: "branch", name: t.replace(/^refs\/heads\//, "") };
}

/**
 * 状态 → 退码的唯一映射（纯函数；行读数在 `runStatus` 里拼，退码只从这里出）。
 *
 * @param {{
 *   pullFound: boolean,
 *   windowComplete: boolean,
 *   isMergedTri: "merged"|"not_merged"|"unknown",
 *   mergeable: "conflict"|"mergeable"|"unknown",
 *   ciState: "green"|"red"|"cancelled"|"running"|"unknown"|"no-build"|"not-read",
 * }} s 各格读数（`ciState` 的 `no-build` = 按 sha 没解析到 build；`not-read` = 状态取不到）
 * @returns {number} `CODE` 之一
 */
export function statusExitCode(s) {
  if (!s.pullFound) {
    /* 没找到 PR：窗口取满 ⇒ 「没提过 PR」是正面事实（退 1 提醒，与 --branches 同判）；
     * 扫到上界 / 清单没答 ⇒ 没取到，不是没提过（退 2）。 */
    return s.windowComplete ? CODE.RED : CODE.NOT_RUN;
  }
  if (s.isMergedTri === "unknown") {
    /* #3059：is_merged 缺键不按 false 读 ⇒ 没有结论。 */
    return CODE.NOT_RUN;
  }
  if (s.mergeable === "conflict") {
    return CODE.CONFLICT;
  }
  if (s.isMergedTri === "merged") {
    /* 落地是正面事实：CI / 关单两格是参考读数，不反过来改写它。 */
    return CODE.GREEN;
  }
  if (s.ciState === "green") {
    return CODE.GREEN;
  }
  if (s.ciState === "red") {
    return CODE.RED;
  }
  if (s.ciState === "no-build" || s.ciState === "cancelled" || s.ciState === "running") {
    return CODE.CI_PENDING;
  }
  /* 状态取不到 / 形状认不出 ⇒ 没结论，不猜。 */
  return CODE.NOT_RUN;
}

/**
 * CI 终态的一行读数（`classifyBuildOutcome` 的状态词 → 人话）。判定本体不在这一格。
 *
 * @param {"green"|"red"|"cancelled"|"running"|"unknown"} state 分类结果
 * @returns {string} 状态短语
 */
function ciStateText(state) {
  if (state === "green") {
    return "绿";
  }
  if (state === "red") {
    return "红";
  }
  if (state === "cancelled") {
    return "被取消（这一跑没有 CI 结论）";
  }
  if (state === "running") {
    return "在跑";
  }
  return "取不到";
}

/**
 * 关单格：读 PR 标题里**认领形态**的号并逐张回读单子状态。
 *
 * 号的口径只有一份：`pullTitleBody` 先剥掉平台拼上的 PR 尾数（对整行提号会把 PR 自己
 * 读成一张单子），再走 `claimNumbersFromTitle`（带括号的 `(#N)` / `（#N）`，裸 `#N`
 * 是人话引用不参与 —— #2646 那次事故的判据，一字不改）。
 *
 * @param {(cmd:string,args:string[])=>import("./ship-exec.mjs").ExecResult} run 执行者
 * @param {(line:string)=>void} log 输出通道
 * @param {string} slug 仓库路径
 * @param {{number:number|null,title:string,isMerged:boolean}} pr PR 读数（标题取平台现值）
 * @returns {void} 只念行；这一格是读数，不参与退码
 */
function readoutIssues(run, log, slug, pr) {
  if (pr.number === null) {
    log(`${TAG} 关单：PR 号取不到 ⇒ 这一格没有对象。`);
    return;
  }
  /* 只喂标题本体（剥掉平台追加的 PR 尾数）—— 约束见 ship-close.mjs 那两条正则的注释。 */
  const titleBody = pullTitleBody(pr.title, pr.number);
  const claimed = claimNumbersFromTitle(titleBody);
  if (claimed.length === 0) {
    log(
      `${TAG} 关单：标题没有 (#N) 认领形态 ⇒ 这一格没有对象（要关请点名：` +
        "pnpm ship --close-issue <单号>）。",
    );
  }
  for (const n of claimed) {
    /* 工具名与领取 / 关单那两格同一条（`issues get-issue`）：计划 ⇄ 执行的对账
       （tests/ship.test.ts 的 planCommands 那组）按「模块+工具」对集合收 —— 这里
       另写一个别名会把集合拆出第二个真相源。 */
    const got = cnbJson(run, ["issues", "get-issue", "--repo", slug, "--number", String(n), "-v"]);
    const d = got?.json?.data;
    if (!got || typeof d !== "object" || d === null) {
      log(`${TAG} 关单：#${n} 读不到（issues get 没答 / 形状不对）⇒ 没有结论，不冒充已关。`);
      continue;
    }
    const state = String(d.state ?? "unknown");
    const reason = String(d.state_reason ?? "");
    const closed = state === "closed";
    /* 出口按前提给：补关那条路（--as-merged）要平台侧的落地证明，PR 还没合时给了
     * 也只会退 2 —— 那就念它真正的出口（跟在验真的合并之后）。 */
    const exit = closed
      ? ""
      : pr.isMerged
        ? ` · 出口：pnpm ship --close-issue ${n} --as-merged ${pr.number}`
        : " · 出口：合并验真之后随本轮一起关（pnpm ship --merge --close-issue）";
    log(
      `${TAG} 关单：#${n} · state=${state}${reason ? ` · state_reason=${reason}` : ""}` +
        `（${closed ? "已关" : "未关"}）${exit}`,
    );
  }
  const refs = referencedNotClaimed(titleBody);
  if (refs.length > 0) {
    log(
      `${TAG} 关单：标题里的裸引用（不参与关单，#2646 的口径）：${refs.map((n) => `#${n}`).join(" ")}`,
    );
  }
}

/**
 * 本地「上一次 ship」的落盘读数（#3206 那份事实源）—— 直接替掉
 * 「grep 自己重定向的日志」那个习惯的一半：结论行与走到哪，都在盘上。
 *
 * ⚠️ 落盘是 write-ahead（sink 一创建就写 `running`）：读的时候盘上那份往往就是
 * **这一次 --status 自己的**（argv 逐字相同）—— 把它念成「上一次跑」是自指。
 * 所以按 argv 对齐跳过本跑；跳过之后没有更老的记录可读，就如实念「没有可读的
 * 上一次」，不冒充任何结论。
 *
 * @param {(line:string)=>void} log 输出通道
 * @param {string} root 检出根
 * @param {string[]} currentArgv 这一次进程的参数（`process.argv.slice(2)`，对齐 sink 的记账）
 * @param {(() => import("./ship-result.mjs").ShipResultReading)} [read] 注入口（测试用）
 * @returns {void}
 */
function readoutLastRun(log, root, currentArgv, read) {
  const reading = (read ?? (() => readShipResult(root)))();
  if (!reading.found || !reading.result) {
    log(`${TAG} 本地上一次跑：没有落盘读数（${reading.path ?? ".git/ship-result.json"} 不在场）。`);
    return;
  }
  const r = reading.result;
  const sameRun =
    Array.isArray(r.argv) &&
    currentArgv.length === r.argv.length &&
    currentArgv.every((v, i) => v === r.argv[i]);
  if (sameRun) {
    log(
      `${TAG} 本地上一次跑：盘上那份就是这一次 --status 自己的（落盘 write-ahead）⇒ ` +
        "没有更老的记录可读，不冒充结论。",
    );
    return;
  }
  log(
    `${TAG} 本地上一次跑：${r.startedAt} · status=${r.status} · exit=${r.exitCode ?? "无"} · ` +
      `PR ${r.pr ?? "未读到"} · 结论：${r.conclusion ?? "（这一跑没念结论行）"}`,
  );
}

/**
 * `--status` 的入口：只读、一次只做一件、一次也不写平台。
 *
 * @param {{
 *   run:(cmd:string,args:string[])=>import("./ship-exec.mjs").ExecResult,
 *   log:(line:string)=>void,
 *   slug:string|null,
 *   cnbOk:boolean,
 *   target:string|null,
 *   dryRun:boolean,
 *   localBranch:string,
 *   trunkBranch:string,
 *   root:string,
 *   currentArgv?:string[],
 *   readLastRun?:() => import("./ship-result.mjs").ShipResultReading,
 * }} ctx `trunkBranch` = 主干分支名（当前分支等于它时目标回落「上一次跑的 PR」，
 *   来源念出来 —— 主干自己没有工作分支的 PR 可查）。`currentArgv` = 这一次进程的
 *   参数（对齐落盘 sink 的记账，用来把「本地上一次跑」那格里的本跑记录跳过）。
 * @returns {number} `CODE` 之一（映射见文件头那张表）
 */
export function runStatus(ctx) {
  const { run, log, slug, cnbOk, target, dryRun, localBranch, trunkBranch, root } = ctx;
  if (!slug) {
    log(`${TAG} 取不到仓库 slug ⇒ 没有结论（不猜一个仓库名去读别人的状态）。`);
    return CODE.NOT_RUN;
  }
  if (dryRun) {
    log(`${TAG} --dry-run 计划（只打印，一条都不执行）：`);
    log(`${TAG}   cnb pulls get-pull / list-pulls --repo ${slug} -v（PR 存在与合并态）`);
    log(
      `${TAG}   cnb build get-build-logs / get-build-status [-stage] -v（CI 终态，与轮询同一份分类）`,
    );
    log(
      `${TAG}   cnb issues get-issue -v（标题认领形态的单子状态）+ 读 .git/ship-result.json（上一次跑）`,
    );
    return CODE.GREEN;
  }
  if (!cnbOk) {
    log(`${TAG} 没有执行者（cnb 不在）⇒ 没有结论，不猜每一格的状态。`);
    return CODE.NOT_RUN;
  }

  /* ── 目标解析 ────────────────────────────────────────────────
   * 点名的说了算；没点名用当前分支；当前在主干 ⇒ 回落「上一次跑的 PR」
   * （主干没有工作分支的 PR，而落盘读数里正好记着刚交付的那条）。 */
  const explicit = parseStatusTarget(target);
  /** @type {{kind:"pr", number:number} | {kind:"branch", name:string} | null} */
  let resolved = explicit;
  let targetSource = explicit ? "点名" : "";
  if (!resolved) {
    const branch = String(localBranch ?? "").trim();
    if (branch && branch !== trunkBranch) {
      resolved = { kind: "branch", name: branch };
      targetSource = "当前分支";
    }
  }
  if (!resolved) {
    /* 主干回落读的是同一份注入口（测试可换假读数，不碰真 .git）。 */
    const last = (ctx.readLastRun ?? (() => readShipResult(root)))();
    const pr = last.found && last.result ? last.result.pr : null;
    if (pr) {
      resolved = { kind: "pr", number: pr };
      targetSource = "上一次跑的落盘读数（当前在主干）";
    }
  }
  if (!resolved) {
    log(
      `${TAG} 没有可查的目标：当前在主干 \`${trunkBranch}\`，落盘读数里也没有上一次跑的 PR。` +
        `点名一个：pnpm ship --status <PR号|分支名>。`,
    );
    return CODE.NOT_RUN;
  }
  log(
    `${TAG} 目标：${resolved.kind === "pr" ? `PR #${resolved.number}` : `分支 ${resolved.name}`}（来源：${targetSource}）`,
  );

  /* ── PR 读数 ─────────────────────────────────────────────────
   * 号 ⇒ get-pull 逐字回读；分支 ⇒ 有界翻清单（与复用 / 落地判定同一份翻页口径）。
   * 「没找到」与「没取到」必须分得开（#2964 / #3058 同一条账）。 */
  /** 按号回读全量判决；读数没跑起来回 null（调用方按「没有结论」收）。 */
  const readPullByNumber = (/** @type {number} */ number) => {
    const got = cnbJson(run, [
      "pulls",
      "get-pull",
      "--repo",
      slug,
      "--number",
      String(number),
      "-v",
    ]);
    return got ? readPullVerdict(got.json) : null;
  };
  /** @type {ReturnType<typeof readPullVerdict>} */
  let pv;
  if (resolved.kind === "pr") {
    const verdict = readPullByNumber(resolved.number);
    if (!verdict || (verdict.number === null && verdict.state === "unknown")) {
      log(`${TAG} PR #${resolved.number} 取不到（get-pull 没答 / 号不存在）⇒ 没有结论。`);
      return CODE.NOT_RUN;
    }
    pv = verdict;
  } else {
    const branchName = resolved.kind === "branch" ? resolved.name : "";
    const scan = scanPullPages(
      { run, slug },
      {
        state: "all",
        visit: (json) => {
          const rec = pullRecordForBranch(json, branchName);
          return rec ? Number(rec.number) : null;
        },
      },
    );
    if (!scan.ran) {
      log(`${TAG} PR 清单取不到（list-pulls 没答）⇒ 没有结论（不是「没提过 PR」）。`);
      return CODE.NOT_RUN;
    }
    if (scan.hit === null && scan.capped) {
      /* 页界截断时的第二条路：本检出的落盘读数（#3206）记着上一次跑的 PR —— 按它
       * 回读并核对 head 分支，对上了就用它（来源念出来）。这是**正面事实**的核对
       * （head.ref 逐字相等），不是猜；对不上或没有记录 ⇒ 仍然如实退「没取到」。 */
      const last = (ctx.readLastRun ?? (() => readShipResult(root)))();
      const lastPr = last.found ? (last.result?.pr ?? null) : null;
      const verdict = lastPr ? readPullByNumber(lastPr) : null;
      if (verdict?.headBranch === branchName) {
        log(
          `${TAG} PR 清单扫了 ${scan.pageCount} 页 / ${scan.scanned} 条没命中（页界截断）⇒ ` +
            `按落盘读数回读 PR #${lastPr}：head 分支正是 ${branchName} ⇒ 用它。`,
        );
        pv = verdict;
      } else {
        log(
          `${TAG} PR 清单扫了 ${scan.pageCount} 页 / ${scan.scanned} 条没命中，且清单被页界截断 ⇒ ` +
            "「没取到」，不是「没提过 PR」（清单可能还有更多；这条分支也没在落盘读数里）。" +
            "点名一个：pnpm ship --status <PR号>，或跑一次 pnpm ship 让它复用 / 建 PR。",
        );
        return CODE.NOT_RUN;
      }
    } else if (scan.hit === null) {
      log(
        `${TAG} 分支 ${branchName} 没提过 PR（清单扫了 ${scan.pageCount} 页 / ${scan.scanned} 条，窗口取满）` +
          ` ⇒ 下一动作：pnpm ship（提交 → 建 PR 往下走）。`,
      );
      /* 「没提过 PR」是这条分支内容未落地的正面事实 —— 与 --branches 的 not-merged
         同判（退 1 是提醒）；映射走同一份函数，不在入口处另写一个码。 */
      return statusExitCode({
        pullFound: false,
        windowComplete: true,
        isMergedTri: "unknown",
        mergeable: "unknown",
        ciState: "not-read",
      });
    } else {
      const verdict = readPullByNumber(scan.hit);
      if (!verdict) {
        log(`${TAG} PR #${scan.hit} 的详情取不到（get-pull 没答）⇒ 没有结论。`);
        return CODE.NOT_RUN;
      }
      pv = verdict;
    }
  }
  log(
    `${TAG} PR：#${pv.number} · state=${pv.state} · is_merged=${
      pv.isMergedTri === "merged" ? "true" : pv.isMergedTri === "not_merged" ? "false" : "缺键"
    } · mergeable_state=${pv.mergeableState}${pv.blockedOn ? ` · blocked_on=${pv.blockedOn}` : ""} · ${pv.title.slice(0, 60)}`,
  );

  /* 冲突这一格在 CI 之前收口：冲突的 PR 平台不派生构建，「没有 build」的真因是它。 */
  const mergeable = classifyPrMergeable(pv);
  if (mergeable === "conflict") {
    log(`${TAG} CI：这条 PR 与 base 冲突 ⇒ 平台不会为它派生 build（不是「还没起」）。`);
    for (const line of conflictAdviceLines({ number: pv.number, baseRef: null })) {
      log(line);
    }
    return statusExitCode({
      pullFound: true,
      windowComplete: true,
      isMergedTri: pv.isMergedTri,
      mergeable,
      ciState: "no-build",
    });
  }

  /* ── CI 读数 ─────────────────────────────────────────────────
   * 归属算法只有一份（resolveBuildSn：按 head.sha 逐页扫构建列表）；
   * 终态分类只有一份（classifyBuildOutcome）。红不深挖 —— 那是 --diagnose 的事。 */
  let ciState = /** @type {"green"|"red"|"cancelled"|"running"|"unknown"|"no-build"|"not-read"} */ (
    "not-read"
  );
  if (pv.headSha === "") {
    log(`${TAG} CI：PR 读数里没有 head sha（缺键）⇒ 归属不了 build，这一格没有结论。`);
  } else {
    /* sn 只在这一支用得上（后面的行读的是 ciState）⇒ 就地 const，不给外层留死初始化。 */
    const ciSn = resolveBuildSn({
      run,
      log,
      slug,
      headSha: pv.headSha,
      command: "pnpm ship --status",
      prefix: `${TAG} CI：`,
    });
    if (ciSn) {
      const raw = fetchBuildStatus(run, slug, ciSn);
      if (raw) {
        /* 取消与真失败的分界原话在 get-build-stage 的 data.error 里（#2406）——
           分类之前先补，与轮询 / --diagnose 同一条链。⚠️ 分类器的状态词是 `failed`，
           本格（与退码映射）用的是轮询层的词汇表（`red`）—— 转换只有一份实现
           （`toShipBuildState`），不在这里手写一个三元。 */
        const outcome = classifyBuildOutcome(enrichStageErrors(run, slug, ciSn, raw));
        ciState = toShipBuildState(outcome.state);
        const buildUrl = `https://cnb.cool/${slug}/-/build/logs/${ciSn}`;
        log(
          `${TAG} CI：${ciStateText(ciState)}（build ${ciSn}）· data.status=${outcome.raw ?? "(取不到)"} · 日志 ${buildUrl}${
            pv.isMergedTri === "merged" ? "（已合并后的历史读数，仅供参考）" : ""
          }`,
        );
        /* 「绿是谁给的」要念出来（#3620）：门禁本体在 GA 的那一跑，CNB 侧只有回读格 ——
           构建级 success 不冒充门禁绿，与轮询 / --diagnose 同一句话。 */
        const ga = gaReadoutStage(raw);
        if (ga && (ciState === "green" || ciState === "running")) {
          const dur = ga.durationMs ? formatDurationMs(ga.durationMs) : "";
          log(
            ciState === "green"
              ? `${TAG} CI：本次绿来自 GA 回读（「${ga.name}」成功${dur ? `，等了 ${dur}` : ""}）；` +
                  `要看 GA 侧逐格读数：pnpm ship --gh-logs ${String(pv.number ?? ciSn)}`
              : `${TAG} CI：GA 回读未取到终态（「${ga.name}」${ga.status || "还在跑"}）⇒ ` +
                  "现在的 success 只是回读格的壳，别当绿用。",
          );
        }
        if (ciState === "red") {
          log(
            `${TAG} CI：下一动作：pnpm ship --diagnose ${ciSn}（哪一格红 + 失败行，一次也不在这里重抄）。`,
          );
        }
        if (ciState === "running") {
          log(
            `${TAG} CI：过一会儿再跑一次 pnpm ship --status（或 pnpm ship 接着等：PR 已存在会复用）。`,
          );
        }
      } else {
        log(`${TAG} CI：构建 ${ciSn} 取不到状态 ⇒ 没有结论（不念绿也不念红）。`);
        ciState = "not-read";
      }
    } else if (pv.isMergedTri === "merged") {
      log(`${TAG} CI：已合并；按 head sha 没解析到 build（已掉出最近列表窗口）⇒ 历史读数略。`);
      ciState = "no-build";
    } else {
      /* resolveBuildSn 自己念了「还没推 / CI 还没起 / 挂在别的 sha 上」与下一动作。 */
      ciState = "no-build";
    }
  }

  /* ── 关单 + 本地上一次跑（两格都是读数，不参与退码）──────────── */
  readoutIssues(run, log, slug, {
    number: pv.number,
    title: pv.title,
    isMerged: pv.isMergedTri === "merged",
  });
  readoutLastRun(log, root, ctx.currentArgv ?? [], ctx.readLastRun);

  /* ── 未合并 + CI 绿的下一动作 ──────────────────────────────── */
  if (pv.isMergedTri === "not_merged" && ciState === "green") {
    log(`${TAG} 下一动作：pnpm ship --merge（CI 绿，合并要人点名 —— 红线 ①）。`);
  }
  return statusExitCode({
    pullFound: true,
    windowComplete: true,
    isMergedTri: pv.isMergedTri,
    mergeable,
    ciState,
  });
}
