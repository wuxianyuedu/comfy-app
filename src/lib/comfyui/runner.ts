import { EventEmitter } from "events";
import WebSocket from "ws";
import { spawn, type ChildProcess } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { prisma } from "../db";
import {
  getView,
  getHistory,
  postPrompt,
  interrupt,
  resolveComfyBase,
  resetComfyBase,
  toWsBase,
} from "./client";
import { prepareGraphForExecution } from "./raw";
import { type ValidationError, extractValidationErrors } from "./validation";

const CLIENT_ID = process.env.COMFY_CLIENT_ID ?? "comfy-app-web";
const MAX_CONCURRENCY = 1; // single GPU — serial execution
const JOB_TIMEOUT_MS = 5 * 60 * 1000;

/** ComfyUI 先发 `executing:null` / `execution_success`，随后才把结果写进 history。
 *  直接读会拿到空，必须轮询几轮。 */
const HISTORY_RETRIES = 12;
const HISTORY_RETRY_DELAY_MS = 250;

/** WS 断线重连退避（毫秒），指数增长到上限。 */
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15000;

/**
 * ComfyUI 的 WS 端点路径随版本变化：
 *   - 现代版本（v0.20+）：`/api/ws?clientId=...`
 *   - 旧版本：`/ws?clientId=...`（访问 `/api/ws` 会 404）
 * 连接阶段失败时按此顺序逐条回退，避免「能提交但收不到事件」。
 */
const WS_PATHS = ["/api/ws", "/ws"];

export type RawWorkflowOverride = { nodeId: string; name: string; value?: unknown };

export type Job = {
  taskId: string;
  prompt?: Record<string, unknown>;
  /** Raw UI-format json (with subgraph wrappers) — executed via comfy-cli. */
  rawJson?: unknown;
  /** Canvas `workflowInputs` injected into the raw json before execution. */
  overrides?: RawWorkflowOverride[];
};

export type LogEntry = {
  t: number; // epoch ms
  level: "info" | "progress" | "warn" | "error" | "success";
  msg: string;
  /** R-ardot118 (2026-08-18): caller source ("file:line") captured at
   *  emit time so the debug panel can show *which code path* produced
   *  each log line.  Empty when capture was skipped.  Persisted as
   *  part of the entry so SSE replays carry it too. */
  src?: string;
};

export type TaskEvent =
  | { type: "progress"; progress: number }
  | { type: "done"; images: unknown[] }
  | { type: "error"; error: string }
  | { type: "log"; entry: LogEntry }
  /* R-ardot114 (2026-08-17): synthetic "state" event re-emitted
   *  from cancelTask() / finalizeFailure() paths that would
   *  otherwise only update the DB without notifying the SSE
   *  subscriber.  The frontend reads the same fields it reads
   *  from the initial /api/tasks/[id]/stream GET body, so a
   *  "state" event triggers the same patch() path that heals
   *  the "stuck generating" UI. */
  | {
      type: "state";
      status: string;
      progress?: number;
      error?: string | null;
      validationErrors?: unknown[] | null;
    };

type RunnerState = {
  ws: WebSocket | null;
  queue: Job[];
  active: number;
  connecting: boolean;
  emitter: EventEmitter;
  promptToTask: Map<string, string>;
  promptByTask: Map<string, Record<string, any>>;
  logs: Map<string, LogEntry[]>;
  lastLogPct: Map<string, number>;
  /** R-ardot111 (2026-08-17): per-node completion tracking.  When
   *  ComfyUI emits `executing` with `data.node !== null` we record the
   *  (node, classType) here; on the next `executing` with `data.node
   *  === null` we log "✔ 节点 X (classType) 完成" using the recorded
   *  values.  This gives the user a clear per-node timeline in the
   *  log panel, not just "started" markers. */
  lastNodeByTask: Map<string, { node: string; classType: string; t: number }>;
  /** R-ardot111 (2026-08-17): task start time (epoch ms), used to
   *  emit "总耗时 Xs" at completion.  Set in enqueue(), cleared in
   *  complete() / fail() / cancelTask(). */
  startedAt: Map<string, number>;
  settled: Set<string>;
  timers: Map<string, NodeJS.Timeout>;
  reconnectAttempts: number;
  /** 当前使用的 WS 路径下标（连接失败时推进到下一条路径重试）。 */
  wsPathIndex: number;
  /** 本次执行实际提交给 ComfyUI 的工作流 JSON。raw 路径存 patched（liblib
   *  subgraph 格式，未展开）；api 路径存 prepareGraphForExecution 后的展开 graph。
   *  任务完成后落盘到 public/generated/.../workflow.json，便于工作流模板后续改动
   *  时仍能完整复现本次生成结果（种子已存 manifest.seed + TaskImage.seed）。 */
  executedWorkflow: Map<string, any>;
};

const g = globalThis as unknown as { comfyRunner?: RunnerState };

function state(): RunnerState {
  if (!g.comfyRunner) {
    const emitter = new EventEmitter();
    emitter.setMaxListeners(0);
    g.comfyRunner = {
      ws: null,
      queue: [],
      active: 0,
      connecting: false,
      emitter,
      promptToTask: new Map(),
      promptByTask: new Map(),
      logs: new Map(),
      lastLogPct: new Map(),
      lastNodeByTask: new Map(),
      startedAt: new Map(),
      settled: new Set(),
      timers: new Map(),
      reconnectAttempts: 0,
      wsPathIndex: 0,
      executedWorkflow: new Map(),
    };
  }
  return g.comfyRunner;
}

function nodeLabel(classType?: string): string {
  const map: Record<string, string> = {
    CheckpointLoaderSimple: "加载模型",
    CLIPTextEncode: "编码提示词",
    EmptyLatentImage: "初始化潜空间",
    KSampler: "采样去噪",
    VAEDecode: "VAE 解码",
    SaveImage: "保存图像",
    LoraLoader: "加载 LoRA",
  };
  return map[classType ?? ""] ?? classType ?? "未知节点";
}

/**
 * 建立事件通道。
 *
 * ⚠️ 这里必须走 `resolveComfyBase()` 而不是同步的配置值：ComfyUI 端口被占用时
 * 会自动 +1 启动，HTTP 侧靠探测找到了真实端口，WS 侧如果还连配置端口就会
 * 「提交成功但收不到任何事件」，最后卡到超时。两条链路必须用同一个 base。
 */
async function connect(): Promise<void> {
  const s = state();
  if (s.connecting || s.ws) return;
  s.connecting = true;

  let base: string;
  try {
    base = await resolveComfyBase();
  } catch {
    s.connecting = false;
    scheduleReconnect();
    return;
  }
  // await 期间可能已有别的调用建好了连接
  if (s.ws) {
    s.connecting = false;
    return;
  }

  const path = WS_PATHS[s.wsPathIndex % WS_PATHS.length];
  const url = `${toWsBase(base)}${path}?clientId=${CLIENT_ID}`;

  let ws: WebSocket;
  try {
    ws = new WebSocket(url);
  } catch {
    s.connecting = false;
    s.wsPathIndex += 1; // 换一条 WS 路径重试
    scheduleReconnect();
    return;
  }

  let opened = false;
  ws.on("open", () => {
    opened = true;
    s.connecting = false;
    s.reconnectAttempts = 0;
    void processQueue();
  });
  ws.on("message", (data) => void handleMessage(data.toString()));
  // error / close 都交给 handleWsDrop 统一处理（幂等，双发只生效一次）。
  ws.on("close", () => handleWsDrop(ws));
  ws.on("error", (err: Error) => {
    // 某些 ComfyUI 版本 / 网络下 error 之后不一定再发 close，
    // 这里兜底触发重连，否则队列会卡死在 RUNNING。
    console.warn(`[comfyui] WS(${path}) 出错：${err?.message ?? err}`);
    // 连接阶段（未 open）就失败：换下一条 WS 路径重试一次。
    if (!opened) s.wsPathIndex += 1;
    handleWsDrop(ws);
  });
  s.ws = ws;
}

/**
 * 统一处理 WS 掉线。
 * 幂等：error 与 close 事件可能双发，第二次进来时 `s.ws` 已不是当前 socket，直接忽略，
 * 避免重复排两次重连。同时丢掉端口探测缓存，让下次重连重新发现 ComfyUI（可能换了端口）。
 */
function handleWsDrop(ws: WebSocket) {
  const s = state();
  if (s.ws !== ws) return;
  s.ws = null;
  s.connecting = false;
  resetComfyBase();
  scheduleReconnect();
}

function scheduleReconnect() {
  const s = state();
  const attempt = Math.min(s.reconnectAttempts++, 8);
  const delay = Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS);
  setTimeout(() => void connect(), delay);
}

// Append a structured log entry: keep in-memory + emit to live subscribers +
// debounce-persist to DB so SSE replay covers everything.
//
// R-ardot115 (2026-08-18): the original `log()` only pushed to in-memory
// `s.logs` and the EventEmitter.  `persistLogs()` was called only at
// terminal points (complete / finalizeFailure).  That meant any log
// emitted *before* the frontend opened EventSource (which only happens
// AFTER `/api/generate` returns taskId and `d.taskId` is patched) was
// invisible: the emit landed on no subscriber, and SSE's initial
// `Task.logs` replay found an empty array.  Symptom in the panel: a long
// silence between "📡 已订阅" and the first server-side line — the user
// couldn't tell what the runner was doing.
//
// Fix: persist to DB on every log, but coalesce via 200ms debounce so
// high-frequency bursts (per-node ▶/✔ pairs during execution) collapse
// to ~1 write instead of one per entry.  A 1500ms safety flush
// guarantees we don't starve the DB during sustained emission.
function callerLoc(): string {
  try {
    const stack = new Error().stack;
    if (!stack) return "";
    const lines = stack.split("\n");
    // lines[0] = "Error", lines[1] = "    at log (…)", lines[2] = real caller.
    const frame = lines[2] || lines[1] || "";
    const m = frame.match(/\(([^():]+):(\d+):(\d+)\)/);
    if (m) {
      const file = m[1].split(/[\\/]/).pop() || m[1];
      return `${file}:${m[2]}`;
    }
    const m2 = frame.match(/at\s+(\S+):(\d+):(\d+)/);
    if (m2) {
      const file = m2[1].split(/[\\/]/).pop() || m2[1];
      return `${file}:${m2[2]}`;
    }
    return "";
  } catch {
    return "";
  }
}

