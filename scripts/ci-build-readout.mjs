#!/usr/bin/env node
/**
 * ci-build-readout.mjs — 把一次平台构建的读数分成「绿 / 真失败 / 被取消」三档
 * （ISSUE #2158 第 2 条；规范 §13.5.27）。
 *
 * ## 为什么要有这一件（这一格答的是哪个问题）
 *
 * 平台的看板只给一列状态，而那一列把两件**完全不同**的事写成同一个字：
 *
 *   · 「某一格自己跑挂了」⇒ 该去查产物、查代码、查环境；
 *   · 「这一跑被人为终止 / 被同一把锁上的另一跑顶掉了」⇒ 产物一个字都没坏，
 *     下一动作是**重跑这一格**，不是去查产物。
 *
 * 现场读数（2026-10-22，`cnb-lm1-1k5h1otqt`）：`单跑生产构建（API 触发）` 的第二格
 * `单跑构建·同步数据库表结构` 状态是 `cancel`，第三格 `单跑构建·生产构建` 状态是
 * `skipped`（**0 秒，没跑**），而整条流水线的状态是 `error`。看板上它与「生产构建
 * 真的失败了」长得一样 —— 于是「去查产物」这件正确的事，被一件**根本没发生**的事
 * 带着跑了。那天的三条 `api_trigger_build` 里，两条是「体积拒涨」、一条是这条；
 * 混在一起读，就会把「被取消」当成「构建坏了」。
 *
 * ## 为什么改不了平台语义（这一条决定了出口只能是「读数」）
 *
 * 被取消的那一跑**整条流水线**都被终止了，下游格是 `skipped` 而不是「没跑成」——
 * 平台不会替下游格补跑一遍。于是 `.cnb.yml` 侧任何改法（加条件、调顺序、拆流水线）
 * 都改不了这件事：**被取消之后，那一跑就没有后续了**。
 *
 * 所以仓库能做的只有一件：把「被取消」从「失败」里**分出来**，并点名
 * 「哪一格被取消、下面哪几格根本没跑、平台给的原因原话是什么」。
 *
 * ## 它答什么 / 不答什么
 *
 * 答：这一跑的结论是哪一档；被取消时是哪一格、下面哪几格没跑；平台给的原因原话。
 * 不答：产物有没有问题（那一格真红了才知道）、该不该重跑（那件事在人）。
 *
 * ## 三档与退出码
 *
 * | 档         | 判据                                            | 退出码 | 下一动作             |
 * | ---------- | ----------------------------------------------- | ------ | -------------------- |
 * | 绿         | 没有红格、没有取消格，构建级状态是 `success`    | 0      | 用它                 |
 * | 真失败     | 有格子 `error` / `failed`                        | 1      | 去查产物与那一格     |
 * | 被取消     | 有格子 `cancel` / `cancelled`（或流水线级取消）  | 2      | 重跑这一格           |
 * | 没有结论   | 还在跑 / 读数形状不认识                          | 2      | 等一等再看           |
 *
 * 退出码三态与 `ship-core.mjs` 的 `CODE` 同一口径：**0 绿、1 有事实是红的、2 没拿到
 * 测量**。「被取消」落在 2 那一档而不是 1：那一跑**没有结论**，说它「红」就是替
 * 平台编了一个不存在的产物问题。
 *
 * ## 判据的顺序（有理由，不是随手排的）
 *
 * ① 任何一格**真失败** ⇒ 「真失败」—— 真红的那格永远是最该被看见的那一件，
 *    即便同一跑里还有别的格被取消；
 * ② 否则任何一格**被取消** ⇒ 「被取消」—— 这一跑没跑完，产物没被验证过；
 * ③ 否则看构建级状态 —— 这是**兜底**，只在没有逐格读数时用（老构建、形状变了）。
 *
 * ⚠️ 「逐格读数」只在 `get-build-status` 的 `data.pipelinesStatus[*].stages[]` 里
 * 才有，而它**是有的**（实测三份构建的 JSON 形状一致）。但它也可能缺席 ——
 * 缺席时**不许**把「取不到逐格读数」当成「没出问题」，那正是「取不到 ⇒ 未知」
 * 这条纪律（§13.6.4.1）。
 *
 * ## 这一份负责什么（判断在隔壁）
 *
 * **判断**（三档分类、取消原因）全在 `ci-build-classify.mjs`；这一份负责**取数**与
 * **念给人看**：拉平台 JSON、把 `get-build-stage` 的原话补进逐格读数
 * （`enrichStageErrors()`，ISSUE #2406 的关键一跳）、把结论写成那几行、以及那个 CLI。
 * 分开的原因是 `check-infra-file-size.cjs` 的 900 行硬闸 —— 那一闸说的是「出口只有拆」，
 * 而拆法按职责：判断跟着「平台 JSON 的形状」变，取数跟着「问平台的那几条命令」变。
 *
 * ## 用法
 *
 *   node scripts/ci-build-readout.mjs --repo moon-read/comfy-app-t3 --sn cnb-lm1-1k5h1otqt
 *   node scripts/ci-build-readout.mjs --repo moon-read/comfy-app-t3 --event api_trigger_build
 *   node scripts/ci-build-readout.mjs --repo moon-read/comfy-app-t3 --event api_trigger_build --limit 5
 *
 * `--repo` 缺省时从 git 远端推（单一远端用它；多个远端优先 `origin`；推不出就要
 * `--repo`，**不猜**一个仓库名 —— 猜错的代价是把读数挂到别的仓库上）。
 */
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { asArray, buildSignature } from "./ship-build.mjs";
import { parseSlug } from "./ship-core.mjs";
import { cnbJson, makeRunner } from "./ship-exec.mjs";
/* 时长档位用 `~/lib/time-format` 那一份定义（与 ComfyUI 退出记录同一件事）。
   本文件此前把平台的 `duration` 字段**当秒**印（`${duration}s`），而它是毫秒 ——
   一次 15m30s 的格子被念成 `930916s`（≈ 10.7 天，ISSUE #2442）。同仓另一个消费者
   一直按毫秒用它：`scripts/ci-probe-lock-readout.mjs` 的 `create + durationMs`。 */
