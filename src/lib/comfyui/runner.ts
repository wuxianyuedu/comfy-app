import { EventEmitter } from "events";
import WebSocket from "ws";
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

export type Job = { taskId: string; prompt: Record<string, unknown> };

export type LogEntry = {
  t: number; // epoch ms
  level: "info" | "progress" | "warn" | "error" | "success";
  msg: string;
};

export type TaskEvent =
  | { type: "progress"; progress: number }
  | { type: "done"; images: unknown[] }
  | { type: "error"; error: string }
  | { type: "log"; entry: LogEntry };

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
  settled: Set<string>;
  timers: Map<string, NodeJS.Timeout>;
  reconnectAttempts: number;
  /** 当前使用的 WS 路径下标（连接失败时推进到下一条路径重试）。 */
  wsPathIndex: number;
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
      settled: new Set(),
      timers: new Map(),
      reconnectAttempts: 0,
      wsPathIndex: 0,
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

// Append a structured log entry: keep in-memory + emit to live subscribers.
function log(taskId: string, level: LogEntry["level"], msg: string) {
  const s = state();
  const entry: LogEntry = { t: Date.now(), level, msg };
  const arr = s.logs.get(taskId) ?? [];
  arr.push(entry);
  s.logs.set(taskId, arr);
  s.emitter.emit(taskId, { type: "log", entry });
}

