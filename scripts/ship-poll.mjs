#!/usr/bin/env node
/**
 * ship-poll.mjs —— `pnpm ship` 的**轮询那一格**：一条 build 从「还没解析到」读到终态。
 *
 * ── 为什么单独一件 ─────────────────────────────────────────────
 *
 * 它此前住在 `ship-platform.mjs` 里，而那份文件在 ISSUE #2258 立案时只剩 13 行余量，
 * 动手那一轮更只剩 2 行（898 / 900）。这一族已经四次在「改别的东西时顺带撞闸」的那一次
 * PR 里临时决定拆哪一段（#2189 / #2199 / #2248 / #2491）—— 拆点选得对不对没人判，
 * 选错的形态是下一次再拆一遍。所以这一单先把落点定下来再动手：**轮询与「取 PR / 判决 /
 * 合并 / 清分支」不是同一个变化方向**。前者跟着「一条 build 怎么被读、等多久才算没有
 * 结论」动；后三者跟着「平台对我们动作的应答」动。
 *
 * 与两个名字里有 build 的邻居分工：
 *   · `ship-build.mjs` 是**纯判定**（按 sha 归属、给一眼算签名、把状态读成三态），
 *     不产生副作用、不起进程；
 *   · `ci-build-readout.mjs` 是**给人看的诊断出口**（`--diagnose`：逐格分类、失败行、
 *     日志链接），判据服务于「这一跑为什么红、红在哪一格」；
 *   · 本文件是那个**循环**：每 20 秒取一眼、算签名、判「有没有在动」，并决定还等不等。
 *
 * ── 本层的形状 ────────────────────────────────────────────────
 *
 * 只经注入的 `run` / `log` / `now` / `sleep` 与世界打交道 —— 不起进程、不写文件、不读
 * git 目录，所以整段可以用同一份假执行者跑完（`tests/ship.test.ts` 的
 * `pollUntilTerminal` 一组）。取数只走 `cnb … -v` 的 JSON 且只读 `data.*`：
 * 信封上的 `status: 200` 只说明「问到了」，与流水线过没过毫无关系。
 */
import { asArray, buildSignature, pickBuildForSha } from "./ship-build.mjs";
import { cnbJson, short } from "./ship-exec.mjs";
import {
  classifyBuildOutcome,
  downstreamSkipped,
  enrichStageErrors,
  inFlightStages,
  progressReadout,
  stalledStages,
  stallReadout,
} from "./ci-build-readout.mjs";
import {
  classifyPrMergeable,
  CODE,
  codeTag,
  conflictAdviceLines,
  readPullVerdict,
} from "./ship-core.mjs";
import { reportConflictStage, reportStage } from "./ship-stage.mjs";

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
 * 停摆读数（ISSUE #2901）的告警阈值：一格 `start` + `endTime<=startTime` 超过这么多分钟，
 * 就在轮询里明说「疑似 runner 失联」并给出出口。
 *
 * 与 `ship-diagnose.mjs` 的 `DIAGNOSE_STALL_MINUTES` 同一个数（10）：它答的是「隔了 10 分钟
 * 还没动」，这里答的是「这一格从开始到现在过了 10 分钟还没回来」—— 同一件事的两个读法。
 * ⚠️ 这是**读数**，不参与退码（硬规则 28③）：断流那一判一个字没改，仍旧是
 * 「签名不变 + 没有一格在飞 + 10 眼」。它只是把「等 2h24m 兜底超时」这条路说出来。
 */
const POLL_STALLED_MINUTES = 10;

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
  if (state === "failed") {
    return "red";
  }
  return state;
}

