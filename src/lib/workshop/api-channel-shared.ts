// ── 工坊 API 通道：共享类型 + 纯提取助手 ────────────────────────────────
// The workshop pipeline's 镜头生图 / 视频生成 stages support two channels:
//   • local —— 现有的 ComfyUI 工作流链路（tRPC generate + SSE）
//   • api   —— 用户自己配的 OpenAI 兼容 HTTP 端点
// 本模块持有传输层类型与「响应形状提取」助手，
// 让服务端中继路由与客户端组件对同一份契约达成一致。
// 全是纯函数 —— 客户端组件导入它是安全的。

/* 某个 API 通道服务哪个生成阶段。 */
import { isDataUrl, wrapBase64 } from "~/lib/media/data-url";
import { isRecord } from "~/lib/is-record";

export type ApiChannelKind = "image" | "video";

/* 浏览器看到的「每通道配置」（已脱敏；apiKey 从不离开服务端）。 */
export interface ApiChannelView {
  /* 配好了 baseUrl（视频还要配到可用的端点）→ 该通道可用。 */
  configured: boolean;
  baseUrl: string;
  /* 追加到 baseUrl 后面的请求路径，例如 "/images/generations"。 */
  path: string;
  model: string;
  hasApiKey: boolean;
}

/* 两个通道的脱敏视图，按通道种类作键。 */
export type ApiChannelsView = Record<ApiChannelKind, ApiChannelView>;

/* 配置保存接口接受的局部通道配置。 */
export interface ApiChannelSaveInput {
  baseUrl?: string;
  path?: string;
  model?: string;
  /* 不传表示保留已存的密钥；传空串表示清除它。 */
  apiKey?: string;
}

/* 服务端落库的嵌套通道配置（存于 data/workshop-api-settings.json）。 */
export interface ApiChannelStored {
  baseUrl: string;
  path: string;
  model: string;
  apiKey: string;
}

const MAX_EXTRACT_DEPTH = 8;
/* 超过这个长度的「像 URL 的值」几乎肯定不是 URL
 *（像 `prompt` 这类键是刻意不去探测的，但这里仍保持防御）。 */
const MAX_URL_LENGTH = 2048;

/**
 * 深度优先搜索：在 `keys` 之一下面找到第一个字符串值。
 * 用于归一化五花八门的上游 API 响应（OpenAI 图片、异步任务接口、
 * 各家特有的信封结构），而不必硬编码每种形状。
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

/* 生成响应里常见「直接放媒体 URL」的键名。 */
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

/* 生成响应里常见「放异步任务标识」的键名。 */
const TASK_ID_KEYS = [
  "id",
  "task_id",
  "taskId",
  "job_id",
  "jobId",
  "request_id",
  "requestId",
];

/* 常见「放 base64 载荷」的键名（例如 OpenAI 图片的 b64_json）。 */
const B64_KEYS = ["b64_json", "b64Json", "image_base64", "base64"];

/**
 * 从上游响应（或轮询结果）里取出成品媒体的 URL。
 * 响应里还没有 URL（异步任务尚未完成）时返回 null。
 */
export function extractMediaUrl(payload: unknown): string | null {
  return findStringUnderKeys(payload, MEDIA_URL_KEYS);
}

/* 从上游的提交响应里取出异步任务 id。 */
export function extractRemoteTaskId(payload: unknown): string | null {
  return findStringUnderKeys(payload, TASK_ID_KEYS);
}

/* 取出 base64 媒体载荷并包装成 data URL；取不到则为 null。 */
export function extractBase64DataUrl(
  payload: unknown,
  mime = "image/png",
): string | null {
  const b64 = findStringUnderKeys(payload, B64_KEYS, 2);
  if (!b64) return null;
  /* 有些上游直接内联一个 data URL。 */
  if (isDataUrl(b64)) return b64;
  /* 「怎么拼 data URL」只有一处定义（`~/lib/media/data-url`，规范 16 §16.2.4.56）。 */
  return wrapBase64(b64, mime);
}

/* 按文件路径 / URL 的扩展名猜媒体类型（SSE 输出里两种都有）。 */
export function guessMediaKind(pathOrUrl: string): "image" | "video" | "other" {
  if (/\.(mp4|webm|mov|mkv|avi|gif)(\?.*)?$/i.test(pathOrUrl)) return "video";
  if (/\.(png|jpe?g|webp|bmp|avif)(\?.*)?$/i.test(pathOrUrl)) return "image";
  return "other";
}

/* 已完成任务的一个落盘产物文件（来自 SSE 的 `done` 帧）。 */
export interface SavedOutput {
  url: string;
  kind: "image" | "video" | "other";
}

/**
 * 把任务的 `done.images` 载荷（unknown[]）归一成「URL + 类型」对。
 * 历史上条目要么是纯 URL 字符串，要么是 executor-finalize 产出的
 * `{ localPath, mediaType }` 记录。
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