function log(taskId: string, level: LogEntry["level"], msg: string) {
  const s = state();
  const entry: LogEntry = { t: Date.now(), level, msg, src: callerLoc() };
  const arr = s.logs.get(taskId) ?? [];
  arr.push(entry);
  s.logs.set(taskId, arr);
  s.emitter.emit(taskId, { type: "log", entry });
  schedulePersistLogs(taskId);
}

// R-ardot115 (2026-08-18): per-taskId debounced DB writer.  Each task
// gets at most one pending write; subsequent `log()` calls within the
// debounce window reset the timer.  The "max delay" watchdog guarantees
// sustained emission (e.g. the per-node ▶/✔ burst) still reaches the DB
// within ~1.5s so SSE replays pick it up promptly.
const PERSIST_DEBOUNCE_MS = 200;
const PERSIST_MAX_DELAY_MS = 1500;
const persistTimers = new Map<
  string,
  { debounce: ReturnType<typeof setTimeout>; maxDelay: ReturnType<typeof setTimeout> }
>();

function schedulePersistLogs(taskId: string) {
  if (!taskId) return;
  const existing = persistTimers.get(taskId);
  if (existing) {
    // Reset only the debounce timer; the max-delay watchdog stays armed.
    clearTimeout(existing.debounce);
    existing.debounce = setTimeout(() => {
      const cur = persistTimers.get(taskId);
      if (cur) {
        clearTimeout(cur.maxDelay);
        persistTimers.delete(taskId);
      }
      void persistLogs(taskId);
    }, PERSIST_DEBOUNCE_MS);
    return;
  }
  const debounce = setTimeout(() => {
    const cur = persistTimers.get(taskId);
    if (cur) {
      clearTimeout(cur.maxDelay);
      persistTimers.delete(taskId);
    }
    void persistLogs(taskId);
  }, PERSIST_DEBOUNCE_MS);
  const maxDelay = setTimeout(() => {
    const cur = persistTimers.get(taskId);
    if (cur) {
      clearTimeout(cur.debounce);
      persistTimers.delete(taskId);
    }
    void persistLogs(taskId);
  }, PERSIST_MAX_DELAY_MS);
  persistTimers.set(taskId, { debounce, maxDelay });
}

async function persistLogs(taskId: string) {
  // R-ardot115 (2026-08-18): a debounced write is now racing the terminal
  // `await persistLogs(taskId)` call.  Cancel the pending timers so the
  // final synchronous flush is the one and only write for this task.
  const pending = persistTimers.get(taskId);
  if (pending) {
    clearTimeout(pending.debounce);
    clearTimeout(pending.maxDelay);
    persistTimers.delete(taskId);
  }
  const arr = state().logs.get(taskId) ?? [];
  await prisma.task
    .update({ where: { id: taskId }, data: { logs: arr as any } })
    .catch(() => {});
}

async function handleMessage(raw: string) {
  let msg: any;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }
  const data = msg.data ?? {};
  const promptId: string | undefined = data.prompt_id;
  if (!promptId) return;
  const s = state();
  const taskId = s.promptToTask.get(promptId);
  if (!taskId) return;

  // 任何来自 ComfyUI 的活动（节点开始执行 / 进度推进）都续期看门狗，
  // 避免长任务被 5 分钟硬超时误杀（P2 修复）。完成/错误分支走 claimSettle
  // 会清掉定时器，这里刷新无害。
  if (msg.type === "executing" || msg.type === "progress") {
    armWatchdog(taskId, promptId);
  }

  if (msg.type === "executing" && data.node) {
    // A node started executing — surface it in the log for transparency.
    const graph = s.promptByTask.get(taskId);
    const classType = graph?.[data.node]?.class_type;
    const nodeId = String(data.node);
    // R-ardot111 (2026-08-17): remember this node so we can log its
    // completion when ComfyUI emits the next `executing` with
    // `data.node === null`.  This turns a "▶ KSampler" line into a
    // proper "▶ KSampler → ✔ KSampler" pair.
    s.lastNodeByTask.set(taskId, { node: nodeId, classType: classType ?? "", t: Date.now() });
    log(taskId, "info", `▶ 节点 [${nodeId}] ${nodeLabel(classType)}（${classType ?? "?"}）`);
    return;
  }

  // R-ardot111 (2026-08-17): when ComfyUI signals the previous node
  // finished (executing → null node) and we have a recorded
  // lastNodeByTask entry, surface a "✔ 完成" line so the user sees
  // a per-node timeline.  Only do this for the API-format path
  // (where data.node is a string id); comfy-cli emits its own
  // "▶ 节点 N/total" lines via executeViaComfyCli.
  if (msg.type === "executing" && data.node === null) {
    const last = s.lastNodeByTask.get(taskId);
    if (last) {
      const dur = Math.max(0, Math.round((Date.now() - last.t) / 100) / 10);
      log(taskId, "info", `✔ 节点 [${last.node}] ${nodeLabel(last.classType)} 完成（${dur}s）`);
      s.lastNodeByTask.delete(taskId);
    }
  }

  if (msg.type === "progress") {
    const value = Number(data.value ?? 0);
    const max = Number(data.max ?? 1);
    const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
    await prisma.task.update({ where: { id: taskId }, data: { progress: pct, status: "RUNNING" } });
    s.emitter.emit(taskId, { type: "progress", progress: pct });

    // Throttled milestone log so the panel stays readable.
    const last = s.lastLogPct.get(taskId) ?? -1;
    if (pct - last >= 25 || pct === 100) {
      s.lastLogPct.set(taskId, pct);
      log(taskId, "progress", `采样进度 ${pct}%`);
    }
    return;
  }

  // Completion: standard ComfyUI uses `executing` with node===null; the
  // kaytool build (v0.28) emits `execution_success` instead.
  if (msg.type === "execution_success" || (msg.type === "executing" && data.node === null)) {
    await complete(taskId, promptId);
  } else if (msg.type === "execution_error") {
    await fail(taskId, promptId, data.exception_message ?? "执行错误");
  }
}

/**
 * 抢占任务的终态。
 *
 * 返回 true 表示本次调用赢得了收口权（并已停掉超时定时器）；返回 false 表示
 * 别处已经把任务结算过了，调用方应直接退出。
 *
 * ⚠️ 历史坑：complete() 曾在入口就 `settled.add`，随后它内部的失败分支再调
 * fail()，而 fail() 第一行就是 `if (settled.has) return` —— 直接空转。结果
 * 是任务永远停在 RUNNING、`active` 不回落、MAX_CONCURRENCY=1 的队列被彻底
 * 堵死，只能重启进程。所以失败收口一律走 finalizeFailure()，不再经过 fail()。
 */
function claimSettle(taskId: string): boolean {
  const s = state();
  if (s.settled.has(taskId)) return false;
  s.settled.add(taskId);
  const t = s.timers.get(taskId);
  if (t) clearTimeout(t);
  s.timers.delete(taskId);
  return true;
}

/**
 * （重）启动任务的看门狗定时器。
 *
 * ⚠️ P2 修复：原实现在提交后用一次 `setTimeout(JOB_TIMEOUT_MS)` 后即不再理会，
 * 长任务（如 WAN 81 帧生成）即便进度正常推进，5 分钟一到也被误判 FAILED，
 * 而此时 ComfyUI 后台仍在占 GPU。改为「有活动就续期」：每次收到进度 /
 * 执行事件都重置定时器，只有连续 JOB_TIMEOUT_MS 毫秒**毫无活动**才判定为
 * 真正的卡死（超时）。
 */
function armWatchdog(taskId: string, promptId: string) {
  const s = state();
  const existing = s.timers.get(taskId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    void fail(taskId, promptId, "生成超时");
  }, JOB_TIMEOUT_MS);
  s.timers.set(taskId, timer);
}

/** 轮询 history —— ComfyUI 是「先广播完成、后写 history」，直接读会扑空。 */
async function fetchHistoryEntry(promptId: string): Promise<any | null> {
  for (let i = 0; i < HISTORY_RETRIES; i++) {
    try {
      const hist = (await getHistory(promptId)) as any;
      const entry = hist?.[promptId];
      // outputs 落盘也可能晚一拍，等到有 outputs 或明确报错为止。
      if (entry && (entry.outputs || entry.status?.status_str)) return entry;
      if (entry && i >= 3) return entry; // 有条目但一直空 → 不再干等
    } catch {
      /* ComfyUI 短暂不可达，继续重试 */
    }
    await new Promise((r) => setTimeout(r, HISTORY_RETRY_DELAY_MS));
  }
  return null;
}

async function complete(taskId: string, promptId: string) {
  if (!claimSettle(taskId)) return;
  const s = state();
  const executedWorkflow = s.executedWorkflow.get(taskId) ?? null;
  try {
    await completeInner(taskId, promptId, executedWorkflow);
  } catch (e: any) {
    // 下载 / 落盘 / 写库任何一步炸了，都必须把任务收口，否则队列同样会卡死。
    await finalizeFailure(taskId, promptId, e?.message ?? "结果处理失败");
  }
}

type CollectedOutputs = {
  images: { filename: string; subfolder: string; type: string }[];
  videos: { filename: string; subfolder: string; type: string }[];
  audios: { filename: string; subfolder: string; type: string }[];
  others: { filename: string; subfolder: string; type: string }[];
  texts: string[];
};

/**
 * 从 ComfyUI history 的 outputs 中收集各类产物。
 * 纯函数，便于单测（P2：补齐 audio/text/3D，避免只认 images/videos 导致的死锁）。
 */
export function collectOutputs(outputs: Record<string, any>): CollectedOutputs {
  const images: { filename: string; subfolder: string; type: string }[] = [];
  const videos: { filename: string; subfolder: string; type: string }[] = [];
  const audios: { filename: string; subfolder: string; type: string }[] = [];
  const others: { filename: string; subfolder: string; type: string }[] = [];
  const texts: string[] = [];
  for (const nodeOut of Object.values(outputs) as any[]) {
    if (!nodeOut || typeof nodeOut !== "object") continue;
    if (Array.isArray(nodeOut.images)) images.push(...nodeOut.images);
    if (Array.isArray(nodeOut.videos)) videos.push(...nodeOut.videos);
    // VHS_VideoCombine emits its files under `gifs` (mp4/gif/webm).
    if (Array.isArray(nodeOut.gifs)) videos.push(...nodeOut.gifs);
    // SaveAudio / AudioComposite emit under `audios`.
    if (Array.isArray(nodeOut.audios)) audios.push(...nodeOut.audios);
    // ShowText / 任意文本输出节点：保留渲染文本（无文件）.
    if (typeof nodeOut.text === "string" && nodeOut.text.trim()) texts.push(nodeOut.text);
    else if (Array.isArray(nodeOut.text))
      for (const t of nodeOut.text) if (typeof t === "string" && t.trim()) texts.push(t);
    // 3D / 未知文件输出（Hunyuan3D、mesh、gltf…）：兜底收集任何其它
    // 「数组内含 {filename,...}」的输出，避免被静默丢弃。
    for (const [k, v] of Object.entries(nodeOut)) {
      if (k === "images" || k === "videos" || k === "gifs" || k === "audios" || k === "text") continue;
      if (Array.isArray(v) && v.length && v.every((it: any) => it && typeof it.filename === "string"))
        others.push(...v);
    }
  }
  return { images, videos, audios, others, texts };
}

