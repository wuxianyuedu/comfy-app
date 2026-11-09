/**
 * `ci-daily-bundle-escalation.mjs` —— 每日失败立案里的「预算账陈旧度触发器」（ISSUE #2639）。
 *
 * 为什么单独成模块：这段只做「读判决行 → 判门限 → 拼一节正文」，与立案那侧的取数 / 去重 /
 * 写单没有共享状态；留在 `ci-daily-failure-issue.mjs` 里会把那份文件推过 900 行硬闸，
 * 而这里的分界是天然的。**它不改判据的判定**（棘轮只许降不许升照旧）：只读
 * `check-bundle-budget.cjs` 自己打的那两句判决行，门限见 `scripts/.gate-thresholds.json`。
 *
 * 三条边界（与主文件那节同口径）：
 *   · 只认判据自己打的判决行（`BUNDLE_GATE_MARKERS`），不重算金额 —— 重算就是第二个量具；
 *   · 撤档期间不响（#2634：判据照打差额、但明说「今天没判」，那种读数**不是红**）；
 *   · 读不出 ≠ 没到门限（§13.6.4.1）：取不到 / 认不出 / 窗口没盖住，一律不升并念出是哪一档。
 */
import {
  classifyBuildOutcome,
  fetchBuildStatus,
  fetchStageDetail,
  findStageMatches,
} from "./ci-build-readout.mjs";
import { fetchBuildsCoveringWindow, isDailyDispatch } from "./check-daily-attendance.mjs";

/**
 * 预算闸那一格在每日链里的格名。`LANE_STAGES` 的键与值都是它，所以只在这里写一次。
 */
export const BUNDLE_GATE_STAGE = "每日生产构建";

/**
 * 预算闸自己的**判决行**。只认这两句 —— 金额、逐文件指纹都不认：这一格判的是
 * 「判据有没有判红」，不是替它再算一遍。`tests/ci-daily-failure-issue.test.ts` 拿
 * `check-bundle-budget.cjs` 的源码对账，判据那一侧改词会当场红（两处各写一遍必然漂）。
 */
export const BUNDLE_GATE_MARKERS = {
  enforced: "[bundle-budget] 违规（阻断）",
  suspended: "[bundle-budget] 读数（不参与判定）",
};

/**
 * 陈旧度门限：基线记的那一版之后又过去这么多提交，还没人认账 / 压回 ⇒ 点名升级。
 * ISSUE #2639 的建议值（15 次 ≈ 现场 `dd8d4647` 其后 35 次的一半）；业主改这一条即可。
 */
export const BUNDLE_BASELINE_STALE_COMMITS = 15;

/**
 * 连续门限：预算闸连续红这么多天 ⇒ 点名升级。它治的是「每次都被重新签过账、
 * 但同一格同类账反复出现」那一形（#2639 那六次），所以与陈旧度**各判各的**。
 */
export const BUNDLE_GATE_RED_STREAK_DAYS = 2;

/**
 * 从预算闸那一格的日志正文里读「账有没有挂着」。**纯函数**：只认判据自己打的那几句。
 *
 * 四档（**不许合并**）：
 *   · `enforced` —— 判据真判了、判成违规（这一跑因此会红）；
 *   · `suspended` —— 判据打了差额但明说「今天没判」（#2634）⇒ **不是红**；
 *   · `none` —— 日志里没有违规读数（判据绿，或根本没跑到那一行）；
 *   · `unknown` —— 正文取不到，或两句判决行同时在（改稿中途的形态）。
 *
 * 陈旧度只从**归因行**里取，两种形状都认（都是判据自己打的）：`其后本检出上有 N 次提交`
 * 与 `改按基线日期 … 归因：src/ 侧其后有 N 次主干提交`。取不到 ⇒ `kind:"unknown"`，
 * **不是 0** —— 0 会被读成「基线很新」。
 *
 * @param {string | null | undefined} text 那一格的日志正文（已剥 ANSI）
 * @returns {{marker:"enforced"|"suspended"|"none"|"unknown", stale:{kind:"commits"|"source-commits", n:number, rev:string|null}|{kind:"unknown"}, note:string}}
 */
