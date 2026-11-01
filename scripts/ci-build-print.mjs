#!/usr/bin/env node
/**
 * ci-build-print.mjs —— 把一次平台构建的读数**写成给人看的那几行**（ISSUE #2526 切出来的）。
 *
 * ## 为什么单独一份
 *
 * `ci-build-readout.mjs` 原来同时承担两族职责，而两族的变化方向不同：
 *
 *   · **取数**（`fetchBuildStatus` / `fetchStageDetail` / `enrichStageErrors` /
 *     `resolveBuildSn` / `normalizeStageContent`）跟着「问平台的那几条命令」变；
 *   · **念文本**（这一份：`formatOutcome` / `stageLogExcerpt` 与那两份指纹表）跟着
 *     「读的人要回答哪个问题」变 —— #2443 给它加过「锚点优先、夹具噪声降级」那一档，
 *     #2304 给 `formatOutcome` 加过「还在跑要念格子进度」那一档，两次都是同一族在动。
 *
 * 直接原因是一次量的读数：那份 888 行（`check-infra-file-size.cjs` 的 900 硬闸余 12 行），
 * 与 #2189 / #2504 同一出口 —— **拆，按职责拆**，不就近切一段。
 *
 * ## 这一份的性质
 *
 * 零副作用、零 IO：进的是分类结果与日志正文，出的是字符串数组 / 行号清单。
 * 判断本身仍在 `ci-build-classify.mjs`（那份管「哪一格算红 / 被取消」），这里只管**怎么说出来**。
 *
 * ## 留在 readout 里的那一「念」
 *
 * `describeFailedStages()` 没搬过来：它要边取正文边念（多问一次 `get-build-stage`），
 * 搬过来就把这一份变成「也摸 IO」的那一份了。
 *
 * 消费方仍从 `ci-build-readout.mjs` 导入（那一份按既有写法转发），消费口一字不改。
 */
import { downstreamSkipped, progressReadout } from "./ci-build-classify.mjs";

/* 这一族的入参类型都来自分类那一份（`ReturnType<typeof …>` 只在 JSDoc 里用）。 */
/**
 * **判据锚**：测试运行器 / 脚本自己写下的「哪条用例红了、哪一格超时」。
 *
 * 与下面的宽松指纹差的是语义而不是宽窄：锚点行由运行器**为失败而写**，
 * 宽松指纹认的是「这行里出现了 `Error` / `FAIL` 字样」—— 后者在被测代码正常
 * 打日志时也会命中（夹具驱动出来的 `TRPCClientError` 就是这一类）。
 */
const FAILURE_ANCHORS = [
  /^\s*FAIL\b/,
  /\bTest Files\s+\d+\s+failed\b/,
  /\bTests\s+\d+\s+failed\b/,
  /\bTest timed out in \d+(?:\.\d+)?\s*m?s\b/,
  /\bAssertionError\b/,
  /^\s*[×✗]\s/,
  /^\s*Failed Tests\b/,
  /\[ELIFECYCLE\]/,
];

/** 一行像不像「失败证据」。只做**认出**，不解释它为什么失败。 */
const FAILURE_MARKERS = [
  /\bFAIL\b/,
  /\bAssertionError\b/,
  /^\s*[×✗]\s/,
  /^\s*Failed Tests\b/,
  /\bTest Files\s+\d+\s+failed\b/,
  /\bTests\s+\d+\s+failed\b/,
  /\[ELIFECYCLE\]/,
  /\bError:\s/,
];

