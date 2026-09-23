#!/usr/bin/env node
// ── agent-film —— 一条命令把「剧本 → 成片」跑到底（Phase 7 · AI 自主执行的对外入口）──
//
// 面向「让编码代理 / 人直接从一句话创意跑到成片」：对一个跑起来的 App（默认本机 dev 端口），
// 通过它的 tRPC `run` 端点发起一次自主执行（`run.start`，默认全自动），再轮询 `run.status`
// 直到 done / failed / awaiting_approval / paused，逐步打印进度，最后回报成片状态。
//
// 引擎在服务端 fire-and-forget 推进（`advanceRunLoop`，见 src/server/agent/run-engine.ts）；
// 本 CLI 只负责「发起 + 观察」，不碰 server-only、不在本机跑模型 —— 真模型/ComfyUI 由目标 App 承担。
//
// 用法：
//   pnpm agent:film --project <proj_..> --idea "一句话创意" \
//       --image-workflow <图类工作流id> --video-workflow <视频工作流id> \
//       [--approval auto|stage|shot] [--url http://127.0.0.1:3000] [--dry-run] [--json]
//
// 纯逻辑（parseArgs / build*Call / superjson 解析 / 轮询状态机）都单独导出，便于离线单测；
// 真实网络只在 main() 里发生，`--dry-run` 只打印将要发出的请求。
// @ts-nocheck

import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";

export const DEFAULT_URL = "http://127.0.0.1:3000";

/**
 * @typedef {"auto"|"stage"|"shot"} Approval
 * @typedef {{
 *   url:string; project:string; idea:string; imageWorkflowId:string; videoWorkflowId:string;
 *   approval:Approval; pollMs:number; timeoutMs:number; dryRun:boolean; json:boolean;
 *   help?:boolean; unknown?:string[];
 * }} FilmCliOpts
 * @typedef {{ method:"POST"|"GET"; url:string; body?:{ json:Record<string,unknown> } }} HttpCall
 * @typedef {{ run?:{ status?:string }; action?:{ kind?:string; shotIds?:string[] } }} RunSnapshot
 */

/** @param {string[]} argv @returns {FilmCliOpts} */
export function parseArgs(argv) {
  /** @type {FilmCliOpts} */
  const opts = {
    url: DEFAULT_URL,
    project: "",
    idea: "",
    imageWorkflowId: "",
    videoWorkflowId: "",
    approval: "auto",
    pollMs: 3000,
    timeoutMs: 30 * 60 * 1000,
    dryRun: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i] ?? "";
    switch (a) {
      case "--url":
        opts.url = next();
        break;
      case "--project":
        opts.project = next();
        break;
      case "--idea":
        opts.idea = next();
        break;
      case "--image-workflow":
        opts.imageWorkflowId = next();
        break;
      case "--video-workflow":
        opts.videoWorkflowId = next();
        break;
      case "--approval": {
        const v = next();
        opts.approval = ["auto", "stage", "shot"].includes(v)
          ? /** @type {Approval} */ (v)
          : "auto";
        break;
      }
      case "--poll":
        opts.pollMs = Number(next()) || opts.pollMs;
        break;
      case "--timeout":
        opts.timeoutMs = Number(next()) || opts.timeoutMs;
        break;
      case "--dry-run":
        opts.dryRun = true;
        break;
      case "--json":
        opts.json = true;
        break;
      case "--help":
      case "-h":
        opts.help = true;
        break;
      default:
        opts.unknown = [...(opts.unknown ?? []), a];
    }
  }
  if (!["auto", "stage", "shot"].includes(opts.approval))
    opts.approval = "auto";
  return opts;
}

/** @param {FilmCliOpts} opts @returns {string[]} 错误信息（空=通过） */
export function validateArgs(opts) {
  const errors = [];
  if (!opts.project) errors.push("缺少 --project <proj_..>");
  if (!opts.idea) errors.push('缺少 --idea "<一句话创意>"');
  return errors;
}

/** @param {FilmCliOpts} opts @returns {HttpCall} */
export function buildStartCall(opts) {
  /** @type {Record<string,unknown>} */
  const json = {
    projectId: opts.project,
    goal: opts.idea,
    approvalMode: opts.approval,
  };
  if (opts.imageWorkflowId) json.imageWorkflowId = opts.imageWorkflowId;
  if (opts.videoWorkflowId) json.videoWorkflowId = opts.videoWorkflowId;
  return {
    method: "POST",
    url: `${opts.url.replace(/\/$/, "")}/api/trpc/run.start`,
    body: { json },
  };
}

