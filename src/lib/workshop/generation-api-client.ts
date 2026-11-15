"use client";

// ── 工坊生成客户端 · API 中继通道（/api/workshop-api/generate）────────────
// 从 generation-client.ts 按 §12.6 文件行数上限拆出：local（ComfyUI）链路留在
// generation-client.ts，这一份只装 API 中继（baseUrl / apiKey 留在服务端，
// 五花八门的上游形状由 api-channel-core 归一）。两份都只跑在浏览器（首行
// "use client" 同款口径），消费方照旧从两处按通道取用。
// 每份网络载荷都用 unknown 守卫收窄（不做类型断言）。

import { isRecord } from "~/lib/is-record";
import type { ApiCallDebugRow as ApiRelayDebugRow } from "./api-channel-core";
import type { ApiChannelView, ApiChannelsView } from "./api-channel-shared";
import type { Character } from "./types";

/* 从中继错误信封里取出可读信息
 *（形如 `{ error: string }`，或鉴权失败时的 `{ error: { message } }`）。 */
function relayErrorMessage(data: unknown, status: number): string {
  if (isRecord(data)) {
    const err: unknown = data.error;
    if (typeof err === "string" && err) {
      return err;
    }
    if (isRecord(err)) {
      const msg: unknown = err.message;
      if (typeof msg === "string" && msg) {
        return msg;
      }
    }
  }
  return `API 请求失败 (${status})`;
}

/**
 * 中继（`/api/workshop-api/generate`）的响应载荷：服务协议约定 `res.ok` 时
 * body 一定是一个 JSON 对象；解析失败或形状不符 → `null`。三个 caller 各自
 * 决定「拿到 null 时是抛错还是降级」（生图 / 提交视频：抛；轮询：返回
 * `{ pending: true }`）。
 */
type RelayResponse = Record<string, unknown> | null;

/** API 中继的统一请求上限。远端生图 / 生视频本身就可能要几分钟（10 分钟与
 *  视频轮询的 deadline 同量纲），但一个真挂死的连接不该让 UI 无限 busy ——
 *  到点 abort，调用方拿到一句可行动的中文报错。 */
const RELAY_TIMEOUT_MS = 10 * 60 * 1000;

/** 请求读数回调（ISSUE #3791）：响应（成功或失败）里带了 debug 读数就逐批上抛。
 *  类型从 api-channel-core 只引形状（type-only，不进运行时图）。 */
export type RelayDebugSink = (rows: ApiRelayDebugRow[]) => void;

function relayDebugRows(data: RelayResponse): ApiRelayDebugRow[] {
  const raw = data?.debug;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((row): row is ApiRelayDebugRow => isRecord(row));
}

async function postRelay(
  body: Record<string, unknown>,
  onDebug?: RelayDebugSink,
  signal?: AbortSignal,
): Promise<RelayResponse> {
  let res: Response;
  try {
    res = await fetch("/api/workshop-api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      /* 用户取消（#3949 需求 5）与到点超时并成一路：任一触发都 abort。 */
      signal: AbortSignal.any(
        signal === undefined
          ? [AbortSignal.timeout(RELAY_TIMEOUT_MS)]
          : [signal, AbortSignal.timeout(RELAY_TIMEOUT_MS)],
      ),
    });
  } catch (error: unknown) {
    /* 用户主动取消（#3949 需求 5）给一句独立的、不带「失败」色彩的话 ——
     * 它不是故障。TimeoutError（到点）才是超时文案。 */
    if (signal?.aborted === true) {
      throw new Error("已取消生成", { cause: error });
    }
    if (
      error instanceof DOMException &&
      (error.name === "TimeoutError" || error.name === "AbortError")
    ) {
      throw new Error("API 通道请求超时（10 分钟无响应），请检查通道地址或稍后重试", {
        cause: error,
      });
    }
    throw error;
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    data = undefined;
  }
  if (!res.ok) {
    /* 失败响应里也可能带了已捕获的请求读数（上游 4xx/5xx）—— 先上抛再抛错，
     * 测试页的错误态同样展示「发出去的是什么」。 */
    if (onDebug !== undefined) {
      onDebug(relayDebugRows(isRecord(data) ? data : null));
    }
    throw new Error(relayErrorMessage(data, res.status));
  }
  // 「res.ok 但 body 不是对象」——以前是三个 caller 各自 `isRecord(data)` 前奏，
  // 现在这一层判据只写一次；null 交给 caller 决定抛错还是降级。
  const record = isRecord(data) ? data : null;
  if (onDebug !== undefined) {
    onDebug(relayDebugRows(record));
  }
  return record;
}

