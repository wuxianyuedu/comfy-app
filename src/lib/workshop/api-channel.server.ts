// ── Workshop API channel: Next 侧入口（配置存储 + 上游调用）──────────────
// 把每通道（图片 / 视频）的端点配置持久化成一份本地 JSON 文件
//（与 app-settings 同一套路：不动数据库、被 git 忽略、有环境变量兜底）。
// apiKey 只存在服务端；浏览器拿到的是脱敏视图。
//
// 本文件只负责**三件 Next 特有的事**，协议实现全部在 `api-channel-core.ts`：
//   ① `import "server-only"` —— 把配置与 apiKey 挡在浏览器包外；
//   ② 落盘读写（含进程内缓存）;
//   ③ 生图前查 `remoteModel` 表，决定走哪条上游（MCP 侧没有这张表）。
// 其余（请求体字段、超时、错误文案、响应提取）与 MCP 入口逐字共用一份。
import { isRecord } from "~/lib/is-record";
import { upperToken } from "~/lib/upper-token";
import "server-only";

import { promises as fs, readFileSync } from "node:fs";
import path from "node:path";

import { remoteModelRepository } from "~/lib/core/repository";
import type { RemoteModeAdapter, WorkshopInputType } from "~/lib/workshop/remote-model-adapter";

import {
  callImageGeneration,
  callVideoPoll,
  callVideoSubmit,
  defaultChannelsFromEnv,
  endpointFor,
  maskChannels,
  normalizeSettings,
  sanitizeChannel,
  WORKSHOP_API_SETTINGS_FILE,
  type ApiImageRequest,
  type ApiUpstreamTarget,
  type ApiVideoSubmitRequest,
  type ApiVideoSubmitResult,
  type WorkshopApiSettings,
} from "./api-channel-core";
import { buildVideoPollUrls } from "~/lib/llm/usage-test-config";
import { joinApiUrl } from "~/lib/llm/provider-types";
import {
  resolveImagesGenerationsEndpoint,
  resolveVideosGenerationsEndpoint,
  type ApiChannelKind,
  type ApiChannelStored,
} from "./api-channel-shared";
import { readUpstreamJson, resolveMediaDataUrl } from "./media-source.server";

const FILE = path.join(process.cwd(), "data", WORKSHOP_API_SETTINGS_FILE);

/** 两个通道的默认值来自环境变量（同一套变量名，MCP 入口共用）。 */
const DEFAULTS = defaultChannelsFromEnv();

let cache: WorkshopApiSettings | null = null;

/* 读配置（进程内缓存）。全新安装也能直接用（空配置 = 未配置）。 */
export function getWorkshopApiSettingsSync(): WorkshopApiSettings {
  if (cache) {
    return cache;
  }
  let stored: Partial<WorkshopApiSettings> = {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(FILE, "utf8"));
    if (isRecord(parsed)) {
      stored = {
        image: sanitizeChannel(parsed.image, DEFAULTS.image),
        video: sanitizeChannel(parsed.video, DEFAULTS.video),
      };
    }
  } catch {
    // 文件缺失或损坏 → 用默认值。
  }
  cache = normalizeSettings(stored, DEFAULTS);
  return cache;
}

/* 合并一次局部通道更新并落盘。 */
export async function saveWorkshopApiSettings(
  patch: Partial<Record<ApiChannelKind, unknown>>,
): Promise<WorkshopApiSettings> {
  const current = getWorkshopApiSettingsSync();
  const next: WorkshopApiSettings = {
    image: patch.image === undefined ? current.image : sanitizeChannel(patch.image, current.image),
    video: patch.video === undefined ? current.video : sanitizeChannel(patch.video, current.video),
  };
  cache = next;
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(next, null, 2), "utf8");
  return next;
}

/* 给浏览器的脱敏视图 —— apiKey 从不离开服务端。 */
export function getMaskedChannels() {
  return maskChannels(getWorkshopApiSettingsSync());
}

export type { ApiImageRequest, ApiVideoSubmitRequest, ApiVideoSubmitResult };

