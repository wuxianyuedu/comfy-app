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
import {
  isVideoMode,
  modeUsesFirstFrame,
  modeUsesLastFrame,
} from "~/lib/workflow/workflow-exposed-params";
import {
  buildEncapsulatedInputs,
  type WorkshopExposedValues,
} from "./workflow-encapsulation";
import { deriveEncapsulationStatus } from "./workshop-encapsulation-status";

/** tRPC wire contract for the local (ComfyUI) generate mutation. */
export type GenerateInput = RouterInputs["generate"]["generate"];

/** Create a local ComfyUI generation task; resolves to the task id. */
export async function startLocalGenerate(
  input: GenerateInput,
): Promise<string> {
  const res = await vanillaApi.generate.generate.mutate(input);
  if (!res?.taskId) throw new Error("本地生成任务创建失败");
  return res.taskId;
}

/** 工坊里可选的生成模式：先把工作流按「内容类别（图 / 视频）」分栏，
 *  再在栏内按具体模式（文生图 / 图生图 / 文生视频 / 图生视频…）分类。
 *  工坊按当前阶段只展示对应类别下的工作流。 */
export type WorkshopWorkflowCategory = "image" | "video";

/** 工作流库里的一个可选工作流（工坊「生成资源」下拉用）。 */
export interface WorkshopWorkflowOption {
  id: string;
  name: string;
  taskType?: string;
  /** 服务端富化的内容类别（image / video / audio；未知按 image 处理）。 */
  category: WorkshopWorkflowCategory;
  /** 该工作流可跑的全部模式码（taskType 常是其中的默认模式）。 */
  modes: string[];
  /** 挂在条目上的模型标签（工作流库「管理模型」维护，如 z-Image）。 */
  modelTags: string[];
  /** 对外参数封装就绪：契约必备口「提示词」已有落点，工坊可直接驱动。 */
  encapsulationReady: boolean;
}

/** 工作流列表项 → 工坊选项；字段缺失/异常时给出安全缺省。
 *
 *  类别优先取服务端富化的 typeCategory（由 taskType 在类型体系里查到），
 *  查不到则退到「模式码是否视频」。 */
function toWorkflowOption(
  row: Record<string, unknown>,
): WorkshopWorkflowOption | null {
  const id = row.id;
  const name = row.name;
  if (typeof id !== "string" || typeof name !== "string") return null;
  const taskType = typeof row.taskType === "string" ? row.taskType : undefined;
  const modes = Array.isArray(row.modes)
    ? row.modes.filter((mode): mode is string => typeof mode === "string")
    : [];
  const declared = row.typeCategory;
  const category: WorkshopWorkflowCategory =
    declared === "video"
      ? "video"
      : declared === "image"
        ? "image"
        : isVideoMode(taskType) || modes.some((mode) => isVideoMode(mode))
          ? "video"
          : "image";
  const modelTags = Array.isArray(row.modelTags)
    ? row.modelTags.filter(
        (tag): tag is string => typeof tag === "string" && tag !== "",
      )
    : [];
  const mode = row.defaultMode ?? taskType ?? modes[0] ?? null;
  const encapsulationReady = deriveEncapsulationStatus({
    io: (row.workflowIO ?? null) as Parameters<
      typeof deriveEncapsulationStatus
    >[0]["io"],
    paramMap: (row.paramMap ?? null) as Parameters<
      typeof deriveEncapsulationStatus
    >[0]["paramMap"],
    mode: typeof mode === "string" ? mode : null,
  }).ready;
  return {
    id,
    name,
    ...(taskType !== undefined ? { taskType } : {}),
    category,
    modes,
    modelTags,
    encapsulationReady,
  };
}

/** 拉取工作流列表，供工坊选择「用哪个工作流库工作流生成」。 */
export async function fetchWorkshopWorkflows(): Promise<
  WorkshopWorkflowOption[]
> {
  const res = await vanillaApi.workflow.list.query({});
  const rows: unknown = res;
  if (!Array.isArray(rows)) return [];
  const out: WorkshopWorkflowOption[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const option = toWorkflowOption(row);
    if (option) out.push(option);
  }
  return out;
}

/** 一次封装结果 + 该工作流在库里的模式信息（供调用方按模式做提示/校验）。 */
export interface LibraryWorkflowBuildResult {
  input: GenerateInput;
  /** 用户给了值、但落不到任何端口的口（未连线 / 断开 / 端口已消失）。
   *  键是**契约口 id**（`prompt` / `size-width`…），不是工作流里的端口名。 */
  unmatched: string[];
  /** 本次实际使用的模式码（服务端默认模式，缺省回退 taskType / modes[0]）。 */
  mode: string | null;
  /** 该工作流可跑的全部模式码。 */
  modes: string[];
  /** 本次生成会用到首帧 / 尾帧图（按模式判定，供调用方决定要不要预传图）。 */
  usesFirstFrame: boolean;
  usesLastFrame: boolean;
}