/* API 通道：一次性图片生成 → 返回可用的图片 URL。
 * 当 `model` 传的是设置页里的远端模型名（remoteModel 表）时，服务端按该条目的
 * 连接参数生图；不传则回落到工坊 API 通道设置（旧行为）。 */
export async function apiGenerateImage(
  req: {
    /** 统一输入：宽高比（如 "16:9"）/ 百万像素（如 "1.5"）/ 分辨率档（"1k"）/
     *  宽高对齐倍数 / 输入图。合起来就是工坊的尺寸表达 —— 百万像素由
     *  `shotSizeToRelay` 换算下发；分辨率档位名（ISSUE #3622）原样带出，
     *  适配器映射了「分辨率」口的远端接口直接拿到 "1k"/"2k"/"4k"。 */
    aspectRatio?: string;
    image?: string;
    /** 参考图组（#3949 需求 6/7）：多张以数组随请求下发；首张另走 `image`
     *  （既有单图适配器不受影响）。 */
    images?: Array<string>;
    megapixels?: string;
    /** 工坊模式码（T2I / I2I / …）：远端模型有该模式适配器时按它翻译字段 */
    mode?: string;
    /** 设置页配置的远端模型名（remoteModel 表按名取连接参数） */
    model?: string;
    multiple?: number;
    negative?: string;
    prompt: string;
    /** 统一输入「分辨率」的取值（清晰度档位名，如 "1k"）。 */
    resolution?: string;
    seed?: number;
    size?: string;
  },
  opts: { onDebug?: RelayDebugSink; signal?: AbortSignal } = {},
): Promise<string> {
  const data = await postRelay(
    {
      kind: "image",
      prompt: req.prompt,
      negative: req.negative,
      size: req.size,
      ...(req.model !== undefined && req.model !== "" ? { model: req.model } : {}),
      ...(req.mode !== undefined && req.mode !== "" ? { mode: req.mode } : {}),
      ...(req.aspectRatio !== undefined && req.aspectRatio !== ""
        ? { aspectRatio: req.aspectRatio }
        : {}),
      ...(req.megapixels !== undefined && req.megapixels !== ""
        ? { megapixels: req.megapixels }
        : {}),
      ...(req.resolution !== undefined && req.resolution !== ""
        ? { resolution: req.resolution }
        : {}),
      ...(req.multiple === undefined ? {} : { multiple: req.multiple }),
      ...(req.image !== undefined && req.image !== "" ? { image: req.image } : {}),
      ...(req.images !== undefined && req.images.length > 0 ? { images: req.images } : {}),
      /* 种子（ISSUE #3778）：此前请求体组装漏了这一键 —— 路由解析得到、
       * 客户端从未发送，用户填的种子静默丢失。 */
      ...(req.seed === undefined ? {} : { seed: req.seed }),
      /* 请求读数（ISSUE #3791）：带了 onDebug 就向 relay 要 debug 读数。 */
      ...(opts.onDebug === undefined ? {} : { debug: true }),
    },
    opts.onDebug,
    opts.signal,
  );
  const url = data && typeof data.url === "string" && data.url ? data.url : null;
  if (url === null) {
    throw new Error("API 生图响应中未找到图片 URL");
  }
  return url;
}

