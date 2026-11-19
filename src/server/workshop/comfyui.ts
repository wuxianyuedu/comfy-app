// ── Workshop MCP 本地 ComfyUI 通道 ──────────────────────────────
// 不依赖 Next/rpc 的 SSE 链路（那套依赖浏览器与 server-only），直接调本地 ComfyUI HTTP API：
// /api/prompt → /api/history → /api/view。工作流为「API 格式」图（节点平铺），默认内置一个
// 模型无关的 SDXL txt2img；视频(i2v)与自定义图走 data/workshop-comfy-settings.json 模板，
// 支持 {{prompt}}/{{negative}}/{{image}} 占位替换，从而与任意已安装模型解耦。
import { randomUUID } from "node:crypto";

import { COMFYUI_DEFAULT_PORT, comfyUiBaseUrl, LOOPBACK_HOST } from "~/lib/endpoints";
import { probeBaseOnce } from "~/lib/comfyui/probe";
import { safeFileNameSegment } from "~/lib/safe-name";
import { base64PayloadOf, isInlineMedia } from "~/lib/media/data-url";
import { sleep } from "~/lib/with-timeout";
import { promises as fs, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { asRecord, isPlainRecord } from "~/lib/is-record";
import { AsyncMutex } from "~/lib/async-mutex";
import { loadSizePresetTable } from "~/lib/media/size-preset-fs.server";
import {
  DEFAULT_SIZE_SPEC,
  sizeSpecDims,
  type SizePresetTable,
  type SizeSpec,
} from "~/lib/media/size-presets";

const OUTPUT_DIR = path.join(process.cwd(), "data", "workshop-outputs");
const SETTINGS_FILE = path.join(process.cwd(), "data", "workshop-comfy-settings.json");

export type ComfySettings = {
  checkpoint?: string;
  imageWorkflow?: unknown;
  videoWorkflow?: unknown;
};

// settings 文件是外来 JSON：非对象、或 checkpoint 不是字符串时按「空配置」回落
// （与 IO 失败的 catch 同口径）；imageWorkflow/videoWorkflow 是任意值，原样留着。
function isComfySettings(v: unknown): v is ComfySettings {
  return isPlainRecord(v) && (v.checkpoint === undefined || typeof v.checkpoint === "string");
}

// /api/prompt 响应是外来 JSON：只认「对象且 error/prompt_id 是字符串或缺失」，
// 其余按空结果回落（透传原对象，保留额外键供错误文案 stringify）。
function isComfyPromptResult(v: unknown): v is ComfyPromptResult {
  return (
    isPlainRecord(v) &&
    (v.error === undefined || typeof v.error === "string") &&
    (v.prompt_id === undefined || typeof v.prompt_id === "string")
  );
}

// history 的单个 node 输出只判「是对象」这层（写入端=ComfyUI，images/gifs 元素
// 形状读侧判），非对象按「没有输出」处理。
function isComfyNodeOutput(v: unknown): v is {
  gifs?: Array<{ filename: string; subfolder: string; type: string }>;
  images?: Array<{ filename: string; subfolder: string; type: string }>;
} {
  return isPlainRecord(v);
}

let resolvedBase: string | null = null;

/** settings 文件的 size+mtimeMs 指纹；文件不存在 ⇒ `null`（与缓存键比对，也是合法状态）。 */
function settingsFileFingerprint(file: string): string | null {
  try {
    const st = statSync(file);
    return `${st.size}:${st.mtimeMs}`;
  } catch {
    return null;
  }
}

/** settings 文件 IO 的注入面（真实形状；用例换临时目录）。 */
export type SettingsFileIo = {
  fingerprint(file: string): string | null;
  read(file: string): string;
  write(file: string, content: string): Promise<void>;
};

const realSettingsFileIo: SettingsFileIo = {
  read: (file) => readFileSync(file, "utf8"),
  fingerprint: settingsFileFingerprint,
  /* 原子写（ISSUE #3859）：tmp + rename，读侧（250ms 级的界面读取 / MCP）不会
   * 撞到半截 JSON。 */
  write: async (file, content) => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, content, "utf8");
    await fs.rename(tmp, file);
  },
};

