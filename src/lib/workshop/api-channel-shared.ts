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
import { joinApiUrl } from "~/lib/llm/provider-types";

export type ApiChannelKind = "image" | "video";

/* 浏览器看到的「每通道配置」（已脱敏；apiKey 从不离开服务端）。 */
export type ApiChannelView = {
  baseUrl: string;
  /* 配好了 baseUrl（视频还要配到可用的端点）→ 该通道可用。 */
  configured: boolean;
  hasApiKey: boolean;
  model: string;
  /* 追加到 baseUrl 后面的请求路径，例如 "/images/generations"。 */
  path: string;
};

/* 两个通道的脱敏视图，按通道种类作键。 */
export type ApiChannelsView = Record<ApiChannelKind, ApiChannelView>;

/* 配置保存接口接受的局部通道配置。 */
export type ApiChannelSaveInput = {
  /* 不传表示保留已存的密钥；传空串表示清除它。 */
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  path?: string;
};

/* 服务端落库的嵌套通道配置（存于 data/workshop-api-settings.json）。 */
export type ApiChannelStored = {
  apiKey: string;
  baseUrl: string;
  model: string;
  path: string;
};

const MAX_EXTRACT_DEPTH = 8;
/* 超过这个长度的「像 URL 的值」几乎肯定不是 URL
 *（像 `prompt` 这类键是刻意不去探测的，但这里仍保持防御）。 */
const MAX_URL_LENGTH = 2048;

/**
 * 深度优先搜索：在 `keys` 之一下面找到第一个字符串值。
 * 用于归一化五花八门的上游 API 响应（OpenAI 图片、异步任务接口、
 * 各家特有的信封结构），而不必硬编码每种形状。
 */