/**
 * 阶段 4：轮询这条 sha 的 build，直到出终态或预算到顶。
 *
 * 选 build 只按 **sha + `event === "pull_request"`** 取最新一条（`pickBuildForSha`），
 * 不拿「列表里第一条」兜底 —— 同一台节点上会并存多条 PR build，取错那条等于
 * 用别人的流水线给自己的代码作证。
 *
 * @param {{
 *   run: (cmd: string, args: string[]) => import("./ship-exec.mjs").ExecResult,
 *   log: (s: string) => void,
 *   slug: string,
 *   newSha: string,
 *   now: ()=>number,
 *   sleep: (ms:number)=>void | Promise<void>,
 *   number?: number | string | null,
 *   baseRef?: string | null,
 * }} ctx
 *   `number` 是可选的 PR 号（建/复用 PR 之后才有）。给了它，「按 sha 还没解析到
 *   build」那一格会顺带读一眼 `get-pull` 的 `mergeable_state` / `blocked_on` ——
 *   ISSUE #2645：CI「没起」与「红了」在读数上长得像，而真因常在**冲突**
 *   （`mergeable_state=conflict` 的 PR 平台不派生构建）。读到冲突**当场收口**
 *   （ISSUE #3083：念警告却继续轮满 10 眼是「说别干等、行为在干等」的自相矛盾）；
 *   缺键 / 平台还在算按「未知」念一句、继续轮。没给 `number` 就只念旧文案。
 *   `baseRef` 只用于冲突那一支的出口话术（点名该合哪条基线）；不给就念占位写法。
 * @returns {Promise<{buildState:"green"|"red"|"cancelled"|"running"|"unknown",buildSn:string|null,stop:number|null}>}
 *   `stop` 非 null 时调用方直接以此码收尾 —— 三种形状都落这里：执行者不在（**还没钉住
 *   build 时**取不到列表；钉住之后不再拉列表，ISSUE #3070 ⇒ `CODE.NOT_RUN`）、**同签名断流**
 *   （连着 `POLL_STALL_MAX` 眼读数没变、**且此刻没有任何一格在飞**，再等下去只是重复同一句话
 *   ⇒ `CODE.CI_PENDING`），以及 **PR 冲突**（平台永不派生，当场退 `CODE.CONFLICT`，ISSUE #3083）。
 */
