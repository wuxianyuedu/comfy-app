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

import { asArray, parseSlug } from "./ship-core.mjs";
import { cnbJson, makeRunner } from "./ship-exec.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** 退出码三态（与 `ship-core.mjs` 的 `CODE` 同一口径）。 */
export const CODE = { GREEN: 0, RED: 1, NOT_RUN: 2 };

/** 「真失败」族：某一格自己跑挂了（产物 / 代码 / 环境的问题）。 */
const FAILED_STATES = new Set(["error", "failed", "failure"]);

/** 「被取消」族：这一格没跑完，原因在人或同一把锁上的另一跑，不在产物。 */
const CANCELLED_STATES = new Set(["cancel", "cancelled", "canceled"]);

/** 「还在跑」族。 */
const RUNNING_STATES = new Set([
  "running",
  "pending",
  "queued",
  "waiting",
  "created",
]);

/**
 * 平台自己那几格（`Prepare` / `End` / `DebugDetection` / `BeforeEnd`）**不是**本仓
 * 配置的格 —— 念它们只会把读数变成噪声。这里按 id 形状认出「本仓配置的那几格」。
 */
const CONFIGURED_STAGE_ID = /^stage-\d+$/;

/**
 * 一格的读数。
 *
 * @typedef {Object} StageRef
 * @property {string} id 平台给的格 id（`stage-1` 那种）
 * @property {string} name 格名（中文那一句）
 * @property {string} status 格状态（小写）
 * @property {number} index 它在平台给的那份列表里的序号（执行顺序）
 */

/**
 * 逐格分类。
 *
 * ⚠️ 只收**本仓配置的那几格**（id 形如 `stage-N`）。若一份读数里一个都匹配不上
 * （平台改了 id 形状），就退回「全收」—— 宁可多念几行平台自带的格，也不许因为
 * 认不出形状而把证据一起丢掉。
 *
 * @param {any} stages 平台给的 stage 数组
 * @returns {{failed: StageRef[], cancelled: StageRef[], skipped: StageRef[], configured: StageRef[]}}
 */
export function classifyStages(stages) {
  /** @type {{failed: StageRef[], cancelled: StageRef[], skipped: StageRef[], configured: StageRef[]}} */
  const out = { failed: [], cancelled: [], skipped: [], configured: [] };
  if (!Array.isArray(stages)) return out;
  /** @type {StageRef[]} */
  const all = [];
  stages.forEach((s, index) => {
    if (!s || typeof s !== "object") return;
    const status = typeof s.status === "string" ? s.status.toLowerCase() : "";
    all.push({
      id: String(s.id ?? ""),
      name: String(s.name ?? ""),
      status,
      index,
    });
  });
  const configured = all.filter((s) => CONFIGURED_STAGE_ID.test(s.id));
  const pool = configured.length > 0 ? configured : all;
  for (const ref of pool) {
    out.configured.push(ref);
    if (FAILED_STATES.has(ref.status)) out.failed.push(ref);
    else if (CANCELLED_STATES.has(ref.status)) out.cancelled.push(ref);
    else if (ref.status === "skipped") out.skipped.push(ref);
  }
  return out;
}

/**
 * 整条构建的分类。
 *
 * @param {any} json `cnb build get-build-status -v` 的解析结果
 * @returns {{
 *   state: "green" | "failed" | "cancelled" | "running" | "unknown",
 *   raw: string | null,
 *   pipelines: Array<{
 *     id: string, name: string, status: string,
 *     failed: StageRef[], cancelled: StageRef[], skipped: StageRef[], configured: StageRef[],
 *   }>,
 *   failed: StageRef[],
 *   cancelled: StageRef[],
 *   skipped: StageRef[],
 *   configured: StageRef[],
 * }}
 */
