// ── Workshop generation client: local ComfyUI chain + API relay ───────────
// The 镜头生图 / 视频生成 stages run on one of two channels:
//   • local — tRPC generate mutation → ComfyUI task, watched over SSE
//     (same chain the studio canvas uses: generate.generate + tasks stream)
//   • api   — /api/workshop-api/generate relay (baseUrl/apiKey stay server-side,
//     heterogeneous upstream shapes are normalized by api-channel-shared)
// Client-side helpers shared by ShotStudio / VideoStudio / WorkshopPipeline.
// Every network payload is narrowed with unknown guards (no assertions).

import { vanillaApi } from "~/trpc/vanilla";
import type { RouterInputs } from "~/trpc/react";
import {
  extractSavedOutputs,
  isRecord,
  type ApiChannelView,
  type ApiChannelsView,
  type SavedOutput,
} from "./api-channel-shared";

/** tRPC wire contract for the local (ComfyUI) generate mutation. */
export type GenerateInput = RouterInputs["generate"]["generate"];

/** Create a local ComfyUI generation task; resolves to the task id. */
export async function startLocalGenerate(input: GenerateInput): Promise<string> {
  const res = await vanillaApi.generate.generate.mutate(input);
  if (!res?.taskId) throw new Error("本地生成任务创建失败");
  return res.taskId;
}

/** 进度事件附带的节点级信息（ComfyUI progress 消息里的当前节点与步数）。 */
export interface TaskProgressNode {
  id: string;
  label?: string;
  value: number;
  max: number;
}

/** 一条执行步骤日志（对应项目画布 /api/tasks/:id/stream 的 `log` 帧），
 *  字段与后端 LogEntry 一致。工作流库就地运行也据此展示「执行日志」。 */
export interface TaskLogEntry {
  t: number;
  level: "info" | "progress" | "warn" | "error" | "success";
  msg: string;
  src?: string;
}

export interface TaskWatchHandlers {
  onProgress?: (progress: number, node?: TaskProgressNode) => void;
  /** 每条执行步骤日志（SSE `log` 帧）。供调用方累积展示。 */
  onLog?: (entry: TaskLogEntry) => void;
  /** Fired for each saved output file as the task completes. */
  onOutput?: (output: SavedOutput) => void;
  /** Called exactly once when the task reaches a terminal state. */
  onSettled: (result: { ok: boolean; message?: string }) => void;
}

/** Narrow an unknown SSE `log` frame payload to TaskLogEntry, or null. */
function narrowLogEntry(raw: unknown): TaskLogEntry | null {
  if (!isRecord(raw)) return null;
  const t = raw.t;
  const level = raw.level;
  const msg = raw.msg;
  if (typeof t !== "number" || typeof msg !== "string") return null;
  const validLevels = ["info", "progress", "warn", "error", "success"] as const;
  const lv = validLevels.find((v) => v === level) ?? null;
  if (!lv) return null;
  return {
    t,
    level: lv,
    msg,
    ...(typeof raw.src === "string" && raw.src ? { src: raw.src } : {}),
  };
}

/**
 * Subscribe to a task's SSE stream (`/api/tasks/:id/stream`) until it settles.
 * Returns a closer that tears the connection down early (cancel / unmount).
 */
export function watchTask(taskId: string, h: TaskWatchHandlers): () => void {
  const es = new EventSource(`/api/tasks/${encodeURIComponent(taskId)}/stream`);
  let settled = false;
  const settle = (ok: boolean, message?: string) => {
    if (settled) return;
    settled = true;
    es.close();
    h.onSettled({ ok, message });
  };
  es.onmessage = (ev: MessageEvent<string>) => {
    try {
      const msg: unknown = JSON.parse(ev.data);
      if (!isRecord(msg)) return;
      const type: unknown = msg.type;
      if (type === "progress" || type === "state") {
        const p: unknown = msg.progress;
        if (typeof p === "number" && Number.isFinite(p)) {
          // 节点级信息（可选）：progress 消息里带的当前节点 id / 类别名 / 步数
          let node: TaskProgressNode | undefined;
          const rawNode: unknown = msg.node;
          if (isRecord(rawNode)) {
            const id: unknown = rawNode.id;
            const value: unknown = rawNode.value;
            const max: unknown = rawNode.max;
            const label: unknown = rawNode.label;
            if (typeof id === "string" && typeof value === "number" && typeof max === "number") {
              node = {
                id,
                value,
                max,
                ...(typeof label === "string" && label ? { label } : {}),
              };
            }
          }
          h.onProgress?.(Math.max(0, Math.min(100, p)), node);
        }
        if (type === "state") {
          // DB truth-poller re-emits terminal verdicts the emitter missed.
          const st: unknown = msg.status;
          if (st === "FAILED" || st === "CANCELLED" || st === "ERROR") {
            const err: unknown = msg.error;
            settle(
              false,
              typeof err === "string" && err.trim() ? err : `任务 ${st}`,
            );
          }
        }
        return;
      }
      if (type === "log") {
        const entry = narrowLogEntry(msg.entry);
        if (entry) h.onLog?.(entry);
        return;
      }
      if (type === "done") {
        const outputs = extractSavedOutputs(msg.images);
        if (outputs.length === 0) {
          settle(false, "任务完成但没有产出文件");
          return;
        }
        outputs.forEach((out) => h.onOutput?.(out));
        settle(true);
        return;
      }
      if (type === "error") {
        const err: unknown = msg.error;
        settle(false, typeof err === "string" && err ? err : "生成失败");
      }
    } catch {
      /* malformed SSE frame — ignore this message */
    }
  };
  es.onerror = () => {
    // Transient drops auto-reconnect; only a fully closed stream is terminal.
    if (es.readyState === EventSource.CLOSED) settle(false, "任务连接中断");
  };
  return () => {
    if (!settled) settled = true;
    es.close();
  };
}