import { formatDurationMs } from "../src/lib/time-format.ts";
import {
  CODE,
  cancelledCause,
  classifyBuildOutcome,
  classifyStages,
  downstreamSkipped,
  inFlightStages,
  pipelineSn,
} from "./ci-build-classify.mjs";

/* 判断全在 `ci-build-classify.mjs`，这里只是**转发**给既有调用点（`ship-poll` /
 * `ship-diagnose` / 两个失败立案脚本 / 独立 CLI 都按这一份导入）。转发而不是让各处改
 * import：拆文件是「压回 900 行硬闸」这一件事的代价，不该让五个消费口各改一行去承担
 * —— 那五处会开始漂。 */
export {
  CODE,
  cancelledCause,
  classifyBuildOutcome,
  classifyStages,
  downstreamSkipped,
  inFlightStages,
  pipelineSn,
};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 把那一格的日志正文归一成一段文本。
 *
 * 平台在不同版本里给过三种形状，这里**一处收口**：`content: string` /
 * `content: string[]`（逐行，实测是本仓现在这一形）/ 带 ANSI 转义的控制序列。
 * 不归一的后果不是「显示难看」：`content` 是行数组时按字符串读会得到
 * `"a,b,c"`，行号与 `FAIL` 匹配全部失效，于是「摘要空着」被读成「日志里没有失败行」。
 *
 * @param {unknown} content `get-build-stage` 的 `data.content`
 * @returns {string}
 */