export function classifyBuildOutcome(json) {
  const data = json && typeof json === "object" ? json.data : null;
  const raw = data && typeof data.status === "string" ? data.status : null;
  /** @type {ReturnType<typeof classifyStages>["configured"]} */
  const failed = [];
  /** @type {ReturnType<typeof classifyStages>["configured"]} */
  const cancelled = [];
  /** @type {ReturnType<typeof classifyStages>["configured"]} */
  const skipped = [];
  /** @type {ReturnType<typeof classifyStages>["configured"]} */
  const configured = [];
  const pipelines = [];
  const table =
    data && data.pipelinesStatus && typeof data.pipelinesStatus === "object"
      ? data.pipelinesStatus
      : {};
  for (const key of Object.keys(table)) {
    const p = table[key];
    if (!p || typeof p !== "object") continue;
    const c = classifyStages(p.stages);
    const pipeline = {
      id: String(p.id ?? key),
      name: String(p.name ?? ""),
      status: typeof p.status === "string" ? p.status.toLowerCase() : "",
      failed: c.failed,
      cancelled: c.cancelled,
      skipped: c.skipped,
      configured: c.configured,
    };
    pipelines.push(pipeline);
    failed.push(...c.failed);
    cancelled.push(...c.cancelled);
    skipped.push(...c.skipped);
    configured.push(...c.configured);
  }

  const low = raw === null ? "" : raw.toLowerCase();
  /** @type {"green"|"failed"|"cancelled"|"running"|"unknown"} */
  let state = "unknown";
  if (failed.length > 0) {
    /* ① 真红的那格最该被看见 —— 即便同一跑里还有别的格被取消。 */
    state = "failed";
  } else if (
    cancelled.length > 0 ||
    pipelines.some((p) => CANCELLED_STATES.has(p.status))
  ) {
    /* ② 逐格读到「被取消」⇒ 这一跑没跑完，产物没被验证过。 */
    state = "cancelled";
  } else if (low === "success") {
    state = "green";
  } else if (FAILED_STATES.has(low)) {
    state = "failed";
  } else if (CANCELLED_STATES.has(low)) {
    state = "cancelled";
  } else if (RUNNING_STATES.has(low)) {
    state = "running";
  }
  return { state, raw, pipelines, failed, cancelled, skipped, configured };
}

/**
 * 「被取消 / 真失败」那一格**下面**那些根本没跑的格。
 *
 * 「下面」按平台给的那份列表的序号判定（那份列表就是执行顺序）—— 只有排在出问题
 * 那格之后的 `skipped` 才是「被它带下去的」；排在它之前的 `skipped` 是**平台自带**
 * 那一档（如 `DebugDetection`），与本次无关。
 *
 * @param {ReturnType<typeof classifyBuildOutcome>} outcome
 * @returns {StageRef[]}
 */
export function downstreamSkipped(outcome) {
  const blockers = [...outcome.failed, ...outcome.cancelled];
  if (blockers.length === 0) return [];
  const from = Math.min(...blockers.map((s) => s.index));
  return outcome.skipped.filter((s) => s.index > from);
}

/**
 * 「某一格**正在跑**」的词汇表（ISSUE #2184）。
 *
 * 它与上面那份 `RUNNING_STATES` **不是同一维**，也不是抄来的第二份：那份作用在**构建级**
 * `data.status`（实测那一层在跑时回的是 `pending`），而平台给**逐格**的运行中状态用的词是
 * `start`（#2167 实测：整跑期间 `data.status` 恒 `pending`，格与格之间靠 `start` 标在飞）。
 * 判「这条流水线此刻有没有一格在动」只认这一份 —— 拿 `RUNNING_STATES` 去数格会把 `start`
 * 读成「没在跑」，而那正是 #2184 断错的那一形。
 */
const STAGE_IN_FLIGHT_STATES = new Set(["start", "running", "processing"]);

/**
 * 这一眼里**在飞的格数**与最久的那一格 —— 轮询用它把「一格都没起来」与「一格跑了很久」分开。
 *
 * 只数**本仓配置的那几格**（`classifyStages` 那条 id 形状口径），平台自带的
 * `Prepare` / `End` 不算 —— 它们在跑不代表本仓的判据在推进。
 *
 * @param {any} json `cnb build get-build-status -v` 的解析结果（null / 畸形都当「读到 0 格」）
 * @returns {{count: number, names: string[]}}
 */