export async function pollUntilTerminal(ctx) {
  const { run, log, slug, newSha, now, sleep, number, baseRef = null } = ctx;
  let buildState = /** @type {"green"|"red"|"cancelled"|"running"|"unknown"} */ ("unknown");
  let buildSn = null;
  const deadline = now() + 45 * 60 * 1000;
  /** PR 冲突信号已念过的标记：只在 `!picked` 那一格念一次，不每 20 秒复述。 */
  let announcedPrState = false;
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
  /** 「停摆读数已经念过」的标记（ISSUE #2901）：同一句话每 20 秒复述一遍与复述「没变化」同类。 */
  let announcedStalled = false;
  for (;;) {
    /* ISSUE #3070：sha→sn 的映射一旦钉住就不再变（sha 在进平台段前已钉死，ISSUE #2812；
     * sn 是平台分配的）—— 钉住之后每 20 秒再拉一次全量列表，只是在重复确认同一件事，
     * 请求量翻倍而读数不变。所以列表只在**还没钉住**时拉；钉住之后直接按 sn 读状态。
     * 签名序列不受影响：签名只看 (statusJson, sn) 两件，列表从来不是签名的输入 ——
     * 断流 / 在飞归零 / #2645 冲突信号的触发时机逐字不变（它们全挂在「有没有 sn」上）。
     * 捎带消掉一个故障点：钉住之后列表的瞬时失败此前会把整跑掐成 NOT_RUN ——
     * 那一拉本来就是冗余的，它的失败不该有话语权。 */
    if (!buildSn) {
      const logs = cnbJson(run, ["build", "get-build-logs", "--repo", slug, "-v"]);
      const builds = logs ? asArray(logs.json) : null;
      if (!builds) {
        log("[ship] 取不到 build 列表 ⇒ 没跑起来，不当成「还在跑」也不当成「绿」");
        return { buildState, buildSn, stop: CODE.NOT_RUN };
      }
      const picked = pickBuildForSha(builds, newSha);
      if (picked) {
        buildSn = picked.sn;
        /* 「走到哪了」：钉住 build 那一刻报一次（只在钉住时发，不每 20 秒复述）。 */
        reportStage(log, "等 CI", { build: buildSn, sha: short(newSha), pr: number ?? "(无)" });
      }
      /* 钉住即不再看列表 ⇒ ISSUE #2950 那条「掉出列表窗口就按钉住的 sn 续读」的回退
       * 自然消解：它防的是「钉住了却被列表读数倒退回没起」，而钉住之后根本没有列表
       * 读数可倒退 —— 不留走不到的分支。「取不到列表」与「还没解析到」两格只在
       * 未钉住时可达，话术与退码不变。 */
    }
    const sn = buildSn;
    /** 这一眼的状态 JSON；没解析到 build 时为 null（签名照样成立）。 */
    let statusJson = null;
    if (sn) {
      const st = cnbJson(run, ["build", "get-build-status", "--repo", slug, "--sn", sn, "-v"]);
      statusJson = st ? st.json : null;
      /* 逐格读数优先于构建级状态 —— 平台把「被取消」记成构建级 `error`，而它与
       * 「真失败」的处置完全不同（前者重跑，后者查产物）。分类只有一份，
       * 在 `ci-build-readout.mjs`（ISSUE #2158 第 2 条 / 规范 §13.5.27）。
       * ⚠️ 分界那句**原话**只在 `get-build-stage -v` 的 `data.error` 里，`get-build-status`
       * 的 `stages[]` 没有这一栏 ⇒ 分类之前先补（ISSUE #2406）。这一跳只对**非绿非 skipped**
       * 的那几格发请求，且**只在逐格读数已到终态时**才有意义 —— 在飞那几格还没原话。 */
      const outcome = st ? classifyBuildOutcome(enrichStageErrors(run, slug, sn, st.json)) : null;
      /** @type {{state:"green"|"red"|"cancelled"|"running"|"unknown",raw:string|null}} */
      const v = outcome
        ? { state: toShipBuildState(outcome.state), raw: outcome.raw }
        : { state: "unknown", raw: null };
      buildState = v.state;
      log(`[ship] build ${sn} → data.status = ${v.raw ?? "(取不到)"}`);
      if (v.state === "cancelled" && outcome) {
        const first = outcome.cancelled[0];
        const skipped = downstreamSkipped(outcome).map((s) => s.name || s.id);
        log(
          // oxlint-disable-next-line typescript/no-unnecessary-condition -- cancelled 来自平台数据，空数组时首元素运行时为 undefined
          `[ship]   这一跑**被取消**（不是产物坏了）：${first ? first.name : "(不知哪一格)"} 被终止 ⇒ 下面那几格根本没跑${
            skipped.length > 0 ? `（${skipped.join("、")}）` : ""
          }，这一跑没有 CI 结论`,
        );
        /* 「被谁顶掉的」是这一档唯一能让人**不去**查产物的那句话（ISSUE #2406）：
         * 原话与抢锁那一跑都来自平台，本仓一个字不代写。 */
        for (const r of outcome.reasons) {
          const who = r.sn ? `（抢锁的那一跑：${r.sn}）` : "";
          if (r.reason) {
            log(`[ship]   平台原话${who}：${r.reason}`);
          } else if (r.sn) {
            log(`[ship]   抢走锁的那一跑：${r.sn}`);
          }
        }
      }
      if (v.state !== "running" && v.state !== "unknown") {
        break;
      }
    } else {
      log(`[ship] 按 sha ${short(newSha)} 还没解析到 build（平台可能尚未开跑）…`);
      /* ISSUE #2645：CI「没起」与「红了」在读数上长得像，而真因常在**冲突**——
       * `mergeable_state=conflict` 的 PR 平台不派生构建，干等只会烧预算。顺带读一眼
       * PR 的 `mergeable_state` / `blocked_on`，把人从「再等等 / 换分支名」那条冤枉路
       * 上拽回来。只念一次（`announcedPrState`），且没给 `number` 时不发这一问。 */
      if (number && !announcedPrState) {
        announcedPrState = true;
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
          const cls = classifyPrMergeable(pv);
          log(
            `[ship] PR #${number}：mergeable_state=${pv.mergeableState} blocked_on=${pv.blockedOn || "(无)"}`,
          );
          if (cls === "conflict") {
            /* ISSUE #3083：#2645 在这里念完警告**继续轮** —— 警告说「别干等」，行为
             * 却在干等（签名不变 + 无格在飞，轮满 10 眼 ≈3 分 20 秒才断流），两句
             * 互相推翻。冲突的 PR 平台**永远不会**派生构建 ⇒ 当场收口
             * （退 3 CONFLICT，没跑起来家族），把预算还给解冲突的人。 */
            log(
              `[ship]   ⚠️ 冲突的 PR 平台不派生 CI ⇒ 不再轮询，当场收口（${codeTag(CODE.CONFLICT)}）：`,
            );
            reportConflictStage({
              run,
              log,
              number,
              baseRef: baseRef ?? null,
              blockedOn: pv.blockedOn,
            });
            for (const line of conflictAdviceLines({ number, baseRef: baseRef ?? null })) {
              log(line);
            }
            return { buildState, buildSn, stop: CODE.CONFLICT };
          }
          if (cls === "unknown") {
            log(
              "[ship]   可合并状态取不到（mergeable_state 缺键 / 平台还在算）⇒ 不猜，" +
                "继续轮；若迟迟没有 build，去平台上核一眼这条 PR 是否冲突。",
            );
          }
        }
      }
    }
    const sig = buildSignature(statusJson, sn ?? "");
    /* 「同签名」只是**没产生新计数**，不等于「没在动」：一格长 stage 在内部推进时签名逐字不变
     * （ISSUE #2184 实测 `…/pending/0-1+11/33` 连着 10 眼，而 `受影响用例` 正在跑；几分钟后
     * 同一条构建是 28/33）。所以停滞要同时满足两件：签名不变 **且** 此刻没有任何一格在飞。
     * 在飞那一判每轮只念一次 —— 它是「还在跑」这一事实的说明，不是每 20 秒要复述一遍的进度条。 */
    const flying = inFlightStages(statusJson);
    /* 停摆读数额外说一次（ISSUE #2901）：那一形里**有**一格在飞（`start`），所以断流那一判
     * 不会掐它 —— 而那正是最需要被念出来的一形：平台对 `start` / `duration` / `endTime`
     * 三件的口径自相矛盾，等下去只有 8640s 的客户端超时兜底。
     * 只在第一次越线时念，之后复述同一句话只是噪音（平台原值变了会再越一次线）。 */
    const stalled = stalledStages(statusJson);
    if (stalled.length > 0 && !announcedStalled) {
      const progressed = progressReadout(statusJson, sn ?? "");
      const lines = stallReadout({
        signature: progressed.signature,
        sn: sn ?? "",
        stalled,
        minutes: POLL_STALLED_MINUTES,
        slug,
      });
      if (lines.length > 0) {
        announcedStalled = true;
        for (const line of lines) {
          log(line);
        }
      }
    }
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
      /* 落「没跑起来家族」而不是红：签名含 stage 级进度之后，「连着 10 眼一模一样」意味着
       * 这条流水线**一个格都没推进过**，那就不是「测出一个红」而是「这一格没有终态结论」——
       * 与 `base-check` 的 `inconclusive` 同一口径（拿不到测量 ≠ 测量结果是红的）。
       * #2152 当初把它落红，理由是「它拿到了读数」；那句话在只看 pipeline 级计数的签名下成立
       * （推进中的流水线也会被念成没动），签名补上 stage 级之后不再成立，业主定：改记 2；
       * ISSUE #3083 把它从泛化的 2 细分到 **4 CI_PENDING**（CI 无终态、不再烧预算干等）。
       * 下一动作仍然给人（看那一格的日志，或过一会儿再跑一次 `pnpm ship`，PR 复用不重建）。 */
      log(
        `[ship] build ${buildSn ?? "(未解析到 build)"} 连续 ${sameSig} 次读数没变、` +
          `且此刻没有一格在飞（${sig}）⇒ 不再轮询：这一格没有终态结论（${codeTag(CODE.CI_PENDING)}）`,
      );
      log(
        `[ship]   接着看：https://cnb.cool/${slug}/-/build/logs/${buildSn ?? "<sn>"}` +
          "，或过一会儿再 `pnpm ship`（PR 已存在会复用，不重建）",
      );
      return { buildState, buildSn, stop: CODE.CI_PENDING };
    }
    if (now() > deadline) {
      log("[ship] 轮询到预算上限仍未出终态 ⇒ 记「没跑起来」，不猜结论");
      buildState = "unknown";
      break;
    }
    await sleep(20_000);
  }
  return { buildState, buildSn, stop: null };
}