export function normalizeStageContent(content) {
  const raw = Array.isArray(content)
    ? content
        .map((x) => (typeof x === "string" ? x : x == null ? "" : String(x)))
        .join("\n")
    : typeof content === "string"
      ? content
      : "";
  return raw.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "").replace(/\r\n?/g, "\n");
}

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
    if (!line || !line.trim()) continue;
    if (FAILURE_ANCHORS.some((re) => re.test(line))) {
      anchors.push({ line: i + 1, text: line.trimEnd() });
    } else if (FAILURE_MARKERS.some((re) => re.test(line))) {
      loose.push({ line: i + 1, text: line.trimEnd() });
    }
  }
  const anchored = anchors.length > 0;
  const failure = (anchored ? anchors : loose).slice(0, maxFailureLines);
  const demoted = anchored
    ? loose.length
    : Math.max(0, loose.length - failure.length);
  let end = lines.length;
  while (end > 0 && !(lines[end - 1] ?? "").trim()) end -= 1;
  const start = Math.max(0, end - tailLines);
  /** @type {Array<{line: number, text: string}>} */
  const tail = [];
  for (let i = start; i < end; i += 1) {
    const line = lines[i] ?? "";
    if (!line.trim()) continue;
    tail.push({ line: i + 1, text: line.trimEnd() });
  }
  return { failure, tail, totalLines: lines.length, demoted, anchored };
}

/**
 * 某一格的详情（状态 / 耗时 / 平台给的原因 / 日志正文）。
 *
 * `get-build-stage` 此前只被 `fetchStageReason()` 用来读 `error` —— 而 `content`
 * 才是「红在哪一行」的唯一来源（ISSUE #2217）。这里把它一次取全，两个消费者共用。
 *
 * @param {(cmd: string, args: string[]) => import("./ship-exec.mjs").ExecResult} run 执行者
 * @param {string} slug 仓库路径
 * @param {string} sn 构建号
 * @param {string} pipelineId 流水线 id
 * @param {string} stageId 格 id
 * @returns {{status: string, duration: number | null, error: string, text: string} | null}
 */
export function fetchStageDetail(run, slug, sn, pipelineId, stageId) {
  const res = cnbJson(run, [
    "build",
    "get-build-stage",
    "--repo",
    slug,
    "--sn",
    sn,
    "--pipelineId",
    pipelineId,
    "--stageId",
    stageId,
    "-v",
  ]);
  const d =
    res && res.json && typeof res.json === "object" ? res.json.data : null;
  if (!d || typeof d !== "object") return null;
  return {
    status: typeof d.status === "string" ? d.status : "",
    duration: Number.isFinite(d.duration) ? Number(d.duration) : null,
    error: typeof d.error === "string" ? d.error.trim() : "",
    text: normalizeStageContent(d.content),
  };
}

/**
 * 把每一格的**平台原话**填进 `get-build-status` 那份读数（ISSUE #2406）。
 *
 * 为什么必须有这一步：`get-build-status -v` 的 `stages[]` **没有 `error` 这一栏**
 * （实测 `cnb-9qi-1k5qojle1` 的 `prepare` 只有 `status/duration/name/id`），
 * 而「被抢锁」与「真失败」的唯一分界线就在那句话上 —— 同一格用 `get-build-stage -v`
 * 取回来才带 `error`。所以「这一跑是被取消还是真红」这个问题的答案，**不可能**只靠
 * 构建级那次调用拿到。
 *
 * 取哪几格：**非 success / skipped 的那几格**（绿的那几格原话没有意义，多问一次就是白花
 * 一次请求），上限 `MAX_DETAIL_STAGES` 格。取不到的那格就留空串 —— **空不等于「没有异常」**，
 * 分类会照 `status` 判，只是念不出原话（这一点写进 `formatOutcome` 的那一行里）。
 *
 * 返回**新的对象**（不改入参）：调用方可能还要拿原值去比对，就地改会让「读到的」与
 * 「被改过的」分不开，而这一族判据的全部价值就在「只读平台原值」。
 *
 * @param {(cmd: string, args: string[]) => import("./ship-exec.mjs").ExecResult} run 执行者
 * @param {string} slug 仓库路径
 * @param {string} sn 构建号
 * @param {any} json `get-build-status -v` 的原值
 * @returns {any} 填过原话的那一份（形状不变，只多 `stages[].error`）
 */