async function completeInner(taskId: string, promptId: string, executedWorkflow: any | null = null) {
  const s = state();

  // 2026-08-13 项目级产出：读取任务归属的项目与请求参数，决定磁盘落点 +
  // 复现元数据。projectId 为 localStorage 的 CanvasProject.id（client 侧字符串）。
  const taskRow = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      projectId: true,
      params: true,
      prompt: true,
      negativePrompt: true,
      workflowName: true,
      referenceImages: true,
      createdAt: true,
    },
  });
  const projectId: string | null = taskRow?.projectId ?? null;
  const taskParams = (taskRow?.params as Record<string, any>) ?? {};
  const reqSeed =
    typeof taskParams.seed === "number" || typeof taskParams.seed === "string"
      ? String(taskParams.seed)
      : undefined;
  let reqW: number | undefined, reqH: number | undefined;
  const sizeStr = typeof taskParams.size === "string" ? taskParams.size : "";
  const sizeMatch = sizeStr.match(/(\d+)\s*[x×]\s*(\d+)/i);
  if (sizeMatch) {
    reqW = Number(sizeMatch[1]);
    reqH = Number(sizeMatch[2]);
  }
  const publicBase = projectId
    ? `/api/generated/projects/${projectId}/${taskId}`
    : `/api/generated/${taskId}`;

  // R-ardot111 (2026-08-17): explicit "拉取 history" line so the
  // gap between "last node done" and "history is ready" is visible
  // — ComfyUI is async here (success signal lands before outputs
  // are persisted), so a hang in this window would otherwise look
  // like "the runner froze".
  log(taskId, "info", "🔍 拉取 ComfyUI history（最长 ~3s）…");
  const entry = await fetchHistoryEntry(promptId);
  if (!entry) {
    await finalizeFailure(taskId, promptId, "未找到生成结果");
    return;
  }
  const outputsCount = Object.keys(entry.outputs ?? {}).length;
  log(taskId, "info", `✓ history 就绪（${outputsCount} 节点输出）`);

  const msgs: any[] = entry.status?.messages ?? [];
  const errored = msgs.some((m) => m?.[0] === "execution_error");
  if (errored || entry.status?.status_str === "error") {
    const ex = msgs.find((m) => m?.[0] === "execution_error")?.[1]?.exception_message;
    await finalizeFailure(taskId, promptId, ex ?? "执行错误");
    return;
  }

  const { images, videos, audios, others, texts } = collectOutputs(entry.outputs ?? {});
  const hasOutput =
    images.length || videos.length || audios.length || texts.length || others.length;
  if (!hasOutput) {
    await finalizeFailure(taskId, promptId, "无输出内容");
    return;
  }

  // R-ardot62 (2026-08-15): KSampler 的真实 seed 不在 outputs 里，藏在
  // entry.prompt[2] 里（ComfyUI 0.33.1 history 格式）。`control_after_generate=
  // randomize` 时默认值是 UI 占位，server 实际抽的 seed 在 history graph
  // `inputs.seed/noise_seed` 字段。这里抽出后优先覆盖 `reqSeed`（用户填的）
  // 与 workflowHints（workflow 元数据），存到 `TaskImage.seed` + `Task.params.runtime`
  // 里让前端历史详情「生成参数卡」能展示真 seed。
  const runtime = extractRuntimeParams(entry);
  const actualSeed: number | undefined = runtime.seed;
  if (actualSeed !== undefined) {
    log(taskId, "info", `真实执行 seed = ${actualSeed}（${runtime.samplerClassType ?? "KSampler"}@${runtime.samplerNodeId ?? "?"}）`);
  }

  const parts: string[] = [];
  if (images.length) parts.push(`${images.length} 张图像`);
  if (videos.length) parts.push(`${videos.length} 个视频`);
  if (audios.length) parts.push(`${audios.length} 个音频`);
  if (others.length) parts.push(`${others.length} 个文件`);
  if (texts.length) parts.push(`${texts.length} 段文本`);
  log(taskId, "success", `✓ 生成完成，开始下载 ${parts.join("、") || "结果"}`);

  const baseDir = path.join(process.cwd(), "public", "generated");
  const dir = projectId
    ? path.join(baseDir, "projects", projectId, taskId)
    : path.join(baseDir, taskId);
  await fs.mkdir(dir, { recursive: true });
  const saved: { localPath: string; mediaType: string }[] = [];

  // Images
  for (let i = 0; i < images.length; i++) {
    const im = images[i];
    const buf = await getView(im.filename, im.subfolder ?? "", im.type ?? "");
    const ext = path.extname(im.filename) || ".png";
    const fname = `img_${i}${ext}`;
    await fs.writeFile(path.join(dir, fname), buf);
    saved.push({ localPath: `${publicBase}/${fname}`, mediaType: "image" });
    log(taskId, "info", `下载第 ${i + 1} 张图像`);
  }

  // Videos (mp4 / gif / webm)
  for (let i = 0; i < videos.length; i++) {
    const v = videos[i];
    const buf = await getView(v.filename, v.subfolder ?? "", v.type ?? "");
    const ext = path.extname(v.filename) || ".mp4";
    const fname = `vid_${i}${ext}`;
    await fs.writeFile(path.join(dir, fname), buf);
    saved.push({ localPath: `${publicBase}/${fname}`, mediaType: "video" });
    log(taskId, "info", `下载第 ${i + 1} 个视频`);
  }

  // Audio (SaveAudio / AudioComposite)
  for (let i = 0; i < audios.length; i++) {
    const a = audios[i];
    const buf = await getView(a.filename, a.subfolder ?? "", a.type ?? "");
    const ext = path.extname(a.filename) || ".wav";
    const fname = `aud_${i}${ext}`;
    await fs.writeFile(path.join(dir, fname), buf);
    saved.push({ localPath: `${publicBase}/${fname}`, mediaType: "audio" });
    log(taskId, "info", `下载第 ${i + 1} 个音频`);
  }

  // Generic 3D / unknown file outputs (mesh, gltf, obj, …)
  for (let i = 0; i < others.length; i++) {
    const o = others[i];
    const buf = await getView(o.filename, o.subfolder ?? "", o.type ?? "");
    const ext = path.extname(o.filename) || ".bin";
    const fname = `file_${i}${ext}`;
    await fs.writeFile(path.join(dir, fname), buf);
    saved.push({ localPath: `${publicBase}/${fname}`, mediaType: "other" });
    log(taskId, "info", `下载第 ${i + 1} 个文件`);
  }

  // Text outputs (ShowText): persist as .txt so the result is inspectable.
  for (let i = 0; i < texts.length; i++) {
    const fname = `txt_${i}.txt`;
    await fs.writeFile(path.join(dir, fname), texts[i], "utf-8");
    saved.push({ localPath: `${publicBase}/${fname}`, mediaType: "text" });
    log(taskId, "info", `保存第 ${i + 1} 段文本`);
  }

  // R-ardot62 (2026-08-15): 把真 seed + 采样器元数据一起回写 Task。
  // priority：actualSeed (history) > reqSeed (用户填) > null。`runtime` 块独立于
  // `params.seed` 字段（用户输入），便于审计「用户填了什么 vs server 跑的是什么」。
  const taskParamsPatched: Record<string, any> = { ...taskParams };
  if (Object.keys(runtime).length > 0) {
    taskParamsPatched.runtime = {
      ...(typeof taskParamsPatched.runtime === "object" && taskParamsPatched.runtime ? taskParamsPatched.runtime : {}),
      ...(actualSeed !== undefined ? { seed: actualSeed } : {}),
      ...(runtime.steps !== undefined ? { steps: runtime.steps } : {}),
      ...(runtime.cfg !== undefined ? { cfg: runtime.cfg } : {}),
      ...(runtime.sampler_name ? { sampler_name: runtime.sampler_name } : {}),
      ...(runtime.scheduler ? { scheduler: runtime.scheduler } : {}),
      ...(runtime.denoise !== undefined ? { denoise: runtime.denoise } : {}),
      ...(runtime.samplerClassType ? { sampler_class: runtime.samplerClassType } : {}),
      ...(runtime.samplerNodeId ? { sampler_node: runtime.samplerNodeId } : {}),
      source: "history",
    };
  }

  // ── 方案 B (2026-08-15): 任务完成时双写执行快照到 DB 行 ──
  // WorkflowTemplate 是覆盖式单行存储，模板重新导入会整体覆盖 rawJson/graph，
  // 导致历史任务无法精确复现当时实际跑的工作流。这里把本次执行实际用到的
  // workflow 一并写进 Task.workflowSnapshot，使「任务」与「模板当前版本」彻底
  // 解耦、可独立复现。`source: "execution"` 标记这是执行时自动捕获的独立副本。
  const workflowSnapshot =
    executedWorkflow != null
      ? {
          workflow: executedWorkflow,
          capturedAt: new Date().toISOString(),
          source: "execution",
        }
      : undefined;

  await prisma.task.update({
    where: { id: taskId },
    data: {
      status: "SUCCEEDED",
      progress: 100,
      finishedAt: new Date(),
      resultImages: saved as any,
      params: taskParamsPatched as any,
      // 仅当本次确有可执行工作流快照时才写入，避免覆盖回填脚本后续可能写的记录。
      ...(workflowSnapshot ? { workflowSnapshot: workflowSnapshot as any } : {}),
    },
  });
  await prisma.taskImage.createMany({
    data: saved.map((s2, i) => ({
      taskId,
      localPath: s2.localPath,
      sortIndex: i,
      isCover: i === 0,
      mediaType: s2.mediaType,
      seed:
        actualSeed !== undefined
          ? String(actualSeed)
          : reqSeed ?? null,
      width: s2.mediaType === "image" ? reqW ?? null : null,
      height: s2.mediaType === "image" ? reqH ?? null : null,
    })),
  });

  // 2026-08-13 项目级产出：写一份可复现的 manifest，便于「按项目归档 + 一键还原」。
  const manifest = {
    taskId,
    projectId,
    workflowName: taskRow?.workflowName ?? null,
    prompt: taskRow?.prompt ?? null,
    negativePrompt: taskRow?.negativePrompt ?? null,
    seed: actualSeed !== undefined ? String(actualSeed) : reqSeed ?? null,
    size: sizeStr || null,
    referenceImages: (taskRow?.referenceImages as string[] | null) ?? [],
    params: taskParams,
    createdAt: taskRow?.createdAt ?? null,
    files: saved,
  };
  await fs
    .writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf-8")
    .catch(() => {});

  // R-ardot65 (2026-08-15): 落盘本次执行实际用到的 workflow.json。种子等已在
  // manifest.seed + TaskImage.seed 持久化，工作流模板后续改动时凭这份快照即可
  // 完整复现本次生成结果。raw 路径为 liblib subgraph 格式（未展开），api 路径为
  // 已展开 graph。
  if (executedWorkflow != null) {
    await fs
      .writeFile(path.join(dir, "workflow.json"), JSON.stringify(executedWorkflow, null, 2), "utf-8")
      .catch(() => {});
  }

  await persistLogs(taskId);
  // R-ardot111 (2026-08-17): emit "总耗时 Xs" so the user can see
  // the wall-clock duration of the whole run.  Falls back to a
  // generic note if startedAt is missing (which can happen for
  // tasks enqueued in a previous server lifetime and re-claimed on
  // a re-attach — extremely rare).
  const startedAt = s.startedAt.get(taskId);
  if (startedAt) {
    const elapsedSec = Math.max(0, Math.round((Date.now() - startedAt) / 100) / 10);
    log(taskId, "info", `✓ 全部完成（总耗时 ${elapsedSec}s）`);
    s.startedAt.delete(taskId);
  }
  s.lastNodeByTask.delete(taskId);
  s.emitter.emit(taskId, { type: "done", images: saved });
  s.promptToTask.delete(promptId);
  s.promptByTask.delete(taskId);
  s.executedWorkflow.delete(taskId);
  s.lastLogPct.delete(taskId);
  s.active = Math.max(0, s.active - 1);
  processQueue();
}

