/**
 * `ci-bundle-escalation-core.mjs` —— 「预算账陈旧度触发器」的**纯判定层**（ISSUE #2639）。
 *
 * 为什么单独一份：每日失败立案在 GA 迁移之后有两个执行者（CNB 侧的
 * `ci-daily-bundle-escalation.mjs` 与 GA 侧的 `ci-ga-daily-bundle-escalation.mjs`），
 * 而这一族（判决行解析 / 门限 / 正文拼装）两边逐字相同。GA 那条链运行在
 * **不装依赖**的 job 里（`fetch-depth: 1`，整条 import 链只吃 `node:*`），所以这一层
 * 除了本仓自己也不许有 local import —— 任何人往这里加一个本仓模块，GA 那格失败立案就
 * 会在 import 期崩掉（`continue-on-error: true` 吞掉后「红了却没单」，正是 #3563 那一形）。
 *
 * 三条边界（与两条取数链同口径）：
 *   · 只认判据自己打的判决行（`BUNDLE_GATE_MARKERS`），不重算金额 —— 重算就是第二个量具；
 *   · 撤档期间不响（#2634：判据照打差额、但明说「今天没判」，那种读数**不是红**）；
 *   · 读不出 ≠ 没到门限（§13.6.4.1）：取不到 / 认不出 / 窗口没盖住，一律不升并念出是哪一档。
 */

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