export function enrichStageErrors(run, slug, sn, json) {
  const data = json && typeof json === "object" ? json.data : null;
  const table =
    data && data.pipelinesStatus && typeof data.pipelinesStatus === "object"
      ? data.pipelinesStatus
      : null;
  if (!table) return json;
  let asked = 0;
  /** @type {Record<string, any>} */
  const pipelinesStatus = {};
  for (const key of Object.keys(table)) {
    const p = table[key];
    if (!p || typeof p !== "object" || !Array.isArray(p.stages)) {
      pipelinesStatus[key] = p;
      continue;
    }
    const stages = p.stages.map((/** @type {any} */ st) => {
      if (!st || typeof st !== "object") return st;
      const status =
        typeof st.status === "string" ? st.status.toLowerCase() : "";
      if (status === "success" || status === "skipped") return st;
      if (asked >= MAX_DETAIL_STAGES) return st;
      asked += 1;
      const detail = fetchStageDetail(
        run,
        slug,
        sn,
        String(p.id ?? key),
        String(st.id ?? ""),
      );
      if (!detail || detail.error === "") return st;
      return { ...st, error: detail.error };
    });
    pipelinesStatus[key] = { ...p, stages };
  }
  return { ...json, data: { ...data, pipelinesStatus } };
}

/**
 * 某一格在哪条流水线里（同一跑里格 id 在流水线内唯一）。
 *
 * @param {ReturnType<typeof classifyBuildOutcome>} outcome
 * @param {string} stageId
 * @returns {ReturnType<typeof classifyBuildOutcome>["pipelines"][number] | null}
 */
export function pipelineForStage(outcome, stageId) {
  return (
    outcome.pipelines.find((p) =>
      [...p.configured, ...p.failed, ...p.cancelled, ...p.skipped].some(
        (s) => s.id === stageId,
      ),
    ) || null
  );
}

/** 一次最多展开几格失败日志（再多就该直接看完整日志了）。 */
export const MAX_DETAIL_STAGES = 3;

/**
 * 把失败格的日志摘要写出来：格头 + 失败行（带行号）+ 尾部 + 完整日志链接。
 *
 * 这里是**唯一一份**实现：`ci-build-readout` 自己的入口与 `pnpm ship --diagnose`
 * 都走它 —— 两份各写一遍的后果，是同一次红在两条命令里给出不一样的行号/摘要。
 *
 * @param {(cmd: string, args: string[]) => import("./ship-exec.mjs").ExecResult} run 执行者
 * @param {object} deps
 * @param {string} deps.slug 仓库路径
 * @param {string} deps.sn 构建号
 * @param {ReturnType<typeof classifyBuildOutcome>} deps.outcome 分类结果
 * @param {(line: string) => void} [deps.log] 输出通道
 * @param {string} [deps.prefix] 每行前缀
 * @returns {number} 真正取到日志正文的格数（取不到不算「没有失败行」）
 */
export function describeFailedStages(
  run,
  { slug, sn, outcome, log = console.log, prefix = "[build-readout]" },
) {
  let detailed = 0;
  const shown = outcome.failed.slice(0, MAX_DETAIL_STAGES);
  for (const s of shown) {
    const pipeline = pipelineForStage(outcome, s.id);
    if (!pipeline) {
      log(
        `${prefix}   失败格：${s.name || s.id}（${s.id}）不在任何一条流水线的读数里 ⇒ 取不到日志。`,
      );
      continue;
    }
    const detail = fetchStageDetail(run, slug, sn, pipeline.id, s.id);
    const status = (detail && detail.status) || s.status;
    const duration =
      detail && detail.duration !== null
        ? ` · ${formatDurationMs(detail.duration) ?? "未知"}`
        : "";
    log(
      `${prefix}   ── 失败格：${s.name || s.id}（${s.id} · ${pipeline.name || pipeline.id} · status=${status}${duration}）`,
    );
    if (!detail) {
      log(
        `${prefix}      取不到这一格的日志正文 ⇒ 没有结论（不是「日志里没有失败行」）。`,
      );
      continue;
    }
    detailed += 1;
    if (detail.error) log(`${prefix}      平台给的原因：${detail.error}`);
    const excerpt = stageLogExcerpt(detail.text);
    if (excerpt.failure.length === 0) {
      log(
        `${prefix}      没认出失败行（正文共 ${excerpt.totalLines} 行）—— 看下面的尾部与完整日志。`,
      );
    } else {
      log(`${prefix}      失败行（行号即完整日志的行号）：`);
      for (const l of excerpt.failure)
        log(`${prefix}      L${l.line} ${l.text}`);
    }
    if (excerpt.demoted > 0) {
      const why = excerpt.anchored
        ? "（有 FAIL / 超时锚点时只列锚点，那批多是夹具驱动的正常日志）"
        : "";
      log(
        `${prefix}      另有 ${excerpt.demoted} 行含错误形状文本，未列出${why} —— 完整日志见下一动作那行链接。`,
      );
    }
    log(`${prefix}      末 ${excerpt.tail.length} 行：`);
    for (const l of excerpt.tail) log(`${prefix}      L${l.line} ${l.text}`);
  }
  if (outcome.failed.length > shown.length) {
    log(
      `${prefix}   另有 ${outcome.failed.length - shown.length} 格也红了，此处没展开；完整日志：https://cnb.cool/${slug}/-/build/logs/${sn}`,
    );
  }
  return detailed;
}

