// ── Workshop MCP 本地 ComfyUI 通道 ──────────────────────────────
// 不依赖 Next/rpc 的 SSE 链路（那套依赖浏览器与 server-only），改为直接调用
// 本地 ComfyUI 的 HTTP API：/api/prompt → /api/history → /api/view。
// 工作流为 ComfyUI「API 格式」图（节点平铺），默认内置一个模型无关的 SDXL
// txt2img 图；视频(i2v)与自定义图走 data/workshop-comfy-settings.json 模板，
// 支持 {{prompt}}/{{negative}}/{{image}} 占位替换，从而与任意已安装模型解耦。
import { randomUUID } from "node:crypto";

import { COMFYUI_DEFAULT_PORT } from "~/lib/endpoints";
import { safeFileNameSegment } from "~/lib/safe-name";
import { base64PayloadOf, isInlineMedia } from "~/lib/media/data-url";
import { comfyUiBaseUrl, LOOPBACK_HOST } from "~/lib/endpoints";
import { promises as fs, readFileSync } from "node:fs";
import path from "node:path";

import {
  DEFAULT_SIZE_SPEC,
  sizeSpecDims,
  type SizeSpec,
} from "~/lib/media/size-presets";

const OUTPUT_DIR = path.join(process.cwd(), "data", "workshop-outputs");
const SETTINGS_FILE = path.join(
  process.cwd(),
  "data",
  "workshop-comfy-settings.json",
);

interface ComfySettings {
  checkpoint?: string;
  imageWorkflow?: unknown;
  videoWorkflow?: unknown;
}

let settingsCache: ComfySettings | null = null;
let resolvedBase: string | null = null;

function loadSettings(): ComfySettings {
  if (settingsCache) return settingsCache;
  let parsed: ComfySettings = {};
  try {
    parsed = JSON.parse(readFileSync(SETTINGS_FILE, "utf-8")) as ComfySettings;
  } catch {
    parsed = {};
  }
  settingsCache = parsed;
  return parsed;
}

/** 解析 ComfyUI base（含端口探测，落 127.0.0.1 避免 localhost→IPv6 解析失败）。 */
export async function resolveComfyBase(): Promise<string> {
  if (resolvedBase) return resolvedBase;
  const raw = process.env.COMFYUI_BASE ?? comfyUiBaseUrl(COMFYUI_DEFAULT_PORT);
  let host = LOOPBACK_HOST;
  let port = COMFYUI_DEFAULT_PORT;
  try {
    const u = new URL(raw);
    host = u.hostname === "localhost" ? LOOPBACK_HOST : u.hostname;
    port = parseInt(u.port) || COMFYUI_DEFAULT_PORT;
  } catch {
    resolvedBase = raw;
    return raw;
  }
  for (let offset = 0; offset <= 5; offset++) {
    const base = `http://${host}:${port + offset}`;
    try {
      const r = await fetch(`${base}/system_stats`, {
        signal: AbortSignal.timeout(800),
      });
      if (r.ok) {
        resolvedBase = base;
        return base;
      }
    } catch {
      /* 继续探测 */
    }
  }
  resolvedBase = raw;
  return raw;
}

function comfyBase(): string {
  return (
    resolvedBase ??
    process.env.COMFYUI_BASE ??
    comfyUiBaseUrl(COMFYUI_DEFAULT_PORT)
  );
}

export interface ComfyPromptResult {
  prompt_id?: string;
  error?: string;
}

export async function postComfyPrompt(
  prompt: unknown,
): Promise<ComfyPromptResult> {
  const base = await resolveComfyBase();
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
  return (await res.json()) as ComfyPromptResult;
}