/** 统一输入的当前取值（适配器按类型取值落字段）。 */
function unifiedImageInputs(req: ApiImageRequest): Partial<Record<WorkshopInputType, unknown>> {
  return {
    prompt: req.prompt ?? undefined,
    negative: req.negative ?? undefined,
    "aspect-ratio": req.aspectRatio ?? undefined,
    megapixels: req.megapixels ?? undefined,
    /* 分辨率档（"1k"/"2k"/"4k"）：与百万像素同口的另一种表达，适配器映射了
     * 哪个就下发哪个（ISSUE #3622）。 */
    resolution: req.resolution ?? undefined,
    multiple: req.multiple ?? undefined,
    image: req.image ?? undefined,
  };
}

/** 按请求体里带的适配器把统一输入翻译成上游字段。 */
function bodyFromAdapter(
  adapter: RemoteModeAdapter,
  req: ApiImageRequest,
  model: string,
): Record<string, unknown> {
  const unified = unifiedImageInputs(req);
  const body: Record<string, unknown> = {};
  /* 固定值字段（#3590）先落：同名字段让输入映射赢 —— 当次给的值比写死的更具体。 */
  for (const { field, value } of adapter.constants ?? []) {
    body[field] = value;
  }
  for (const { type, field } of adapter.inputs) {
    const value = unified[type];
    if (value === undefined || value === "") {
      continue;
    }
    body[field] = value;
  }
  if (model) {
    body.model = model;
  }
  return body;
}

/** Next 侧的上游解析：设置页「远端模型」优先，未命中回落通道设置。
 *
 *  这是本文件**唯一**比纯逻辑多出来的东西 —— 它要读 `remoteModel` 表，
 *  而 MCP 侧（纯 Node）没有这张表。 */
async function resolveTarget(
  req: ApiImageRequest,
  channel: ApiChannelStored,
): Promise<{
  adapter: RemoteModeAdapter | null;
  channel: ApiChannelStored;
  target: ApiUpstreamTarget;
}> {
  /* 返回体里带上 channel 是为了让调用方把「同一份配置」交给 callImageGeneration
   * 做端点的最终拼装（未配置时的可读错误也在那里判）。 */
  const wantedModel = (req.model ?? "").trim();
  if (!wantedModel) {
    return { target: fallbackTarget(channel), channel, adapter: null };
  }
  try {
    const entries = await remoteModelRepository.list();
    const entry = entries.find((r) => r.name === wantedModel && (r.baseUrl ?? "") !== "");
    if (!entry) {
      return { target: fallbackTarget(channel), channel, adapter: null };
    }
    // 模式适配器优先：条目配置了该模式的输入映射就按它翻译统一输入。
    // 端点是模型级配置（ISSUE #3622）：模型级路径配了就用它；没配则一律按
    // Base URL 形态推导 images/generations 惯例端点 —— 与有没有适配器无关。
    const doc = await remoteModelRepository.getWorkshopAdaptersDoc(wantedModel);
    const adapters = doc.adapters;
    const wantedMode = upperToken(req.mode);
    const [onlyAdapter] = adapters;
    const adapter =
      adapters.find((a) => a.mode === wantedMode) ??
      (adapters.length === 1 ? (onlyAdapter ?? null) : null);
    const base = (entry.baseUrl ?? "").replace(/\/+$/, "");
    return {
      target: {
        endpoint:
          doc.endpointPath === ""
            ? resolveImagesGenerationsEndpoint(entry.baseUrl ?? "")
            : /* #3656：显式路径走 joinApiUrl——Base 已带版本段不重复补（防 /v1/v1），
               * Base 缺版本段补 /v1；设置页下拉存的就是带版本段的完整路径。 */
              joinApiUrl(base, doc.endpointPath),
        apiKey: entry.apiKey ?? "",
        model: entry.name,
      },
      channel,
      adapter,
    };
  } catch {
    // 表不可用（未迁移等）→ 回落通道设置
    return { target: fallbackTarget(channel), channel, adapter: null };
  }
}

/** 通道设置里的生图上游（含「未配置」时端点为空串的既有行为）。 */
function fallbackTarget(channel: ApiChannelStored): ApiUpstreamTarget {
  return {
    endpoint: endpointFor(channel),
    apiKey: channel.apiKey,
    model: channel.model,
  };
}

