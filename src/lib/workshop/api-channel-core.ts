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
import { asRecord, isRecord } from "~/lib/is-record";
import { INLINE_SNIPPET_MAX, clampText } from "~/lib/text-clamp";

/** 单个通道的配置（回导出：入口与用例都从这里取，避免各自 import 两个模块）。 */
export type { ApiChannelStored };

/** 两个入口共用的四字段配置（image / video 各一份）。 */
export type WorkshopApiSettings = Record<ApiChannelKind, ApiChannelStored>;

/** 上游默认值：文件名、环境变量兜底与两个通道的初始 path。 */
export const WORKSHOP_API_SETTINGS_FILE = "workshop-api-settings.json";

/** 远端模型连接参数（设置页「远端模型」条目）——生图优先走它直连。 */
export type ApiUpstreamTarget = {
  apiKey: string;
  endpoint: string;
  model: string;
};

/** 生图请求：字段与工坊「统一输入」的对应关系由适配器决定，见调用方。 */
export type ApiImageRequest = {
  /** 统一输入：宽高比 / 百万像素 / 分辨率档（"1k"/"2k"/"4k"）/ 对齐倍数 / 输入图。
   *  分辨率与百万像素是同一「尺寸」口的两种表达：工坊选「分辨率」表达时
   *  `resolution` 带档位名，`megapixels` 仍带换算值 —— 适配器映射了哪个
   *  就下发哪个（ISSUE #3622：接口原生认 1k/2k/4k 这类档位的直接映射）。 */
  aspectRatio?: string;
  image?: string;
  megapixels?: string;
  /** 工坊模式码（T2I / I2I / …）：有适配器时按它取字段映射 */
  mode?: string;
  /** 设置页「远端模型」的名字：按 remoteModel 表条目的连接参数直连生图 */
  model?: string;
  multiple?: number;
  negative?: string;
  prompt: string;
  /** 统一输入「分辨率」的取值（清晰度档位名，如 "1k"）。 */
  resolution?: string;
  /** 统一输入「种子」（ISSUE #3778）：非负整数；缺省 = 不带（上游自己摇）。 */
  seed?: number;
  size?: string;
};

/** 视频提交请求（同步 URL 与异步任务两种上游都走它）。 */
export type ApiVideoSubmitRequest = {
  /** 秒数（#3590：适配器 duration 输入的直接取值；工坊镜头链路继续传 frames/fps）。 */
  duration?: number;
  fps?: number;
  frames?: number;
  /* 图生视频用的参考首帧图（内联 data URL）。 */
  imageDataUrl?: string;
  /** 工坊模式码（T2V / I2V …，#3590）：远端模型有该模式适配器时按它翻译字段。 */
  mode?: string;
  /** 设置页「远端模型」的名字（#3590）：按 remoteModel 表条目的连接参数直连。 */
  model?: string;
  negative?: string;
  prompt: string;
  /** 统一输入「种子」（ISSUE #3783）：非负整数；缺省 = 不带（上游自己摇）。
   *  与生图 `ApiImageRequest.seed`（#3778）同口径。 */
  seed?: number;
};

/** 视频提交结果：同步返回 URL，或给一个待轮询的任务 id。 */
export type ApiVideoSubmitResult = {
  /* 上游是「任务式」接口时，用来轮询的任务 id（经 pollVideoViaApi）。 */
  remoteTaskId?: string;
  /* 上游同步返回成品视频时给出的直链 URL。 */
  url?: string;
};

