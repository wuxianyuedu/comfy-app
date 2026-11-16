/**
 * `ci-daily-bundle-escalation.mjs` —— 每日失败立案里的「预算账陈旧度触发器」（ISSUE #2639）。
 *
 * 为什么单独成模块：这段只做「读判决行 → 判门限 → 拼一节正文」，与立案那侧的取数 / 去重 /
 * 写单没有共享状态；留在 `ci-daily-failure-issue.mjs` 里会把那份文件推过 900 行硬闸，
 * 而这里的分界是天然的。**它不改判据的判定**（棘轮只许降不许升照旧）：只读
 * `check-bundle-budget.cjs` 自己打的那两句判决行，门限见 `scripts/.gate-thresholds.json`。
 *
 * 纯判定层（判决行解析 / 门限 / 正文拼装）抽在 `ci-bundle-escalation-core.mjs`，
 * 供本模块与 GA 那一侧（`ci-ga-daily-bundle-escalation.mjs`）共用；
 * 这里只留 CNB 取数链与 re-export（让既有用例与调用方的 import 路径一字未变）。
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
import {
  BUNDLE_GATE_RED_STREAK_DAYS,
  judgeBundleEscalation,
  readBundleAccount,
} from "./ci-bundle-escalation-core.mjs";
import { fetchBuildsCoveringWindow, isDailyDispatch } from "../gates/check-daily-attendance.mjs";

/* re-export：纯判定层的出口仍由本模块对外提供（调用方与用例的 import 路径不变）。 */
export {
  BUNDLE_BASELINE_STALE_COMMITS,
  BUNDLE_GATE_MARKERS,
  BUNDLE_GATE_RED_STREAK_DAYS,
  composeEscalation,
  judgeBundleEscalation,
  readBundleAccount,
} from "./ci-bundle-escalation-core.mjs";

/**
 * 预算闸那一格在每日链里的格名。`LANE_STAGES` 的键与值都是它，所以只在这里写一次。
 */
export const BUNDLE_GATE_STAGE = "每日生产构建";

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