export function inFlightStages(json) {
  const configured = classifyBuildOutcome(json).configured;
  const flying = configured.filter((s) => STAGE_IN_FLIGHT_STATES.has(s.status));
  return { count: flying.length, names: flying.map((s) => s.name || s.id) };
}

/**
 * 把分类结果写成给人看的那几行。
 *
 * @param {ReturnType<typeof classifyBuildOutcome>} outcome
 * @param {{sn?: string, slug?: string, reason?: string | null}} [extra]
 * @returns {string[]}
 */
export function formatOutcome(outcome, extra = {}) {
  const sn = extra.sn || "(未知构建)";
  const slug = extra.slug || "";
  const lines = [];
  const head = {
    green: "绿（这一跑有结论）",
    failed: "真失败（有格子自己跑挂了，去查产物）",
    cancelled: "被取消（这一跑没有结论，不是产物坏了）",
    running: "没有结论（还在跑）",
    unknown: "没有结论（读数形状不认识，不猜方向）",
  };
  lines.push(`[build-readout] build ${sn} → 结论：${head[outcome.state]}`);
  for (const p of outcome.pipelines) {
    lines.push(
      `[build-readout]   流水线：${p.name || "(无名)"}（status=${p.status || "(无)"}）`,
    );
  }
  for (const s of outcome.failed) {
    lines.push(
      `[build-readout]   红的那一格：${s.name || s.id}（${s.id}，status=${s.status}）`,
    );
  }
  for (const s of outcome.cancelled) {
    lines.push(
      `[build-readout]   被取消的那一格：${s.name || s.id}（${s.id}，status=${s.status}）`,
    );
  }
  const skipped = downstreamSkipped(outcome);
  for (const s of skipped) {
    lines.push(
      `[build-readout]   下面这些格根本没跑：${s.name || s.id}（${s.id}，status=skipped）`,
    );
  }
  if (extra.reason) {
    lines.push(`[build-readout]   平台给的原因：${extra.reason}`);
  }
  if (outcome.state === "failed") {
    lines.push(
      `[build-readout]   下一动作：查那一格的日志：https://cnb.cool/${slug}/-/build/logs/${sn}`,
    );
  } else if (outcome.state === "cancelled") {
    lines.push(
      "[build-readout]   下一动作：重跑这一格（锁被另一跑顶掉 / 人为终止），不要去查产物。",
    );
  } else if (outcome.state === "running") {
    lines.push("[build-readout]   下一动作：等它跑完再读一次。");
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
 * @returns {Array<{sn: string, createTime?: string}> | null} 列表；取不到时 null
 */
export function fetchBuildList(run, slug, event, limit) {
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
  const list = res ? asArray(res.json) : null;
  if (!list) return null;
  const builds = list
    .filter((b) => b && typeof b.sn === "string")
    .map((b) => ({ sn: String(b.sn), createTime: String(b.createTime ?? "") }));
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
 */
export function fetchStageReason(run, slug, sn, pipelineId, stageId) {
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
  const why = typeof d.error === "string" ? d.error.trim() : "";
  return why === "" ? null : why;
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
    const statusJson = fetchBuildStatus(run, slug, sn);
    if (!statusJson) {
      log(`[build-readout] build ${sn} ⇒ 取不到状态 ⇒ 没有结论。`);
      worst = CODE.NOT_RUN;
      continue;
    }
    const outcome = classifyBuildOutcome(statusJson);
    /** @type {string | null} */
    let reason = null;
    if (outcome.state === "cancelled") {
      const first = outcome.cancelled[0];
      const pipeline = outcome.pipelines.find((p) =>
        p.cancelled.some((s) => s.id === (first ? first.id : "")),
      );
      if (first && pipeline) {
        reason = fetchStageReason(run, slug, sn, pipeline.id, first.id);
      }
    }
    for (const line of formatOutcome(outcome, { sn, slug, reason })) {
      log(line);
    }
    if (outcome.state === "failed") worst = CODE.RED;
    else if (outcome.state !== "green" && worst !== CODE.RED)
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