/** 把一份可能残缺的配置归一化：字符串字段取默认、path 强制根相对。 */
export function sanitizeChannel(raw: unknown, fallback: ApiChannelStored): ApiChannelStored {
  const src = asRecord(raw) ?? {};
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

export function defaultChannelsFromEnv(env: EnvLike = process.env): WorkshopApiSettings {
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
  if (c.apiKey) {
    h.Authorization = `Bearer ${c.apiKey}`;
  }
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

/* SAFETY: 类型断言已复核 */
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
  if (fieldPath === undefined || fieldPath === "") {
    return null;
  }
  let cur: unknown = payload;
  for (const seg of fieldPath.split(".").filter(Boolean)) {
    /* 用 isRecord（含数组）而非 isPlainRecord：本函数按点分路径下钻，
     * 路径段是字符串，但数组索引 "0" 在 JS 里也能取到元素 —— 收口前的
     * 实现正是「数组也算对象」，改用严格版会静默改变收窄结果。 */
    if (!isRecord(cur)) {
      return null;
    }
    cur = cur[seg];
  }
  return typeof cur === "string" && cur.length > 0 ? cur : null;
}

/** 生图请求体（无适配器时的 OpenAI 兼容默认映射）。
 *  空串显式归一为 undefined（省略字段）——用 `??` 会把 "" 原样送进 payload。 */
function defaultImageBody(req: ApiImageRequest, model: string): Record<string, unknown> {
  return {
    model: model === "" ? undefined : model,
    prompt: req.prompt,
    negative_prompt: req.negative === "" ? undefined : req.negative,
    size: req.size === "" ? undefined : req.size,
    /* 种子（ISSUE #3778）：填了才带，字段名用远端接口的通行名。 */
    ...(req.seed === undefined ? {} : { seed: req.seed }),
    n: 1,
    response_format: "url",
  };
}

/** 视频提交请求体（同步 / 异步上游共用；image 双写兼容两种命名）。 */
function videoBody(req: ApiVideoSubmitRequest, model: string): Record<string, unknown> {
  return {
    model: model === "" ? undefined : model,
    prompt: req.prompt,
    negative_prompt: req.negative === "" ? undefined : req.negative,
    image_url: req.imageDataUrl,
    image: req.imageDataUrl,
    frames: req.frames,
    fps: req.fps,
    /* 种子（ISSUE #3783）：填了才带，字段名用远端接口的通行名
     * （与 defaultImageBody 的 seed 同口径）。 */
    ...(req.seed === undefined ? {} : { seed: req.seed }),
  };
}

/* 超时（毫秒）：生图/提交都等远端模型跑完，给 3 分钟；轮询是轻量 GET。 */
const GENERATE_TIMEOUT_MS = 180_000;
const POLL_TIMEOUT_MS = 30_000;

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
   * （轮询逐候选上报）。 */
  phase: "image" | "relay" | "video-poll" | "video-submit";
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

export type ApiChannelFetchOptions = {
  /** 请求体覆盖（远端模型的模式适配器翻译统一输入后给出；缺省走 OpenAI 兼容默认映射）。 */
  bodyOverride?: Record<string, unknown>;
  /** 请求读数回调（ISSUE #3791）：给出时每次实际发出的请求（含轮询逐候选）
   *  都上报一条 {@link ApiCallDebugRow}；网络层失败也报（status=null）。 */
  debug?: (row: ApiCallDebugRow) => void;
  /** 模型级透传字段（#3626）：厂商特有 JSON 字段（如 `extra_body.response_format`），
   *  落在请求 body **最后** —— 覆盖适配器/默认映射组装出的字段。 */
  extraBody?: Record<string, unknown>;
  /** 上游结果字段路径（适配器的 outputField）：命中即直接当结果 URL 返回。 */
  outputField?: string;
  /** 异步视频任务的轮询地址候选（#3590）：远端模型有自己的任务查询形状
   *  （Agnes 系 /agnesapi?video_id=…、REST /videos/{id}），给出时**逐个试**，
   *  缺省回落通道设置那条 `baseUrl/{taskId}`。 */
  pollUrls?: Array<string>;
  /** 上游响应体解析器（Next 侧传 `readUpstreamJson`，MCP 侧用默认）。 */
  readJson?: UpstreamJsonReader;
  /** 上游目标覆盖（#3590）：远端模型按 remoteModel 表解析出的
   *  endpoint / apiKey / model。给出时提交不再用通道设置那一格。 */
  targetOverride?: ApiUpstreamTarget;
};

/**
 * 调 OpenAI 兼容生图端点，返回可用 URL（远程或 inline data URL）。
 * `resolveTarget` 由入口注入：Next 侧先查 remoteModel 表决定用哪个上游。
 */
export async function callImageGeneration(
  req: ApiImageRequest,
  channel: ApiChannelStored,
  resolveTarget: (req: ApiImageRequest, channel: ApiChannelStored) => ApiUpstreamTarget | null,
  options: ApiChannelFetchOptions = {},
): Promise<string> {
  const target = resolveTarget(req, channel) ?? {
    endpoint: endpointFor(channel),
    apiKey: channel.apiKey,
    model: channel.model,
  };
  if (!target.endpoint || target.endpoint === "/images/generations") {
    throw new Error(
      "远端 API 生图通道未配置 —— 可在设置页「远端模型」里添加生图模型（kind=图片），或到「模型适配」里配置该模型的接口与字段映射",
    );
  }
  /* 请求体先组装好（纯函数不抛），debug 回调在 fetch 前后都要拿得到它。 */
  const imageBody = options.bodyOverride ?? defaultImageBody(req, target.model);
  let res: Response;
  const startedAt = Date.now();
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
        options.extraBody === undefined ? imageBody : { ...imageBody, ...options.extraBody },
      ),
      signal: AbortSignal.timeout(GENERATE_TIMEOUT_MS),
    });
  } catch (error) {
    /* 网络层失败也上报（status=null）：测试页要看到「发到了哪、发了什么」。 */
    options.debug?.({
      body: debugBodyOf(imageBody),
      durationMs: Date.now() - startedAt,
      endpoint: target.endpoint,
      excerpt: null,
      ok: false,
      phase: "image",
      status: null,
    });
    throw new Error(errorText(error, "API 生图请求失败"), { cause: error });
  }
  const payload = await (options.readJson ?? defaultJsonReader)(res);
  options.debug?.({
    body: debugBodyOf(imageBody),
    durationMs: Date.now() - startedAt,
    endpoint: target.endpoint,
    excerpt: debugBodyOf(payload),
    ok: res.ok,
    phase: "image",
    status: res.status,
  });
  if (!res.ok) {
    throw upstreamError("API 生图失败", res.status, payload);
  }
  /* 适配器指定了结果字段：只认那个字段（不再做通配提取，避免取到无关的
   * 同名字段）。命中即返回，未命中回落通配提取——与既有行为一致。 */
  const picked = pickStringByPath(payload, options.outputField);
  const url = picked ?? extractMediaUrl(payload) ?? extractBase64DataUrl(payload);
  if (url === null) {
    throw new Error("API 生图响应中未找到图片 URL / b64 数据");
  }
  return url;
}