export function readBundleAccount(text) {
  const body = typeof text === "string" ? text : "";
  if (body.trim() === "") {
    return {
      marker: "unknown",
      stale: { kind: "unknown" },
      note: "那一格的日志正文没取到",
    };
  }
  const enforced = body.includes(BUNDLE_GATE_MARKERS.enforced);
  const suspended = body.includes(BUNDLE_GATE_MARKERS.suspended);
  const marker =
    enforced && suspended ? "unknown" : enforced ? "enforced" : suspended ? "suspended" : "none";
  /* 归因行两形：`基线修订号：dd8d4647（其后本检出上有 87 次提交）` 与
   * `… 改按基线日期 … 归因：src/ 侧其后有 N 次主干提交`。前者是常态，后者是
   * 基线修订号不可达（squash 合入的常态）时判据自己走的第二通道。 */
  const since =
    /基线修订号：(?<rev>[0-9a-f]{8})[^\n]*?其后本检出上有\s*(?<commits>\d+)\s*次提交/.exec(body);
  const byDate = /改按基线日期[^\n]*?其后有\s*(?<commits>\d+)\s*次主干提交/.exec(body);
  /** @type {{kind:"commits"|"source-commits", n:number, rev:string|null}|{kind:"unknown"}} */
  let stale = { kind: "unknown" };
  if (since) {
    stale = { kind: "commits", n: Number(since.groups?.commits), rev: since.groups?.rev ?? null };
  } else if (byDate) {
    stale = { kind: "source-commits", n: Number(byDate.groups?.commits), rev: null };
  }
  const note =
    marker === "unknown"
      ? enforced && suspended
        ? "两句判决行同时在 ⇒ 认不出判据这一跑到底判没判"
        : "那一格的日志正文没取到"
      : marker === "none"
        ? "日志里没有违规读数（判据没红，或根本没跑到那一行）"
        : marker === "suspended"
          ? "判据打了差额但明说「今天没判」（开发期暂撤）"
          : stale.kind === "unknown"
            ? "判据判了违规，但归因行读不出「基线之后动过几次」"
            : `归因行：${stale.kind === "commits" ? "基线之后" : "src/ 侧其后"} ${stale.n} 次提交`;
  return { marker, stale, note };
}

/**
 * 升级那一段（Markdown）。**只念读数与两条出口**，不替谁判「该不该认」——
 * 认账 / 压回都是人的判断（§13.5.4 例外流程），这一格只把「拖到多久了」念出来。
 *
 * @param {{account:ReturnType<typeof readBundleAccount>, streak:{days:number|"unknown", note:string}, why:string[]}} input
 * @returns {string}
 */
export function composeEscalation({ account, streak, why }) {
  const stale =
    account.stale.kind === "unknown"
      ? "- 陈旧度：**读不出**（判据的归因行里没有可解析的那一段）"
      : `- 陈旧度：基线 \`${account.stale.rev ?? "(按日期归因)"}\` 其后**${account.stale.n} 次提交**${
          account.stale.kind === "source-commits" ? "（src/ 侧主干提交）" : ""
        }`;
  const streakLine =
    streak.days === "unknown"
      ? `- 连续：**读不出**（${streak.note}）`
      : `- 连续：预算闸已连续红 **${streak.days} 天**（逐日只看判据自己那两句判决行）`;
  return [
    "## 该有人出面了（预算账读数触发器，ISSUE #2639）",
    "",
    `- 触发原因：${why.join("；")}`,
    stale,
    streakLine,
    "",
    "两条出口（§13.5.4 例外流程，只能二选一）：",
    "",
    "1. **认账** —— 在造成这批字节的那条 PR 里贴 before/after 两档读数 + 一句「为什么值这个体积」，" +
      "同批带 `--allow-increase` 重跑 `node scripts/check-bundle-budget.cjs --update`；",
    "2. **压回** —— 开一条把字节降回去的 PR。",
  ].join("\n");
}

/**
 * 「该有人出面」判不判（纯函数，门限可注入，好让用例把边界钉住）。
 *
 * 只有**判据真判红**（`enforced`）才可能升；其余三档都不升，且各给一句不同的话 ——
 * 「暂撤」「没红」「读不出」混成一句，读的人就分不出「没事」与「没测」。
 *
 * @param {{account:ReturnType<typeof readBundleAccount>, streak:{days:number|"unknown", note:string}, staleCommits?:number, streakDays?:number}} input
 * @returns {{fired:boolean, reason:string, section:string|null}}
 */