/**
 * 从那一格的日志里挑出「失败行 + 尾部」两段，行号原样保留。
 *
 * 为什么不是「只给最后 N 行」：vitest 的失败明细与最后的汇总隔着一大段通过用例，
 * 只给尾部会把 `× 缺键时念 …` 那一行切掉；为什么不是「正则取失败行就够」：
 * 失败行**下面**的上下文（期望/实际、退出码、`[affected-launch] …`）才是判断材料。
 * 两段都给，且都带行号 —— 人能拿它直接跳进完整日志，不用再搜一遍。
 *
 * 失败行**分两档**（ISSUE #2443）。日志里一旦有判据锚（`FAIL … > 用例` / 超时），
 * 就只列锚点，其余只带错误字样的行降级成一句计数：清单按行号排，前者的数量决定
 * 「第一眼看到什么」。当场读数（build `cnb-phl-1k5rscpsg`，格「受影响用例」）：
 * 前 12 条是夹具驱动 `recordSyncFailure()` 时产品代码自己打的 `[canvas-sync]` 日志，
 * 接着 8 条 `connect ECONNREFUSED :3000`，而这一跑**唯一**的两条真读数
 * （两份用例各自超时）在 L1003 / L1016 —— 前 25 条全被噪声占满，锚点一条没进清单。
 * 没有锚点时（构建类格子的 `pnpm` 失败、整块没跑起来）保持原来的宽松口径：
 * 那时 `Error:` 那几行就是唯一证据，降级它们等于把「没认出」写成「没有红」。
 *
 * @param {string} text 归一后的日志正文
 * @param {{maxFailureLines?: number, tailLines?: number}} [opts]
 * @returns {{failure: Array<{line: number, text: string}>, tail: Array<{line: number, text: string}>, totalLines: number, demoted: number, anchored: boolean}}
 *   `demoted` 是「含错误字样但没列出来」的行数（`anchored` 为真时它们多数是正常日志）
 */
export function stageLogExcerpt(text, opts = {}) {
  const maxFailureLines = opts.maxFailureLines ?? 25;
  const tailLines = opts.tailLines ?? 40;
  const lines = String(text ?? "").split("\n");
  /** @type {Array<{line: number, text: string}>} */
  const anchors = [];
  /** @type {Array<{line: number, text: string}>} */
  const loose = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line?.trim()) {
      continue;
    }
    if (FAILURE_ANCHORS.some((re) => re.test(line))) {
      anchors.push({ line: i + 1, text: line.trimEnd() });
    } else if (FAILURE_MARKERS.some((re) => re.test(line))) {
      loose.push({ line: i + 1, text: line.trimEnd() });
    }
  }
  const anchored = anchors.length > 0;
  const failure = (anchored ? anchors : loose).slice(0, maxFailureLines);
  const demoted = anchored ? loose.length : Math.max(0, loose.length - failure.length);
  let end = lines.length;
  while (end > 0 && !(lines[end - 1] ?? "").trim()) {
    end -= 1;
  }
  const start = Math.max(0, end - tailLines);
  /** @type {Array<{line: number, text: string}>} */
  const tail = [];
  for (let i = start; i < end; i += 1) {
    const line = lines[i] ?? "";
    if (!line.trim()) {
      continue;
    }
    tail.push({ line: i + 1, text: line.trimEnd() });
  }
  return { failure, tail, totalLines: lines.length, demoted, anchored };
}

/**
 * 把分类结果写成给人看的那几行。
 *
 * @param {ReturnType<typeof import("./ci-build-classify.mjs").classifyBuildOutcome>} outcome
 * @param {{sn?: string, slug?: string, reason?: string | null, prefix?: string, json?: unknown}} [extra]
 *   `json` 是 `get-build-status` 的原值 —— 只有「还在跑」那一支要它（用来念格子进度，
 *   与轮询那行共用 `buildSignature`；不给就少念两行，话术与判定都不变，ISSUE #2304）。
 * @returns {string[]}
 */