/** 用选定的工作流库工作流封装一次生成请求。
 *
 *  ISSUE #145：工坊对外只暴露「提示词 / 尺寸 / 参考图(首帧)」，其余 IO 参数
 *  一律用工作流图内的默认值。这里拉取工作流详情（含 enrich 过的 workflowIO 与
 *  作者的连线表 `paramMap`），交给 `buildEncapsulatedInputs` 按工作流的模式码
 *  组装成 `workflowInputs` 三元组 —— **落点只认作者在库里连的线**。
 *
 *  返回的 input 可直接交给 `startLocalGenerate`；没连线 / 断开的对外口会出现在
 *  `unmatched` 里（由调用方决定是否提示用户）。 */
export async function buildLibraryWorkflowInput(
  workflowId: string,
  values: WorkshopExposedValues,
): Promise<LibraryWorkflowBuildResult> {
  const detail = await vanillaApi.workflow.detailFull.query({ id: workflowId });
  const io = detail?.workflowIO ?? null;
  const modes = Array.isArray(detail?.modes)
    ? detail.modes.filter((mode): mode is string => typeof mode === "string")
    : [];
  const mode = detail?.defaultMode ?? detail?.taskType ?? modes[0] ?? null;
  const { workflowInputs, unmatched } = buildEncapsulatedInputs({
    io,
    paramMap: detail?.paramMap ?? null,
    mode,
    values,
  });
  /* 尺寸**不**再带 `size`（"WxH"）兼容字段：尺寸只以「比例 + 分辨率」或
   *  「比例 + 百万像素 + 倍数」表达，逐端口落进 `workflowInputs`；
   *  目标工作流要 width/height 时由封装层按场景尺寸表现算（见
   *  `buildEncapsulatedInputs`）。历史里那一串 "768x1024" 就是这条兼容字段。 */
  const input: GenerateInput = {
    workflow: workflowId,
    ...(values.prompt !== undefined ? { prompt: values.prompt } : {}),
    ...(values.negativePrompt !== undefined
      ? { negative: values.negativePrompt }
      : {}),
    ...(values.firstFrame !== undefined
      ? { firstFrame: values.firstFrame }
      : {}),
    ...(values.lastFrame !== undefined ? { lastFrame: values.lastFrame } : {}),
    // 视频时长：帧数走内置字段，秒数由 workflowInputs 里的时长口落下去。
    ...(values.frames !== undefined ? { frames: values.frames } : {}),
    ...(workflowInputs.length > 0 ? { workflowInputs } : {}),
  };
  return {
    input,
    unmatched,
    mode,
    modes,
    usesFirstFrame: modeUsesFirstFrame(mode),
    usesLastFrame: modeUsesLastFrame(mode),
  };
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
            if (
              typeof id === "string" &&
              typeof value === "number" &&
              typeof max === "number"
            ) {
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

/** API channel: one-shot image generation → usable image URL.
 *  model 传设置页远端模型名（remoteModel 表）时，服务端按该条目的连接参数
 *  生图；不传则回落到工坊 API 通道设置（旧行为）。 */
export async function apiGenerateImage(req: {
  prompt: string;
  negative?: string;
  size?: string;
  /** 设置页配置的远端模型名（remoteModel 表按名取连接参数） */
  model?: string;
  /** 工坊模式码（T2I / I2I / …）：远端模型有该模式适配器时按它翻译字段 */
  mode?: string;
  /** 统一输入：宽高比（如 "16:9"）/ 百万像素（如 "1.5"）/ 宽高对齐倍数 / 输入图。
   *  三者合起来就是工坊的「比例 + 百万像素 + 倍数」尺寸表达 —— 选「分辨率」时
   *  由调用方（`shotSizeToRelay`）换算后再传，不把 "1k" 这种档位名丢给远端。 */
  aspectRatio?: string;
  megapixels?: string;
  multiple?: number;
  image?: string;
}): Promise<string> {
  const data = await postRelay({
    kind: "image",
    prompt: req.prompt,
    negative: req.negative,
    size: req.size,
    ...(req.model ? { model: req.model } : {}),
    ...(req.mode ? { mode: req.mode } : {}),
    ...(req.aspectRatio ? { aspectRatio: req.aspectRatio } : {}),
    ...(req.megapixels ? { megapixels: req.megapixels } : {}),
    ...(req.multiple !== undefined ? { multiple: req.multiple } : {}),
    ...(req.image ? { image: req.image } : {}),
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
  if (!url && !remoteTaskId)
    throw new Error("API 视频响应中未找到视频 URL 或任务 ID");
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