export function findStringUnderKeys(value: unknown, keys: Array<string>, depth = 0): string | null {
  if (depth > MAX_EXTRACT_DEPTH) {
    return null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = findStringUnderKeys(item, keys, depth + 1);
      if (hit !== null) {
        return hit;
      }
    }
    return null;
  }
  if (!isRecord(value)) {
    return null;
  }
  for (const key of keys) {
    const v: unknown = value[key];
    if (typeof v === "string" && v.length > 0 && v.length <= MAX_URL_LENGTH) {
      return v;
    }
  }
  for (const v of Object.values(value)) {
    if (isRecord(v) || Array.isArray(v)) {
      const hit = findStringUnderKeys(v, keys, depth + 1);
      if (hit !== null) {
        return hit;
      }
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

/* 生成响应里常见「放异步任务标识」的键名。`video_id` 是 Agnes 视频接口的
 * 原生任务键（#3577：提交响应里 `id` 虽然同值，但点名原生键免得依赖
 * 「恰好也有 id」这一巧合）。 */
const TASK_ID_KEYS = [
  "id",
  "task_id",
  "taskId",
  "video_id",
  "videoId",
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
export function extractBase64DataUrl(payload: unknown, mime = "image/png"): string | null {
  const b64 = findStringUnderKeys(payload, B64_KEYS, 2);
  if (b64 === null) {
    return null;
  }
  /* 有些上游直接内联一个 data URL。 */
  if (isDataUrl(b64)) {
    return b64;
  }
  /* 「怎么拼 data URL」只有一处定义（`~/lib/media/data-url`，规范 16 §16.2.4.56）。 */
  return wrapBase64(b64, mime);
}

/* 按文件路径 / URL 的扩展名猜媒体类型（SSE 输出里两种都有）。 */
export function guessMediaKind(pathOrUrl: string): "image" | "video" | "other" {
  if (/\.(?:mp4|webm|mov|mkv|avi|gif)(?:\?.*)?$/i.test(pathOrUrl)) {
    return "video";
  }
  if (/\.(?:png|jpe?g|webp|bmp|avif)(?:\?.*)?$/i.test(pathOrUrl)) {
    return "image";
  }
  return "other";
}

/* 已完成任务的一个落盘产物文件（来自 SSE 的 `done` 帧）。 */
export type SavedOutput = {
  kind: "image" | "video" | "other";
  url: string;
};

/**
 * 把任务的 `done.images` 载荷（unknown[]）归一成「URL + 类型」对。
 * 历史上条目要么是纯 URL 字符串，要么是 executor-finalize 产出的
 * `{ localPath, mediaType }` 记录。
 */
export function extractSavedOutputs(value: unknown): Array<SavedOutput> {
  const list = Array.isArray(value) ? value : [value];
  const out: Array<SavedOutput> = [];
  for (const entry of list) {
    if (typeof entry === "string") {
      out.push({ url: entry, kind: guessMediaKind(entry) });
      continue;
    }
    if (!isRecord(entry)) {
      continue;
    }
    const rawPath: unknown = entry.localPath ?? entry.url ?? entry.path;
    if (typeof rawPath !== "string" || rawPath.length === 0) {
      continue;
    }
    const rawKind: unknown = entry.mediaType ?? entry.type;
    const kind =
      rawKind === "video" || rawKind === "image" || rawKind === "other"
        ? rawKind
        : guessMediaKind(rawPath);
    out.push({ url: rawPath, kind });
  }
  return out;
}

/** Base URL 末段的资源段归一：…/images、…/videos 这类「用户把资源段填进了
 *  base」的历史形态剥掉，动作段交给 `joinApiUrl` 统一拼（#3656）。
 *  完整动作段（…/images/generations）不以这两段结尾，不受影响。 */
function stripTrailingResourceSegment(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "").replace(/\/(?:images|videos)$/i, "");
}

/** 由远端模型条目的 Base URL 解析「生图」端点（OpenAI 兼容 images/generations）。
 *  显式的模型级端点路径（`RemoteModelAdaptersDoc.endpointPath`，#3622/#3656）
 *  由调用方经 `joinApiUrl` 拼，不在这里兜；Base URL 按这几种形态兼容：
 *    已含完整动作段（…/v1/images/generations）→ 原样使用；
 *    只到资源段（…/v1/images 或 …/images）→ 归一后补动作段；
 *    只到根（…/v1 或裸域，#3656 新口径）→ 补全 /v1/images/generations。
 *  历史事故：条目里填了完整端点仍被无条件再拼一次，请求打到
 *  /v1/images/images/generations 而 404。纯字符串拼装，可单测。 */
export function resolveImagesGenerationsEndpoint(baseUrl: string): string {
  const base = stripTrailingResourceSegment(String(baseUrl).trim());
  if (/\/images\/generations$/i.test(base)) {
    return base;
  }
  return joinApiUrl(base, "/images/generations");
}

/** 由远端模型条目的 Base URL 解析「生视频」端点（与生图同一套三形态兼容，
 *  动作段换成 OpenAI 兼容视频惯例 /videos/generations）。
 *
 *  为什么与生图成对而不是复用：两张表的资源名（images / videos）与动作段
 *  是同一套惯例的两份实例，参数化（资源名进参）会让调用点读不出「这是哪条
 *  通道的端点」，镜像两份各自贴着各自的资源名更直白（与 api-channel.server
 *  里图 / 视频两份 resolveTarget 的拆分同一取舍）。#3656 起版本段缺省由
 *  `joinApiUrl` 统一补（Base 只到裸域时不再发一个注定 404 的地址）。 */
export function resolveVideosGenerationsEndpoint(baseUrl: string): string {
  const base = stripTrailingResourceSegment(String(baseUrl).trim());
  if (/\/videos\/generations$/i.test(base)) {
    return base;
  }
  return joinApiUrl(base, "/videos/generations");
}

/* ── 调试探白的纯形状助手（自 api-channel-core 拆来，#4724 连带）────────
 * 客户端测试页与服务端中继都要用同一套「请求体截断」展示；放在这个纯模块里，
 * 客户端就不必为了这两个助手去引 api-channel-core（那会顺带把出网判据拖进
 * 浏览器可达图）。 */

/** 一条「实际发出的请求」读数（ISSUE #3791：测试生成要能看到完整请求参数）。
 *  由各 call* 在 fetch 返回后回调 `options.debug` 上报；`body` 里的长字符串
 *  （如输入图 data URL）已按 `DEBUG_STRING_LIMIT` 截断 —— 面板要的是形状，
 *  不是整张图。密钥不进这里（它在请求头里，回调消费方只拿得到
 *  endpoint / body / 状态 / 耗时 / 响应摘要）。 */
export type ApiCallDebugRow = {
  /** 实际发出的请求体（长字符串已截断）。 */
  body: unknown;
  /** 从发起到读到响应的毫秒数；候选轮询里单个候选失败也有值。 */
  durationMs: number | null;
  /** 实际请求的完整 URL（含按 Base URL 形态推导出的动作路径）。 */
  endpoint: string;
  /** 上游响应体的**结构化截断**视图（与 body 同一套截断：长字符串截断、
   * 结构原样）—— 客户端才能可靠地格式化显示；截断的裸字符串 JSON 解析
   * 不回去，格式化就没有结构可用了（ISSUE #3799）。网络层失败为 null。 */
  excerpt: unknown;
  /** HTTP 层是否 2xx。 */
  ok: boolean;
  /** 哪一步发的：本地提交（客户端即时行）/ 生图 / 视频提交 / 视频轮询
   * （轮询逐候选上报）/ 本地任务（#4080 评论 4：工作流候选的 ComfyUI 任务行）。 */
  phase: "image" | "local-task" | "relay" | "video-poll" | "video-submit";
  /** HTTP 状态码；网络层失败（fetch 抛错）时为 null。 */
  status: number | null;
};

/** debug 面板里字符串值的截断长度：请求体里塞过 data URL（整张图），
 *  不截断的话一条读数就是几 MB。 */
const DEBUG_STRING_LIMIT = 300;
function truncateDebugString(text: string): string {
  return text.length <= DEBUG_STRING_LIMIT
    ? text
    : `${text.slice(0, DEBUG_STRING_LIMIT)}…（截断，原长 ${text.length} 字符）`;
}

/** 请求体的 debug 形状：长字符串截断、结构原样（形状才是要看的）。
 * 导出：客户端（测试页）的「本地提交」行用同一套截断展示组装好的请求体。 */
export function debugBodyOf(body: unknown): unknown {
  if (typeof body === "string") {
    return truncateDebugString(body);
  }
  if (Array.isArray(body)) {
    return body.map(debugBodyOf);
  }
  if (body !== null && typeof body === "object") {
    /* isRecord 收窄而不是断言（no-unsafe-type-assertion）。 */
    if (!isRecord(body)) {
      return null;
    }
    return Object.fromEntries(
      Object.entries(body).map(([key, value]) => [key, debugBodyOf(value)]),
    );
  }
  return body;
}
