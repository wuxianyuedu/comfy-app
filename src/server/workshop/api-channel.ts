// ── Workshop MCP 本地 API 通道（纯 Node 入口）─────────────────────────
// 与 `~/lib/workshop/api-channel.server` 同能力双入口：那个跑 Next、必须 `import "server-only"`
// （配置与 apiKey 不能进浏览器包）；这个跑 MCP stdio、**不能**碰 server-only（非 Next 环境直接抛错）。
// 协议实现（请求体、超时、错误文案、响应提取）全在 `api-channel-core.ts`；本文件只供两处差异：
// 上游用 `res.json()`（Next 侧另有"非 JSON 即报错"更严实现）、生图不查 remoteModel 表（纯 Node 没有）。
import { readFileSync } from "node:fs";
import { hash } from "node:crypto";
import path from "node:path";

import { isInlineMedia, toDataUrl } from "~/lib/media/data-url";
import { isPlainRecord } from "~/lib/is-record";

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
} from "~/lib/workshop/api-channel-core";

const FILE = path.join(process.cwd(), "data", WORKSHOP_API_SETTINGS_FILE);
let filePathForTest: string | null = null;
/** 只给用例：把配置文件指到测试自己的临时目录（cwd 相对路径不可注入）。 */
export function configureWorkshopApiSettingsFileForTest(p: string): void {
  filePathForTest = p;
}

const DEFAULTS = defaultChannelsFromEnv();

// 配置文件是外来 JSON：只判「是非数组对象」这层，字段归一交给
// normalizeSettings → sanitizeChannel 逐字段 typeof 校验（脏值各自回落 default）。
function isSettingsPatch(v: unknown): v is Partial<WorkshopApiSettings> {
  return isPlainRecord(v);
}

let cache: WorkshopApiSettings | null = null;
/** 缓存对应的文件指纹（#4231）：与 `~/lib/workshop/api-channel.server` 同一机制 ——
 * 原先缓存一旦建立就永不失效，设置页（Next 进程）对同一份文件的写入，MCP 这个
 * 长驻进程永远读不到：用户改了 apiKey/endpoint，MCP 工具拿到的还是旧值。 */
let cacheFingerprint = "";

/** 读取配置（进程内缓存，按文件指纹失效）。 */
export function getWorkshopApiSettingsSync(): WorkshopApiSettings {
  let raw: string | null = null;
  let fingerprint = "";
  try {
    raw = readFileSync(filePathForTest ?? FILE, "utf8");
    fingerprint = hash("sha1", raw, "hex");
  } catch {
    // 文件缺失 → 用默认值（指纹留空，必然与缓存不等）。
  }
  if (cache && fingerprint === cacheFingerprint) {
    return cache;
  }
  let stored: Partial<WorkshopApiSettings> = {};
  if (raw !== null) {
    try {
      const parsed: unknown = JSON.parse(raw);
      stored = isSettingsPatch(parsed) ? parsed : {};
    } catch {
      // 损坏 → 默认
    }
  }
  cache = normalizeSettings(stored, DEFAULTS);
  cacheFingerprint = fingerprint;
  return cache;
}

export type { ApiImageRequest, ApiVideoSubmitRequest, ApiVideoSubmitResult };

/** 调用 OpenAI 兼容 images/generations 端点，返回可用 URL（远程或 data URL）。 */
export async function generateImageViaApi(req: ApiImageRequest): Promise<string> {
  const channel = getWorkshopApiSettingsSync().image;
  if (!channel.baseUrl) {
    throw new Error("API 生图通道未配置：请先填写 Base URL 与 API Key");
  }
  return callImageGeneration(req, channel, () => null);
}

/** 提交视频任务；支持同步 URL 与异步任务两种上游。 */
export async function submitVideoViaApi(req: ApiVideoSubmitRequest): Promise<ApiVideoSubmitResult> {
  return callVideoSubmit(req, getWorkshopApiSettingsSync().video);
}

/** 轮询一次异步视频任务。 */
export async function pollVideoViaApi(
  remoteTaskId: string,
): Promise<{ pending: boolean; url?: string }> {
  return callVideoPoll(remoteTaskId, getWorkshopApiSettingsSync().video);
}

const MAX_REMOTE_MEDIA_BYTES = 24 * 1024 * 1024;

async function readResponseBufferCapped(res: Response, maxBytes: number): Promise<Buffer> {
  const len = res.headers.get("content-length");
  if (len !== null) {
    const n = Number(len);
    if (Number.isFinite(n) && n > maxBytes) {
      throw new Error(`媒体超过 ${Math.floor(maxBytes / 1024 / 1024)}MB 上限`);
    }
  }
  if (!res.body) {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > maxBytes) {
      throw new Error(`媒体超过 ${Math.floor(maxBytes / 1024 / 1024)}MB 上限`);
    }
    return buf;
  }
  const reader = res.body.getReader();
  const chunks: Array<Uint8Array> = [];
  let total = 0;
  try {
    for (;;) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- 流式读取必须逐块等待，无法并行
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) {
          throw new Error(`媒体超过 ${Math.floor(maxBytes / 1024 / 1024)}MB 上限`);
        }
        chunks.push(value);
      }
    }
  } finally {
    /* 超限抛出时取消流：releaseLock 不停上游，剩余字节会继续进无人读取的
     * socket 直到超时（ISSUE #4218，与 safeFetch 的 body.cancel 同一口径）；
     * 正常读完时 cancel 是无操作。cancel/close 都做兜底——测试桩与旧环境
     * 可能没有这些方法。 */
    try {
      void Promise.resolve(reader.cancel?.()).catch(() => undefined);
    } catch {
      /* cancel 不可用时不影响既有的收尾 */
    }
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

/** 把任意图片引用（远程 URL 或 data URL）解析为内联 data URL（送视频上游首帧）。 */
export async function resolveMediaDataUrl(ref: string): Promise<string> {
  /* 「已经是内联 media 吗」与「怎么拼 data URL」各只有一处定义
   *（`~/lib/media/data-url`，规范 16 §16.2.4.56）。 */
  if (isInlineMedia(ref)) {
    return ref;
  }
  const res = await fetch(ref, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) {
    throw new Error(`解析媒体失败 (${res.status})`);
  }
  const buf = await readResponseBufferCapped(res, MAX_REMOTE_MEDIA_BYTES);
  const mime = res.headers.get("content-type") ?? "image/png";
  return toDataUrl(buf, mime);
}
