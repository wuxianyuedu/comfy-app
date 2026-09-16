// ── Workshop API channel: shared types + pure extraction helpers ──────────
// The workshop pipeline's 镜头生图 / 视频生成 stages support two channels:
//   • local  — the existing ComfyUI workflow chain (tRPC generate + SSE)
//   • api    — a user-configured OpenAI-compatible HTTP endpoint
// This module holds the wire types and response-shape extraction helpers so
// both the server relay routes and client components agree on one contract.
// Pure functions only — safe to import from client components.

/** Which generation stage an API channel serves. */
export type ApiChannelKind = "image" | "video";

/** Masked per-channel config as seen by the browser (apiKey never leaves the server). */
export interface ApiChannelView {
  /** baseUrl + (for video) a reachable endpoint are configured → channel usable. */
  configured: boolean;
  baseUrl: string;
  /** Request path appended to baseUrl, e.g. "/images/generations". */
  path: string;
  model: string;
  hasApiKey: boolean;
}

/** Masked view for both channels, keyed by kind. */
export type ApiChannelsView = Record<ApiChannelKind, ApiChannelView>;

/** Partial channel config accepted by the config save endpoint. */
export interface ApiChannelSaveInput {
  baseUrl?: string;
  path?: string;
  model?: string;
  /** Omit to keep the stored key; empty string clears it. */
  apiKey?: string;
}

/** Nested channel config as persisted server-side (data/workshop-api-settings.json). */
export interface ApiChannelStored {
  baseUrl: string;
  path: string;
  model: string;
  apiKey: string;
}

/** Narrow an unknown value to a plain object (the only guard the relay needs). */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

const MAX_EXTRACT_DEPTH = 8;
/** URL-ish values longer than this are almost certainly not URLs (keys like
 *  `prompt` are intentionally not probed, but stay defensive). */
const MAX_URL_LENGTH = 2048;

/**
 * Depth-first search for the first string value stored under one of `keys`.
 * Used to normalize heterogeneous upstream API responses (OpenAI images,
 * async task APIs, provider-specific envelopes) without hard-coding shapes.
 */
export function findStringUnderKeys(
  value: unknown,
  keys: string[],
  depth = 0,
): string | null {
  if (depth > MAX_EXTRACT_DEPTH) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = findStringUnderKeys(item, keys, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (!isRecord(value)) return null;
  for (const key of keys) {
    const v: unknown = value[key];
    if (typeof v === "string" && v.length > 0 && v.length <= MAX_URL_LENGTH)
      return v;
  }
  for (const v of Object.values(value)) {
    if (isRecord(v) || Array.isArray(v)) {
      const hit = findStringUnderKeys(v, keys, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

/** Keys commonly holding a direct media URL in generation responses. */
const MEDIA_URL_KEYS = [
  "url",
  "image_url",
  "imageUrl",
  "video_url",
  "videoUrl",
  "output_url",
  "outputUrl",
  "download_url",
  "downloadUrl",
  "file_url",
  "fileUrl",
  "result_url",
  "resultUrl",
];

/** Keys commonly holding an async job/task identifier. */
const TASK_ID_KEYS = [
  "id",
  "task_id",
  "taskId",
  "job_id",
  "jobId",
  "request_id",
  "requestId",
];

/** Keys commonly holding base64 payloads (OpenAI images b64_json). */
const B64_KEYS = ["b64_json", "b64Json", "image_base64", "base64"];

/**
 * Extract a finished media URL from an upstream response (or poll result).
 * Returns null when the response carries no URL yet (async pending).
 */
export function extractMediaUrl(payload: unknown): string | null {
  return findStringUnderKeys(payload, MEDIA_URL_KEYS);
}

/** Extract an async task id from an upstream submit response. */
export function extractRemoteTaskId(payload: unknown): string | null {
  return findStringUnderKeys(payload, TASK_ID_KEYS);
}

/** Extract a base64 media payload and wrap it as a data URL, or null. */
export function extractBase64DataUrl(
  payload: unknown,
  mime = "image/png",
): string | null {
  const b64 = findStringUnderKeys(payload, B64_KEYS, 2);
  if (!b64) return null;
  // Some providers inline a data URL already.
  if (b64.startsWith("data:")) return b64;
  return `data:${mime};base64,${b64}`;
}

/** Guess media kind from a file path/URL extension (SSE outputs carry both). */
export function guessMediaKind(pathOrUrl: string): "image" | "video" | "other" {
  if (/\.(mp4|webm|mov|mkv|avi|gif)(\?.*)?$/i.test(pathOrUrl)) return "video";
  if (/\.(png|jpe?g|webp|bmp|avif)(\?.*)?$/i.test(pathOrUrl)) return "image";
  return "other";
}

/** One saved output file from a finished task (SSE `done` frame). */
export interface SavedOutput {
  url: string;
  kind: "image" | "video" | "other";
}

/**
 * Normalize a task's `done.images` payload (unknown[]) into URL + kind pairs.
 * Entries are historically either plain URL strings or `{ localPath, mediaType }`
 * records produced by executor-finalize.
 */
export function extractSavedOutputs(value: unknown): SavedOutput[] {
  const list = Array.isArray(value) ? value : [value];
  const out: SavedOutput[] = [];
  for (const entry of list) {
    if (typeof entry === "string") {
      out.push({ url: entry, kind: guessMediaKind(entry) });
      continue;
    }
    if (!isRecord(entry)) continue;
    const rawPath: unknown = entry.localPath ?? entry.url ?? entry.path;
    if (typeof rawPath !== "string" || rawPath.length === 0) continue;
    const rawKind: unknown = entry.mediaType ?? entry.type;
    const kind =
      rawKind === "video" || rawKind === "image" || rawKind === "other"
        ? rawKind
        : guessMediaKind(rawPath);
    out.push({ url: rawPath, kind });
  }
  return out;
}

/** 由远端模型条目的 Base URL 解析「生图」端点（OpenAI 兼容 images/generations）。
 *  用户在设置页填的 Base URL 三种形态都兼容：
 *    已含完整动作段（…/v1/images/generations）→ 原样使用；
 *    只到资源段（…/v1/images）→ 只补动作段 /generations；
 *    只到根（…/v1）→ 补全 /images/generations。
 *  历史事故：条目里填了完整端点仍被无条件再拼一次，请求打到
 *  /v1/images/images/generations 而 404。纯字符串拼装，可单测。 */
export function resolveImagesGenerationsEndpoint(baseUrl: string): string {
  const base = String(baseUrl ?? "")
    .trim()
    .replace(/\/+$/, "");
  if (/\/images\/generations$/i.test(base)) return base;
  if (/\/images$/i.test(base)) return `${base}/generations`;
  return `${base}/images/generations`;
}