/**
 * 「还在跑」那一支的进度读数（ISSUE #2304）：签名 + 在飞格，一次遍历同时给出。
 *
 * 为什么要有这一件：诊断与轮询此前是**两个读者面**——轮询那行带 `…/pending/0-1+30/37`，
 * 而 `--diagnose` 只念「还在跑，等它跑完再读一次」；看诊断的人只能去翻原始 JSON，
 * 而那层嵌套（`data.pipelinesStatus.<sn>-001.stages[]`）读错一次就会把「在推进」念成
 * 「一格都没起」。签名本身仍只有 `ship-build.mjs` 一个算法，这里不另数一遍计数。
 *
 * @param {unknown} json `get-build-status` 的原值
 * @param {string} [sn] 构建号（进签名的第一段）
 * @returns {{signature: string, flyingCount: number, flyingNames: string[]}}
 */
export function progressReadout(json, sn = "") {
  const flying = inFlightStages(json);
  return {
    signature: buildSignature(json, sn),
    flyingCount: flying.count,
    flyingNames: flying.names,
  };
}

/**
 * 把分类结果写成给人看的那几行。
 *
 * @param {ReturnType<typeof classifyBuildOutcome>} outcome
 * @param {{sn?: string, slug?: string, reason?: string | null, prefix?: string, json?: unknown}} [extra]
 *   `json` 是 `get-build-status` 的原值 —— 只有「还在跑」那一支要它（用来念格子进度，
 *   与轮询那行共用 `buildSignature`；不给就少念两行，话术与判定都不变，ISSUE #2304）。
 * @returns {string[]}
 */
export function formatOutcome(outcome, extra = {}) {
  const sn = extra.sn || "(未知构建)";
  const slug = extra.slug || "";
  const tag = extra.prefix || "[build-readout]";
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
    lines.push(
      `${tag}   流水线：${p.name || "(无名)"}（status=${p.status || "(无)"}）`,
    );
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
    lines.push(
      `${tag}   红的那一格：${s.name || s.id}（${s.id}，status=${s.status}）`,
    );
  }
  for (const s of outcome.cancelled) {
    lines.push(
      `${tag}   被取消的那一格：${s.name || s.id}（${s.id}，status=${s.status}）`,
    );
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
    if (r.reason) lines.push(`${tag}   平台原话：${r.reason}`);
  }
  const skipped = downstreamSkipped(outcome);
  for (const s of skipped) {
    lines.push(
      `${tag}   下面这些格根本没跑：${s.name || s.id}（${s.id}，status=skipped）`,
    );
  }
  /* `extra.reason` 是 `fetchStageReason()` 单独取回来的那份原话。上面 `reasons` 已经
   * 逐条念过它了 ⇒ 这里只在**上面一条都没念到**时兜底，避免同一句原话念两遍。 */
  if (extra.reason && outcome.reasons.every((r) => r.reason !== extra.reason)) {
    lines.push(`${tag}   平台给的原因：${extra.reason}`);
  }
  if (outcome.state === "failed") {
    lines.push(
      `${tag}   下一动作：查那一格的日志：https://cnb.cool/${slug}/-/build/logs/${sn}`,
    );
  } else if (outcome.state === "cancelled") {
    lines.push(
      `${tag}   下一动作：重跑这一格（锁被另一跑顶掉 / 人为终止），不要去查产物。`,
    );
  } else if (outcome.state === "running") {
    lines.push(`${tag}   下一动作：等它跑完再读一次。`);
  }
  return lines;
}