export function judgeBundleEscalation({
  account,
  streak,
  staleCommits = BUNDLE_BASELINE_STALE_COMMITS,
  streakDays = BUNDLE_GATE_RED_STREAK_DAYS,
}) {
  if (account.marker === "suspended") {
    return {
      fired: false,
      reason:
        "预算闸今天没判（开发期暂撤，ISSUE #2634 —— 读数在、不参与判定）⇒ 触发器只认「真红」那一档",
      section: null,
    };
  }
  if (account.marker === "none") {
    return {
      fired: false,
      reason: "预算闸这一跑没有违规读数 ⇒ 没有可升的账",
      section: null,
    };
  }
  if (account.marker !== "enforced") {
    return {
      fired: false,
      reason: `预算闸读数认不出（${account.note}）⇒ 不构成结论`,
      section: null,
    };
  }
  const staleN = account.stale.kind === "unknown" ? null : account.stale.n;
  const streakN = streak.days === "unknown" ? null : streak.days;
  const byStale = staleN !== null && staleN >= staleCommits;
  const byStreak = streakN !== null && streakN >= streakDays;
  if (!byStale && !byStreak) {
    if (staleN === null && streakN === null) {
      return {
        fired: false,
        reason:
          `两个门限都读不出（陈旧度：${account.note}；连续天数：${streak.note}）` +
          "⇒ 不构成结论（不是「没过门限」）",
        section: null,
      };
    }
    return {
      fired: false,
      reason:
        `账挂着但还没到门限（陈旧 ${staleN === null ? "读不出" : `${staleN}/${staleCommits}`} · ` +
        `连续 ${streakN === null ? "读不出" : `${streakN}/${streakDays}`} 天）`,
      section: null,
    };
  }
  const why = [
    byStale ? `基线已陈旧 ${staleN} 次提交（门限 ${staleCommits}）` : "",
    byStreak ? `预算闸已连续红 ${streakN} 天（门限 ${streakDays}）` : "",
  ].filter(Boolean);
  return {
    fired: true,
    reason: why.join("；"),
    section: composeEscalation({ account, streak, why }),
  };
}

/**
 * 「预算闸连续红了几天」—— 与主取数共用 `fetchBuildsCoveringWindow()`，只是窗口按门限
 * 天数算（ISSUE #2639 说的「同一实现扩个窗口参数」）。
 *
 * 三态：数字 = 逐日回看确认的连续天数；`"unknown"` = 读不出（**不是 0**）。
 * 读不出的四种形态各给一句：没盖住窗口 / 上一跑不在宽窗口列表里 / 某一天没终态 /
 * 某一天的预算闸读数认不出（含「那一格没跑」）。中间断一天则如实截断到断点为止。
 *
 * 每天的判法：`findStageMatches()` 逐字反查格名（认不出 / 多格同名都算读不出，不替你挑
 * 一格 —— #2455 那条），再 `fetchStageDetail()` 取正文、`readBundleAccount()` 判。
 *
 * @param {{run:(cmd:string,args:string[])=>any, slug:string, lanes:string[], fromSn:string, need?:number, known?:{sn:string, json:any, text:string|null}|null, now?:number}} input
 * @returns {{days:number|"unknown", note:string}}
 */
export function fetchBundleRedStreak({
  run,
  slug,
  lanes,
  fromSn,
  need = BUNDLE_GATE_RED_STREAK_DAYS,
  known = null,
  now = Date.now(),
}) {
  const windowHours = need * 24 + 12;
  const win = fetchBuildsCoveringWindow({ run, slug, windowHours, now });
  if (win.list === null) {
    return { days: "unknown", note: "取不到构建列表" };
  }
  if (!win.covered) {
    return { days: "unknown", note: `没盖住 ${windowHours}h 窗口（${win.note}）` };
  }
  const daily = win.list.filter(isDailyDispatch);
  const at = daily.findIndex((b) => String(b?.sn ?? "") === fromSn);
  if (at === -1) {
    return {
      days: "unknown",
      note: `上一跑 ${fromSn} 不在宽窗口的派发列表里`,
    };
  }
  const wanted = new Set(lanes);
  /* 本档派发的取数上限：宽窗口里会混进别的档（桌包 02:00 那条），跳过它们不算“看过一跑”。
   * 上限按 `need` 推，不另立常量 —— 门限一改，这里跟着改。 */
  const fetchCap = need * 3 + 3;
  let examined = 0;
  let fetched = 0;
  let red = 0;
  for (let i = at; i < daily.length && examined < need; i += 1) {
    const sn = String(daily[i]?.sn ?? "");
    if (sn === "") {
      continue;
    }
    const reuse = known?.sn === sn ? known : null;
    if (!reuse && fetched >= fetchCap) {
      return {
        days: "unknown",
        note: `本档派发不足 ${need} 跑（看了 ${fetched} 跑就撞到取数上限）`,
      };
    }
    /** @type {any} */
    let json = reuse ? reuse.json : null;
    if (!json) {
      json = fetchBuildStatus(run, slug, sn);
      fetched += 1;
    }
    if (!json) {
      return { days: "unknown", note: `${sn} 的逐格读数取不到` };
    }
    const outcome = classifyBuildOutcome(json);
    if (outcome.state === "running" || outcome.state === "unknown") {
      return {
        days: "unknown",
        note: `${sn} 没有终态（${outcome.state}）`,
      };
    }
    if (wanted.size > 0 && !outcome.pipelines.some((p) => wanted.has(p.name))) {
      continue;
    }
    examined += 1;
    const { hits } = findStageMatches(outcome, BUNDLE_GATE_STAGE);
    if (hits.length !== 1) {
      return {
        days: "unknown",
        note:
          hits.length === 0
            ? `${sn} 里认不出「${BUNDLE_GATE_STAGE}」这一格`
            : `${sn} 里「${BUNDLE_GATE_STAGE}」命中 ${hits.length} 格（不替你挑一格）`,
      };
    }
    const hit = hits[0];
    if (!hit) {
      return { days: "unknown", note: `${sn} 的预算闸那一格认不出` };
    }
    if (String(hit.stage.status).toLowerCase() === "skipped") {
      return { days: "unknown", note: `${sn} 那一格没跑（skipped）` };
    }
    /** @type {string | null} */
    let text = reuse && typeof reuse.text === "string" ? reuse.text : null;
    if (text === null) {
      const detail = fetchStageDetail(run, slug, sn, String(hit.pipeline.id), String(hit.stage.id));
      fetched += 1;
      if (!detail) {
        return {
          days: "unknown",
          note: `${sn} 的「${BUNDLE_GATE_STAGE}」日志取不到`,
        };
      }
      text = detail.text;
    }
    const marker = readBundleAccount(text).marker;
    if (marker === "enforced") {
      red += 1;
      continue;
    }
    if (marker === "suspended" || marker === "none") {
      return {
        days: red,
        note: `${sn} 那一跑预算闸没有判红 ⇒ 连续在这里断`,
      };
    }
    return { days: "unknown", note: `${sn} 的预算闸读数认不出` };
  }
  if (examined < need) {
    return {
      days: "unknown",
      note: `本档派发只有 ${examined} 跑（要 ${need} 跑）`,
    };
  }
  return { days: red, note: `逐日回看 ${need} 跑：${red} 跑判红` };
}