/**
 * 从 ComfyUI history 的 prompt graph 里抽取本次执行**实际使用**的 KSampler 参数。
 *
 * 为什么需要这个？KSampler 的真实 seed 来自 server 端的 `control_after_generate`
 * 处理（randomize 时随机、increment/decrement 时上下浮动），写入 history 但**不**
 * 出现在 `entry.outputs` 里（outputs 只有图像文件）。前端看到的工作流默认 seed
 * 是 UI 元数据，对 randomize 节点而言不是真实执行值。
 *
 * 形态参考（来自 0.33.1 history entry.prompt[2]）：
 *   "76:69": {
 *     "class_type": "KSampler",
 *     "inputs": { "seed": 941524759465139, "steps": 25, "cfg": 4, "denoise": 0.7, ... }
 *   }
 *
 * 取 graph 顺序第一个 KSampler/KSamplerAdvanced 为主采样器。返回值所有字段都可能
 * 为 `undefined`，调用方自行决定是否覆盖请求默认值。
 */
export type RuntimeParams = {
  seed?: number;
  steps?: number;
  cfg?: number;
  sampler_name?: string;
  scheduler?: string;
  denoise?: number;
  samplerNodeId?: string;
  samplerClassType?: string;
};

export function extractRuntimeParams(entry: any): RuntimeParams {
  const out: RuntimeParams = {};
  const graph = entry?.prompt?.[2];
  if (!graph || typeof graph !== "object") return out;
  for (const [nid, node] of Object.entries(graph) as [string, any][]) {
    const t = typeof node?.class_type === "string" ? node.class_type : "";
    // KSamplerAdvanced 用 noise_seed；KSampler / SamplerCustom 用 seed。
    if (t !== "KSampler" && t !== "KSamplerAdvanced" && t !== "SamplerCustom") continue;
    const inputs = node?.inputs ?? {};
    if (out.samplerNodeId === undefined) {
      out.samplerNodeId = nid;
      out.samplerClassType = t;
    }
    // 仅看第一个主采样器：后续出现的同类型不覆盖。
    if (out.samplerNodeId !== nid) continue;
    const seedRaw = inputs.noise_seed ?? inputs.seed;
    const n =
      typeof seedRaw === "number"
        ? seedRaw
        : typeof seedRaw === "string" && seedRaw.trim() !== "" && Number.isFinite(Number(seedRaw))
          ? Number(seedRaw)
          : undefined;
    if (typeof n === "number" && Number.isFinite(n) && out.seed === undefined) out.seed = n;
    if (typeof inputs.steps === "number" && out.steps === undefined) out.steps = inputs.steps;
    if (typeof inputs.cfg === "number" && out.cfg === undefined) out.cfg = inputs.cfg;
    if (typeof inputs.sampler_name === "string" && inputs.sampler_name && out.sampler_name === undefined)
      out.sampler_name = inputs.sampler_name;
    if (typeof inputs.scheduler === "string" && inputs.scheduler && out.scheduler === undefined)
      out.scheduler = inputs.scheduler;
    if (typeof inputs.denoise === "number" && out.denoise === undefined) out.denoise = inputs.denoise;
  }
  return out;
}

// Map raw ComfyUI/node errors to user-actionable hints.
//
// Why we don't just `String(raw)`: some ComfyUI builds (kaytool's v0.28
// included) emit `exception_message` as a structured object instead of a
// plain string, and tracebacks can be arrays of frames. A naive
// `Object.prototype.toString` would collapse all of those to
// "[object Object]", hiding the actual reason from the user.  This
// helper recursively peels known fields, falling back to a pretty-printed
// JSON dump so *something* informative always lands in `task.error`.
export function friendlyError(raw: unknown): string {
  if (raw == null) return "";
  if (typeof raw === "string") return raw;
  if (typeof raw === "number" || typeof raw === "boolean") return String(raw);
  if (typeof raw === "bigint") return raw.toString();
  if (Array.isArray(raw)) {
    const parts = raw.map(friendlyError).filter((s) => s && s.trim());
    return parts.length ? parts.join("\n") : "";
  }
  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    // Ordered preference: ComfyUI's own canonical fields first, then
    // generic exception shape (Error.message / details / reason).
    const candidates: (keyof typeof o)[] = [
      "exception_message",
      "message",
      "error",
      "details",
      "reason",
      "msg",
      "detail",
      "description",
    ];
    for (const k of candidates) {
      const v = o[k];
      if (typeof v === "string" && v.trim()) return v;
    }
    // Some ComfyUI exception_payloads nest `exception_message` deeper
    // (e.g. `{ data: { exception_message: "..." } }`).
    for (const k of ["data", "exception", "exception_payload"]) {
      const inner = o[k];
      if (inner && typeof inner === "object") {
        const innerText = friendlyError(inner);
        if (innerText && innerText.trim()) return innerText;
      }
    }
    // Last resort: pretty-print the object so the user at least sees
    // *something* other than "[object Object]".  Cap length so a
    // gigantic traceback payload can't blow up the DB column.
    try {
      const json = JSON.stringify(raw, null, 2);
      return json.length > 4000 ? json.slice(0, 4000) + "\n…(truncated)" : json;
    } catch {
      return "[unserializable error]";
    }
  }
  // Fallback for symbols / functions — should not happen, but be safe.
  return String(raw);
}

/** Build a human-readable failure message from ComfyUI's /prompt response.
 *  ComfyUI returns `node_errors` keyed by node id, each with `input_errors`
 *  (field → {message}) or a top-level `message`. Surface those instead of a
 *  generic "节点配置错误" so the user can fix the actual bad value. */
function buildPromptError(res: any, graph: Record<string, any>): string {
  // R69: previously `String(res.error)` — that collapses a structured
  // error object to the literal "[object Object]" and gets stored as
  // the task's error string, which then surfaces verbatim in the UI.
  // Reuse friendlyError so structured payloads (kaytool etc.) are
  // peeled to the real `.exception_message`/`.message`, and only the
  // true unknown-type cases fall through to a generic explanation.
  if (res?.error != null) {
    const peeled = friendlyError(res.error);
    if (peeled && peeled.trim() && peeled.trim() !== "[object Object]") return peeled;
  }
  const ne = res?.node_errors;
  if (!ne || !Object.keys(ne).length) return "节点配置错误";
  const lines: string[] = [];
  for (const [nid, err] of Object.entries(ne) as [string, any][]) {
    const cls = err?.class_type ?? graph?.[nid]?.class_type ?? "";
    let detail = "";
    if (err?.input_errors) {
      detail = Object.entries(err.input_errors)
        .map(([k, v]: [string, any]) => `${k}: ${v?.message ?? v?.details ?? JSON.stringify(v)}`)
        .join("; ");
    } else if (typeof err?.message === "string") {
      detail = err.message;
    } else if (typeof err === "string") {
      detail = err;
    }
    lines.push(`节点 ${nid}${cls ? ` (${cls})` : ""}: ${detail || "配置错误"}`);
  }
  return `节点配置错误:\n${lines.join("\n")}`;
}

/** 对外的失败入口：先抢终态，再收口。
 *  `validationErrors` 为可选的结构化校验错误（ComfyUI /prompt 的
 *  `node_errors` 拆解），仅在「提交即校验失败」路径传入；其它失败
 *  （超时/执行异常）不携带，落库为 null。 */
async function fail(
  taskId: string,
  promptId: string,
  error: unknown,
  validationErrors?: ValidationError[]
) {
  if (!claimSettle(taskId)) return;
  await finalizeFailure(taskId, promptId, error, validationErrors);
}

/** 真正的失败收口。**不做 settled 判断** —— 调用方必须已经抢到终态。
 *  `error` 故意放宽为 `unknown`：ComfyUI 的 `execution_error.exception_message`
 *  在某些版本（kaytool v0.28）里是结构化对象，`friendlyError` 会剥出真正的
 *  `.message`/`.exception_message`，而不是直接 toString() 成 "[object Object]"。*/