/**
 * 一次构建的逐格状态。
 *
 * @param {(cmd: string, args: string[]) => import("./ship-exec.mjs").ExecResult} run 执行者
 * @param {string} slug 仓库路径（`组织/仓库`）
 * @param {string} sn 构建号
 * @returns {any | null} 平台 JSON；取不到时 null
 */
export function fetchBuildStatus(run, slug, sn) {
  const res = cnbJson(run, [
    "build",
    "get-build-status",
    "--repo",
    slug,
    "--sn",
    sn,
    "-v",
  ]);
  return res ? res.json : null;
}

/**
 * 最近几跑（按事件）。
 *
 * @param {(cmd: string, args: string[]) => import("./ship-exec.mjs").ExecResult} run 执行者
 * @param {string} slug 仓库路径
 * @param {string} event 事件名
 * @param {number} limit 要几条
 * @param {{log?: (line: string) => void}} [opts] 取不到时念一行**原因**（只读，不改结论）
 * @returns {Array<{sn: string, createTime: string, status: string, eventUrl: string}> | null}
 *   列表；取不到时 null
 */
export function fetchBuildList(run, slug, event, limit, opts = {}) {
  const res = cnbJson(run, [
    "build",
    "get-build-logs",
    "--repo",
    slug,
    "--event",
    event,
    "--page-size",
    String(limit),
    "-v",
  ]);
  /* 平台在这条命令上有两种信封，实测都出现过：列表直挂 `data`（`{data:[…]}`）与套一层
   * （`{data:{total,totalCapped,data:[…]}}`）。只认前者会回 `null`，而调用方读到的是
   * 一句「取不到构建列表」—— 一次**看起来像网络故障**的空读数；而 PR 档那一格正是靠
   * 这份列表认出「这一跑是谁」的，认不出 ⇒ 一律不写 ⇒ 那一格绿着、红没人知道
   * （ISSUE #2335 的 `cnb-vko-1k5oj5gb0`）。第二种形状与 `check-daily-attendance.mjs`
   * 的 `asBuildArray()` 同一口径 —— 那一份是每日档自己发的同形命令留下的读数。 */
  const list = res ? (asArray(res.json) ?? asArray(res.json?.data)) : null;
  if (!list) {
    /* 「取不到」必须自己说清是哪一种取不到（ISSUE #2335 现场：这一格只留下
     * `取不到构建列表` 六个字，而排障时根本分不出是命令没起来、退码非零（凭据 /
     * 权限）、还是信封又变了 —— 三种的下一个动作完全不同）。读到一行 stderr 的
     * 代价远小于一次现场重跑。**只读、不判**：结论仍由调用方按「没有结论」处理。 */
    if (opts.log) {
      /* 信封的**内容**也要念：实测 runner 上拿到的是
       * `{status:200, …, data:{code:401, message:"…"}}` —— 顶层键与本地完全一样
       * （`status,trace,header,contentType,data`），只念顶层键等于什么都没说。
       * 截断到 160 字：够看清 `code` / `message`，又不至于把一整份 JSON 倒进流水线。 */
      const shape = res
        ? (() => {
            const d = res.json?.data;
            const inner = Array.isArray(d)
              ? "data 是数组但没有 sn 字段"
              : `data=${JSON.stringify(d ?? null).slice(0, 160)}`;
            return ` · ${inner}`;
          })()
        : "";
      const why = !res
        ? "命令没起来或输出不是 JSON（`cnb` 不可用 / 非 JSON 输出）"
        : `退码 ${res.code}${res.stderr.trim() ? ` · stderr: ${res.stderr.trim().split("\n")[0]}` : ""}` +
          ` · 信封里认不出列表${shape}`;
      opts.log(`[build-readout] 构建列表取不到：${why}`);
    }
    return null;
  }
  const builds = list
    .filter((b) => b && typeof b.sn === "string")
    /* `status` 与 `eventUrl` 是**列表自带字段的原样透出**（不另立判据）：调用方拿它们
     * 决定「要不要去取逐格详情」（在跑 / 排队的那几跑先不取），以及把红挂回出问题的那张
     * PR 上 —— 这两个字段只有列表这一侧有（`get-build-status -v` 只给 `status` +
     * `pipelinesStatus`，说不出自己是哪一跑，见 `fetchDailyDetails` 那段）。 */
    .map((b) => ({
      sn: String(b.sn),
      createTime: String(b.createTime ?? ""),
      status: String(b.status ?? ""),
      eventUrl: String(b.eventUrl ?? ""),
    }));
  builds.sort((a, b) => b.createTime.localeCompare(a.createTime));
  return builds.slice(0, limit);
}