/** @param {Pick<FilmCliOpts,"url"|"project">} opts @returns {HttpCall} */
export function buildStatusCall(opts) {
  const input = encodeURIComponent(
    JSON.stringify({ json: { projectId: opts.project } }),
  );
  return {
    method: "GET",
    url: `${opts.url.replace(/\/$/, "")}/api/trpc/run.status?input=${input}`,
  };
}

/** 从 superjson 的 tRPC 回包里取 .result.data.json（无信封原样返回）。 @param {unknown} payload @returns {RunSnapshot} */
export function parseSuperjsonEnvelope(payload) {
  const obj = /** @type {{ result?: { data?: { json?: RunSnapshot } } }} */ (
    payload
  );
  const data = obj?.result?.data;
  if (data && typeof data === "object" && "json" in data) return data.json;
  return (data ?? payload) || {};
}

/** 人读一行进度文本。 @param {RunSnapshot} snapshot @returns {string} */
export function formatStep(snapshot) {
  const status = snapshot?.run?.status ?? "unknown";
  return `status=${status} 下一步=${describeAction(snapshot?.action)}`;
}

/** @param {RunSnapshot["action"]} action @returns {string} */
function describeAction(action) {
  switch (action?.kind) {
    case "generate_script":
      return "生成剧本";
    case "extract_characters":
      return "提取角色";
    case "plan_storyboard":
      return "规划分镜";
    case "render_images":
      return `逐镜生图(${action.shotIds?.length ?? 0})`;
    case "render_film":
      return "生成视频并合成成片";
    case "await_approval":
      return "等待确认";
    case "done":
      return "已完成";
    default:
      return "空闲";
  }
}

/**
 * 发起 + 轮询的可注入执行：deps.request 发一次 HttpCall、doSleep 可注入（离线单测不发真网络）。
 * @param {FilmCliOpts} opts
 * @param {{ request:(c:HttpCall)=>Promise<unknown>; doSleep?:(ms:number)=>Promise<void>; log?:(s:string)=>void }} deps
 * @returns {Promise<{ snapshot:RunSnapshot; timedOut:boolean; polls:number }>}
 */
export async function driveFilmRun(opts, deps) {
  const {
    request,
    doSleep = (/** @type {number} */ ms) => sleep(ms),
    log = () => {},
  } = deps;
  /** @type {RunSnapshot} */
  let snapshot = parseSuperjsonEnvelope(await request(buildStartCall(opts)));
  log(formatStep(snapshot));
  const deadline = Date.now() + opts.timeoutMs;
  let polls = 0;
  while (snapshot?.run?.status === "running") {
    if (Date.now() > deadline) return { snapshot, timedOut: true, polls };
    await doSleep(opts.pollMs);
    polls++;
    snapshot = parseSuperjsonEnvelope(await request(buildStatusCall(opts)));
    log(formatStep(snapshot));
  }
  return { snapshot, timedOut: false, polls };
}

const HELP = `用法: pnpm agent:film --project <proj_..> --idea "创意" [选项]
  --image-workflow <id> 逐镜生图  --video-workflow <id> 出片视频工作流
  --approval auto|stage|shot (默认 auto)  --url <appBase> (默认 ${DEFAULT_URL})
  --poll <ms> (默认3000)  --timeout <ms> (默认1800000)  --dry-run  --json
`;

/** @param {string[]} [argv] @returns {Promise<number>} 进程退出码 */
export async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (opts.help) {
    process.stdout.write(HELP);
    return 0;
  }
  const errors = validateArgs(opts);
  if (errors.length) {
    process.stderr.write(errors.join("\n") + "\n\n" + HELP);
    return 2;
  }
  if (opts.dryRun) {
    process.stdout.write(
      JSON.stringify(
        { start: buildStartCall(opts), status: buildStatusCall(opts) },
        null,
        2,
      ) + "\n",
    );
    return 0;
  }
  /** @type {(c:HttpCall)=>Promise<unknown>} */
  const request = async (call) => {
    const res = await fetch(call.url, {
      method: call.method,
      headers: { "content-type": "application/json" },
      ...(call.body ? { body: JSON.stringify(call.body) } : {}),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : null;
  };
  const log = (/** @type {string} */ line) => process.stdout.write(line + "\n");
  try {
    const { snapshot, timedOut, polls } = await driveFilmRun(opts, {
      request,
      log,
    });
    if (opts.json) process.stdout.write(JSON.stringify(snapshot) + "\n");
    else
      log(
        timedOut ? `超时（${polls} 次轮询）` : `结束：${formatStep(snapshot)}`,
      );
    const status = snapshot?.run?.status;
    return status === "failed" || timedOut ? 1 : 0;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`agent-film 失败：${msg}\n`);
    return 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = await main();
}