/** settings 文件的指纹 memo（ISSUE #2194）：用户会被本模块话术指着手改这个文件，而显式 `reset` 需要
 * 「执行者」—— 一个 watcher 或没人按的按钮；size+mtime 指纹让**改这个动作本身**成为执行者，改完的下一次
 * 读取必然 miss。形状与 custom-nodes manifest 摘要（audit E6）/ lockfile 漂移（L11）同族，一次 statSync。
 * 导出仅为用例（注入 io 不碰真盘）；模块自己用 `settingsMemo`。 */
export function createSettingsFileMemo(file: string, io: SettingsFileIo = realSettingsFileIo) {
  let cache: ComfySettings | null = null;
  let fingerprint: string | null = null;
  /* 保存串行化（ISSUE #3859）：两个并发 save 各自从旧快照合并、整份覆盖，
   * 先写者的 patch 被后写者顶掉。进程内互斥串行化（写入方都在本进程）。 */
  const saveMutex = new AsyncMutex();
  return {
    load(): ComfySettings {
      const fp = io.fingerprint(file);
      if (cache && fp === fingerprint) {
        return cache;
      }
      let parsed: ComfySettings;
      try {
        const raw: unknown = JSON.parse(io.read(file));
        parsed = isComfySettings(raw) ? raw : {};
      } catch {
        parsed = {};
      }
      cache = parsed;
      fingerprint = fp;
      return parsed;
    },
    save(patch: Partial<ComfySettings>): Promise<ComfySettings> {
      return saveMutex.run(async () => {
        const next = { ...this.load(), ...patch };
        await io.write(file, JSON.stringify(next, null, 2)).then(() => {
          cache = next;
          fingerprint = io.fingerprint(file);
        });
        return next;
      });
    },
  };
}

/** 模块自己用的那份（真实落点）。 */
const settingsMemo = createSettingsFileMemo(SETTINGS_FILE);

function loadSettings(): ComfySettings {
  return settingsMemo.load();
}

/** 丢掉缓存的 ComfyUI base，让下一次 `resolveComfyBase()` 重新探测。与 `~/lib/comfyui/client.ts` 的
 * `resetComfyBase()` 同语义（两处缓存此前只有那侧有出口，ISSUE #2194）：ComfyUI 重启后可能落在另一个
 * 端口（配置端口被占用时自行 +1），不清就钉死在死端口上整个进程周期。执行者是本模块的
 * `guardNetworkFailure` —— 没有执行者的失效出口只是没人按的按钮。 */
export function resetWorkshopComfyBase(): void {
  resolvedBase = null;
}

/** fetch 抛出的网络层错误（连接被拒 / 主机不可达 / DNS）在这一侧全是 `TypeError`；
 *  HTTP 状态失败走 `res.ok` 分支、不是异常 —— 由此把「连不上」（该复位）与
 *  「连上了但实例报错」（GPU OOM 的 500 也是活实例，#685，**不该**复位）分开。 */
function isNetworkFailure(e: unknown): boolean {
  return e instanceof TypeError;
}

/** 网络层失败时复位 base 缓存再把错误抛出去（重新探测交给下一次调用的
 * `resolveComfyBase` —— 本模块的调用链里它是每个提交 / 上传动作的第一跳）。 */
function guardNetworkFailure(e: unknown): never {
  if (isNetworkFailure(e)) {
    resetWorkshopComfyBase();
  }
  throw e;
}

/** 解析 ComfyUI base（含端口探测；落 127.0.0.1 避免 localhost→IPv6 解析失败）。存活判据走
 * `~/lib/comfyui/probe` 的 `probeBaseOnce` 唯一口径（**连上即存活**，含 GPU OOM 的 500，#685）——
 * 此前这里自己判 `r.ok`，与设置页单点探测分叉：同一实例一边判活、这边判死。`probe.ts` 是零依赖
 * 叶子（只有 fetch + 地址拼接），本模块是纯 Node 宿主（MCP），import 安全。 */