/* 调一个 OpenAI 兼容的 images/generations 端点；返回可用的 URL
 *（远程 URL，或 b64 载荷内联成 data URL）。 */
export async function generateImageViaApi(req: ApiImageRequest): Promise<string> {
  const resolved = await resolveTarget(req, getWorkshopApiSettingsSync().image);
  /* 有适配器：请求体按字段映射落统一输入 + 按 outputField 取结果；
   * 无适配器：OpenAI 兼容默认映射（含「未配置」时抛既有的可读错误）。 */
  return callImageGeneration(req, resolved.channel, () => resolved.target, {
    readJson: readUpstreamJson,
    bodyOverride: resolved.adapter
      ? bodyFromAdapter(resolved.adapter, req, resolved.target.model)
      : undefined,
    outputField: resolved.adapter?.outputField,
  });
}

/* ── 视频的远端模型定向（#3590）──────────────────────────────────────────
 * 与生图的 resolveTarget 同构：请求带 model 时按 remoteModel 表条目直连，
 * 有该模式适配器时按它翻译统一输入；没带 / 查不到回落通道设置。
 * 之所以不是改造 resolveTarget 加个 kind 参数：两条链的统一输入集合不同
 * （图是 aspect-ratio/megapixels/multiple，视频是 first-frame/duration），
 * 分开两份各自贴着各自的请求类型，比一把共用更不容易在加输入时漏一半。 */

/** 视频统一输入的当前取值（适配器按类型取值落字段）。 */
function unifiedVideoInputs(
  req: ApiVideoSubmitRequest,
): Partial<Record<WorkshopInputType, unknown>> {
  return {
    duration: req.duration ?? undefined,
    "first-frame": req.imageDataUrl ?? undefined,
    negative: req.negative ?? undefined,
    prompt: req.prompt ?? undefined,
  };
}

/** 按视频请求带的适配器把统一输入翻译成上游字段（与 bodyFromAdapter 同一合并
 *  顺序：常量先落，输入映射可覆盖同名字段）。 */
function bodyFromVideoAdapter(
  adapter: RemoteModeAdapter,
  req: ApiVideoSubmitRequest,
  model: string,
): Record<string, unknown> {
  const unified = unifiedVideoInputs(req);
  const body: Record<string, unknown> = {};
  for (const { field, value } of adapter.constants ?? []) {
    body[field] = value;
  }
  for (const { type, field } of adapter.inputs) {
    const value = unified[type];
    if (value === undefined || value === "") {
      continue;
    }
    body[field] = value;
  }
  if (model) {
    body.model = model;
  }
  return body;
}

/** 视频侧的上游解析（镜像生图 resolveTarget，只多产出适配器行）。 */
async function resolveVideoTarget(
  req: ApiVideoSubmitRequest,
  channel: ApiChannelStored,
): Promise<{ adapter: RemoteModeAdapter | null; target: ApiUpstreamTarget }> {
  const wantedModel = (req.model ?? "").trim();
  if (!wantedModel) {
    return { adapter: null, target: fallbackTarget(channel) };
  }
  try {
    const entries = await remoteModelRepository.list();
    const entry = entries.find((r) => r.name === wantedModel && (r.baseUrl ?? "") !== "");
    if (!entry) {
      return { adapter: null, target: fallbackTarget(channel) };
    }
    /* 端点是模型级配置（ISSUE #3622）：模型级路径配了就用它；没配时有适配器
     * 按 Base URL 形态推导 videos/generations 惯例端点，无适配器保持既有回落
     * （OpenAI 兼容惯例的 /videos，与 usage-test 的视频预设一致）。 */
    const doc = await remoteModelRepository.getWorkshopAdaptersDoc(wantedModel);
    const adapters = doc.adapters;
    const wantedMode = upperToken(req.mode);
    const [onlyAdapter] = adapters;
    const adapter =
      adapters.find((a) => a.mode === wantedMode) ??
      (adapters.length === 1 ? (onlyAdapter ?? null) : null);
    const base = (entry.baseUrl ?? "").replace(/\/+$/, "");
    const endpoint =
      doc.endpointPath === ""
        ? adapter
          ? resolveVideosGenerationsEndpoint(base)
          : /* #3656：无适配器的既有回落（/videos）也走统一拼装，Base 缺版本段补 /v1 */
            joinApiUrl(base, "/videos")
        : joinApiUrl(base, doc.endpointPath);
    return {
      adapter,
      target: { endpoint, apiKey: entry.apiKey ?? "", model: entry.name },
    };
  } catch {
    // 表不可用（未迁移等）→ 回落通道设置
    return { adapter: null, target: fallbackTarget(channel) };
  }
}

