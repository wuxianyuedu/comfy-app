/**
 * `executor-outputs.ts` — 产物收集与运行时参数提取（纯函数）
 * ===========================================================================
 *
 * 产物收集与运行时参数提取，纯函数、无任何外部副作用：
 *   - {@link collectOutputs}     从 ComfyUI history 的 outputs 中收集
 *                                图像 / 视频 / 音频 / 其它 / 文本 五类产物
 *   - {@link extractRuntimeParams} 从 history prompt graph 抽取本次执行
 *                                实际使用的 KSampler 参数（真实 seed 等）
 *
 * @module comfyui/executor-outputs — 产物收集与运行时参数提取（纯函数）
 */
import { isRecord } from "~/lib/is-record";

/** ComfyUI history 输出文件条目（images / videos / gifs / audios 及 3D 兜底）。 */
export type CollectedOutputFile = {
  filename: string;
  subfolder: string;
  type: string;
};

export type CollectedOutputs = {
  audios: Array<CollectedOutputFile>;
  images: Array<CollectedOutputFile>;
  others: Array<CollectedOutputFile>;
  texts: Array<string>;
  videos: Array<CollectedOutputFile>;
};

/** 输出数组里的文件条目：`filename` 必须是字符串（`subfolder` / `type` 允许缺省）。 */
function isCollectedOutputFile(v: unknown): v is CollectedOutputFile {
  return isRecord(v) && typeof v.filename === "string";
}

/**
 * 从 ComfyUI history 的 outputs 中收集各类产物。
 * 纯函数，便于单测（P2：补齐 audio/text/3D，避免只认 images/videos 导致的死锁）。
 */
export function collectOutputs(outputs: Record<string, unknown>): CollectedOutputs {
  const images: Array<CollectedOutputFile> = [];
  const videos: Array<CollectedOutputFile> = [];
  const audios: Array<CollectedOutputFile> = [];
  const others: Array<CollectedOutputFile> = [];
  const texts: Array<string> = [];
  for (const node of Object.values(outputs)) {
    if (!isRecord(node)) {
      continue;
    }
    if (Array.isArray(node.images)) {
      images.push(...node.images.filter(isCollectedOutputFile));
    }
    if (Array.isArray(node.videos)) {
      videos.push(...node.videos.filter(isCollectedOutputFile));
    }
    // VHS_VideoCombine 把文件发在 `gifs` 下（实际是 mp4/gif/webm）。
    if (Array.isArray(node.gifs)) {
      videos.push(...node.gifs.filter(isCollectedOutputFile));
    }
    // SaveAudio 与 AudioComposite 把文件发在 `audios` 下。
    if (Array.isArray(node.audios)) {
      audios.push(...node.audios.filter(isCollectedOutputFile));
    }
    // ShowText / 任意文本输出节点：保留渲染文本（无文件）.
    if (typeof node.text === "string" && node.text.trim()) {
      texts.push(node.text);
    } else if (Array.isArray(node.text)) {
      for (const t of node.text) {
        if (typeof t === "string" && t.trim()) {
          texts.push(t);
        }
      }
    }
    // 3D / 未知文件输出（Hunyuan3D、mesh、gltf…）：兜底收集任何其它
    // 「数组内含 {filename,...}」的输出，避免被静默丢弃。
    for (const [k, v] of Object.entries(node)) {
      if (k === "images" || k === "videos" || k === "gifs" || k === "audios" || k === "text") {
        continue;
      }
      if (!Array.isArray(v)) {
        continue;
      }
      const files = v.filter(isCollectedOutputFile);
      if (files.length && files.length === v.length) {
        others.push(...files);
      }
    }
  }
  return { images, videos, audios, others, texts };
}

/**
 * 从 ComfyUI history 的 prompt graph 里抽取本次执行**实际使用**的 KSampler 参数。
 *
 * 为什么需要这个？KSampler 的真实 seed 来自 server 端的 `control_after_generate`
 * 处理（randomize 时随机、increment/decrement 时上下浮动），写入 history 但**不**
 * 出现在 `entry.outputs` 里（outputs 只有图像文件）。前端看到的工作流默认 seed
 * 是 UI 元数据，对 randomize 节点而言不是真实执行值。
 *
 * 形态参考（来自 0.33.1 history entry.prompt[2]）：
 *   "76:69": {
 *     "class_type": "KSampler",   // 节点类型
 *     "inputs": { "seed": 941524759465139, "steps": 25, "cfg": 4, ... }  // 真实 seed 等
 *   }   // 上面 inputs 里就是本次真实执行用的参数
 *
 * 一个工作流可能有**多个**采样节点（两段采样、放大链路各带一个 KSampler 等）。
 * 这里把 graph 里每个采样节点按出现顺序收进 `samplers`，并把**第一个**作为「主
 * 采样器」摊平到顶层字段——顶层那份是历史既有形态（种子落库 / manifest / 成功日志
 * 都读它），保留它让下游零改动；要看全部采样器就读 `samplers`。
 */