async function finalizeFailure(
  taskId: string,
  promptId: string,
  error: unknown,
  validationErrors?: ValidationError[]
) {
  const s = state();
  const friendly = friendlyError(error) || "任务失败";
  // R-ardot111 (2026-08-17): emit total elapsed time on the failure
  // branch too, so the user knows "this task actually ran for Xs
  // before failing" rather than "it died immediately".
  const startedAt = s.startedAt.get(taskId);
  const elapsedSuffix = startedAt
    ? `（已运行 ${Math.max(0, Math.round((Date.now() - startedAt) / 100) / 10)}s）`
    : "";
  log(taskId, "error", `✗ 生成失败：${friendly}${elapsedSuffix}`);

  await prisma.task.update({
    where: { id: taskId },
    data: {
      status: "FAILED",
      error: friendly,
      // R-Next (2026-08-17): structured validation errors from ComfyUI's
      // /prompt `node_errors`, so the UI can render a precise per-field list
      // instead of parsing the English summary string in `error`.
      validationErrors:
        validationErrors && validationErrors.length
          ? JSON.stringify(validationErrors)
          : null,
      finishedAt: new Date(),
    },
  });

  await persistLogs(taskId);
  // R-ardot111 (2026-08-17): clean up the per-task state we added so
  // a re-enqueue of the same taskId starts from a clean slate.
  if (startedAt) s.startedAt.delete(taskId);
  s.lastNodeByTask.delete(taskId);
  /* R-ardot116 (2026-08-18): previously finalizeFailure only emitted
   *  an `error` event.  The `error` event closes the SSE stream (see
   *  /api/tasks/[id]/stream/route.ts:54-59) so a `state` patch
   *  carrying structured `validationErrors` would never reach the
   *  client.  cancelTask() already does the right thing — it emits
   *  `state` first, then `error`.  Mirror that here so the panel
   *  gets the structured diagnostic *while the stream is still
   *  open* and patches d.validationErrors before the close.  Order
   *  matters: state first (heal UI), error second (close socket). */
  s.emitter.emit(taskId, {
    type: "state",
    status: "FAILED",
    progress: 0,
    error: friendly,
    validationErrors: validationErrors && validationErrors.length ? validationErrors : [],
  });
  s.emitter.emit(taskId, { type: "error", error: friendly });
  if (promptId) s.promptToTask.delete(promptId);
  s.promptByTask.delete(taskId);
  s.lastLogPct.delete(taskId);
  s.active = Math.max(0, s.active - 1);
  processQueue();
}

/* ── comfy-cli execution path ───────────────────────────────────────────────
 * Raw UI-format workflows (e.g. liblib subgraph wrappers whose `rawJson` carries
 * a UUID `class_type` wrapper) cannot be POSTed directly to ComfyUI — the backend
 * rejects the UUID class_type. comfy-cli does the canonical client-side
 * UI→API conversion + subgraph expansion (the same `graphToPrompt` the official
 * frontend runs), so we delegate submission to it and harvest results through the
 * shared history→download→DB path (`complete`/`fail`).
 * ─────────────────────────────────────────────────────────────────────── */

const cliProcs = new Map<string, ChildProcess>();
const CLI_TIMEOUT_MS = 25 * 60 * 1000;

/** Map an API-format node id (e.g. "76:67") or top-level id to the raw UI node. */
function resolveRawNode(raw: any, nodeId: string): any | null {
  const subs = raw?.definitions?.subgraphs;
  const subList: any[] = Array.isArray(subs) ? subs : Object.values(subs ?? {});
  if (nodeId.includes(":")) {
    const internalId = nodeId.split(":").pop()!;
    for (const sg of subList) {
      const n = (sg?.nodes ?? []).find((x: any) => String(x.id) === internalId);
      if (n) return n;
    }
    return null;
  }
  const top = (raw?.nodes ?? []).find((n: any) => String(n.id) === nodeId);
  if (top) return top;
  for (const sg of subList) {
    const n = (sg?.nodes ?? []).find((x: any) => String(x.id) === nodeId);
    if (n) return n;
  }
  return null;
}

/** Index of a named widget input within a UI node's `widgets_values` array. */
function widgetSlot(node: any, name: string): number {
  const inputs = node?.inputs ?? [];
  let slot = 0;
  for (const inp of inputs) {
    if (inp?.widget) {
      if (inp.name === name) return slot;
      slot++;
    }
  }
  return -1;
}

/** Best-effort injection of canvas `workflowInputs` into the raw UI json. */
export function applyRawOverrides(rawJson: any, overrides?: RawWorkflowOverride[]): any {
  if (!overrides?.length) return rawJson;
  const raw = JSON.parse(JSON.stringify(rawJson));
  for (const ov of overrides) {
    if (!ov?.nodeId || ov.value === undefined) continue;
    const node = resolveRawNode(raw, ov.nodeId);
    if (!node) continue;

    // Seed "control after generate" is NOT a named widget in raw UI format — it
    // is serialized as the widgets_values slot immediately after the seed widget.
    // Resolve the seed widget slot and target slot+1. (API-format graphs instead
    // carry a real `control_after_generate` input, handled by the name branch.)
    if (ov.name === "control_after_generate") {
      const seedSlot = seedWidgetSlot(node);
      if (seedSlot < 0) continue;
      if (!Array.isArray(node.widgets_values)) node.widgets_values = [];
      node.widgets_values[seedSlot + 1] = ov.value;
      continue;
    }

    const slot = widgetSlot(node, ov.name);
    if (slot < 0) continue;
    if (!Array.isArray(node.widgets_values)) node.widgets_values = [];
    node.widgets_values[slot] = ov.value;
  }
  return raw;
}

/** Index of the seed-type widget within a UI node's `widgets_values` array.
 *  Returns -1 when the node has no seed-like widget. */
function seedWidgetSlot(node: any): number {
  const inputs = node?.inputs ?? [];
  let slot = 0;
  for (const inp of inputs) {
    if (!inp?.widget) continue;
    const wname = typeof inp.widget === "string" ? inp.widget : inp.widget.name ?? inp.name;
    if (typeof wname === "string" && /seed|noise_seed/i.test(wname)) return slot;
    slot++;
  }
  return -1;
}