export function formatOutcome(outcome, extra = {}) {
  const sn = extra.sn ?? "(未知构建)";
  const slug = extra.slug ?? "";
  const tag = extra.prefix ?? "[build-readout]";
  const lines = [];
  const head = {
    green: "绿（这一跑有结论）",
    failed: "真失败（有格子自己跑挂了，去查产物）",
    cancelled: "被取消（这一跑没有结论，不是产物坏了）",
    running: "没有结论（还在跑）",
    unknown: "没有结论（读数形状不认识，不猜方向）",
  };
  lines.push(`${tag} build ${sn} → 结论：${head[outcome.state]}`);
  for (const p of outcome.pipelines) {
    lines.push(`${tag}   流水线：${p.name || "(无名)"}（status=${p.status || "(无)"}）`);
  }
  /* 「还在跑」那一支以前只念一句「等它跑完再读一次」，而**轮询那行念的是格子进度**
   * （`…/pending/0-1+30/37`）—— 同一个事实两个读者面，看诊断的人只能去翻原始 JSON，
   * 而那层的嵌套读错一次就会把「在推进」念成「一格都没起」（ISSUE #2304 现场就这么错过一次）。
   * 所以这里复用它：签名只有 `buildSignature` 一个算法，进度话术与轮询那行不会分叉。 */
  if (outcome.state === "running" && extra.json) {
    /* 签名**只算一次**：那一行与「在飞」的判定都取自这里，不让同一份 JSON 被数两遍
       （两处遍历一旦漂移，念出来的进度就和轮询那行不是同一个数了）。 */
    const progress = progressReadout(extra.json, sn);
    lines.push(`${tag}   进度（与轮询那行同一份计算）：${progress.signature}`);
    lines.push(
      progress.flyingCount > 0
        ? `${tag}   在飞 ${progress.flyingCount} 格：${progress.flyingNames.slice(0, 3).join("、")} ⇒ 慢不等于停`
        : `${tag}   此刻没有一格在飞（只念事实：既没终态，也没有推进中的格）`,
    );
  }
  for (const s of outcome.failed) {
    lines.push(`${tag}   红的那一格：${s.name || s.id}（${s.id}，status=${s.status}）`);
  }
  for (const s of outcome.cancelled) {
    lines.push(`${tag}   被取消的那一格：${s.name || s.id}（${s.id}，status=${s.status}）`);
  }
  /* 被终止的**原话**必须先于「下一动作」被念出来：这一档的全部价值就是让人不用去翻
   * 完整日志就能回答「是取消还是真红，被谁顶掉的」（ISSUE #2406）。 */
  for (const r of outcome.reasons) {
    const where =
      r.kind === "pipeline-cancel"
        ? `流水线「${r.stage}」被终止`
        : r.kind === "build-cancel"
          ? "构建级状态就是 cancel（逐格没给读数）"
          : `「${r.stage}」被终止`;
    const who = r.sn
      ? ` · 抢走锁的那一跑：${r.sn}`
      : r.holder
        ? ` · 抢走锁的流水线：${r.holder}`
        : "";
    lines.push(`${tag}   ${where}${who}`);
    if (r.reason) {
      lines.push(`${tag}   平台原话：${r.reason}`);
    }
  }
  const skipped = downstreamSkipped(outcome);
  for (const s of skipped) {
    lines.push(`${tag}   下面这些格根本没跑：${s.name || s.id}（${s.id}，status=skipped）`);
  }
  /* `extra.reason` 是 `fetchStageReason()` 单独取回来的那份原话。上面 `reasons` 已经
   * 逐条念过它了 ⇒ 这里只在**上面一条都没念到**时兜底，避免同一句原话念两遍。 */
  if (extra.reason && outcome.reasons.every((r) => r.reason !== extra.reason)) {
    lines.push(`${tag}   平台给的原因：${extra.reason}`);
  }
  if (outcome.state === "failed") {
    lines.push(`${tag}   下一动作：查那一格的日志：https://cnb.cool/${slug}/-/build/logs/${sn}`);
  } else if (outcome.state === "cancelled") {
    lines.push(`${tag}   下一动作：重跑这一格（锁被另一跑顶掉 / 人为终止），不要去查产物。`);
  } else if (outcome.state === "running") {
    lines.push(`${tag}   下一动作：等它跑完再读一次。`);
  }
  return lines;
}