export type ApiVideoSubmitResult = {
  /* 否则用 apiPollVideo 轮询的异步任务 id。 */
  remoteTaskId?: string;
  /* 上游同步返回时给出的成品视频 URL。 */
  url?: string;
};

/* API 通道：提交一个（图生）视频任务。 */
export async function apiSubmitVideo(
  req: {
    /** 秒数（#3590 测试页；适配器 duration 输入的直接取值）。 */
    duration?: number;
    fps?: number;
    frames?: number;
    /* 参考首帧（任何可解析的来源都行：/generated/… 、data URL、http）。 */
    image?: string;
    /** 工坊模式码（T2V / I2V …，#3590）：远端模型按它选适配器。 */
    mode?: string;
    /** 设置页配置的远端模型名（#3590）：按 remoteModel 表条目直连。 */
    model?: string;
    negative?: string;
    prompt: string;
    /** 统一输入「种子」（ISSUE #3783）：非负整数；缺省 = 不带。 */
    seed?: number;
  },
  opts: { onDebug?: RelayDebugSink; signal?: AbortSignal } = {},
): Promise<ApiVideoSubmitResult> {
  const data = await postRelay(
    {
      kind: "video",
      prompt: req.prompt,
      negative: req.negative,
      image: req.image,
      frames: req.frames,
      fps: req.fps,
      /* 空串 / 缺省都省略 —— 服务端按「没带」回落，不按空串回落。 */
      ...(req.model !== undefined && req.model !== "" ? { model: req.model } : {}),
      ...(req.mode !== undefined && req.mode !== "" ? { mode: req.mode } : {}),
      ...(req.duration === undefined ? {} : { duration: req.duration }),
      /* 种子（ISSUE #3783）：与生图（#3778）同口径转发 —— 请求体组装漏了
       * 这一键的话，路由解析得到、客户端却从未发送，用户填的种子静默丢失。 */
      ...(req.seed === undefined ? {} : { seed: req.seed }),
      ...(opts.onDebug === undefined ? {} : { debug: true }),
    },
    opts.onDebug,
    opts.signal,
  );
  if (!data) {
    throw new Error("API 视频响应格式错误");
  }
  const url = typeof data.url === "string" && data.url ? data.url : undefined;
  const remoteTaskId =
    typeof data.remoteTaskId === "string" && data.remoteTaskId ? data.remoteTaskId : undefined;
  if (url === undefined && remoteTaskId === undefined) {
    throw new Error("API 视频响应中未找到视频 URL 或任务 ID");
  }
  return { url, remoteTaskId };
}

/* API 通道：对异步视频任务做一次轮询。model/mode 跟着提交那一步走（#3590）：
 * 远端模型的任务查询地址与密钥都挂在条目上。 */ export async function apiPollVideo(
  remoteTaskId: string,
  opts: {
    /* 请求读数（ISSUE #3791）：与提交同一口径，逐候选轮询也上报。 */
    debug?: boolean;
    mode?: string;
    model?: string;
    onDebug?: RelayDebugSink;
    signal?: AbortSignal;
  } = {},
): Promise<{ pending: boolean; url?: string }> {
  const data = await postRelay(
    {
      kind: "video",
      remoteTaskId,
      ...(opts.model !== undefined && opts.model !== "" ? { model: opts.model } : {}),
      ...(opts.mode !== undefined && opts.mode !== "" ? { mode: opts.mode } : {}),
      ...(opts.debug === true ? { debug: true } : {}),
    },
    opts.onDebug,
    opts.signal,
  );
  if (!data) {
    return { pending: true };
  }
  const url = typeof data.url === "string" && data.url ? data.url : undefined;
  return { url, pending: url === undefined };
}

/* 把生成出/参考用的图片上传进本机 ComfyUI 的 input 目录，
 * 好让视频工作流的 LoadImage 节点能消费它；返回文件名。 */
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
    isRecord(data) && typeof data.filename === "string" && data.filename ? data.filename : null;
  if (!res.ok || filename === null) {
    throw new Error(res.ok ? "参考图准备失败" : relayErrorMessage(data, res.status));
  }
  return filename;
}