export async function resolveComfyBase(): Promise<string> {
  if (resolvedBase !== null) {
    return resolvedBase;
  }
  const raw = process.env.COMFYUI_BASE ?? comfyUiBaseUrl(COMFYUI_DEFAULT_PORT);
  let host;
  let port;
  try {
    const u = new URL(raw);
    host = u.hostname === "localhost" ? LOOPBACK_HOST : u.hostname;
    port = Number.parseInt(u.port) || COMFYUI_DEFAULT_PORT;
  } catch {
    return raw; /* 探测没法做就不缓存：实例随时可能起来（与 client.ts 同一句语义） */
  }
  for (let offset = 0; offset <= 5; offset++) {
    const base = `http://${host}:${port + offset}`;
    // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：后一步要用前一步的结果（既有串行路径）
    if ((await probeBaseOnce(base, 800)) !== null) {
      resolvedBase = base;
      return base;
    }
  }
  /* 探测全落空 ⇒ **不缓存**：缓存会把通道在进程生命周期里钉死在一个连不上的
   * 地址上（client.ts 那侧的注释原文：「谁都没应答」不缓存 —— 实例随时可能起来）。
   * 此前这里 `resolvedBase = raw`，探空结果同样首读即定终身（ISSUE #2194）。 */
  return raw;
}

function comfyBase(): string {
  return resolvedBase ?? process.env.COMFYUI_BASE ?? comfyUiBaseUrl(COMFYUI_DEFAULT_PORT);
}

export type ComfyPromptResult = {
  error?: string;
  prompt_id?: string;
};

