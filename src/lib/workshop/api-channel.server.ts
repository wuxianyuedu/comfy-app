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
import "server-only";

import { promises as fs, readFileSync } from "fs";
import path from "path";

import { remoteModelRepository } from "~/lib/core/repository";
import {
  type RemoteModeAdapter,
  type WorkshopInputType,
} from "~/lib/workshop/model-mode-contract";

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
import {
  resolveImagesGenerationsEndpoint,
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
  if (cache) return cache;
  let stored: Partial<WorkshopApiSettings> = {};
  try {
    stored = JSON.parse(
      readFileSync(FILE, "utf-8"),
    ) as Partial<WorkshopApiSettings>;
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
    image:
      patch.image !== undefined
        ? sanitizeChannel(patch.image, current.image)
        : current.image,
    video:
      patch.video !== undefined
        ? sanitizeChannel(patch.video, current.video)
        : current.video,
  };
  cache = next;
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(next, null, 2), "utf-8");
  return next;
}

/* 给浏览器的脱敏视图 —— apiKey 从不离开服务端。 */
export function getMaskedChannels() {
  return maskChannels(getWorkshopApiSettingsSync());
}

export type { ApiImageRequest, ApiVideoSubmitRequest, ApiVideoSubmitResult };

/** 统一输入的当前取值（适配器按类型取值落字段）。 */
function unifiedImageInputs(
  req: ApiImageRequest,
): Partial<Record<WorkshopInputType, unknown>> {
  return {
    prompt: req.prompt ?? undefined,
    negative: req.negative ?? undefined,
    "aspect-ratio": req.aspectRatio ?? undefined,
    megapixels: req.megapixels ?? undefined,
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
  for (const { type, field } of adapter.inputs) {
    const value = unified[type];
    if (value === undefined || value === "") continue;
    body[field] = value;
  }
  if (model) body.model = model;
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
  target: ApiUpstreamTarget;
  channel: ApiChannelStored;
  adapter: RemoteModeAdapter | null;
}> {
  /* 返回体里带上 channel 是为了让调用方把「同一份配置」交给 callImageGeneration
   * 做端点的最终拼装（未配置时的可读错误也在那里判）。 */
  const wantedModel = (req.model ?? "").trim();
  if (!wantedModel)
    return { target: fallbackTarget(channel), channel, adapter: null };
  try {
    const entries = await remoteModelRepository.list();
    const entry = entries.find((r) => r.name === wantedModel && r.baseUrl);
    if (!entry)
      return { target: fallbackTarget(channel), channel, adapter: null };
    // 模式适配器优先：条目配置了该模式的输入映射就按它翻译统一输入。
    const adapters =
      await remoteModelRepository.getWorkshopAdapters(wantedModel);
    const wantedMode = (req.mode ?? "").trim().toUpperCase();
    const adapter =
      adapters.find((a) => a.mode === wantedMode) ??
      (adapters.length === 1 ? adapters[0]! : null);
    return {
      target: {
        endpoint: adapter
          ? `${(entry.baseUrl ?? "").replace(/\/+$/, "")}${adapter.endpointPath}`
          : resolveImagesGenerationsEndpoint(entry.baseUrl ?? ""),
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
export async function generateImageViaApi(
  req: ApiImageRequest,
): Promise<string> {
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

/* 把视频任务提交到配置好的端点。 */
export async function submitVideoViaApi(
  req: ApiVideoSubmitRequest,
): Promise<ApiVideoSubmitResult> {
  return callVideoSubmit(req, getWorkshopApiSettingsSync().video, {
    readJson: readUpstreamJson,
  });
}

/* 轮询一次异步视频任务：返回成品 URL，或 { pending: true } 表示仍在进行。 */
export async function pollVideoViaApi(
  remoteTaskId: string,
): Promise<{ url?: string; pending: boolean }> {
  return callVideoPoll(remoteTaskId, getWorkshopApiSettingsSync().video, {
    readJson: readUpstreamJson,
  });
}

/* 把任意图片引用解析成内联 data URL
 *（转发首帧给远程视频 API 之前、以及上传到本机 ComfyUI 时都要用）。 */
export { resolveMediaDataUrl };