/**
 * 被取消那一格的详情 —— 平台自己给的原因原话。
 *
 * @param {(cmd: string, args: string[]) => import("./ship-exec.mjs").ExecResult} run 执行者
 * @param {string} slug 仓库路径
 * @param {string} sn 构建号
 * @param {string} pipelineId 流水线 id
 * @param {string} stageId 格 id
 * @returns {string | null} 原因原文；取不到时 null
 *
 * ⚠️ 走 `enrichStageErrors()` 补过原话之后，`outcome.reasons` 里已经有这句话了
 * （ISSUE #2406）——调用方应当先用 `reasons`，这里只是「那一格没被分类覆盖到」时的
 * 补充入口（它多问一次平台，别当成常规路径）。
 */
export function fetchStageReason(run, slug, sn, pipelineId, stageId) {
  const detail = fetchStageDetail(run, slug, sn, pipelineId, stageId);
  return detail && detail.error !== "" ? detail.error : null;
}

/**
 * 从 git 远端推仓库路径（`组织/仓库`）。
 *
 * ⚠️ **不猜**：远端多于一个且没有 `origin` 时回 null，由调用方要 `--repo`。
 * 猜错的代价是把读数挂到别的仓库上 —— 那比「没读到」坏得多。
 *
 * @param {(cmd: string, args: string[]) => import("./ship-exec.mjs").ExecResult} run 执行者
 * @returns {string | null}
 */