async function executeViaComfyCli(job: Job) {
  const s = state();
  const { taskId, rawJson, overrides } = job;
  // R-ardot115 (2026-08-18): the entry line of the raw path so the
  // user can see in the log panel exactly which method is handling
  // their task.  Before this it was silent until the first stdout
  // JSON event arrived (often 5-30s in, the Python venv boot).
  log(taskId, "info", `→ executeViaComfyCli 入口（raw UI-format）`);
  const base = await resolveComfyBase();
  let host = "127.0.0.1";
  let port = 8188;
  try {
    const u = new URL(base);
    host = u.hostname === "localhost" ? "127.0.0.1" : u.hostname;
    port = parseInt(u.port) || 8188;
  } catch { /* keep defaults */ }
  log(taskId, "info", `ComfyUI 目标：${host}:${port}（${base}）`);

  const patched = applyRawOverrides(rawJson, overrides);
  const tmpDir = path.join(process.cwd(), ".workbuddy", "tmp");
  await fs.mkdir(tmpDir, { recursive: true });
  const tmpFile = path.join(tmpDir, `wf-${taskId}.json`);
  log(taskId, "info", `写入临时工作流文件：${tmpFile}`);
  await fs.writeFile(tmpFile, JSON.stringify(patched), "utf-8");
  // R-ardot65 (2026-08-15): 记下本次实际提交给 ComfyUI 的 workflow（liblib
  // subgraph 未展开格式），任务完成落盘为 workflow.json 供完整复现。
  s.executedWorkflow.set(taskId, patched);
  log(
    taskId,
    "info",
    `工作流文件就绪（${Object.keys((patched as any)?.nodes ?? {}).length || Object.keys(patched as any).length} 节点）`
  );

  const binDir = process.platform === "win32" ? "Scripts" : "bin";
  const pyName = process.platform === "win32" ? "python.exe" : "python";
  const py = path.join(
    process.cwd(),
    ".workbuddy",
    "python-venv",
    "comfy-cli",
    binDir,
    pyName
  );
  const args = [
    "-m", "comfy_cli", "run",
    "--workflow", tmpFile,
    "--json", "--wait",
    "--where", "local",
    "--host", host,
    "--port", String(port),
    "--no-notify",
    "--timeout", "600",
  ];

  // R-ardot115 (2026-08-18): surface the literal comfy-cli command so
  // the user (and we, on support) can reproduce the exact invocation
  // from the log panel without digging through devtools.
  log(
    taskId,
    "info",
    `comfy-cli 执行 raw 工作流（${host}:${port}）`
  );
  log(taskId, "info", `  ${pyName} ${args.join(" ")}`);
  // R-ardot111 (2026-08-17): explicit pre-spawn line so the user
  // sees a "→ 启动" marker before the (potentially slow) Python
  // boot.  Without this, the first log on a raw submission was
  // "comfy-cli 执行 raw 工作流" + a long silence, which looks
  // indistinguishable from a hang.
  log(taskId, "info", `→ 启动 comfy-cli 进程（raw UI-format → API 转换）`);
  s.emitter.emit(taskId, {
    type: "log",
    entry: { t: Date.now(), level: "info", msg: "已使用 comfy-cli 提交 raw 工作流" },
  });

  let promptId: string | null = null;
  let settled = false;

  const child = spawn(py, args, {
    cwd: process.cwd(),
    env: { ...process.env, DO_NOT_TRACK: "1", COMFY_CLI_NO_TELEMETRY: "1" },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  cliProcs.set(taskId, child);
  log(
    taskId,
    "info",
    `comfy-cli 进程已启动（pid=${child.pid ?? "?"}，等待 stdout…）`
  );

  const guard = setTimeout(() => {
    if (settled) return;
    settled = true;
    try { child.kill("SIGKILL"); } catch { /* ignore */ }
    cliProcs.delete(taskId);
    void fail(taskId, promptId ?? "", "comfy-cli 执行超时（看门狗）");
  }, CLI_TIMEOUT_MS);

  // R-ardot115 (2026-08-18): flatten /prompt errors returned via
  // comfy-cli's envelope into a structured `validationErrors[]` and
  // pass them to `fail()` as the 4th arg, mirroring the API-format
  // branch at line ~1226.  comfy-cli ships the upstream /prompt
  // response under `env.error`; we look for `node_errors` first, then
  // fall back to the message string.  Without this, the user only
  // ever saw "Workflow has N validation error(s) against server"
  // with no per-field breakdown, and the "↻ 重新执行" hint for
  // re-running to populate structure was a no-op (re-running the
  // SAME workflow would produce the SAME envelope with the SAME
  // unflattened payload).
  // R-ardot118 (2026-08-18): comfy-cli wraps the upstream /prompt
  // payload in an `envelope`. The structured `node_errors` lands at
  // several possible positions depending on the comfy-cli version:
  //   • error.details.node_errors  → LIST of records (this is what
  //     `_node_errors_to_list()` produces and what actually reaches us)
  //   • error.node_errors          → dict (defensive)
  //   • node_errors                → dict (defensive)
  //   • data/response/result.*     → future-proofing
  // A single `env.error.node_errors` check (the old code) only ever saw
  // {code, message, hint, details} — which has NO `node_errors` — so the
  // 6-item per-field list never rendered.  Deep-search the envelope for
  // `node_errors` (dict or list) and hand it to extractValidationErrors,
  // which now accepts both shapes.
  const findNodeErrorsCarrier = (root: any, depth = 5): any => {
    if (!root || typeof root !== "object") return undefined;
    const seen = new WeakSet<any>();
    const stack: { node: any; d: number }[] = [{ node: root, d: 0 }];
    while (stack.length) {
      const { node, d } = stack.pop()!;
      if (d > depth || seen.has(node)) continue;
      seen.add(node);
      if (node && typeof node === "object") {
        const ne = (node as any).node_errors;
        if (ne != null && (Array.isArray(ne) ? ne.length : Object.keys(ne).length)) {
          return ne;
        }
        for (const v of Object.values(node)) {
          if (v && typeof v === "object") stack.push({ node: v, d: d + 1 });
        }
      }
    }
    return undefined;
  };

  const extractEnvelopeValidationErrors = (env: any): ValidationError[] | undefined => {
    const carrier = findNodeErrorsCarrier(env);
    if (!carrier) return undefined;
    return extractValidationErrors(carrier, patched);
  };

  const finish = (ok: boolean, env: any) => {
    if (settled) return;
    settled = true;
    clearTimeout(guard);
    cliProcs.delete(taskId);
    if (ok) {
      void complete(taskId, promptId ?? "");
    } else {
      const err = env?.error;
      const msg =
        (typeof err?.message === "string" && err.message) ||
        (typeof err?.hint === "string" && err.hint) ||
        "comfy-cli 执行失败";
      const validationErrors = extractEnvelopeValidationErrors(env);
      if (validationErrors && validationErrors.length) {
        // Mirror the API-format branch's behaviour: surface the
        // structured list in a single log line for the user, then
        // pass it to fail() so the UI can render a per-field block.
        log(
          taskId,
          "error",
          `✗ comfy-cli 报 ${validationErrors.length} 条校验错误（见上方红框）`
        );
        validationErrors.slice(0, 12).forEach((ve) => {
          log(
            taskId,
            "error",
            `  · 节点 ${ve.nodeId}${ve.classType ? ` (${ve.classType})` : ""}` +
              (ve.field ? ` · 字段 ${ve.field}` : "") +
              `：${ve.message}`
          );
        });
        if (validationErrors.length > 12) {
          log(
            taskId,
            "error",
            `  …还有 ${validationErrors.length - 12} 条（请查看红框/重新执行工作流查看完整清单）`
          );
        }
      } else {
        // Comprehensive-detection safety net (R-ardot118): the message
        // says "validation error" but the deep search found no
        // structured `node_errors`.  Dump the raw envelope (truncated)
        // so a support re-run can see the real shape instead of a
        // silent "Workflow has N validation error(s)" line.
        const rawMsg = typeof msg === "string" ? msg : "";
        if (/validation error/i.test(rawMsg) || env?.error?.code === "prompt_rejected") {
          try {
            const dump = JSON.stringify(env).slice(0, 900);
            log(
              taskId,
              "warn",
              `⚠ 未从 comfy-cli envelope 解析出结构化校验错误，原始 envelope（截断）：${dump}`
            );
          } catch {
            /* stringify can throw on circular refs — ignore */
          }
        }
      }
      void fail(taskId, promptId ?? "", msg, validationErrors);
    }
  };

  let buf = "";
  let nonJsonLines = 0;
  child.stdout?.setEncoding("utf-8");
  child.stdout?.on("data", (chunk: string) => {
    buf += chunk;
    let idx: number;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      let ev: any = null;
      try { ev = JSON.parse(line); } catch {
        // R-ardot115 (2026-08-18): surface non-JSON lines too so the
        // user can see when comfy-cli prints a Python traceback or
        // import error.  Cap to avoid flooding the panel during
        // legitimate verbose output.
        nonJsonLines++;
        if (nonJsonLines <= 20) {
          const trimmed = line.length > 240 ? line.slice(0, 240) + "…" : line;
          log(taskId, "info", `[comfy-cli stdout] ${trimmed}`);
        } else if (nonJsonLines === 21) {
          log(taskId, "info", `[comfy-cli stdout] …后续非 JSON 行已省略（查看后端日志）`);
        }
        continue;
      }
      if (!ev || typeof ev !== "object") continue;
      if (ev.type === "queued" && ev.prompt_id) {
        promptId = ev.prompt_id;
        s.promptToTask.set(ev.prompt_id, taskId);
        void prisma.task
          .update({ where: { id: taskId }, data: { status: "RUNNING", promptId: ev.prompt_id } })
          .catch(() => {});
        // R-ardot111 (2026-08-17): mirror the API-format branch's
        // "✓ 已接收…等待 executing" wording so the log panel shows a
        // consistent vocabulary across both submission paths.
        log(taskId, "info", `✓ comfy-cli 已提交（prompt_id: ${promptId}），等待节点执行…`);
      } else if (ev.type === "envelope") {
        finish(Boolean(ev.ok), ev);
      } else if (
        ev.type === "progress" &&
        typeof ev.completed === "number" &&
        typeof ev.total === "number" &&
        ev.total > 0
      ) {
        s.emitter.emit(taskId, {
          type: "progress",
          progress: Math.round((ev.completed / ev.total) * 100),
        });
      } else if (ev.type === "executing" || ev.type === "execution_success") {
        // R-ardot115 (2026-08-18): forward the raw CLI events for
        // per-node visibility (we can't map them back to the raw
        // graph class_type here without the original UUIDs, but the
        // node id + event type alone is enough to show "something is
        // running").
        const node = ev.node ?? ev.data?.node ?? "?";
        log(
          taskId,
          "info",
          ev.type === "execution_success"
            ? `✓ comfy-cli 节点 [${node}] 执行完成`
            : `▶ comfy-cli 节点 [${node}] 开始执行`
        );
      }
    }
  });

  // R-ardot115 (2026-08-18): stream stderr live so Python tracebacks
  // appear in the panel as they happen, instead of only at close().
  let errBuf = "";
  let errLines = 0;
  child.stderr?.setEncoding("utf-8");
  child.stderr?.on("data", (d: string) => {
    errBuf += d;
    const lines = d.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      errLines++;
      if (errLines <= 30) {
        const t = trimmed.length > 240 ? trimmed.slice(0, 240) + "…" : trimmed;
        log(taskId, "warn", `[comfy-cli stderr] ${t}`);
      } else if (errLines === 31) {
        log(taskId, "warn", `[comfy-cli stderr] …后续错误行已省略（查看后端日志）`);
      }
    }
  });

  child.on("close", (code) => {
    clearTimeout(guard);
    cliProcs.delete(taskId);
    if (settled) return;
    settled = true;
    const tail = errBuf.trim().split("\n").slice(-12).join("\n");
    log(
      taskId,
      "error",
      `comfy-cli 进程已退出（code=${code}），未收到 envelope 事件`
    );
    void fail(taskId, promptId ?? "", `comfy-cli 异常退出（code=${code}）\n${tail || "(无 stderr)"}`);
  });

  child.on("error", (err) => {
    if (settled) return;
    settled = true;
    clearTimeout(guard);
    cliProcs.delete(taskId);
    log(taskId, "error", `comfy-cli 启动失败：${err.message}`);
    void fail(taskId, promptId ?? "", `comfy-cli 启动失败：${err.message}`);
  });
}

