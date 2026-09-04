/**
 * `executor-outputs.ts` — 产物收集与运行时参数提取（纯函数）
 * ===========================================================================
 *
 * 从 executor.ts 拆出的纯函数模块（batch 4），无任何外部副作用：
 *   - {@link collectOutputs}     从 ComfyUI history 的 outputs 中收集
 *                                images / videos / audios / others / texts
 *   - {@link extractRuntimeParams} 从 history prompt graph 抽取本次执行
 *                                实际使用的 KSampler 参数（真实 seed 等）
 *
 * @module comfyui/executor-outputs
 */
/** ComfyUI history 输出文件条目（images / videos / gifs / audios 及 3D 兜底）。 */
export type CollectedOutputFile = {
  filename: string;
  subfolder: string;
  type: string;
};

export type CollectedOutputs = {
  images: CollectedOutputFile[];
  videos: CollectedOutputFile[];
  audios: CollectedOutputFile[];
  others: CollectedOutputFile[];
  texts: string[];
};

/**
 * 从 ComfyUI history 的 outputs 中收集各类产物。
 * 纯函数，便于单测（P2：补齐 audio/text/3D，避免只认 images/videos 导致的死锁）。
 */
export function collectOutputs(outputs: Record<string, unknown>): CollectedOutputs {
  const images: CollectedOutputFile[] = [];
  const videos: CollectedOutputFile[] = [];
  const audios: CollectedOutputFile[] = [];
  const others: CollectedOutputFile[] = [];
  const texts: string[] = [];
  for (const nodeOut of Object.values(outputs)) {
    if (!nodeOut || typeof nodeOut !== "object") continue;
    const node = nodeOut as Record<string, unknown>;
    if (Array.isArray(node.images)) images.push(...(node.images as CollectedOutputFile[]));
    if (Array.isArray(node.videos)) videos.push(...(node.videos as CollectedOutputFile[]));
    // VHS_VideoCombine emits its files under `gifs` (mp4/gif/webm).
    if (Array.isArray(node.gifs)) videos.push(...(node.gifs as CollectedOutputFile[]));
    // SaveAudio / AudioComposite emit under `audios`.
    if (Array.isArray(node.audios)) audios.push(...(node.audios as CollectedOutputFile[]));
    // ShowText / 任意文本输出节点：保留渲染文本（无文件）.
    if (typeof node.text === "string" && node.text.trim()) texts.push(node.text);
    else if (Array.isArray(node.text))
      for (const t of node.text) if (typeof t === "string" && t.trim()) texts.push(t);
    // 3D / 未知文件输出（Hunyuan3D、mesh、gltf…）：兜底收集任何其它
    // 「数组内含 {filename,...}」的输出，避免被静默丢弃。
    for (const [k, v] of Object.entries(node)) {
      if (k === "images" || k === "videos" || k === "gifs" || k === "audios" || k === "text") continue;
      if (
        Array.isArray(v) &&
        v.length &&
        v.every(
          (it) =>
            it &&
            typeof it === "object" &&
            typeof (it as Record<string, unknown>).filename === "string"
        )
      )
        others.push(...(v as CollectedOutputFile[]));
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
 *     "class_type": "KSampler",
 *     "inputs": { "seed": 941524759465139, "steps": 25, "cfg": 4, "denoise": 0.7, ... }
 *   }
 *
 * 取 graph 顺序第一个 KSampler/KSamplerAdvanced 为主采样器。返回值所有字段都可能
 * 为 `undefined`，调用方自行决定是否覆盖请求默认值。
 */
export type RuntimeParams = {
  seed?: number;
  steps?: number;
  cfg?: number;
  sampler_name?: string;
  scheduler?: string;
  denoise?: number;
  samplerNodeId?: string;
  samplerClassType?: string;
};

export function extractRuntimeParams(entry: unknown): RuntimeParams {
  const out: RuntimeParams = {};
  const prompt = (entry as { prompt?: unknown } | null | undefined)?.prompt;
  const graphRaw = (prompt as Record<string, unknown> | null | undefined)?.[2];
  if (!graphRaw || typeof graphRaw !== "object") return out;
  const graph = graphRaw as Record<string, unknown>;
  for (const [nid, nodeRaw] of Object.entries(graph)) {
    const node = nodeRaw as Record<string, unknown> | undefined;
    const t = typeof node?.class_type === "string" ? node.class_type : "";
    // KSamplerAdvanced 用 noise_seed；KSampler / SamplerCustom 用 seed。
    if (t !== "KSampler" && t !== "KSamplerAdvanced" && t !== "SamplerCustom") continue;
    const inputs = (node?.inputs ?? {}) as Record<string, unknown>;
    if (out.samplerNodeId === undefined) {
      out.samplerNodeId = nid;
      out.samplerClassType = t;
    }
    // 仅看第一个主采样器：后续出现的同类型不覆盖。
    if (out.samplerNodeId !== nid) continue;
    const seedRaw = inputs.noise_seed ?? inputs.seed;
    const n =
      typeof seedRaw === "number"
        ? seedRaw
        : typeof seedRaw === "string" && seedRaw.trim() !== "" && Number.isFinite(Number(seedRaw))
          ? Number(seedRaw)
          : undefined;
    if (typeof n === "number" && Number.isFinite(n) && out.seed === undefined) out.seed = n;
    if (typeof inputs.steps === "number" && out.steps === undefined) out.steps = inputs.steps;
    if (typeof inputs.cfg === "number" && out.cfg === undefined) out.cfg = inputs.cfg;
    if (typeof inputs.sampler_name === "string" && inputs.sampler_name && out.sampler_name === undefined)
      out.sampler_name = inputs.sampler_name;
    if (typeof inputs.scheduler === "string" && inputs.scheduler && out.scheduler === undefined)
      out.scheduler = inputs.scheduler;
    if (typeof inputs.denoise === "number" && out.denoise === undefined) out.denoise = inputs.denoise;
  }
  return out;
}