async function persistLogs(taskId: string) {
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
    log(taskId, "info", `▶ ${nodeLabel(classType)}`);
    return;
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
  try {
    await completeInner(taskId, promptId);
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

async function completeInner(taskId: string, promptId: string) {
  const s = state();

  const entry = await fetchHistoryEntry(promptId);
  if (!entry) {
    await finalizeFailure(taskId, promptId, "未找到生成结果");
    return;
  }

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

  const parts: string[] = [];
  if (images.length) parts.push(`${images.length} 张图像`);
  if (videos.length) parts.push(`${videos.length} 个视频`);
  if (audios.length) parts.push(`${audios.length} 个音频`);
  if (others.length) parts.push(`${others.length} 个文件`);
  if (texts.length) parts.push(`${texts.length} 段文本`);
  log(taskId, "success", `✓ 生成完成，开始下载 ${parts.join("、") || "结果"}`);

  const dir = path.join(process.cwd(), "public", "generated", taskId);
  await fs.mkdir(dir, { recursive: true });
  const saved: { localPath: string; mediaType: string }[] = [];

  // Images
  for (let i = 0; i < images.length; i++) {
    const im = images[i];
    const buf = await getView(im.filename, im.subfolder ?? "", im.type ?? "");
    const ext = path.extname(im.filename) || ".png";
    const fname = `img_${i}${ext}`;
    await fs.writeFile(path.join(dir, fname), buf);
    saved.push({ localPath: `/api/generated/${taskId}/${fname}`, mediaType: "image" });
    log(taskId, "info", `下载第 ${i + 1} 张图像`);
  }

  // Videos (mp4 / gif / webm)
  for (let i = 0; i < videos.length; i++) {
    const v = videos[i];
    const buf = await getView(v.filename, v.subfolder ?? "", v.type ?? "");
    const ext = path.extname(v.filename) || ".mp4";
    const fname = `vid_${i}${ext}`;
    await fs.writeFile(path.join(dir, fname), buf);
    saved.push({ localPath: `/api/generated/${taskId}/${fname}`, mediaType: "video" });
    log(taskId, "info", `下载第 ${i + 1} 个视频`);
  }

  // Audio (SaveAudio / AudioComposite)
  for (let i = 0; i < audios.length; i++) {
    const a = audios[i];
    const buf = await getView(a.filename, a.subfolder ?? "", a.type ?? "");
    const ext = path.extname(a.filename) || ".wav";
    const fname = `aud_${i}${ext}`;
    await fs.writeFile(path.join(dir, fname), buf);
    saved.push({ localPath: `/api/generated/${taskId}/${fname}`, mediaType: "audio" });
    log(taskId, "info", `下载第 ${i + 1} 个音频`);
  }

  // Generic 3D / unknown file outputs (mesh, gltf, obj, …)
  for (let i = 0; i < others.length; i++) {
    const o = others[i];
    const buf = await getView(o.filename, o.subfolder ?? "", o.type ?? "");
    const ext = path.extname(o.filename) || ".bin";
    const fname = `file_${i}${ext}`;
    await fs.writeFile(path.join(dir, fname), buf);
    saved.push({ localPath: `/api/generated/${taskId}/${fname}`, mediaType: "other" });
    log(taskId, "info", `下载第 ${i + 1} 个文件`);
  }

  // Text outputs (ShowText): persist as .txt so the result is inspectable.
  for (let i = 0; i < texts.length; i++) {
    const fname = `txt_${i}.txt`;
    await fs.writeFile(path.join(dir, fname), texts[i], "utf-8");
    saved.push({ localPath: `/api/generated/${taskId}/${fname}`, mediaType: "text" });
    log(taskId, "info", `保存第 ${i + 1} 段文本`);
  }

  await prisma.task.update({
    where: { id: taskId },
    data: {
      status: "SUCCEEDED",
      progress: 100,
      finishedAt: new Date(),
      resultImages: saved as any,
    },
  });
  await prisma.taskImage.createMany({
    data: saved.map((s2, i) => ({
      taskId,
      localPath: s2.localPath,
      sortIndex: i,
      isCover: i === 0,
      mediaType: s2.mediaType,
    })),
  });

  await persistLogs(taskId);
  s.emitter.emit(taskId, { type: "done", images: saved });
  s.promptToTask.delete(promptId);
  s.promptByTask.delete(taskId);
  s.lastLogPct.delete(taskId);
  s.active = Math.max(0, s.active - 1);
  processQueue();
}

// Map raw ComfyUI/node errors to user-actionable hints.
function friendlyError(raw: unknown): string {
  return (raw ?? "").toString();
}

/** Build a human-readable failure message from ComfyUI's /prompt response.
 *  ComfyUI returns `node_errors` keyed by node id, each with `input_errors`
 *  (field → {message}) or a top-level `message`. Surface those instead of a
 *  generic "节点配置错误" so the user can fix the actual bad value. */
function buildPromptError(res: any, graph: Record<string, any>): string {
  if (res?.error) return String(res.error);
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

/** 对外的失败入口：先抢终态，再收口。 */
async function fail(taskId: string, promptId: string, error: string) {
  if (!claimSettle(taskId)) return;
  await finalizeFailure(taskId, promptId, error);
}

/** 真正的失败收口。**不做 settled 判断** —— 调用方必须已经抢到终态。 */
async function finalizeFailure(taskId: string, promptId: string, error: string) {
  const s = state();
  const friendly = friendlyError(error);
  log(taskId, "error", `✗ 生成失败：${friendly}`);

  await prisma.task.update({
    where: { id: taskId },
    data: { status: "FAILED", error: friendly, finishedAt: new Date() },
  });

  await persistLogs(taskId);
  s.emitter.emit(taskId, { type: "error", error });
  if (promptId) s.promptToTask.delete(promptId);
  s.promptByTask.delete(taskId);
  s.lastLogPct.delete(taskId);
  s.active = Math.max(0, s.active - 1);
  processQueue();
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
    // 提交前剔除 bypass / mute / 纯前端节点(Reroute/Primitive/Note)，
    // 并对连线做穿透，严格对齐 ComfyUI 真实执行语义（P1：mode/Reroute）。
    const prep = prepareGraphForExecution(job.prompt);
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
    const res = (await postPrompt(prep.graph, CLIENT_ID)) as any;
    if (res.error || (res.node_errors && Object.keys(res.node_errors).length)) {
      await fail(job.taskId, "", buildPromptError(res, prep.graph));
      return;
    }
    const promptId: string = res.prompt_id;
    s.promptToTask.set(promptId, job.taskId);
    await prisma.task.update({
      where: { id: job.taskId },
      data: { status: "RUNNING", promptId },
    });
    log(job.taskId, "info", `已提交至 ComfyUI（prompt_id: ${promptId}）`);
    armWatchdog(job.taskId, promptId);
  } catch (e: any) {
    await fail(job.taskId, "", e?.message ?? "提交失败");
  }
}

export function enqueue(job: Job) {
  const s = state();
  s.settled.delete(job.taskId);
  s.queue.push(job);
  s.promptByTask.set(job.taskId, job.prompt);
  state().logs.set(job.taskId, []);
  log(job.taskId, "info", "任务已加入执行队列");
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
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { status: true, promptId: true },
  });
  if (!task) return;

  if (task.status === "RUNNING" || task.status === "QUEUED") {
    log(taskId, "warn", "用户取消任务");
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
  s.active = Math.max(0, s.active - 1);
  processQueue();
}
