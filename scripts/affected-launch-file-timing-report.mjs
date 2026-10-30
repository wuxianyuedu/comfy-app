/**
 * `affected-launch-file-timing-report.mjs` —— 「跑了哪些用例」那张清单的**另一半**：
 * 每份用例自己花了多久（ISSUE #2683）。
 *
 * ## 它补的是哪一格
 *
 * `affected-launch-file-list.mjs` 收掉了「一个文件名都没有」那一半（#2683 第一笔），
 * 于是平台那一格读得到 108 行 `· tests/x.test.ts`。但业主的第二问是「跑哪一个耗时多少」
 * —— 而那一屏上**一个时长都没有**：用时其实一直在 junit 里（`junitReportArgs` 让 vitest
 * 写的就是它），只是它躺在账本目录里、随这一跑被删，而读它的那条链（钩子的收尾账）在
 * 平台这一格上没有出口。于是「这一跑跑了哪些」与「那一份多贵」分住在两个读者面。
 *
 * ## 三条口径（与清单那一份同源）
 *
 *   · **只在 quiet 档打**：不 quiet 时默认 reporter 已经逐文件打了行（人自己跑这一档时
 *     就看着它），再打一遍是双份 —— 那一档开它的理由正是「日志预算不够」；
 *   · **封顶 + 超了要念**：顶层 15 份 + 最贵的 5 份 + 其余一份总账。清单那一份已经吃掉
 *     200 行预算，这份再逐份打 108 行就是把它作废第二次；而「省掉的行省了多少」必须
 *     说出口 —— 静默少打与少跑在日志上长得一模一样；
 *   · **取不到读数要说「取不到」，不是「0ms」**：`calibration` 那一档（全量档没有清单 /
 *     账本目录没造出来 / junit 一份都没写出）与「跑得很快」是两件事，混起来的那一屏
 *     会让「这一跑没有读数」长得像「每份都秒过」（§13.6.4.1 同一条口径）。
 *
 * 数值只**转述**不**判定**：这一格不碰退出码、不碰复跑面、也不改任何预算 —— 它买的是
 * 「最贵的那几份是谁」这句人能据以砍线的话。取数不在本文件里做（`parseJunitXml` 只有
 * 一个出处，`precommit-timing.mjs`），本文件只排字。
 */

/** 用了多久以上才值得单独念一行（毫秒）。 */
export const SLOWEST_MS = 1000;

/** 用时超过上面那条的，最多念几份（其余并进总账一行）。 */
export const SLOWEST_SHOWN = 5;

/** 逐份清单最多念几行（超出部分只念条数 —— 与 `MAX_LISTED` 同一动机）。 */
export const TIMED_SHOWN = 15;

/**
 * 毫秒 → 人读时长，与 `affected-launch-rerun-report.mjs` 的 `fmtSec` 同形
 * （同一屏里两种刻度就是「这个数是什么单位」重新变成一个问题）。
 *
 * @param {number} ms
 * @returns {string}
 */
function secs(ms) {
  const value = Number(ms);
  /* 低于 100ms 时 `toFixed(1)` 会打出 `0.0s` —— 那与「没有读数」在这一屏上长得一样，
   * 而 0.0 是**真读数**（很短的用例）。所以那一档给两位小数，「跑得很快」与「没读到」
   * 才不会互相冒充。 */
  return `${(value / 1000).toFixed(value < 100 ? 2 : 1)}s`;
}

/**
 * 这一跑的**逐份用时**读数（quiet 档的收尾那一段）。
 *
 * @param {string[]} files 本次真正交给 vitest 的用例路径（清单顺序）
 * @param {{quiet: boolean, read?: {name: string, ms: number}[], maxTimed?: number,
 *          slowest?: number, maxSlowest?: number}} input
 *   `read` 是 junit 里读回来的逐份用时；**不给或给空数组 = 没拿到读数**，
 *   那一档打「读不到」而不是打一张全 0 的表。
 * @returns {string} 要打到日志里的正文；不 quiet 时是空串
 */
