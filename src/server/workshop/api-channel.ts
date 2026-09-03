// ── Workshop MCP 本地 API 通道 ─────────────────────────────────
// 复刻 @/lib/workshop/api-channel.server 的生图/视频能力，但**不** import
// "server-only"（纯 Node 可用），配置同样存于 data/workshop-api-settings.json。
// 归一化助手复用纯模块 @/lib/workshop/api-channel-shared。
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  extractBase64DataUrl,
  extractMediaUrl,
  extractRemoteTaskId,
  type ApiChannelKind,
  type ApiChannelStored,
} from "@/lib/workshop/api-channel-shared";

const FILE = path.join(process.cwd(), "data", "workshop-api-settings.json");

const DEFAULT_IMAGE: ApiChannelStored = {
  baseUrl: process.env.WORKSHOP_API_IMAGE_BASE ?? "",
  path: "/images/generations",
  model: process.env.WORKSHOP_API_IMAGE_MODEL ?? "",
  apiKey: process.env.WORKSHOP_API_IMAGE_KEY ?? "",
};

const DEFAULT_VIDEO: ApiChannelStored = {
  baseUrl: process.env.WORKSHOP_API_VIDEO_BASE ?? "",
  path: "/videos/generations",
  model: process.env.WORKSHOP_API_VIDEO_MODEL ?? "",
  apiKey: process.env.WORKSHOP_API_VIDEO_KEY ?? "",
};

type WorkshopApiSettings = Record<ApiChannelKind, ApiChannelStored>;

let cache: WorkshopApiSettings | null = null;

function sanitizeChannel(raw: unknown, fallback: ApiChannelStored): ApiChannelStored {
  const src = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const str = (key: string): string | undefined => {
    const v: unknown = src[key];
    return typeof v === "string" ? v : undefined;
  };
  const baseUrl = (str("baseUrl") ?? fallback.baseUrl).trim();
  const reqPath = (str("path") ?? fallback.path).trim();
  return {
    baseUrl,
    path: reqPath.startsWith("/") ? reqPath : `/${reqPath}`,
    model: (str("model") ?? fallback.model).trim(),
    apiKey: str("apiKey") ?? fallback.apiKey,
  };
}

/** 读取配置（进程内缓存）。 */
export function getWorkshopApiSettingsSync(): WorkshopApiSettings {
  if (cache) return cache;
  let stored: Partial<WorkshopApiSettings> = {};
  try {
    stored = JSON.parse(readFileSync(FILE, "utf-8")) as Partial<WorkshopApiSettings>;
  } catch {
    // 缺失/损坏 → 默认
  }
  cache = {
    image: sanitizeChannel(stored.image, DEFAULT_IMAGE),
    video: sanitizeChannel(stored.video, DEFAULT_VIDEO),
  };
  return cache;
}

function headersFor(c: ApiChannelStored): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (c.apiKey) h.Authorization = `Bearer ${c.apiKey}`;
  return h;
}

function endpoint(c: ApiChannelStored): string {
  return `${c.baseUrl.replace(/\/+$/, "")}${c.path}`;
}

export interface ApiImageRequest {
  prompt: string;
  negative?: string;
  size?: string;
}

/** 调用 OpenAI 兼容 images/generations 端点，返回可用 URL（远程或 data URL）。 */
export async function generateImageViaApi(req: ApiImageRequest): Promise<string> {
  const c = getWorkshopApiSettingsSync().image;
  if (!c.baseUrl) throw new Error("API 生图通道未配置：请先填写 Base URL 与 API Key");
  let res: Response;
  try {
    res = await fetch(endpoint(c), {
      method: "POST",
      headers: headersFor(c),
      body: JSON.stringify({
        model: c.model === "" ? undefined : c.model,
        prompt: req.prompt,
        negative_prompt: req.negative === "" ? undefined : req.negative,
        size: req.size === "" ? undefined : req.size,
        n: 1,
        response_format: "url",
      }),
      signal: AbortSignal.timeout(180_000),
    });
  } catch (e) {
    throw new Error(`API 生图请求失败: ${e instanceof Error ? e.message : String(e)}`);
  }
  const payload = (await res.json().catch(() => ({}))) as unknown;
  if (!res.ok) {
    const detail = JSON.stringify(payload).slice(0, 200);
    throw new Error(`API 生图失败 (${res.status}): ${detail}`);
  }
  const url = extractMediaUrl(payload) ?? extractBase64DataUrl(payload);
  if (!url) throw new Error("API 生图响应中未找到图片 URL / b64 数据");
  return url;
}

export interface ApiVideoSubmitRequest {
  prompt: string;
  negative?: string;
  imageDataUrl?: string;
  frames?: number;
  fps?: number;
}

export interface ApiVideoSubmitResult {
  url?: string;
  remoteTaskId?: string;
}

/** 提交视频任务；支持同步 URL 与异步任务两种上游。 */
export async function submitVideoViaApi(req: ApiVideoSubmitRequest): Promise<ApiVideoSubmitResult> {
  const c = getWorkshopApiSettingsSync().video;
  if (!c.baseUrl) throw new Error("API 视频通道未配置：请先填写 Base URL 与 API Key");
  let res: Response;
  try {
    res = await fetch(endpoint(c), {
      method: "POST",
      headers: headersFor(c),
      body: JSON.stringify({
        model: c.model === "" ? undefined : c.model,
        prompt: req.prompt,
        negative_prompt: req.negative === "" ? undefined : req.negative,
        image_url: req.imageDataUrl,
        image: req.imageDataUrl,
        frames: req.frames,
        fps: req.fps,
      }),
      signal: AbortSignal.timeout(180_000),
    });
  } catch (e) {
    throw new Error(`API 视频提交失败: ${e instanceof Error ? e.message : String(e)}`);
  }
  const payload = (await res.json().catch(() => ({}))) as unknown;
  if (!res.ok) {
    const detail = JSON.stringify(payload).slice(0, 200);
    throw new Error(`API 视频提交失败 (${res.status}): ${detail}`);
  }
  const url = extractMediaUrl(payload);
  if (url) return { url };
  const remoteTaskId = extractRemoteTaskId(payload);
  if (remoteTaskId) return { remoteTaskId };
  throw new Error("API 视频响应中未找到视频 URL 或任务 ID");
}

/** 轮询一次异步视频任务。 */
export async function pollVideoViaApi(
  remoteTaskId: string,
): Promise<{ url?: string; pending: boolean }> {
  const c = getWorkshopApiSettingsSync().video;
  if (!c.baseUrl) throw new Error("API 视频通道未配置");
  const url = `${c.baseUrl.replace(/\/+$/, "")}/${remoteTaskId.replace(/^\/+/, "")}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: headersFor(c),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    throw new Error(`API 视频轮询失败: ${e instanceof Error ? e.message : String(e)}`);
  }
  const payload = (await res.json().catch(() => ({}))) as unknown;
  if (!res.ok) {
    const detail = JSON.stringify(payload).slice(0, 200);
    throw new Error(`API 视频轮询失败 (${res.status}): ${detail}`);
  }
  const mediaUrl = extractMediaUrl(payload);
  if (mediaUrl) return { url: mediaUrl, pending: false };
  return { pending: true };
}

/** 把任意图片引用（远程 URL 或 data URL）解析为内联 data URL（送视频上游首帧）。 */
export async function resolveMediaDataUrl(ref: string): Promise<string> {
  if (ref.startsWith("data:")) return ref;
  const res = await fetch(ref, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`解析媒体失败 (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  const mime = res.headers.get("content-type") ?? "image/png";
  return `data:${mime};base64,${buf.toString("base64")}`;
}
