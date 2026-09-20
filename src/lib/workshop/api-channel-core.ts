// ── Workshop API channel: 配置存储 + 上游调用的**唯一实现** ─────────────
// 本模块把「按配置调一个 OpenAI 兼容端点」的全部逻辑收在一处：配置读取 /
// 归一化 / 掩码视图 / 生图 / 生视频 / 轮询。
//
// 为什么单独存在（而不是留在 api-channel.server.ts 里）：同一套能力有**两个**
// 入口需要它 ——
//   · `api-channel.server.ts`：Next 侧，必须 `import "server-only"`（防止
//     配置与 apiKey 被打进浏览器包）；
//   · `src/server/workshop/api-channel.ts`：MCP stdio 侧，纯 Node 运行，
//     **不能**碰 server-only（那会在非 Next 环境直接抛错）。
// 两者的差异只有「读配置时用哪个 IO 实现」与「拿到响应体后怎么解析」，
// 业务协议（请求体字段、超时、错误文案、URL/任务 id 提取）必须逐字相同。
//
// 历史上这两个入口各自复制了一份实现（84% 逐行相同），于是「改一处漏一处」
// 就是一次静默的协议分叉 —— 生图请求体在一边加了字段、另一边还是旧的。
// 现在协议只此一份，入口只注入 IO 适配器。
import {
  extractBase64DataUrl,
  extractMediaUrl,
  extractRemoteTaskId,
  type ApiChannelKind,
  type ApiChannelStored,
  type ApiChannelsView,
} from "./api-channel-shared";
import { errorText } from "~/lib/error-message";
import { INLINE_SNIPPET_MAX, clampText } from "~/lib/text-clamp";

/** 单个通道的配置（回导出：入口与用例都从这里取，避免各自 import 两个模块）。 */
export type { ApiChannelStored };

/** 两个入口共用的四字段配置（image / video 各一份）。 */
export type WorkshopApiSettings = Record<ApiChannelKind, ApiChannelStored>;

/** 上游默认值：文件名、环境变量兜底与两个通道的初始 path。 */
export const WORKSHOP_API_SETTINGS_FILE = "workshop-api-settings.json";

/** 远端模型连接参数（设置页「远端模型」条目）——生图优先走它直连。 */
export interface ApiUpstreamTarget {
  endpoint: string;
  apiKey: string;
  model: string;
}

/** 生图请求：字段与工坊「统一输入」的对应关系由适配器决定，见调用方。 */
export interface ApiImageRequest {
  prompt: string;
  negative?: string;
  size?: string;
  /** 设置页「远端模型」的名字：按 remoteModel 表条目的连接参数直连生图 */
  model?: string;
  /** 工坊模式码（T2I / I2I / …）：有适配器时按它取字段映射 */
  mode?: string;
  /** 统一输入：宽高比 / 百万像素 / 宽高对齐倍数 / 输入图。 */
  aspectRatio?: string;
  megapixels?: string;
  multiple?: number;
  image?: string;
}

/** 视频提交请求（同步 URL 与异步任务两种上游都走它）。 */
export interface ApiVideoSubmitRequest {
  prompt: string;
  negative?: string;
  /* 图生视频用的参考首帧图（内联 data URL）。 */
  imageDataUrl?: string;
  frames?: number;
  fps?: number;
}

/** 视频提交结果：同步返回 URL，或给一个待轮询的任务 id。 */
export interface ApiVideoSubmitResult {
  /* 上游同步返回成品视频时给出的直链 URL。 */
  url?: string;
  /* 上游是「任务式」接口时，用来轮询的任务 id（经 pollVideoViaApi）。 */
  remoteTaskId?: string;
}

/** 归一化上游不明对象的窄化（唯一需要的那一种守卫）。 */
export function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** 把一份可能残缺的配置归一化：字符串字段取默认、path 强制根相对。 */
export function sanitizeChannel(
  raw: unknown,
  fallback: ApiChannelStored,
): ApiChannelStored {
  const src = (typeof raw === "object" && raw !== null ? raw : {}) as Record<
    string,
    unknown
  >;
  const str = (key: string): string | undefined => {
    const v: unknown = src[key];
    return typeof v === "string" ? v : undefined;
  };
  const baseUrl = (str("baseUrl") ?? fallback.baseUrl).trim();
  const reqPath = (str("path") ?? fallback.path).trim();
  return {
    baseUrl,
    // 路径必须是根相对，拼接 `${baseUrl}${path}` 才能保持格式正确。
    path: reqPath.startsWith("/") ? reqPath : `/${reqPath}`,
    model: (str("model") ?? fallback.model).trim(),
    apiKey: str("apiKey") ?? fallback.apiKey,
  };
}

/** 按环境变量拼出两个通道的默认配置（两个入口共用同一套变量名）。 */
export type EnvLike = Record<string, string | undefined>;

