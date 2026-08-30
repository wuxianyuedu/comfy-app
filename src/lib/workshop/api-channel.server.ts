// ── Workshop API channel: server-side config store + upstream calls ───────
// Persists per-channel (image / video) endpoint config as a local JSON file
// (same pattern as app-settings: no DB migration, git-ignored, env fallback).
// The apiKey is stored server-side only; the browser receives a masked view.
import "server-only";

import { promises as fs, readFileSync } from "fs";
import path from "path";

import {
  extractBase64DataUrl,
  extractMediaUrl,
  extractRemoteTaskId,
  type ApiChannelKind,
  type ApiChannelStored,
  type ApiChannelsView,
} from "./api-channel-shared";
import { readUpstreamJson, resolveMediaDataUrl } from "./media-source.server";

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
    // Path must be root-relative so `${baseUrl}${path}` stays well-formed.
    path: reqPath.startsWith("/") ? reqPath : `/${reqPath}`,
    model: (str("model") ?? fallback.model).trim(),
    apiKey: str("apiKey") ?? fallback.apiKey,
  };
}

/** Read with in-process caching; a fresh install just works (empty = unconfigured). */
export function getWorkshopApiSettingsSync(): WorkshopApiSettings {
  if (cache) return cache;
  let stored: Partial<WorkshopApiSettings> = {};
  try {
    stored = JSON.parse(readFileSync(FILE, "utf-8")) as Partial<WorkshopApiSettings>;
  } catch {
    // Missing/corrupt file → defaults.
  }
  cache = {
    image: sanitizeChannel(stored.image, DEFAULT_IMAGE),
    video: sanitizeChannel(stored.video, DEFAULT_VIDEO),
  };
  return cache;
}

/** Merge a partial per-channel update and persist. */
export async function saveWorkshopApiSettings(
  patch: Partial<Record<ApiChannelKind, unknown>>,
): Promise<WorkshopApiSettings> {
  const current = getWorkshopApiSettingsSync();
  const next: WorkshopApiSettings = {
    image: patch.image !== undefined ? sanitizeChannel(patch.image, current.image) : current.image,
    video: patch.video !== undefined ? sanitizeChannel(patch.video, current.video) : current.video,
  };
  cache = next;
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(next, null, 2), "utf-8");
  return next;
}

/** Masked view for the browser — apiKey never leaves the server. */
export function getMaskedChannels(): ApiChannelsView {
  const s = getWorkshopApiSettingsSync();
  const view = (c: ApiChannelStored) => ({
    configured: c.baseUrl.length > 0,
    baseUrl: c.baseUrl,
    path: c.path,
    model: c.model,
    hasApiKey: c.apiKey.length > 0,
  });
  return { image: view(s.image), video: view(s.video) };
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

/** Call an OpenAI-compatible images/generations endpoint; returns a usable URL
 *  (remote or inline data URL for b64 payloads). */
export async function generateImageViaApi(req: ApiImageRequest): Promise<string> {
  const c = getWorkshopApiSettingsSync().image;
  if (!c.baseUrl) throw new Error("API 生图通道未配置：请先填写 Base URL 与 API Key");
  let res: Response;
  try {
    res = await fetch(endpoint(c), {
      method: "POST",
      headers: headersFor(c),
      body: JSON.stringify({
        // 空串显式归一为 undefined(省略字段);不用 ?? —— ?? 会把 "" 原样送进 payload
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
  const payload = await readUpstreamJson(res);
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
  /** Reference first-frame image (inline data URL) for image-to-video. */
  imageDataUrl?: string;
  frames?: number;
  fps?: number;
}

export interface ApiVideoSubmitResult {
  /** Direct URL when the provider returned the finished video synchronously. */
  url?: string;
  /** Async task id to poll via pollVideoViaApi when the provider is task-based. */
  remoteTaskId?: string;
}

/** Submit a video job to the configured endpoint. Supports both sync-URL and
 *  async-task providers; the client polls the latter via generate route. */
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
  const payload = await readUpstreamJson(res);
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

/** Poll an async video task once. Returns the finished URL or { pending: true }. */
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
  const payload = await readUpstreamJson(res);
  if (!res.ok) {
    const detail = JSON.stringify(payload).slice(0, 200);
    throw new Error(`API 视频轮询失败 (${res.status}): ${detail}`);
  }
  const mediaUrl = extractMediaUrl(payload);
  if (mediaUrl) return { url: mediaUrl, pending: false };
  return { pending: true };
}

/** Resolve any image reference into an inline data URL (used before forwarding
 *  a first-frame to remote video APIs and when uploading to local ComfyUI). */
export { resolveMediaDataUrl };