export type SamplerRuntime = {
  cfg?: number;
  classType: string;
  denoise?: number;
  nodeId: string;
  sampler_name?: string;
  scheduler?: string;
  seed?: number;
  steps?: number;
};

export type RuntimeParams = {
  cfg?: number;
  denoise?: number;
  sampler_name?: string;
  samplerClassType?: string;
  samplerNodeId?: string;
  /** graph 里全部采样节点（按出现顺序）；只有一个时也是长度 1 的数组。 */
  samplers?: Array<SamplerRuntime>;
  scheduler?: string;
  seed?: number;
  steps?: number;
};

/** 采样节点类名判定：KSamplerAdvanced 用 noise_seed，KSampler / SamplerCustom 用 seed。 */
function isSamplerClassType(t: string): boolean {
  return t === "KSampler" || t === "KSamplerAdvanced" || t === "SamplerCustom";
}

/** 读单个采样节点的 inputs → `SamplerRuntime`（缺字段留 undefined，不臆造）。 */
function readSamplerNode(
  nodeId: string,
  classType: string,
  inputs: Record<string, unknown>,
): SamplerRuntime {
  const seedRaw = inputs.noise_seed ?? inputs.seed;
  const seed =
    typeof seedRaw === "number"
      ? seedRaw
      : typeof seedRaw === "string" && seedRaw.trim() !== "" && Number.isFinite(Number(seedRaw))
        ? Number(seedRaw)
        : undefined;
  const out: SamplerRuntime = { nodeId, classType };
  if (typeof seed === "number" && Number.isFinite(seed)) {
    out.seed = seed;
  }
  if (typeof inputs.steps === "number") {
    out.steps = inputs.steps;
  }
  if (typeof inputs.cfg === "number") {
    out.cfg = inputs.cfg;
  }
  if (typeof inputs.sampler_name === "string" && inputs.sampler_name) {
    out.sampler_name = inputs.sampler_name;
  }
  if (typeof inputs.scheduler === "string" && inputs.scheduler) {
    out.scheduler = inputs.scheduler;
  }
  if (typeof inputs.denoise === "number") {
    out.denoise = inputs.denoise;
  }
  return out;
}

export function extractRuntimeParams(entry: unknown): RuntimeParams {
  const out: RuntimeParams = {};
  const entryObj = isRecord(entry) ? entry : undefined;
  const promptRaw: unknown = entryObj?.prompt;
  const graphRaw: unknown = Array.isArray(promptRaw) ? promptRaw[2] : undefined;
  if (!isRecord(graphRaw)) {
    return out;
  }
  const samplers: Array<SamplerRuntime> = [];
  for (const [nid, nodeRaw] of Object.entries(graphRaw)) {
    if (!isRecord(nodeRaw)) {
      continue;
    }
    const t = typeof nodeRaw.class_type === "string" ? nodeRaw.class_type : "";
    if (!isSamplerClassType(t)) {
      continue;
    }
    const inputsRaw: unknown = nodeRaw.inputs;
    const inputs: Record<string, unknown> = isRecord(inputsRaw) ? inputsRaw : {};
    samplers.push(readSamplerNode(nid, t, inputs));
  }
  if (samplers.length === 0) {
    return out;
  }
  out.samplers = samplers;
  /* 主采样器 = graph 顺序第一个：摊平到顶层，保持历史既有形态（下游零改动）。 */
  const primary = samplers[0];
  if (!primary) {
    return out;
  }
  out.samplerNodeId = primary.nodeId;
  out.samplerClassType = primary.classType;
  if (primary.seed !== undefined) {
    out.seed = primary.seed;
  }
  if (primary.steps !== undefined) {
    out.steps = primary.steps;
  }
  if (primary.cfg !== undefined) {
    out.cfg = primary.cfg;
  }
  if (primary.sampler_name !== undefined) {
    out.sampler_name = primary.sampler_name;
  }
  if (primary.scheduler !== undefined) {
    out.scheduler = primary.scheduler;
  }
  if (primary.denoise !== undefined) {
    out.denoise = primary.denoise;
  }
  return out;
}