// ── API relay channel ──────────────────────────────────────────────────────

/** Extract a readable message from a relay error envelope
 *  (`{ error: string }` or auth `{ error: { message } }`). */
function relayErrorMessage(data: unknown, status: number): string {
  if (isRecord(data)) {
    const err: unknown = data.error;
    if (typeof err === "string" && err) return err;
    if (isRecord(err)) {
      const msg: unknown = err.message;
      if (typeof msg === "string" && msg) return msg;
    }
  }
  return `API 请求失败 (${status})`;
}

async function postRelay(body: Record<string, unknown>): Promise<unknown> {
  const res = await fetch("/api/workshop-api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    data = undefined;
  }
  if (!res.ok) throw new Error(relayErrorMessage(data, res.status));
  return data;
}

/** API channel: one-shot image generation → usable image URL. */
export async function apiGenerateImage(req: {
  prompt: string;
  negative?: string;
  size?: string;
}): Promise<string> {
  const data = await postRelay({
    kind: "image",
    prompt: req.prompt,
    negative: req.negative,
    size: req.size,
  });
  const url =
    isRecord(data) && typeof data.url === "string" && data.url
      ? data.url
      : null;
  if (!url) throw new Error("API 生图响应中未找到图片 URL");
  return url;
}

export interface ApiVideoSubmitResult {
  /** Finished video URL when the provider responds synchronously. */
  url?: string;
  /** Async task id to poll via apiPollVideo otherwise. */
  remoteTaskId?: string;
}

/** API channel: submit an (image-to-)video job. */
export async function apiSubmitVideo(req: {
  prompt: string;
  negative?: string;
  /** Reference first-frame (any resolvable source: /generated/…, data URL, http). */
  image?: string;
  frames?: number;
  fps?: number;
}): Promise<ApiVideoSubmitResult> {
  const data = await postRelay({
    kind: "video",
    prompt: req.prompt,
    negative: req.negative,
    image: req.image,
    frames: req.frames,
    fps: req.fps,
  });
  if (!isRecord(data)) throw new Error("API 视频响应格式错误");
  const url = typeof data.url === "string" && data.url ? data.url : undefined;
  const remoteTaskId =
    typeof data.remoteTaskId === "string" && data.remoteTaskId
      ? data.remoteTaskId
      : undefined;
  if (!url && !remoteTaskId) throw new Error("API 视频响应中未找到视频 URL 或任务 ID");
  return { url, remoteTaskId };
}

/** API channel: single poll of an async video task. */
export async function apiPollVideo(
  remoteTaskId: string,
): Promise<{ url?: string; pending: boolean }> {
  const data = await postRelay({ kind: "video", remoteTaskId });
  if (!isRecord(data)) return { pending: true };
  const url = typeof data.url === "string" && data.url ? data.url : undefined;
  return { url, pending: !url };
}

/** Upload a generated / reference image into the local ComfyUI input dir so
 *  the video workflows' LoadImage nodes can consume it; returns the filename. */
export async function prepareLocalInputImage(image: string): Promise<string> {
  const res = await fetch("/api/workshop-local/prepare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image }),
  });
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    data = undefined;
  }
  const filename =
    isRecord(data) && typeof data.filename === "string" && data.filename
      ? data.filename
      : null;
  if (!res.ok || !filename) {
    throw new Error(
      !res.ok ? relayErrorMessage(data, res.status) : "参考图准备失败",
    );
  }
  return filename;
}

function narrowChannel(v: unknown, fallbackPath: string): ApiChannelView {
  const rec = isRecord(v) ? v : {};
  return {
    configured: rec.configured === true,
    baseUrl: typeof rec.baseUrl === "string" ? rec.baseUrl : "",
    path: typeof rec.path === "string" && rec.path ? rec.path : fallbackPath,
    model: typeof rec.model === "string" ? rec.model : "",
    hasApiKey: rec.hasApiKey === true,
  };
}

/** Masked view of both API channels; null when the config service is down
 *  (callers treat null as "unconfigured" and offer the settings modal). */
export async function fetchApiChannels(): Promise<ApiChannelsView | null> {
  try {
    const res = await fetch("/api/workshop-api/config");
    if (!res.ok) return null;
    const data: unknown = await res.json();
    const channels = isRecord(data) ? data.channels : undefined;
    if (!isRecord(channels)) return null;
    return {
      image: narrowChannel(channels.image, "/images/generations"),
      video: narrowChannel(channels.video, "/videos/generations"),
    };
  } catch {
    return null;
  }
}