/** 提交视频任务；支持同步 URL 与异步任务两种上游。
 *  `options.targetOverride`（#3590）给出时按远端模型的连接参数发（endpoint /
 *  apiKey / model 都来自 remoteModel 表条目），请求体也优先用适配器翻译的
 *  `bodyOverride` —— 与 `callImageGeneration` 的注入形状对齐。 */
export async function callVideoSubmit(
  req: ApiVideoSubmitRequest,
  channel: ApiChannelStored,
  options: ApiChannelFetchOptions = {},
): Promise<ApiVideoSubmitResult> {
  const target = options.targetOverride ?? {
    endpoint: endpointFor(channel),
    apiKey: channel.apiKey,
    model: channel.model,
  };
  /* 既有守卫保留：没给远端模型覆盖时，通道没配 Base URL 就别发（endpointFor
   * 在 baseUrl 为空时会拼出一条相对路径端点，发出去是打给自己的 404）。 */
  if (options.targetOverride === undefined && !channel.baseUrl) {
    throw new Error("API 视频通道未配置：请先填写 Base URL 与 API Key");
  }
  if (!target.endpoint) {
    throw new Error("API 视频通道未配置：请先填写 Base URL 与 API Key");
  }
  const submitBody = options.bodyOverride ?? videoBody(req, target.model);
  let res: Response;
  const submitStartedAt = Date.now();
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
        options.extraBody === undefined ? submitBody : { ...submitBody, ...options.extraBody },
      ),
      signal: AbortSignal.timeout(GENERATE_TIMEOUT_MS),
    });
  } catch (error) {
    /* 网络层失败也上报（status=null），与生图同一口径。 */
    options.debug?.({
      body: debugBodyOf(submitBody),
      durationMs: Date.now() - submitStartedAt,
      endpoint: target.endpoint,
      excerpt: null,
      ok: false,
      phase: "video-submit",
      status: null,
    });
    throw new Error(errorText(error, "API 视频提交失败"), { cause: error });
  }
  const payload = await (options.readJson ?? defaultJsonReader)(res);
  options.debug?.({
    body: debugBodyOf(submitBody),
    durationMs: Date.now() - submitStartedAt,
    endpoint: target.endpoint,
    excerpt: debugBodyOf(payload),
    ok: res.ok,
    phase: "video-submit",
    status: res.status,
  });
  if (!res.ok) {
    throw upstreamError("API 视频提交失败", res.status, payload);
  }
  /* 适配器指定了产物字段：与生图同一口径 —— 命中即取，未命中回落通用提取。 */
  const picked = pickStringByPath(payload, options.outputField);
  if (picked !== null) {
    return { url: picked };
  }
  const url = extractMediaUrl(payload);
  if (url !== null) {
    return { url };
  }
  const remoteTaskId = extractRemoteTaskId(payload);
  if (remoteTaskId !== null) {
    return { remoteTaskId };
  }
  throw new Error("API 视频响应中未找到视频 URL 或任务 ID");
}