export function defaultChannelsFromEnv(
  env: EnvLike = process.env,
): WorkshopApiSettings {
  return {
    image: {
      baseUrl: env.WORKSHOP_API_IMAGE_BASE ?? "",
      path: "/images/generations",
      model: env.WORKSHOP_API_IMAGE_MODEL ?? "",
      apiKey: env.WORKSHOP_API_IMAGE_KEY ?? "",
    },
    video: {
      baseUrl: env.WORKSHOP_API_VIDEO_BASE ?? "",
      path: "/videos/generations",
      model: env.WORKSHOP_API_VIDEO_MODEL ?? "",
      apiKey: env.WORKSHOP_API_VIDEO_KEY ?? "",
    },
  };
}

/** 把两个通道的配置各归一化一次（读取与保存共用）。 */
export function normalizeSettings(
  stored: Partial<WorkshopApiSettings>,
  defaults: WorkshopApiSettings,
): WorkshopApiSettings {
  return {
    image: sanitizeChannel(stored.image, defaults.image),
    video: sanitizeChannel(stored.video, defaults.video),
  };
}

/** 掩码视图（apiKey 只留 hasApiKey 布尔，永不离开服务端）。 */
export function maskChannels(settings: WorkshopApiSettings): ApiChannelsView {
  const view = (c: ApiChannelStored) => ({
    configured: c.baseUrl.length > 0,
    baseUrl: c.baseUrl,
    path: c.path,
    model: c.model,
    hasApiKey: c.apiKey.length > 0,
  });
  return { image: view(settings.image), video: view(settings.video) };
}

/** 请求头：总是 JSON，有 apiKey 才带 Authorization。 */
export function headersFor(c: ApiChannelStored): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (c.apiKey) h.Authorization = `Bearer ${c.apiKey}`;
  return h;
}

/** 完整端点：baseUrl（去尾斜杠）+ 根相对的 path。 */
export function endpointFor(c: ApiChannelStored): string {
  return `${c.baseUrl.replace(/\/+$/, "")}${c.path}`;
}