async function processQueue() {
  const s = state();
  if (s.active >= MAX_CONCURRENCY) return;
  if (!s.ws || s.ws.readyState !== WebSocket.OPEN) {
    connect();
    return;
  }
  const job = s.queue.shift();
  if (!job) return;
  s.active += 1;

  try {
    // raw UI-format 工作流（含 liblib 子图 wrapper）：交给 comfy-cli 做
    // UI→API 转换 + 子图展开，原生客户端 graphToPrompt，绕开 UUID class_type。
    // R-ardot113 (2026-08-17): the previous `void executeViaComfyCli(job)`
    // (no .catch) was a *latent* active-slot deadlock.  If
    // `executeViaComfyCli` rejected synchronously (resolveComfyBase
    // throw, writeFile EACCES, spawn ENOENT on a missing Python
    // binary…), the rejection became an unhandled promise, no
    // fail()/finalizeFailure() ever ran, and `s.active` stayed
    // pegged at 1 forever.  That pegged slot then blocked every
    // later enqueue — task visible in the UI as "QUEUED 0%",
    // stuck indefinitely.  We now `.catch` the rejection and
    // funnel it through the same `finalizeFailure` path that
    // every other failure mode uses, so `s.active--` always fires
    // and the next queued job gets a chance.
    if (job.rawJson) {
      void executeViaComfyCli(job).catch(async (err) => {
        const msg = err instanceof Error ? err.message : String(err);
        log(job.taskId, "error", `raw 工作流启动异常：${msg}`);
        try {
          await finalizeFailure(job.taskId, "", msg);
        } catch (inner) {
          /* finalizeFailure may itself throw (DB down) — don't
           *  recurse into another catch, just log and release
           *  the slot manually so the queue keeps moving. */
          log(
            job.taskId,
            "error",
            `finalizeFailure 二次失败：${inner instanceof Error ? inner.message : String(inner)}`
          );
          if (s.startedAt.has(job.taskId)) s.startedAt.delete(job.taskId);
          s.lastNodeByTask.delete(job.taskId);
          s.active = Math.max(0, s.active - 1);
          processQueue();
        }
      });
      return;
    }
    // 提交前剔除 bypass / mute / 纯前端节点(Reroute/Primitive/Note)，
    // 并对连线做穿透，严格对齐 ComfyUI 真实执行语义（P1：mode/Reroute）。
    const prep = prepareGraphForExecution(job.prompt!);
    // R-ardot65 (2026-08-15): 记下本次实际提交给 ComfyUI 的 graph（已展开、已穿透），
    // 任务完成落盘为 workflow.json 供完整复现。
    s.executedWorkflow.set(job.taskId, prep.graph);
    if (!Object.keys(prep.graph).length) {
      await fail(job.taskId, "", "工作流没有可执行的节点（可能全部被禁用）");
      return;
    }
    if (prep.removed.length) {
      log(
        job.taskId,
        "info",
        `执行前跳过 ${prep.removed.length} 个禁用/纯前端节点` +
          (prep.droppedInputs ? `，丢弃 ${prep.droppedInputs} 个悬空输入` : "")
      );
    }
    // R-ardot111 (2026-08-17): explicit pre-submit log so the user
    // sees a clear "→ 提交" line right before the HTTP POST to
    // ComfyUI.  Useful when /prompt hangs or rejects — without this
    // the user only ever sees the post-submit "✓ 已接收" line, which
    // makes it impossible to tell whether the request was ever sent.
    const nodeCount = Object.keys(prep.graph).length;
    log(job.taskId, "info", `→ 准备提交到 ComfyUI /prompt（${nodeCount} 节点）`);
    const res = (await postPrompt(prep.graph, CLIENT_ID)) as any;
    if (res.error || (res.node_errors && Object.keys(res.node_errors).length)) {
      // R-Next (2026-08-17): carry the flattened `node_errors` into the task
      // so the UI can show "节点 X · 字段 Y：消息" instead of just the
      // "Workflow has N validation error(s)" summary.
      const validationErrors = extractValidationErrors(res, prep.graph);
      // R-ardot116 (2026-08-18): mirror the raw-path branch's behaviour
      // (lines 1199-1224) — surface the structured list as per-line
      // log entries so the user sees "节点 X (KSampler) · 字段 cfg：…"
      // in the log panel *before* the closing "✗ 生成失败" line, and
      // not just the English summary from `buildPromptError`.  Without
      // this, a user staring at the panel saw one line ("✗ 生成失败:
      // Workflow has 6 validation error(s) against server") and no
      // way to identify which of the 6 fields to fix.  Capped at 12 to
      // match the raw branch and avoid blowing up the DB row when a
      // workflow drifts badly.
      if (validationErrors.length) {
        log(
          job.taskId,
          "error",
          `✗ ComfyUI 报 ${validationErrors.length} 条校验错误（见下方逐条 + 红框清单）`
        );
        validationErrors.slice(0, 12).forEach((ve) => {
          log(
            job.taskId,
            "error",
            `  · 节点 ${ve.nodeId}${ve.classType ? ` (${ve.classType})` : ""}` +
              (ve.field ? ` · 字段 ${ve.field}` : "") +
              `：${ve.message}`
          );
        });
        if (validationErrors.length > 12) {
          log(
            job.taskId,
            "error",
            `  …还有 ${validationErrors.length - 12} 条（请查看红框 / 重新执行工作流查看完整清单）`
          );
        }
      }
      await fail(
        job.taskId,
        "",
        buildPromptError(res, prep.graph),
        validationErrors
      );
      return;
    }
    const promptId: string = res.prompt_id;
    s.promptToTask.set(promptId, job.taskId);
    await prisma.task.update({
      where: { id: job.taskId },
      data: { status: "RUNNING", promptId },
    });
    // R-ardot111 (2026-08-17): richer post-submit log so the user
    // can correlate the prompt_id they see in the panel with the
    // /history/{prompt_id} ComfyUI URL when investigating hangs.
    log(job.taskId, "info", `✓ ComfyUI 已接收（prompt_id: ${promptId}），等待首个 executing 事件…`);
    armWatchdog(job.taskId, promptId);
  } catch (e: any) {
    await fail(job.taskId, "", e?.message ?? "提交失败");
  }
}

export function enqueue(job: Job) {
  const s = state();
  s.settled.delete(job.taskId);
  s.queue.push(job);
  if (job.prompt) s.promptByTask.set(job.taskId, job.prompt);
  state().logs.set(job.taskId, []);
  // R-ardot111 (2026-08-17): stamp the start time so we can emit a
  // "总耗时 Xs" line at completion, and so the client log can show
  // task age for "stuck RUNNING" debugging.
  s.startedAt.set(job.taskId, Date.now());
  log(job.taskId, "info", "任务已加入执行队列");
  // R-ardot111 (2026-08-17): surface queue position + active slot
  // so the user can see whether the task is waiting on a peer or
  // about to run immediately.  This is the very first line they'll
  // see if they had the log panel open before clicking 生成.
  log(
    job.taskId,
    "info",
    `队列位置：${s.queue.length} / 活跃槽位：${s.active}/${MAX_CONCURRENCY}`
  );
  connect();
  void processQueue();
}

export function subscribe(taskId: string, cb: (e: TaskEvent) => void): () => void {
  const s = state();
  s.emitter.on(taskId, cb);
  return () => s.emitter.off(taskId, cb);
}

export function getLogs(taskId: string): LogEntry[] {
  return state().logs.get(taskId) ?? [];
}

export async function cancelTask(taskId: string) {
  const s = state();
  // Kill any comfy-cli subprocess driving this task before flipping status.
  const cliProc = cliProcs.get(taskId);
  if (cliProc) {
    try { cliProc.kill("SIGKILL"); } catch { /* ignore */ }
    cliProcs.delete(taskId);
  }
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { status: true, promptId: true },
  });
  if (!task) return;

  /* R-ardot121 (2026-08-18): previously this required
   *  `status === RUNNING || QUEUED`.  We now accept ANY non-terminal
   *  status — SUCCEEDED / FAILED / CANCELLED are skipped below — so
   *  users can cancel a stuck QUEUED row even when the in-memory
   *  state has been wiped (e.g. by a dev-server restart that the
   *  R-ardot121 reaper hasn't yet swept).  If the task has a
   *  promptId we still try `interrupt()` to tell ComfyUI to drop
   *  its prompt as well; if not, we just close out the DB row. */
  const isTerminal = (st: string | null) =>
    st === "SUCCEEDED" || st === "FAILED" || st === "CANCELLED";

  log(taskId, "warn", "用户取消任务");
  if (!isTerminal(task.status) && task.promptId) {
    try {
      await interrupt();
    } catch {
      /* ignore */
    }
  }

  await prisma.task.update({
    where: { id: taskId },
    data: { status: "CANCELLED", finishedAt: new Date() },
  });
  if (task.promptId) s.promptToTask.delete(task.promptId);
  s.promptByTask.delete(taskId);
  // R-ardot111 (2026-08-17): clean up the per-task bookkeeping we
  // added so a re-enqueue of the same taskId starts clean.
  s.startedAt.delete(taskId);
  s.lastNodeByTask.delete(taskId);
  /* R-ardot121 (2026-08-18): only release the runner's slot when we
   *  actually held one.  DB-only tasks (no in-memory job) must NOT
   *  decrement `s.active`, or a future `processQueue` call would
   *  briefly think a slot is free and try to enqueue a phantom job.
   *  `hadSlot` means we either owned the comfy-cli subprocess or
   *  had the task sitting in the in-memory queue. */
  const inQueue = s.queue.some((j) => j.taskId === taskId);
  const hadSlot = inQueue || cliProcs.has(taskId);
  if (hadSlot) s.active = Math.max(0, s.active - 1);
  /* R-ardot114 (2026-08-17): cancel previously only updated the DB
   *  and the in-memory slot, never pushed anything to the SSE
   *  emitter — so the frontend's d.status stayed at "running"
   *  forever and the "生成中…" button never came back.  Emit a
   *  synthetic state event so the canvas patch() flips the node
   *  to error, then a terminal error event so the EventSource
   *  onmessage handler closes the connection (matching the
   *  finalizeFailure pattern at line 886).  Order matters: state
   *  first (heal UI), error second (close socket). */
  s.emitter.emit(taskId, {
    type: "state",
    status: "CANCELLED",
    progress: 0,
    error: "用户取消",
    validationErrors: [],
  });
  s.emitter.emit(taskId, { type: "error", error: "用户取消" });
  // R-ardot115 (2026-08-18): flush any pending debounced log writes
  // for this task so the cancel-line + any in-flight warnings reach
  // the DB before we declare the row terminal.  Without this, a fast
  // cancel-then-reload could miss the "用户取消任务" entry.
  await persistLogs(taskId);
  if (hadSlot) processQueue();
}

/* R-ardot113 (2026-08-17): safety-net heartbeat.  `processQueue()`
 *  is normally driven by:
 *    (a) enqueue() right after the user clicks 生成
 *    (b) WS open  (line 181)
 *    (c) finalizeFailure / cancelTask (after active--)
 *
 *  In a few edge cases, none of these fire promptly:
 *    - The very first WS attempt fails during `new WebSocket()`,
 *      then `scheduleReconnect` defers the next attempt; during
 *      the back-off, a job sitting in `s.queue` has no trigger.
 *    - The handler that's supposed to call processQueue inside
 *      `executeViaComfyCli` runs, but the comfy-cli process spawn
 *      succeeds and the JS `spawn` promise resolves without ever
 *      emitting "queued" → no other life cycle re-fires it.
 *  Without a heartbeat, the user sees "QUEUED 0%" forever even
 *  though the slot is free and the WS is up.  We poll every 3s
 *  and re-run processQueue if it can make progress (queue non-
 *  empty, slot free, WS OPEN).  Idempotent — `processQueue` is a
 *  no-op when there's nothing to do.
 *
 *  Global flag to avoid double-heartbeats if the module is
 *  re-imported under HMR. */
const HEARTBEAT_MS = 3000;
let heartbeatHandle: ReturnType<typeof setInterval> | null = null;
function startHeartbeat() {
  if (heartbeatHandle) return;
  heartbeatHandle = setInterval(() => {
    try {
      const s = state();
      if (s.queue.length > 0 && s.active < MAX_CONCURRENCY) {
        processQueue();
      }
    } catch (err) {
      console.warn("[comfyui] heartbeat processQueue 失败：", err);
    }
  }, HEARTBEAT_MS);
}
startHeartbeat();