export async function postComfyPrompt(prompt: unknown): Promise<ComfyPromptResult> {
  const base = await resolveComfyBase();
  try {
    const res = await fetch(`${base}/api/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, client_id: randomUUID() }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      throw new Error(
        `ComfyUI /api/prompt 失败 (${res.status}): ${await res.text().catch(() => "")}`,
      );
    }
    const raw: unknown = await res.json();
    return isComfyPromptResult(raw) ? raw : {};
  } catch (error) {
    guardNetworkFailure(error);
  }
}

export async function getComfyHistory(promptId: string): Promise<Record<string, unknown>> {
  const base = comfyBase();
  try {
    const res = await fetch(`${base}/api/history/${promptId}`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      throw new Error(`ComfyUI /api/history 失败 (${res.status})`);
    }
    const raw: unknown = await res.json();
    return asRecord(raw) ?? {};
  } catch (error) {
    guardNetworkFailure(error);
  }
}

export async function getComfyView(
  filename: string,
  subfolder: string,
  type: string,
): Promise<Buffer> {
  const base = comfyBase();
  const url = new URL(`${base}/api/view`);
  url.searchParams.set("filename", filename);
  url.searchParams.set("subfolder", subfolder ?? "");
  url.searchParams.set("type", type ?? "");
  try {
    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      throw new Error(`ComfyUI /api/view 失败 (${res.status})`);
    }
    return Buffer.from(await res.arrayBuffer());
  } catch (error) {
    guardNetworkFailure(error);
  }
}

export async function uploadComfyImage(buffer: Buffer, filename: string): Promise<string> {
  const base = await resolveComfyBase();
  const form = new FormData();
  form.append("image", new Blob([new Uint8Array(buffer)]), filename);
  form.append("type", "input");
  try {
    const res = await fetch(`${base}/api/upload/image`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      throw new Error(`ComfyUI 上传失败 (${res.status}): ${await res.text().catch(() => "")}`);
    }
    const raw: unknown = await res.json();
    const name = asRecord(raw)?.name;
    if (typeof name !== "string" || name === "") {
      throw new Error("ComfyUI 上传未返回文件名");
    }
    return name;
  } catch (error) {
    guardNetworkFailure(error);
  }
}

/** 解析某工坊会话（项目）的产出目录：data/workshop-outputs/{safeSessionId}。
 *  sessionId 为空时退回公共根目录（兼容无项目历史调用）。 */
export function outputDirForSession(sessionId?: string): string {
  if (sessionId !== undefined && sessionId !== "") {
    const safe = safeFileNameSegment(sessionId);
    return path.join(OUTPUT_DIR, safe);
  }
  return OUTPUT_DIR;
}

/** 远程媒体下载上限：只挡异常大体积，不改变正常参考图/首帧流程。 */
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

/** 把远程 URL / data URL 归一为可上传的 Buffer。 */
export async function fetchToBuffer(ref: string): Promise<Buffer> {
  if (isInlineMedia(ref)) {
    /* 「怎么取 data URL 的 base64 载荷」只有一处定义
     *（`~/lib/media/data-url`，规范 16 §16.2.4.56）。
     * 收口前这里写的是 `ref.slice(ref.indexOf(",") + 1)` —— 缺逗号时
     * `indexOf` 给 `-1`，`slice(0)` 会把**整个 data URL** 当 base64
     * 交给 `Buffer.from`（它跳过非法字符）→ 静默解出垃圾字节。 */
    const base64 = base64PayloadOf(ref);
    if (base64 === null) {
      throw new Error("参考图 data URL 格式无效");
    }
    const buf = Buffer.from(base64, "base64");
    if (buf.byteLength > MAX_REMOTE_MEDIA_BYTES) {
      throw new Error(`媒体超过 ${Math.floor(MAX_REMOTE_MEDIA_BYTES / 1024 / 1024)}MB 上限`);
    }
    return buf;
  }
  const res = await fetch(ref, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) {
    throw new Error(`获取参考图失败 (${res.status})`);
  }
  return readResponseBufferCapped(res, MAX_REMOTE_MEDIA_BYTES);
}

/** 持久化 ComfyUI 通道配置（checkpoint / 自定义图模板）。 */
export async function saveComfySettings(patch: Partial<ComfySettings>): Promise<ComfySettings> {
  return settingsMemo.save(patch);
}

/** 尺寸表达 → 内置 SDXL 图的宽高。
 *
 *  服务端也吃同一套尺寸表达（比例 + 分辨率 / 比例 + 百万像素 + 倍数，见
 *  `lib/size-presets`）：缺省按图片场景的默认档（3:4 1k），不写像素字面量。
 *  查表用**生效的那份**（ISSUE #3972）：`table` 缺省才是编译进包的默认快照，
 *  调用方（`generateImageViaComfyUI`）先 `loadSizePresetTable()` 现读 ——
 *  设置里改过的表在 comfyui 通道真的生效。 */
export function sizeDimsForImage(
  spec?: SizeSpec,
  table?: SizePresetTable,
): {
  height: number;
  width: number;
} {
  return sizeSpecDims(spec ?? DEFAULT_SIZE_SPEC, "image", table);
}

/** 模型无关的默认 SDXL txt2img 图（SaveImage 输出，供 /api/view 取回）。 */
export function buildTxt2ImgWorkflow(input: {
  checkpoint?: string;
  negative?: string;
  prompt: string;
  seed?: number;
  size?: SizeSpec;
  /** 生效的尺寸表（ISSUE #3972）：宽高按它查，不再用编译进包的默认快照。 */
  table?: SizePresetTable;
}): unknown {
  const ckpt =
    input.checkpoint ??
    loadSettings().checkpoint ??
    process.env.WORKSHOP_COMFYUI_CHECKPOINT ??
    "sd_xl_base_1.0.safetensors";
  const { width, height } = sizeDimsForImage(input.size, input.table);
  return {
    "3": {
      class_type: "KSampler",
      inputs: {
        seed: input.seed ?? 0,
        steps: 25,
        cfg: 7,
        sampler_name: "euler",
        scheduler: "normal",
        denoise: 1,
        model: ["4", 0],
        positive: ["6", 0],
        negative: ["7", 0],
      },
    },
    "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: ckpt } },
    "5": {
      class_type: "EmptyLatentImage",
      inputs: { width, height, batch_size: 1 },
    },
    "6": {
      class_type: "CLIPTextEncode",
      inputs: { text: input.prompt, clip: ["4", 1] },
    },
    "7": {
      class_type: "CLIPTextEncode",
      inputs: { text: input.negative ?? "", clip: ["4", 1] },
    },
    "8": {
      class_type: "VAEDecode",
      inputs: { samples: ["3", 0], vae: ["4", 2] },
    },
    "9": {
      class_type: "SaveImage",
      inputs: { images: ["8", 0], filename_prefix: "workshop" },
    },
  };
}

/** 把模板里的 {{prompt}}/{{negative}}/{{image}} 替换为实际值。
 *
 *  先解析成结构、再对**字符串值**做替换（#4414）：此前在 JSON.stringify 的文本上
 *  做裸字符串手术——prompt / negative 里带 `"`、`\` 或换行（图像提示词里极常见）
 *  时，替换结果是非法 JSON，JSON.parse 抛 SyntaxError，整次生成失败。占位符
 *  位于 ComfyUI API 图节点的字符串字段内，按值遍历替换与原口径同范围（整树），
 *  但值本身不再需要是合法 JSON 片段。 */
export function substitutePlaceholders(
  template: unknown,
  vars: { image?: string; negative?: string; prompt: string },
): unknown {
  let parsed: unknown = template;
  if (typeof template === "string") {
    try {
      parsed = JSON.parse(template);
    } catch {
      throw new Error("工作流模板不是合法 JSON：请重新导入该模板");
    }
  }
  return substituteInValue(parsed, vars);
}

/** 深度遍历：字符串值做占位替换，数组 / 对象递归，其余原样返回。 */
function substituteInValue(
  value: unknown,
  vars: { image?: string; negative?: string; prompt: string },
): unknown {
  if (typeof value === "string") {
    let out = value.split("{{prompt}}").join(vars.prompt);
    out = out.split("{{negative}}").join(vars.negative ?? "");
    return out.split("{{image}}").join(vars.image ?? "");
  }
  if (Array.isArray(value)) {
    return value.map((item) => substituteInValue(item, vars));
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, substituteInValue(item, vars)]),
    );
  }
  return value;
}