/* 定妆照 URL → 已上传文件名的会话内缓存：批量生成时同一镜的同一张定妆照
 * 会随每个镜头反复请求，缓存让 ComfyUI 输入目录里不再为同一张图堆 N 份副本。 */
const portraitRefCache = new Map<string, string>();
/** 缓存上限：超过就整表清掉（定妆照数量有限，正常到不了）。 */
const PORTRAIT_REF_CACHE_MAX = 32;

/** 收集镜头相关角色的**已选定定妆照**，上传进 ComfyUI 输入目录，
 *  作为本次镜头生图的参考图（`referenceImages` 的值）。
 *
 *  流程口径（docs/guides/feature-workshop-flow.md §4）：定妆照就是「后续分镜图
 *  的参考图基准」。参考图口吃的是**已上传文件的文件名**，所以逐张经
 *  `prepareLocalInputImage` 上传；单张失败不拖垮整次生成 —— 跳过并计入
 *  `failedCount`，由调用方决定是否提示（降级不得静默，规范 10 §10.3.1）。
 *
 *  顺序按 `characterIds`（分镜里的角色出场序）。内置默认契约只有两个参考图槽
 *  （reference-image / -2），超过两张的定妆照落不进端口，这里截到两张、
 *  不做无效上传。没有角色选了定妆照 → 空数组，调用方不给这个口。 */
export async function preparePortraitReferences(
  characters: Array<Character>,
  characterIds: ReadonlyArray<string>,
): Promise<{ failedCount: number; files: Array<string> }> {
  const urls = characterIds
    .map((id) => characters.find((c) => c.id === id)?.portraitUrl)
    .filter((url): url is string => typeof url === "string" && url !== "")
    .slice(0, 2);
  const files: Array<string> = [];
  let failedCount = 0;
  for (const url of urls) {
    const cached = portraitRefCache.get(url);
    if (cached !== undefined) {
      files.push(cached);
      continue;
    }
    try {
      // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：后一步要用前一步的结果（既有串行路径）
      const filename = await prepareLocalInputImage(url);
      if (portraitRefCache.size >= PORTRAIT_REF_CACHE_MAX) {
        portraitRefCache.clear();
      }
      portraitRefCache.set(url, filename);
      files.push(filename);
    } catch {
      failedCount += 1;
    }
  }
  return { files, failedCount };
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

/* 两个 API 通道的脱敏视图；配置服务不可用时为 null
 *（调用方把 null 当作「未配置」，并弹出设置面板）。 */
export async function fetchApiChannels(): Promise<ApiChannelsView | null> {
  try {
    const res = await fetch("/api/workshop-api/config");
    if (!res.ok) {
      return null;
    }
    const data: unknown = await res.json();
    const channels = isRecord(data) ? data.channels : undefined;
    if (!isRecord(channels)) {
      return null;
    }
    return {
      image: narrowChannel(channels.image, "/images/generations"),
      video: narrowChannel(channels.video, "/videos/generations"),
    };
  } catch {
    return null;
  }
}

/* 「准备请求」预览（#3949 需求 8）：dryRun=true 让 relay 只做上游解析与请求体
 * 组装、不真正调用 —— 返回的读数就是「实际会发出去的请求」（端点 + 适配器
 * 翻译后的请求体，长字符串已截断、密钥不在其中）。 */
export async function apiPreviewRequest(
  body: Record<string, unknown>,
  kind: "image" | "video",
): Promise<ApiRelayDebugRow[]> {
  /* kind 必须显式带上（ISSUE #3985）：中转按 kind 分流 image / video，预览体
   * 本身不含这格（assemble* 只组模式相关的字段），漏了会被中转 400 掉。 */
  const data = await postRelay({ ...body, kind, dryRun: true });
  return relayDebugRows(data);
}