/* 把视频任务提交到配置好的端点：带 model 时按 remoteModel 条目直连（#3590），
 * 未带 model 的工坊镜头链路保持既有行为（全局通道设置）。 */
export async function submitVideoViaApi(req: ApiVideoSubmitRequest): Promise<ApiVideoSubmitResult> {
  const resolved = await resolveVideoTarget(req, getWorkshopApiSettingsSync().video);
  return callVideoSubmit(req, getWorkshopApiSettingsSync().video, {
    readJson: readUpstreamJson,
    targetOverride: resolved.target,
    bodyOverride: resolved.adapter
      ? bodyFromVideoAdapter(resolved.adapter, req, resolved.target.model)
      : undefined,
    outputField: resolved.adapter?.outputField,
  });
}

/* 轮询一次异步视频任务：返回成品 URL，或 { pending: true } 表示仍在进行。
 * `model` 给出且能在 remoteModel 表里找到时（#3590），轮询地址按该条目 +
 * 提交端点的目录段构造成候选（Agnes 系 /agnesapi?video_id=… 与
 * REST /videos/{id}），鉴权用该条目自己的密钥；查不到 / 未给 model 时回落
 * 通道设置（既有行为，工坊镜头链路的失败语义原样保留）。
 * 提交路径的口径与 resolveVideoTarget 同源（ISSUE #3622）：模型级端点优先，
 * 其次按 Base URL 形态推导，最后既有回落 /videos。 */
export async function pollVideoViaApi(
  remoteTaskId: string,
  opts: { mode?: string; model?: string } = {},
): Promise<{ pending: boolean; url?: string }> {
  const channel = getWorkshopApiSettingsSync().video;
  const wantedModel = (opts.model ?? "").trim();
  if (wantedModel !== "") {
    try {
      const entries = await remoteModelRepository.list();
      const entry = entries.find((r) => r.name === wantedModel && (r.baseUrl ?? "") !== "");
      if (entry) {
        const doc = await remoteModelRepository.getWorkshopAdaptersDoc(wantedModel);
        const adapters = doc.adapters;
        const wantedMode = upperToken(opts.mode);
        const [onlyAdapter] = adapters;
        const adapter =
          adapters.find((a) => a.mode === wantedMode) ??
          (adapters.length === 1 ? (onlyAdapter ?? null) : null);
        const base = (entry.baseUrl ?? "").replace(/\/+$/, "");
        /* 轮询候选的目录段从「动作路径」推导（buildVideoPollUrls 内部补版本段）：
         * 显式路径存的是带版本段的完整路径（/v1/videos），先剥掉版本段再取目录，
         * 否则 videoEndpointDir 会把 /v1 当成目录（#3656）。 */
        const submitPath =
          doc.endpointPath === ""
            ? adapter
              ? resolveVideosGenerationsEndpoint(base).slice(base.length)
              : "/videos"
            : doc.endpointPath.replace(/^\/v\d+/i, "");
        const { rest, agnes } = buildVideoPollUrls(
          entry.baseUrl ?? "",
          submitPath,
          wantedModel,
          remoteTaskId,
        );
        return callVideoPoll(remoteTaskId, channel, {
          readJson: readUpstreamJson,
          pollUrls: [rest, ...(agnes === null ? [] : [agnes])],
          targetOverride: { endpoint: rest, apiKey: entry.apiKey ?? "", model: wantedModel },
        });
      }
    } catch {
      // 表不可用 → 落到下面的通道设置路径
    }
  }
  return callVideoPoll(remoteTaskId, channel, {
    readJson: readUpstreamJson,
  });
}

/* 把任意图片引用解析成内联 data URL
 *（转发首帧给远程视频 API 之前、以及上传到本机 ComfyUI 时都要用）。 */
export { resolveMediaDataUrl };