export type ComfyRunResult = {
  files: Array<string>;
};

/**
 * 提交工作流、轮询历史、取回输出并落盘到 data/workshop-outputs[/{sessionId}]。
 * 返回 file:// 绝对路径数组（图片来自 images，视频来自 gifs）。
 */
export async function runComfyWorkflow(
  workflow: unknown,
  opts?: { sessionId?: string },
): Promise<ComfyRunResult> {
  const posted = await postComfyPrompt(workflow);
  const promptId = posted.prompt_id;
  if (promptId === undefined || promptId === "") {
    throw new Error(`ComfyUI 未返回 prompt_id：${JSON.stringify(posted)}`);
  }

  const deadline = Date.now() + 10 * 60_000;
  let history: Record<string, unknown> = {};
  let timedOut = true;
  while (Date.now() < deadline) {
    // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：后一步要用前一步的结果（既有串行路径）
    history = await getComfyHistory(promptId).catch(() => ({}));
    const entry = asRecord(history[promptId]);
    const status = asRecord(entry?.status);
    const done = status?.completed === true || status?.status_str === "success";
    const failed = status?.status_str === "error";
    if (done || failed) {
      timedOut = false;
      break;
    }
    // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：后一步要用前一步的结果（既有串行路径）
    await sleep(1500);
  }

  if (timedOut) {
    /* 超时 ≠ 完成（ISSUE #3878）：原先把「10 分钟没等到」落进「完成但没有输出
     * 文件」的失败分支，排障方向全错；且 ComfyUI 侧该 prompt 仍在消耗 GPU、
     * 无人取消。这里单独报错，并尽力 /interrupt 停掉在跑的 prompt（尽力而为，
     * 失败不掩盖主错误——interrupt 不区分 prompt，误伤面由「本应用单飞」兜住）。 */
    void fetch(`${comfyBase()}/api/interrupt`, {
      method: "POST",
      signal: AbortSignal.timeout(5000),
    }).catch(() => undefined);
    throw new Error(
      `ComfyUI 任务 10 分钟仍未等到结果（已尽力中断 prompt ${promptId}）——请确认工作流规模 / 模型加载或 ComfyUI 负载后重试`,
    );
  }

  const entry = asRecord(history[promptId]);
  const outputs: Record<string, unknown> = asRecord(entry?.outputs) ?? {};
  const files: Array<string> = [];
  const outDir = outputDirForSession(opts?.sessionId);
  await fs.mkdir(outDir, { recursive: true });
  for (const nodeOut of Object.values(outputs)) {
    const items = isComfyNodeOutput(nodeOut)
      ? [...(nodeOut.images ?? []), ...(nodeOut.gifs ?? [])]
      : [];
    for (const item of items) {
      // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：后一步要用前一步的结果（既有串行路径）
      const buf = await getComfyView(item.filename, item.subfolder, item.type);
      const outName = `comfy-${promptId}-${files.length}-${item.filename}`;
      const outPath = path.join(outDir, safeFileNameSegment(outName));
      // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：后一步要用前一步的结果（既有串行路径）
      await fs.writeFile(outPath, buf);
      files.push(`file://${outPath}`);
    }
  }
  if (files.length === 0) {
    throw new Error("ComfyUI 任务完成但没有输出文件");
  }
  return { files };
}

