import { EventEmitter } from "events";
import WebSocket from "ws";
import { promises as fs } from "fs";
import path from "path";
import { prisma } from "../db";
import { getView, getHistory, postPrompt, interrupt, COMFYUI_BASE } from "./client";

const CLIENT_ID = process.env.COMFY_CLIENT_ID ?? "comfy-app-web";
const MAX_CONCURRENCY = 1; // single GPU — serial execution
const JOB_TIMEOUT_MS = 5 * 60 * 1000;

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

function connect() {
  const s = state();
  if (s.connecting || s.ws) return;
  s.connecting = true;
  let ws: WebSocket;
  try {
    ws = new WebSocket(`${COMFYUI_BASE}/api/ws?clientId=${CLIENT_ID}`);
  } catch {
    s.connecting = false;
    return;
  }
  s.ws = ws;
  ws.on("open", () => {
    s.connecting = false;
    processQueue();
  });
  ws.on("message", (data) => void handleMessage(data.toString()));
  ws.on("close", () => {
    s.connecting = false;
    s.ws = null;
    setTimeout(connect, 2000);
  });
  ws.on("error", () => {
    s.connecting = false;
    s.ws = null;
  });
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

async function complete(taskId: string, promptId: string) {
  const s = state();
  if (s.settled.has(taskId)) return;
  s.settled.add(taskId);
  const t = s.timers.get(taskId);
  if (t) clearTimeout(t);
  s.timers.delete(taskId);

  const hist = (await getHistory(promptId)) as any;
  const entry = hist?.[promptId];
  if (!entry) {
    await fail(taskId, promptId, "未找到生成结果");
    return;
  }

  const msgs: any[] = entry.status?.messages ?? [];
  const errored = msgs.some((m) => m?.[0] === "execution_error");
  if (errored || entry.status?.status_str === "error") {
    const ex = msgs.find((m) => m?.[0] === "execution_error")?.[1]?.exception_message;
    await fail(taskId, promptId, ex ?? "执行错误");
    return;
  }

  const outputs = entry.outputs ?? {};
  const images: { filename: string; subfolder: string; type: string }[] = [];
  const videos: { filename: string; subfolder: string; type: string }[] = [];
  for (const nodeOut of Object.values(outputs) as any[]) {
    if (Array.isArray(nodeOut?.images)) images.push(...nodeOut.images);
    if (Array.isArray(nodeOut?.videos)) videos.push(...nodeOut.videos);
    // VHS_VideoCombine emits its files under `gifs` (mp4/gif/webm).
    if (Array.isArray(nodeOut?.gifs)) videos.push(...nodeOut.gifs);
  }
  if (!images.length && !videos.length) {
    await fail(taskId, promptId, "无输出内容");
    return;
  }

  const isVideo = videos.length > 0;
  log(
    taskId,
    "success",
    isVideo
      ? `✓ 生成完成，开始下载 ${videos.length} 个视频`
      : `✓ 生成完成，开始下载 ${images.length} 张图像`
  );

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

async function fail(taskId: string, promptId: string, error: string) {
  const s = state();
  if (s.settled.has(taskId)) return;
  s.settled.add(taskId);
  const t = s.timers.get(taskId);
  if (t) clearTimeout(t);
  s.timers.delete(taskId);

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
    const res = (await postPrompt(job.prompt, CLIENT_ID)) as any;
    if (res.error || (res.node_errors && Object.keys(res.node_errors).length)) {
      await fail(job.taskId, "", res.error ?? "节点配置错误");
      return;
    }
    const promptId: string = res.prompt_id;
    s.promptToTask.set(promptId, job.taskId);
    await prisma.task.update({
      where: { id: job.taskId },
      data: { status: "RUNNING", promptId },
    });
    log(job.taskId, "info", `已提交至 ComfyUI（prompt_id: ${promptId}）`);
    const timer = setTimeout(() => {
      void fail(job.taskId, promptId, "生成超时");
    }, JOB_TIMEOUT_MS);
    s.timers.set(job.taskId, timer);
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