export async function getComfyHistory(
  promptId: string,
): Promise<Record<string, unknown>> {
  const base = comfyBase();
  const res = await fetch(`${base}/api/history/${promptId}`, {
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`ComfyUI /api/history 失败 (${res.status})`);
  return (await res.json()) as Record<string, unknown>;
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
  const res = await fetch(url.toString(), {
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`ComfyUI /api/view 失败 (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

export async function uploadComfyImage(
  buffer: Buffer,
  filename: string,
): Promise<string> {
  const base = await resolveComfyBase();
  const form = new FormData();
  form.append("image", new Blob([new Uint8Array(buffer)]), filename);
  form.append("type", "input");
  const res = await fetch(`${base}/api/upload/image`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok)
    throw new Error(
      `ComfyUI 上传失败 (${res.status}): ${await res.text().catch(() => "")}`,
    );
  const data = (await res.json()) as { name?: string };
  if (!data.name) throw new Error("ComfyUI 上传未返回文件名");
  return data.name;
}

/** 解析某工坊会话（项目）的产出目录：data/workshop-outputs/{safeSessionId}。
 *  sessionId 为空时退回公共根目录（兼容无项目历史调用）。 */
export function outputDirForSession(sessionId?: string): string {
  if (sessionId) {
    const safe = safeFileNameSegment(sessionId);
    return path.join(OUTPUT_DIR, safe);
  }
  return OUTPUT_DIR;
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
    if (base64 === null) throw new Error("参考图 data URL 格式无效");
    return Buffer.from(base64, "base64");
  }
  const res = await fetch(ref, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`获取参考图失败 (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

/** 持久化 ComfyUI 通道配置（checkpoint / 自定义图模板）。 */
export async function saveComfySettings(
  patch: Partial<ComfySettings>,
): Promise<ComfySettings> {
  const current = loadSettings();
  const next: ComfySettings = { ...current, ...patch };
  settingsCache = next;
  await fs.mkdir(path.dirname(SETTINGS_FILE), { recursive: true });
  await fs.writeFile(SETTINGS_FILE, JSON.stringify(next, null, 2), "utf-8");
  return next;
}

/** 尺寸表达 → 内置 SDXL 图的宽高。
 *
 *  服务端也吃同一套尺寸表达（比例 + 分辨率 / 比例 + 百万像素 + 倍数，见
 *  `lib/size-presets`）：缺省按图片场景的默认档（3:4 1k），不写像素字面量。 */
export function sizeDimsForImage(spec?: SizeSpec): {
  width: number;
  height: number;
} {
  return sizeSpecDims(spec ?? DEFAULT_SIZE_SPEC, "image");
}

/** 模型无关的默认 SDXL txt2img 图（SaveImage 输出，供 /api/view 取回）。 */
export function buildTxt2ImgWorkflow(input: {
  prompt: string;
  negative?: string;
  size?: SizeSpec;
  checkpoint?: string;
  seed?: number;
}): unknown {
  const ckpt =
    input.checkpoint ??
    loadSettings().checkpoint ??
    process.env.WORKSHOP_COMFYUI_CHECKPOINT ??
    "sd_xl_base_1.0.safetensors";
  const { width, height } = sizeDimsForImage(input.size);
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

/** 把模板里的 {{prompt}}/{{negative}}/{{image}} 替换为实际值。 */
export function substitutePlaceholders(
  template: unknown,
  vars: { prompt: string; negative?: string; image?: string },
): unknown {
  const json = JSON.stringify(template)
    .split("{{prompt}}")
    .join(vars.prompt)
    .split("{{negative}}")
    .join(vars.negative ?? "")
    .split("{{image}}")
    .join(vars.image ?? "");
  return JSON.parse(json) as unknown;
}

export interface ComfyRunResult {
  files: string[];
}

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
  if (!promptId)
    throw new Error(`ComfyUI 未返回 prompt_id：${JSON.stringify(posted)}`);

  const deadline = Date.now() + 10 * 60_000;
  let history: Record<string, unknown> = {};
  while (Date.now() < deadline) {
    history = await getComfyHistory(promptId).catch(() => ({}));
    const entry = history[promptId] as
      { status?: { completed?: boolean; status_str?: string } } | undefined;
    const done =
      entry?.status?.completed === true ||
      entry?.status?.status_str === "success";
    const failed = entry?.status?.status_str === "error";
    if (done || failed) break;
    await new Promise((r) => setTimeout(r, 1500));
  }

  const entry = history[promptId] as
    { outputs?: Record<string, unknown> } | undefined;
  const outputs = entry?.outputs ?? {};
  const files: string[] = [];
  const outDir = outputDirForSession(opts?.sessionId);
  await fs.mkdir(outDir, { recursive: true });
  for (const nodeOut of Object.values(outputs)) {
    const rec = nodeOut as {
      images?: Array<{ filename: string; subfolder: string; type: string }>;
      gifs?: Array<{ filename: string; subfolder: string; type: string }>;
    };
    const items = [...(rec.images ?? []), ...(rec.gifs ?? [])];
    for (const item of items) {
      const buf = await getComfyView(item.filename, item.subfolder, item.type);
      const outName = `comfy-${promptId}-${files.length}-${item.filename}`;
      const outPath = path.join(outDir, safeFileNameSegment(outName));
      await fs.writeFile(outPath, buf);
      files.push(`file://${outPath}`);
    }
  }
  if (files.length === 0) throw new Error("ComfyUI 任务完成但没有输出文件");
  return { files };
}

/**
 * 生成图（comfyui 通道）：有自定义 imageWorkflow 模板则用模板，否则用默认 SDXL 图。
 */
export async function generateImageViaComfyUI(input: {
  prompt: string;
  negative?: string;
  /** 尺寸表达（比例 + 分辨率 / 比例 + 百万像素 + 倍数）；缺省走图片场景默认档。 */
  size?: SizeSpec;
  sessionId?: string;
}): Promise<string> {
  const settings = loadSettings();
  const workflow = settings.imageWorkflow
    ? substitutePlaceholders(settings.imageWorkflow, {
        prompt: input.prompt,
        negative: input.negative,
      })
    : buildTxt2ImgWorkflow({
        prompt: input.prompt,
        negative: input.negative,
        size: input.size,
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
  prompt: string;
  negative?: string;
  imageDataUrl?: string;
  sessionId?: string;
}): Promise<{ url?: string }> {
  const settings = loadSettings();
  if (!settings.videoWorkflow) {
    throw new Error(
      "comfyui 视频通道需要 i2v 工作流模板：请在 data/workshop-comfy-settings.json 配置 videoWorkflow（ComfyUI API 格式图，含 {{prompt}}/{{negative}}/{{image}} 占位），导出方法：ComfyUI 里点「Queue Prompt」旁 API 按钮。",
    );
  }
  let image: string | undefined;
  if (input.imageDataUrl) {
    const buf = await fetchToBuffer(input.imageDataUrl);
    image = await uploadComfyImage(
      buf,
      `workshop-frame-${randomUUID().slice(0, 8)}.png`,
    );
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