/** 轮询一次异步视频任务。
 *  `options.pollUrls`（#3590）给出时逐个候选试（远端模型有自己的任务查询形状，
 *  如 Agnes 系 /agnesapi?video_id=… 与 REST /videos/{id}），鉴权头用
 *  `targetOverride.apiKey`（远端模型的密钥）；单个候选失败换下一个，全空 =
 *  仍在生成。都缺省时回落通道设置那条 —— **保持既有语义**：网络失败 /
 *  非 2xx 当场大声报错（工坊的轮询循环靠它把失败送到界面上，硬规则 4）。 */
export async function callVideoPoll(
  remoteTaskId: string,
  channel: ApiChannelStored,
  options: ApiChannelFetchOptions = {},
): Promise<{ pending: boolean; url?: string }> {
  const apiKey = options.targetOverride?.apiKey ?? channel.apiKey;
  /* 候选列表模式（远端模型）：失败换下一个，全失败按「仍在生成」交回 ——
   * 轮询本来就要一轮轮试，个别候选 404（任务还不挂在那个地址上）不算故障。 */
  if (options.pollUrls !== undefined && options.pollUrls.length > 0) {
    for (const pollUrl of options.pollUrls) {
      if (pollUrl === "") {
        continue;
      }
      let payload: unknown;
      const candidateStartedAt = Date.now();
      try {
        // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：前一候选没读到就换下一个
        const res = await fetch(pollUrl, {
          method: "GET",
          headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
          signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
        });
        // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：同上，候选串行试
        payload = await (options.readJson ?? defaultJsonReader)(res);
        options.debug?.({
          body: { remoteTaskId },
          durationMs: Date.now() - candidateStartedAt,
          endpoint: pollUrl,
          excerpt: debugBodyOf(payload),
          ok: res.ok,
          phase: "video-poll",
          status: res.status,
        });
        if (!res.ok) {
          continue;
        }
      } catch {
        /* 网络层失败也上报（status=null）：测试页要看每一候选试到哪。 */
        options.debug?.({
          body: { remoteTaskId },
          durationMs: Date.now() - candidateStartedAt,
          endpoint: pollUrl,
          excerpt: null,
          ok: false,
          phase: "video-poll",
          status: null,
        });
        continue;
      }
      /* 适配器指定了产物字段：与提交同一口径。 */
      const picked = pickStringByPath(payload, options.outputField);
      if (picked !== null) {
        return { url: picked, pending: false };
      }
      const mediaUrl = extractMediaUrl(payload);
      if (mediaUrl !== null) {
        return { url: mediaUrl, pending: false };
      }
    }
    return { pending: true };
  }
  /* 通道设置模式（既有行为）：只有一条地址，失败就是失败。 */
  if (!channel.baseUrl) {
    throw new Error("API 视频通道未配置");
  }
  let res: Response;
  const pollStartedAt = Date.now();
  try {
    res = await fetch(pollEndpointFor(channel.baseUrl, remoteTaskId), {
      method: "GET",
      headers: headersFor(channel),
      signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
    });
  } catch (error) {
    options.debug?.({
      body: { remoteTaskId },
      durationMs: Date.now() - pollStartedAt,
      endpoint: pollEndpointFor(channel.baseUrl, remoteTaskId),
      excerpt: null,
      ok: false,
      phase: "video-poll",
      status: null,
    });
    throw new Error(errorText(error, "API 视频轮询失败"), { cause: error });
  }
  const payload = await (options.readJson ?? defaultJsonReader)(res);
  options.debug?.({
    body: { remoteTaskId },
    durationMs: Date.now() - pollStartedAt,
    endpoint: pollEndpointFor(channel.baseUrl, remoteTaskId),
    excerpt: debugBodyOf(payload),
    ok: res.ok,
    phase: "video-poll",
    status: res.status,
  });
  if (!res.ok) {
    throw upstreamError("API 视频轮询失败", res.status, payload);
  }
  const mediaUrl = extractMediaUrl(payload);
  if (mediaUrl !== null) {
    return { url: mediaUrl, pending: false };
  }
  return { pending: true };
}