/**
 * 把「这一跑 + 那一格日志 + 连续天数」判成「升不升」与正文那一节（主文件只调它）。
 *
 * 这一段**不参与写不写**：它只给正文多一节 / 少一节，改了预算闸的判定才是越界。
 * 离线档（`--from`）不联网：正文只从那份 JSON 的 `stageLogs[sn]` 取，连续天数一律
 * `"unknown"` —— 离线档的规矩就是不发网络请求，不是这一格的例外。
 *
 * @param {{run:(cmd:string,args:string[])=>any, slug:string, offline:boolean,
 *   offlineLogs?:Record<string,string>|null, outcome:ReturnType<typeof classifyBuildOutcome>,
 *   sn:string, details?:Array<{sn:string,json:unknown}>, lanes?:string[]}} input
 * @returns {{fired:boolean, reason:string, section:string}}
 */
export function judgeBundleStageReading({
  run,
  slug,
  offline,
  offlineLogs = null,
  outcome,
  sn,
  details = [],
  lanes = [],
}) {
  const stageFailed = outcome.failed.some((f) => (f.name || f.id) === BUNDLE_GATE_STAGE);
  /** @type {string | null} */
  let bundleText = null;
  if (stageFailed) {
    if (offline) {
      bundleText = offlineLogs ? (offlineLogs[sn] ?? null) : null;
    } else {
      const { hits } = findStageMatches(outcome, BUNDLE_GATE_STAGE);
      if (hits.length === 1) {
        const hit = hits[0];
        if (!hit) {
          return { fired: false, reason: "预算闸那一格认不出", section: "" };
        }
        const detail = fetchStageDetail(
          run,
          slug,
          sn,
          String(hit.pipeline.id),
          String(hit.stage.id),
        );
        bundleText = detail ? detail.text : null;
      }
    }
  }
  /** @type {ReturnType<typeof readBundleAccount>} */
  const account = stageFailed
    ? readBundleAccount(bundleText)
    : {
        marker: "none",
        stale: { kind: "unknown" },
        note: "这一跑的红格里没有预算闸",
      };
  /** @type {{days:number|"unknown", note:string}} */
  let streak = {
    days: "unknown",
    note: "预算闸没判红 ⇒ 没有「连续红」可言",
  };
  if (account.marker === "enforced") {
    streak = offline
      ? { days: "unknown", note: "离线档不联网，连续天数取不到" }
      : fetchBundleRedStreak({
          run,
          slug,
          lanes,
          fromSn: sn,
          known: {
            sn,
            json: details.find((d) => String(d.sn) === sn)?.json ?? null,
            text: bundleText,
          },
        });
  }
  const judged = judgeBundleEscalation({ account, streak });
  return { fired: judged.fired, reason: judged.reason, section: judged.section ?? "" };
}