export function fileTimingReport(files, input) {
  if (!input.quiet) {
    return "";
  }
  const timed = Array.isArray(input.read) ? input.read : [];
  const shownMax = pick(input.maxTimed, TIMED_SHOWN);
  const slowestMax = pick(input.maxSlowest, SLOWEST_SHOWN);
  const slowestMs = pick(input.slowest, SLOWEST_MS, true);
  if (timed.length === 0) {
    /* 拿不到与「每份都很快」必须分得开：全量档没有清单、账本目录造不出来、
     * junit 一份都没写 —— 三种形状在这里都是「这一跑没有读数」。 */
    return (
      "[affected-launch] 逐份用时：**读不到**（没有 junit 读数）—— " +
      "不是「每份都很快」\n  读数来自 vitest 的 junit reporter；拿不到它时这一行" +
      "只说这一件，不编数。\n"
    );
  }
  const byName = new Map(timed.map((t) => [t.name, t.ms]));
  /* 清单里读不到用时的那几份要单独点名：「清单 108 份、读回来 107 份」比一张表少一行
   * 重要得多 —— 缺的那一份是**一次都没被计时**（加载即炸 / 被跳过 / reporter 没记上），
   * 而「少打一行」与「少跑一份」在日志上长得一模一样。顺序照清单、不按用时重排：
   * 这一格要回答的是「那 108 份各自多久」，与清单那一屏逐行对得上才读得起来。 */
  const listed = files.filter((f) => byName.has(f));
  const unlisted = files.filter((f) => !byName.has(f));
  const ordered = listed
    .map((name) => ({ name, ms: byName.get(name) ?? 0 }))
    .sort((a, b) => b.ms - a.ms);
  const head = ordered.slice(0, shownMax);
  const rest = ordered.slice(head.length).length;
  const restMs = ordered.slice(head.length).reduce((sum, e) => sum + e.ms, 0);
  const slow = ordered.slice(0, slowestMax).filter((e) => e.ms >= slowestMs);
  const total = ordered.reduce((sum, e) => sum + e.ms, 0);
  const lines = [
    `[affected-launch] 逐份用时：读回 ${ordered.length} 份（junit）；` +
      `合计 ${secs(total)} 是各份相加、**不是墙钟**（并发下这几份在同时跑）\n`,
  ];
  if (slow.length > 0) {
    lines.push(
      "  最慢：\n" + slow.map((e) => `    ${secs(e.ms).padStart(7)}  ${e.name}\n`).join(""),
    );
  }
  lines.push(
    `  用时前 ${head.length} 份（降序）：\n` +
      head.map((e) => `    ${secs(e.ms).padStart(7)}  ${e.name}\n`).join(""),
  );
  if (rest > 0) {
    lines.push(
      `  ……其余 ${rest} 份合计 ${secs(restMs)}（逐份省了 ${rest} 行日志预算；` +
        "要完整表就本地跑\n    `node scripts/run-affected-tests.mjs --full`，" +
        "或看不 quiet 档的默认 reporter）\n",
    );
  }
  if (unlisted.length > 0) {
    lines.push(
      `  ⚠ ${unlisted.length} 份**没有用时读数**（进了清单但 junit 里没有它 —— ` +
        "加载即炸 / 被跳过 / reporter 没记上）：\n" +
        unlisted
          .slice(0, shownMax)
          .map((f) => `    · ${f}\n`)
          .join("") +
        (unlisted.length > shownMax ? `    ……另有 ${unlisted.length - shownMax} 份未列出\n` : "") +
        "    这一档拿不到它们的代价，别读成「它们很快」。\n",
    );
  }
  return lines.join("");
}

/**
 * 正数才认，否则落回缺省值（调用点给小的值就能钉住截断那一档，用例就是这么钉的）。
 *
 * @param {number | undefined} raw
 * @param {number} fallback
 * @param {boolean} [allowZero]
 * @returns {number}
 */
function pick(raw, fallback, allowZero = false) {
  if (typeof raw !== "number" || !Number.isInteger(raw)) {
    return fallback;
  }
  if (raw < 0 || (raw === 0 && !allowZero)) {
    return fallback;
  }
  return raw;
}