/** 异步任务的轮询地址：baseUrl + 任务 id。 */
export function pollEndpointFor(baseUrl: string, remoteTaskId: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${remoteTaskId.replace(/^\/+/, "")}`;
}

/** 上游响应 → JSON。默认 `res.json()`；Next 侧另有更严的实现（非 JSON 报错）。 */
export type UpstreamJsonReader = (res: Response) => Promise<unknown>;

const defaultJsonReader: UpstreamJsonReader = (res) =>
  res.json().catch(() => ({})) as Promise<unknown>;

/** 上游返回非 2xx 时统一的错误文案（截断响应体，避免把整页 HTML 灌进日志）。 */
function upstreamError(label: string, status: number, payload: unknown): Error {
  const detail = clampText(JSON.stringify(payload), {
    maxLength: INLINE_SNIPPET_MAX,
    marker: "",
  });
  return new Error(`${label} (${status}): ${detail}`);
}

/** 按点分字段路径取一个字符串（适配器的 outputField；未指定/未命中返回 null）。 */
function pickStringByPath(payload: unknown, fieldPath?: string): string | null {
  if (!fieldPath) return null;
  let cur: unknown = payload;
  for (const seg of fieldPath.split(".").filter(Boolean)) {
    if (!isPlainRecord(cur)) return null;
    cur = cur[seg];
  }
  return typeof cur === "string" && cur.length > 0 ? cur : null;
}

/** 生图请求体（无适配器时的 OpenAI 兼容默认映射）。
 *  空串显式归一为 undefined（省略字段）——用 `??` 会把 "" 原样送进 payload。 */
function defaultImageBody(
  req: ApiImageRequest,
  model: string,
): Record<string, unknown> {
  return {
    model: model === "" ? undefined : model,
    prompt: req.prompt,
    negative_prompt: req.negative === "" ? undefined : req.negative,
    size: req.size === "" ? undefined : req.size,
    n: 1,
    response_format: "url",
  };
}

/** 视频提交请求体（同步 / 异步上游共用；image 双写兼容两种命名）。 */
function videoBody(
  req: ApiVideoSubmitRequest,
  model: string,
): Record<string, unknown> {
  return {
    model: model === "" ? undefined : model,
    prompt: req.prompt,
    negative_prompt: req.negative === "" ? undefined : req.negative,
    image_url: req.imageDataUrl,
    image: req.imageDataUrl,
    frames: req.frames,
    fps: req.fps,
  };
}

/* 超时（毫秒）：生图/提交都等远端模型跑完，给 3 分钟；轮询是轻量 GET。 */
const GENERATE_TIMEOUT_MS = 180_000;
const POLL_TIMEOUT_MS = 30_000;

export interface ApiChannelFetchOptions {
  /** 上游响应体解析器（Next 侧传 `readUpstreamJson`，MCP 侧用默认）。 */
  readJson?: UpstreamJsonReader;
  /** 请求体覆盖（远端模型的模式适配器翻译统一输入后给出；缺省走 OpenAI 兼容默认映射）。 */
  bodyOverride?: Record<string, unknown>;
  /** 上游结果字段路径（适配器的 outputField）：命中即直接当结果 URL 返回。 */
  outputField?: string;
}

/**
 * 调 OpenAI 兼容生图端点，返回可用 URL（远程或 inline data URL）。
 * `resolveTarget` 由入口注入：Next 侧先查 remoteModel 表决定用哪个上游。
 */
export async function callImageGeneration(
  req: ApiImageRequest,
  channel: ApiChannelStored,
  resolveTarget: (
    req: ApiImageRequest,
    channel: ApiChannelStored,
  ) => ApiUpstreamTarget | null,
  options: ApiChannelFetchOptions = {},
): Promise<string> {
  const target = resolveTarget(req, channel) ?? {
    endpoint: endpointFor(channel),
    apiKey: channel.apiKey,
    model: channel.model,
  };
  if (!target.endpoint || target.endpoint === "/images/generations") {
    throw new Error(
      "远端 API 生图通道未配置 —— 可在设置页「远端模型」里添加生图模型（kind=图片），或打开 API 通道设置填写 Base URL 与 API Key",
    );
  }
  let res: Response;
  try {
    res = await fetch(target.endpoint, {
      method: "POST",
      headers: target.apiKey
        ? {
            "Content-Type": "application/json",
            Authorization: `Bearer ${target.apiKey}`,
          }
        : { "Content-Type": "application/json" },
      body: JSON.stringify(
        options.bodyOverride ?? defaultImageBody(req, target.model),
      ),
      signal: AbortSignal.timeout(GENERATE_TIMEOUT_MS),
    });
  } catch (e) {
    throw new Error(errorText(e, "API 生图请求失败"));
  }
  const payload = await (options.readJson ?? defaultJsonReader)(res);
  if (!res.ok) throw upstreamError("API 生图失败", res.status, payload);
  /* 适配器指定了结果字段：只认那个字段（不再做通配提取，避免取到无关的
   * 同名字段）。命中即返回，未命中回落通配提取——与既有行为一致。 */
  const picked = pickStringByPath(payload, options.outputField);
  const url =
    picked ?? extractMediaUrl(payload) ?? extractBase64DataUrl(payload);
  if (!url) throw new Error("API 生图响应中未找到图片 URL / b64 数据");
  return url;
}

/** 提交视频任务；支持同步 URL 与异步任务两种上游。 */
export async function callVideoSubmit(
  req: ApiVideoSubmitRequest,
  channel: ApiChannelStored,
  options: ApiChannelFetchOptions = {},
): Promise<ApiVideoSubmitResult> {
  if (!channel.baseUrl)
    throw new Error("API 视频通道未配置：请先填写 Base URL 与 API Key");
  let res: Response;
  try {
    res = await fetch(endpointFor(channel), {
      method: "POST",
      headers: headersFor(channel),
      body: JSON.stringify(videoBody(req, channel.model)),
      signal: AbortSignal.timeout(GENERATE_TIMEOUT_MS),
    });
  } catch (e) {
    throw new Error(errorText(e, "API 视频提交失败"));
  }
  const payload = await (options.readJson ?? defaultJsonReader)(res);
  if (!res.ok) throw upstreamError("API 视频提交失败", res.status, payload);
  const url = extractMediaUrl(payload);
  if (url) return { url };
  const remoteTaskId = extractRemoteTaskId(payload);
  if (remoteTaskId) return { remoteTaskId };
  throw new Error("API 视频响应中未找到视频 URL 或任务 ID");
}

/** 轮询一次异步视频任务。 */
export async function callVideoPoll(
  remoteTaskId: string,
  channel: ApiChannelStored,
  options: ApiChannelFetchOptions = {},
): Promise<{ url?: string; pending: boolean }> {
  if (!channel.baseUrl) throw new Error("API 视频通道未配置");
  let res: Response;
  try {
    res = await fetch(pollEndpointFor(channel.baseUrl, remoteTaskId), {
      method: "GET",
      headers: headersFor(channel),
      signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
    });
  } catch (e) {
    throw new Error(errorText(e, "API 视频轮询失败"));
  }
  const payload = await (options.readJson ?? defaultJsonReader)(res);
  if (!res.ok) throw upstreamError("API 视频轮询失败", res.status, payload);
  const mediaUrl = extractMediaUrl(payload);
  if (mediaUrl) return { url: mediaUrl, pending: false };
  return { pending: true };
}