/* ── R-ardot121 (2026-08-18): DB-side QUEUED reaper ─────────────────────────
 * Symptom: after a dev-server cold restart (R-117), tasks in
 *   `status=QUEUED, promptId=null, finishedAt=null` linger forever —
 *   the in-memory `s.queue` is gone, the heartbeat only acts on
 *   the in-memory queue (R-ardot113 above), and no code path
 *   re-claims DB-side QUEUED rows.  The user sees "加入队列后就不
 *   继续执行了".
 *
 * Two layers of fix:
 *   (a) reapStaleQueuedTasks() — runs on module load + every 30s
 *       afterwards.  Any task that has been QUEUED for > STALE_MS
 *       without a `promptId` is marked FAILED with a clear reason
 *       so the user can see the explanation in the log panel and
 *       re-run.  Tasks WITH a promptId are ComfyUI's responsibility
 *       (it's in ComfyUI's queue, not ours), so we leave them alone.
 *   (b) cancelTask() now also handles the DB-only state (no in-memory
 *       entry) so the user has an escape hatch even before the
 *       30s reaper tick fires.
 */
const REAPER_MS = 30_000;
const STALE_MS = 30_000; // a QUEUED task older than this with no promptId is "dead"
/* R-ardot121 RUNNING reaper: a task that DID reach ComfyUI (promptId set)
 *  but whose in-memory runner got lost (dev cold restart, crash) is stuck
 *  as RUNNING forever — the heartbeat only re-drives the in-memory queue.
 *  ComfyUI's /queue has no reference to our in-memory state either, so
 *  we ask ComfyUI for the verdict:
 *    • /history/{promptId} has the entry → mark SUCCEEDED (or FAILED if
 *      execution_error). The output is in ComfyUI history; we don't
 *      re-fetch binaries here (separate concern), the reason string
 *      points the user to promptId.
 *    • 404 → ComfyUI never saw it (ComfyUI also restarted, or the prompt
 *      was rejected upstream) → mark FAILED orphan.
 *    • still in /queue → legitimately running, leave it; re-check next tick.
 *    • network error → leave it, re-check next tick.
 *  60s first check gives ComfyUI time to ack a fast image gen; reaper
 *  tick is 30s so a long video will reconcile shortly after ComfyUI
 *  finishes. */
const RUNNING_STALE_MS = 60_000;
const RUNNING_TICK_CAP = 5;

/* R-ardot121 HMR fix: under Next.js HMR the runner module is
 *  re-evaluated, so a plain module-scope `let reaperHandle` is reset to
 *  null on every reload and a SECOND setInterval is created.  Multiple
 *  intervals then concurrently run reapStaleQueuedTasks() — and because
 *  findMany→update is not atomic, the same QUEUED task gets logged 2-3×
 *  ("卡在队列 2203s/2210s/2217s").  Key both the handle and the
 *  in-flight guard on globalThis so there is exactly ONE reaper per
 *  process no matter how many HMR reloads happen. */
const REAPER_GLOBAL = "__comfyReaper_v1";
interface ReaperGlobal {
  handle: ReturnType<typeof setInterval> | null;
  reaping: Set<string>;
}
const rg = globalThis as unknown as Record<string, ReaperGlobal | undefined>;
const reaperState: ReaperGlobal = rg[REAPER_GLOBAL] ?? { handle: null, reaping: new Set() };
rg[REAPER_GLOBAL] = reaperState;

async function reapStaleQueuedTasks(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - STALE_MS);
    const stale = await prisma.task.findMany({
      where: {
        status: "QUEUED",
        finishedAt: null,
        createdAt: { lt: cutoff },
        /* `promptId` is null means we never got a ComfyUI prompt_id
         *  back — the task is stuck before reaching ComfyUI.  If it
         *  is non-null, ComfyUI has accepted the prompt and we must
         *  NOT clobber the row. */
        promptId: null,
      },
      select: { id: true, createdAt: true, workflowName: true },
      take: 20,
    });
    for (const t of stale) {
      /* In-process guard: if another (concurrent) reaper tick already
       *  claimed this task, skip to avoid duplicate FAILED logs.  The
       *  DB `status: QUEUED` query is not atomic, so two ticks fired
       *  within the same ms could both pick up the same row. */
      if (reaperState.reaping.has(t.id)) continue;
      reaperState.reaping.add(t.id);
      try {
        const ageSec = Math.round((Date.now() - t.createdAt.getTime()) / 1000);
        const reason = `任务卡在队列超过 ${ageSec}s（dev server 重启后 in-memory 队列清空，无人 re-claim）— 请重新执行`;
        log(t.id, "error", reason);
        /* R-ardot121: emit a synthetic state → error pair so any SSE
         *  subscriber immediately sees the terminal failure, then mark
         *  the DB row FAILED.  No processQueue() call — there is no
         *  in-memory job for this task, and we explicitly do NOT want
         *  to re-enqueue an unknown workflow. */
        const s = state();
        s.emitter.emit(t.id, {
          type: "state",
          status: "FAILED",
          progress: 0,
          error: reason,
          validationErrors: [],
        });
        s.emitter.emit(t.id, { type: "error", error: reason });
        await prisma.task.update({
          where: { id: t.id },
          data: {
            status: "FAILED",
            finishedAt: new Date(),
            error: reason,
          },
        });
        await persistLogs(t.id);
      } finally {
        reaperState.reaping.delete(t.id);
      }
    }
    if (stale.length > 0) {
      console.warn(
        `[comfyui] reaper: marked ${stale.length} stale QUEUED task(s) as FAILED (older than ${STALE_MS / 1000}s, no promptId)`
      );
    }
  } catch (err) {
    console.warn("[comfyui] reapStaleQueuedTasks 失败：", err);
  }
}

/** R-ardot121 (2026-08-18): reconcile RUNNING tasks against ComfyUI.
 *  See header comment on RUNNING_STALE_MS for the verdict matrix. */
async function reapStaleRunningTasks(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - RUNNING_STALE_MS);
    const stale = await prisma.task.findMany({
      where: {
        status: "RUNNING",
        finishedAt: null,
        createdAt: { lt: cutoff },
        promptId: { not: null },
      },
      select: { id: true, promptId: true, createdAt: true, workflowName: true },
      take: RUNNING_TICK_CAP,
    });
    if (stale.length === 0) return;
    const base = await resolveComfyBase();
    for (const t of stale) {
      if (!t.promptId) continue;
      if (reaperState.reaping.has(t.id)) continue;
      reaperState.reaping.add(t.id);
      try {
        const url = `${base}/history/${encodeURIComponent(t.promptId)}`;
        let verdict: "succeeded" | "failed" | "unknown" = "unknown";
        let reason = "";
        try {
          const r = await fetch(url, { signal: AbortSignal.timeout(5_000) });
          if (r.status === 200) {
            const data = (await r.json()) as Record<string, unknown> | null;
            const entry = data && (data[t.promptId] as Record<string, unknown> | undefined);
            if (entry) {
              const status = entry.status as { executed?: unknown; errored?: unknown; messages?: unknown } | undefined;
              const errMsg = (entry.error as { message?: string } | undefined)?.message;
              if (status?.errored || errMsg) {
                verdict = "failed";
                reason = `ComfyUI execution_error: ${errMsg ?? "未知原因"} (promptId=${t.promptId})`;
              } else {
                verdict = "succeeded";
                reason = `已完成 · 输出见 ComfyUI /history/${t.promptId}（dev server 重启后由 reaper 对账恢复）`;
              }
            } else {
              /* 200 + no entry: ComfyUI does NOT 404 for unknown prompts — it
               *  returns `{}`.  Could be (a) prompt still processing (will
               *  appear later) or (b) ComfyUI never saw it (orphan).  Cross-
               *  check /queue: if the prompt is NOT in queue_running nor
               *  queue_pending, it's effectively lost → FAILED orphan. */
              let inQueue = false;
              try {
                const q = await fetch(`${base}/queue`, { signal: AbortSignal.timeout(3_000) });
                if (q.ok) {
                  const qd = (await q.json()) as { queue_running?: { prompt_id?: string }[]; queue_pending?: { prompt_id?: string }[] } | null;
                  const all = [...(qd?.queue_running ?? []), ...(qd?.queue_pending ?? [])];
                  inQueue = all.some((j) => j?.prompt_id === t.promptId);
                }
              } catch { /* queue probe failed — fall through to unknown */ }
              if (!inQueue) {
                verdict = "failed";
                reason = `dev server 重启后无人在监控，ComfyUI /history 与 /queue 均无此 prompt (${t.promptId}) — 请重新执行`;
              } else {
                verdict = "unknown";
                reason = `ComfyUI /history 无条目但 /queue 仍在排队 — 下次重试`;
              }
            }
          } else if (r.status === 404) {
            verdict = "failed";
            reason = `dev server 重启后无人在监控，ComfyUI 已无此 prompt (${t.promptId}) 的历史 — 请重新执行`;
          } else {
            verdict = "unknown";
            reason = `ComfyUI /history 返回 ${r.status} — 下次重试`;
          }
        } catch (netErr) {
          verdict = "unknown";
          reason = `ComfyUI 不可达：${netErr instanceof Error ? netErr.message : "network"} — 下次重试`;
        }
        if (verdict === "unknown") {
          log(t.id, "warn", `reaper(running): ${reason}`);
          continue;
        }
        const finalStatus = verdict === "succeeded" ? "SUCCEEDED" : "FAILED";
        log(t.id, verdict === "succeeded" ? "success" : "error", reason);
        const s = state();
        s.emitter.emit(t.id, {
          type: "state",
          status: finalStatus,
          progress: verdict === "succeeded" ? 1 : 0,
          error: verdict === "failed" ? reason : null,
          validationErrors: [],
        });
        s.emitter.emit(t.id, {
          type: verdict === "succeeded" ? "done" : "error",
          ...(verdict === "failed" ? { error: reason } : {}),
        });
        await prisma.task.update({
          where: { id: t.id },
          data: {
            status: finalStatus,
            finishedAt: new Date(),
            error: verdict === "failed" ? reason : null,
          },
        });
        await persistLogs(t.id);
      } finally {
        reaperState.reaping.delete(t.id);
      }
    }
    console.warn(
      `[comfyui] reaper(running): checked ${stale.length} stale RUNNING task(s) (older than ${RUNNING_STALE_MS / 1000}s)`
    );
  } catch (err) {
    console.warn("[comfyui] reapStaleRunningTasks 失败：", err);
  }
}
function startReaper() {
  if (reaperState.handle) return; // singleton across HMR reloads
  // Fire once on module load so a freshly-restarted dev server heals
  // any tasks abandoned by the previous lifetime *immediately*, not
  // 30s later.
  void reapStaleQueuedTasks();
  void reapStaleRunningTasks();
  reaperState.handle = setInterval(() => {
    void reapStaleQueuedTasks();
    void reapStaleRunningTasks();
  }, REAPER_MS);
}
startReaper();