export function resolveRepoSlug(run) {
  const listed = run("git", ["remote"]);
  const remotes = (listed.stdout || "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  if (remotes.length === 0) return null;
  const picked =
    remotes.length === 1
      ? remotes[0]
      : remotes.includes("origin")
        ? "origin"
        : null;
  if (!picked) return null;
  const url = run("git", ["remote", "get-url", picked]);
  return parseSlug(url.stdout || "");
}

/**
 * 解析命令行。
 *
 * @param {string[]} argv
 * @returns {{repo: string | null, sn: string | null, event: string, limit: number, help: boolean, error: string | null}}
 */
export function parseArgs(argv) {
  /** @type {{repo: string | null, sn: string | null, event: string, limit: number, help: boolean, error: string | null}} */
  const out = {
    repo: null,
    sn: null,
    event: "api_trigger_build",
    limit: 3,
    help: false,
    error: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[i + 1];
    if (arg === "--help" || arg === "-h") {
      out.help = true;
      continue;
    }
    if (arg === "--repo" || arg === "--sn" || arg === "--event") {
      const value = next();
      if (value === undefined || value.startsWith("--")) {
        out.error = `${arg} 后面要跟一个值`;
        return out;
      }
      i += 1;
      if (arg === "--repo") out.repo = value;
      else if (arg === "--sn") out.sn = value;
      else out.event = value;
      continue;
    }
    if (arg === "--limit") {
      const value = next();
      const n = Number(value);
      if (value === undefined || !Number.isInteger(n) || n < 1) {
        out.error = "--limit 后面要跟一个 ≥1 的整数";
        return out;
      }
      i += 1;
      out.limit = n;
      continue;
    }
    out.error = `认不出的参数：${arg}`;
    return out;
  }
  return out;
}

/** 用法正文。 */
export function usage() {
  return [
    "用法：",
    "  node scripts/ci-build-readout.mjs --repo <组织/仓库> [--sn <构建号>]",
    "  node scripts/ci-build-readout.mjs --repo <组织/仓库> --event <事件名> [--limit <条数>]",
    "",
    "  --repo    仓库路径；缺省时从 git 远端推（推不出就要显式给）",
    "  --sn      只读这一跑",
    "  --event   按事件取最近几跑（缺省 api_trigger_build，即「单跑生产构建（API 触发）」）",
    "  --limit   取几条（缺省 3）",
    "",
    "  退出码：0 = 绿；1 = 有格子真红了；2 = 没有结论（被取消 / 还在跑 / 读不出来）",
  ].join("\n");
}

/**
 * 入口。
 *
 * @param {object} [deps] 依赖（三个都可不给，缺省各取本机那一份）
 * @param {string[]} [deps.argv] 命令行参数
 * @param {(cmd: string, args: string[]) => import("./ship-exec.mjs").ExecResult} [deps.run] 外部命令执行者
 * @param {(line: string) => void} [deps.log] 输出通道
 * @returns {number} 三态退出码之一
 */
export function main({
  argv = process.argv.slice(2),
  run = makeRunner(ROOT),
  log = console.log,
} = {}) {
  const parsed = parseArgs(argv);
  if (parsed.help) {
    log(usage());
    return CODE.GREEN;
  }
  if (parsed.error) {
    log(`[build-readout] ${parsed.error}`);
    log(usage());
    return CODE.NOT_RUN;
  }
  const slug = parsed.repo || resolveRepoSlug(run);
  if (!slug) {
    log(
      "[build-readout] 取不到仓库路径（远端多于一个且没有 origin）⇒ 给 --repo <组织/仓库>。",
    );
    return CODE.NOT_RUN;
  }
  /** @type {string[]} */
  let sns = [];
  if (parsed.sn) {
    sns = [parsed.sn];
  } else {
    const builds = fetchBuildList(run, slug, parsed.event, parsed.limit);
    if (!builds) {
      log(
        "[build-readout] 取不到 build 列表 ⇒ 没跑起来，不当成「绿」也不当成「红」。",
      );
      return CODE.NOT_RUN;
    }
    sns = builds.map((b) => b.sn);
    if (sns.length === 0) {
      log(`[build-readout] 事件 ${parsed.event} 下一条构建也没有 ⇒ 没跑起来。`);
      return CODE.NOT_RUN;
    }
  }
  let worst = CODE.GREEN;
  for (const sn of sns) {
    const rawStatus = fetchBuildStatus(run, slug, sn);
    if (!rawStatus) {
      log(`[build-readout] build ${sn} ⇒ 取不到状态 ⇒ 没有结论。`);
      worst = CODE.NOT_RUN;
      continue;
    }
    /* 分类之前先补原话：`get-build-status` 的 `stages[]` 没有 `error` 这一栏，
     * 而「被顶掉」与「真失败」的分界就在那句话上（ISSUE #2406）。 */
    const statusJson = enrichStageErrors(run, slug, sn, rawStatus);
    const outcome = classifyBuildOutcome(statusJson);
    /** @type {string | null} */
    let reason = outcome.reasons.find((r) => r.reason)?.reason ?? null;
    if (!reason && outcome.state === "cancelled") {
      const first = outcome.cancelled[0];
      const pipeline = first ? pipelineForStage(outcome, first.id) : null;
      if (first && pipeline) {
        reason = fetchStageReason(run, slug, sn, pipeline.id, first.id);
      }
    }
    for (const line of formatOutcome(outcome, { sn, slug, reason })) {
      log(line);
    }
    if (outcome.state === "failed") {
      describeFailedStages(run, { slug, sn, outcome, log });
      worst = CODE.RED;
    } else if (outcome.state !== "green" && worst !== CODE.RED)
      worst = CODE.NOT_RUN;
  }
  return worst;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  process.exit(main());
}