/**
 * 生成图（comfyui 通道）：有自定义 imageWorkflow 模板则用模板，否则用默认 SDXL 图。
 */
export async function generateImageViaComfyUI(input: {
  negative?: string;
  prompt: string;
  sessionId?: string;
  /** 尺寸表达（比例 + 分辨率 / 比例 + 百万像素 + 倍数）；缺省走图片场景默认档。 */
  size?: SizeSpec;
}): Promise<string> {
  const settings = loadSettings();
  /* 生效的尺寸表现读磁盘（ISSUE #3972）：设置里改过的表、被「保存到项目代码库」
   * 改过的项目默认，都在这份里 —— 宽高换算与界面同源。 */
  const sizeTable = await loadSizePresetTable();
  const workflow =
    settings.imageWorkflow !== undefined && settings.imageWorkflow !== null
      ? substitutePlaceholders(settings.imageWorkflow, {
          prompt: input.prompt,
          negative: input.negative,
        })
      : buildTxt2ImgWorkflow({
          prompt: input.prompt,
          negative: input.negative,
          size: input.size,
          table: sizeTable,
        });
  const { files } = await runComfyWorkflow(workflow, {
    sessionId: input.sessionId,
  });
  return files[0] ?? "";
}

/**
 * 生成视频（comfyui 通道）：需要 i2v 工作流模板（data/workshop-comfy-settings.json
 * 的 videoWorkflow，含 {{prompt}}/{{negative}}/{{image}} 占位）。无模板则明确报错，
 * 因为 i2v 依赖具体模型，无法内置通用图。
 */
export async function submitVideoViaComfyUI(input: {
  imageDataUrl?: string;
  negative?: string;
  prompt: string;
  sessionId?: string;
}): Promise<{ url?: string }> {
  const settings = loadSettings();
  if (settings.videoWorkflow === undefined || settings.videoWorkflow === null) {
    throw new Error(
      "comfyui 视频通道需要 i2v 工作流模板：请在 data/workshop-comfy-settings.json 配置 videoWorkflow（ComfyUI API 格式图，含 {{prompt}}/{{negative}}/{{image}} 占位），导出方法：ComfyUI 里点「Queue Prompt」旁 API 按钮。",
    );
  }
  let image: string | undefined;
  if (input.imageDataUrl !== undefined && input.imageDataUrl !== "") {
    const buf = await fetchToBuffer(input.imageDataUrl);
    image = await uploadComfyImage(buf, `workshop-frame-${randomUUID().slice(0, 8)}.png`);
  }
  const workflow = substitutePlaceholders(settings.videoWorkflow, {
    prompt: input.prompt,
    negative: input.negative,
    image,
  });
  const { files } = await runComfyWorkflow(workflow, {
    sessionId: input.sessionId,
  });
  return { url: files[0] };
}
