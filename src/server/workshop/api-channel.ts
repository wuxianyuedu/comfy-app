// ── Workshop MCP 本地 API 通道（纯 Node 入口）─────────────────────────
// 与 `@/lib/workshop/api-channel.server` 是同一套能力的两个入口：那个跑在
// Next 里、必须 `import "server-only"`（配置与 apiKey 不能进浏览器包），
// 这个跑在 MCP stdio 里、**不能**碰 server-only（非 Next 环境直接抛错）。
//
// 协议实现（请求体字段、超时、错误文案、响应提取）全部在
// `api-channel-core.ts`，本文件只提供两处差异：
//   · 上游响应体用 `res.json()`（Next 侧另有"非 JSON 即报错"的更严实现）；
//   · 生图不做 remoteModel 表查询（纯 Node 没有这张表），只用通道设置。
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  callImageGeneration,
  callVideoPoll,
  callVideoSubmit,
  defaultChannelsFromEnv,
  normalizeSettings,
  WORKSHOP_API_SETTINGS_FILE,
  type ApiImageRequest,
  type ApiVideoSubmitRequest,
  type ApiVideoSubmitResult,
  type WorkshopApiSettings,
} from "@/lib/workshop/api-channel-core";

const FILE = path.join(process.cwd(), "data", WORKSHOP_API_SETTINGS_FILE);

const DEFAULTS = defaultChannelsFromEnv();

let cache: WorkshopApiSettings | null = null;

/** 读取配置（进程内缓存）。 */
export function getWorkshopApiSettingsSync(): WorkshopApiSettings {
  if (cache) return cache;
  let stored: Partial<WorkshopApiSettings> = {};
  try {
    stored = JSON.parse(readFileSync(FILE, "utf-8")) as Partial<WorkshopApiSettings>;
  } catch {
    // 缺失/损坏 → 默认
  }
  cache = normalizeSettings(stored, DEFAULTS);
  return cache;
}

export type { ApiImageRequest, ApiVideoSubmitRequest, ApiVideoSubmitResult };

/** 调用 OpenAI 兼容 images/generations 端点，返回可用 URL（远程或 data URL）。 */
export async function generateImageViaApi(req: ApiImageRequest): Promise<string> {
  const channel = getWorkshopApiSettingsSync().image;
  if (!channel.baseUrl) throw new Error("API 生图通道未配置：请先填写 Base URL 与 API Key");
  return callImageGeneration(req, channel, () => null);
}

/** 提交视频任务；支持同步 URL 与异步任务两种上游。 */
export async function submitVideoViaApi(
  req: ApiVideoSubmitRequest,
): Promise<ApiVideoSubmitResult> {
  return callVideoSubmit(req, getWorkshopApiSettingsSync().video);
}

/** 轮询一次异步视频任务。 */
export async function pollVideoViaApi(
  remoteTaskId: string,
): Promise<{ url?: string; pending: boolean }> {
  return callVideoPoll(remoteTaskId, getWorkshopApiSettingsSync().video);
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
