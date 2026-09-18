import { linkTargetId } from "./workflow-preview";
import { coerceApiInputValue } from "./raw-overrides";
import type { RawWorkflowOverride } from "./runner-state";

export type LoraSpec = { name: string; weight: number };

/** `buildCustomWorkflow` 能消费的参数。
 *
 *  **只有 `GenerateInput`（`generate.generate` 的入参）里也有的字段会被真正填充**
 *  —— 内置模板（token 替换）移除后，`checkpoint` / `sampler` / `scheduler` /
 *  下列字段已无任何生产写入方（自动注入分支只在「有人绕过路由直接调用本函数」
 *  时才有意义）；括号里是它们各自对应的参数名：步数（steps）、CFG（cfg）、
 *  随机种子（seed）、尺寸（size）、数量（count）、降噪（denoise）、
 *  遮罩（mask）、放大模型（upscaleModel）、前缀（prefix）、WAN 模型（wanModel）、
 *  WAN VAE（wanVae）、T5 模型（t5Model）、LTX 模型（ltxModel）、
 *  时长（duration）、分辨率（resolution）、帧率（fps）、LoRA（loras）。
 *
 *  保留这些字段与自动注入是为了两件事：① 画布 / 导入图的**提示词**注入
 *  （`prompt` / `negative` / `inputImage`，这条是真的在用）；② 未来若把某个
 *  扁平字段重新接回路由，注入逻辑不必重写。**新增字段前先确认路由入参里有它**，
 *  否则就是那个反复出现的「传了不生效且无任何报错」的静默失配。
 */
export type GenerateParams = {
  prompt?: string;
  negative?: string;
  checkpoint?: string; // 文件名 —— 必须与 ComfyUI 里的完全一致
  loras?: LoraSpec[];
  sampler?: string;
  scheduler?: string;
  steps?: number;
  cfg?: number;
  size?: string; // 例如 "1024x1024"
  count?: number;
  seed?: number;
  denoise?: number;
  inputImage?: string; // 已在 ComfyUI input 目录里的文件名
  // 图像编辑
  mask?: string;
  upscaleModel?: string;
  // 视频
  frames?: number;
  fps?: number;
  wanModel?: string;
  wanVae?: string;
  t5Model?: string;
  // LTX 视频
  ltxModel?: string;
  duration?: number;
  resolution?: string;
  firstFrame?: string; // 已在 ComfyUI input 目录里的文件名（首尾帧的首图）
  lastFrame?: string; // 已在 ComfyUI input 目录里的文件名（首尾帧的尾图）
  /* 自定义工作流：用户在 IO 编辑模式里挑出来的暴露引脚。
   * 形状与执行器的 RawWorkflowOverride 一致 —— 生成路由会把同一个数组分别喂给
   * buildCustomWorkflow 与 enqueue().overrides。 */
  workflowInputs?: RawWorkflowOverride[];
};

export type BuildResult = {
  ok: boolean;
  prompt?: Record<string, unknown>;
  error?: string;
};
/**
 * 把用户导入的工作流里「哪个节点是什么角色」映射到具体节点 id，
 * 于是 UI 可以指定「哪一个 CLIPTextEncode 才是正向提示词」等等。
 * 所有字段都是可选的 —— 缺哪个就对该角色走自动识别。
 */
export type ParamMap = {
  positiveNode?: string;
  negativeNode?: string;
  checkpointNode?: string;
  samplerNode?: string;
  // 接收上游图片的 LoadImage 节点（自动识别出来的，或用户在 UI 里手动指定）。
  inputImageNode?: string;
};
/**
 * 客户端安全的预览助手拆在 `workflow-preview.ts`：浏览器组件可以导入它，
 * 而不会连带拉进 `fs` / ComfyUI 客户端这类仅服务端的模块。
 */
export {
  buildWorkflowPreview,
  buildWorkflowPreviewFull,
  FULL_PREVIEW_LEVEL_GAP,
  FULL_PREVIEW_MARGIN,
  FULL_PREVIEW_NODE_H,
  FULL_PREVIEW_NODE_W,
  FULL_PREVIEW_ROW_GAP,
  type WorkflowPreview,
  type WorkflowPreviewEdge,
  type WorkflowPreviewNode,
  type WorkflowPreviewNodeKind,
} from "./workflow-preview";
/**
 * 自动识别导入的 ComfyUI 图里各角色节点：
 *  - 前两个 CLIPTextEncode → 正向 / 负向提示词
 *  - 第一个 CheckpointLoaderSimple → 模型
 *  - 第一个 KSampler → 采样器
 */
/**
 * 从 conditioning 连线向上游走，直到找到真正持有提示词字符串的那个
 * 文本编码节点（CLIPTextEncode / SDXL / Flux …）。
 * 这里跟的是真实的图拓扑，而不是按节点 id 顺序猜。
 */
/**
 * 对「可能不完整」的图节点做宽松结构视图。导入的图就是用户给的 JSON ——
 * 字段可能缺失、类型可能出人意料 —— 所以下面的遍历逻辑对每个字段都做防御性
 * 解读，而不是直接信任它的形状。
 */
type GraphNodeLike = {
  class_type?: unknown;
  inputs: Record<string, unknown>;
};
/** 对象检查：返回 `value` 的结构视图（同一引用、不复制 ——
 *  因此经它做的修改会写回原图）。 */
function asGraphNode(value: unknown): GraphNodeLike | null {
  return typeof value === "object" && value !== null
    ? (value as GraphNodeLike)
    : null;
}

function findTextEncoder(
  graph: Record<string, unknown>,
  startId: string | undefined,
  visited = new Set<string>(),
): string | null {
  if (!startId || visited.has(startId)) return null;
  visited.add(startId);
  const node = asGraphNode(graph[startId]);
  if (!node?.inputs) return null;
  const TEXT_FIELDS = [
    "text",
    "text_g",
    "text_l",
    "prompt",
    "positive",
    "negative",
    "text_positive",
    "text_negative",
  ];
  for (const f of TEXT_FIELDS) {
    const value = node.inputs[f];

    if (typeof value === "string" && !Array.isArray(value)) return startId;
  }

  for (const v of Object.values(node.inputs)) {
    const target = linkTargetId(v);
    if (target && graph[target]) {
      const result = findTextEncoder(graph, target, visited);

      if (result) return result;
    }
  }
  return null;
}

function isSamplerLike(node: GraphNodeLike): boolean {
  return (
    !!node.inputs &&
    Array.isArray(node.inputs.positive) &&
    Array.isArray(node.inputs.negative)
  );
}
/**
 * 自动识别导入的 ComfyUI 图里各角色节点。
 *
 * 正/负向不再按节点 id 顺序猜 —— 而是沿 KSampler 的 `positive`/`negative`
 * conditioning 连线向上游走，找到真正的文本编码节点（CLIPTextEncode /
 * SDXL / Flux …）。图中没有采样器时，回落到「前两个 CLIPTextEncode」。
 */
export function detectParamMap(graph: Record<string, unknown>): ParamMap {
  const map: ParamMap = {};
  const ids = Object.keys(graph);
  const nodes = ids.map((id) => ({ id, node: asGraphNode(graph[id]) }));

  const sampler = nodes.find((node) => {
    const n = node.node;
    if (!n) return false;
    return (
      n.class_type === "KSampler" ||
      n.class_type === "KSamplerAdvanced" ||
      isSamplerLike(n)
    );
  });
  if (sampler?.node) {
    const inputs = sampler.node.inputs;
    const posEnc = findTextEncoder(graph, linkTargetId(inputs.positive));
    const negEnc = findTextEncoder(graph, linkTargetId(inputs.negative));
    if (posEnc) map.positiveNode = posEnc;
    if (negEnc) map.negativeNode = negEnc;
  }
  // 兜底：按 id 取前两个 CLIPTextEncode（没有采样器时保持旧行为）。
  if (!map.positiveNode || !map.negativeNode) {
    const clips = nodes.filter(
      (node) => node.node?.class_type === "CLIPTextEncode",
    );
    if (!map.positiveNode && clips[0]) map.positiveNode = clips[0].id;
    if (!map.negativeNode && clips[1]) map.negativeNode = clips[1].id;
  }

  const ckpt = nodes.find(
    (node) => node.node?.class_type === "CheckpointLoaderSimple",
  );
  if (ckpt) map.checkpointNode = ckpt.id;

  const ks = nodes.find(
    (node) =>
      node.node?.class_type === "KSampler" ||
      node.node?.class_type === "KSamplerAdvanced",
  );
  if (ks) map.samplerNode = ks.id;

  const li = nodes.find((node) => node.node?.class_type === "LoadImage");
  if (li) map.inputImageNode = li.id;

  return map;
}
/**
 * ComfyUI 的 seed 是无符号 32 位整数。旧代码用
 * `Math.random() * 0xffffffffffffffff`（2^64）—— 既超过
 * `Number.MAX_SAFE_INTEGER`（整数精度因此丢失），又超出 ComfyUI 期望的 uint32
 * 范围。这里在 [0, 2^32-1] 内生成安全的 seed。
 */
function randomSeed(): number {
  return Math.floor(Math.random() * 0x100000000);
}
/** 把用户给的 seed 夹到 ComfyUI 能接受的合法 uint32 范围内。 */
function clampSeed(seed: number): number {
  const truncated = Math.trunc(seed);

  if (!Number.isFinite(truncated)) return randomSeed();

  return Math.max(0, Math.min(0xffffffff, truncated));
}

const CHECKPOINT_LOADER = new Set([
  "CheckpointLoaderSimple",
  "CheckpointLoader",
  "unCLIPCheckpointLoader",
  "CheckpointLoaderNF4",
]);
const UNET_LOADER = new Set(["UNETLoader", "UNETLoaderGGUF", "ModelLoader"]);
const CLIP_LOADER = new Set([
  "DualCLIPLoader",
  "TripleCLIPLoader",
  "CLIPLoader",
  "CLIPLoaderGGUF",
]);
/**
 * 注入一串 LoraLoader 节点。支持 Flux / SD3 / WAN 这类「基座 model+clip 来自
 * UNETLoader + DualCLIPLoader（或 Triple/CLIPLoader）而非单个
 * CheckpointLoaderSimple」的工作流。
 * 返回基座 loader 的输出与最后那个 LoraLoader 的 id，调用方据此只重连「原本吃
 * 基座 model/clip 的节点」（refiner / 双 CLIP 链路因此保持完好）。
 */
function injectLoras(
  graph: Record<string, unknown>,
  loras: LoraSpec[],
): {
  baseModel: [string, number] | null;
  baseClip: [string, number] | null;
  lastLora: string | null;
} {
  let baseModel: [string, number] | null = null;
  let baseClip: [string, number] | null = null;
  for (const [id, value] of Object.entries(graph)) {
    const classType = asGraphNode(value)?.class_type;
    if (typeof classType !== "string") continue;
    if (CHECKPOINT_LOADER.has(classType)) {
      // CheckpointLoaderSimple 的输出顺序是 [MODEL0, CLIP1, VAE2]。
      baseModel ??= [id, 0];
      baseClip ??= [id, 1];
    } else if (UNET_LOADER.has(classType) && !baseModel) {
      baseModel = [id, 0];
    } else if (CLIP_LOADER.has(classType) && !baseClip) {
      baseClip = [id, 0];
    }
  }
  if (!baseModel) return { baseModel: null, baseClip: null, lastLora: null };

  let prevModel: [string, number] = baseModel;
  let prevClip: [string, number] | null = baseClip;
  const loraIds: string[] = [];
  loras.forEach((lora, i) => {
    const id = `lora_${i}`;
    const inputs: Record<string, unknown> = {
      lora_name: lora.name,
      strength_model: lora.weight,
      model: prevModel,
    };
    if (prevClip) {
      inputs.strength_clip = lora.weight;
      inputs.clip = prevClip;
    }
    graph[id] = { class_type: "LoraLoader", inputs };
    prevModel = [id, 0];
    if (prevClip) prevClip = [id, 1];
    loraIds.push(id);
  });
  return {
    baseModel,
    baseClip,
    lastLora: loraIds.length ? loraIds[loraIds.length - 1]! : null,
  };
}
/** 只重连「原本吃基座 model/clip」的那些 loader 输出。
 *  跳过注入的 LoraLoader 节点自身（它们的 model/clip 输入本就该指向链上的
 *  前一个环节）。 */
function rewireLoaders(
  graph: Record<string, unknown>,
  baseModel: [string, number] | null,
  baseClip: [string, number] | null,
  lastLora: string,
) {
  for (const value of Object.values(graph)) {
    const node = asGraphNode(value);
    if (!node?.inputs) continue;
    const inputs = node.inputs;
    if (
      node.class_type === "LoraLoader" ||
      node.class_type === "LoraLoaderModelOnly"
    )
      continue;
    if (
      baseModel &&
      Array.isArray(inputs.model) &&
      inputs.model[0] === baseModel[0] &&
      inputs.model[1] === baseModel[1]
    ) {
      inputs.model = [lastLora, 0];
    }
    if (
      baseClip &&
      Array.isArray(inputs.clip) &&
      inputs.clip[0] === baseClip[0] &&
      inputs.clip[1] === baseClip[1]
    ) {
      inputs.clip = [lastLora, 1];
    }
  }
}
/** 给 CLIPTextEncode 类节点写提示词（兼容 SDXL 的 text_g/text_l）。 */
function setPromptText(node: GraphNodeLike | null, prompt: string) {
  if (!node?.inputs) return;
  const inputs = node.inputs;
  if (inputs.text_g !== undefined) {
    // SDXL / SDXL-simplified：text_g 与 text_l 都承载提示词。
    inputs.text_g = prompt;
    if (inputs.text_l !== undefined) inputs.text_l = prompt;
  } else if (!Array.isArray(inputs.text)) {
    // 普通 CLIPTextEncode：`text` 就是提示词（除非它是一条连线）。
    inputs.text = prompt;
  }
}

/**
 * 从用户导入的 ComfyUI 工作流（API 格式）构建成图。
 *
 * 按节点检测自动注入：prompt/negative 进第一对 CLIPTextEncode，steps/cfg/seed/
 * sampler/scheduler/checkpoint 进对应节点（存在时）。这样一张原样的
 * "Export (API Format)" 图不必手工改就能换提示词复用。
 *
 * 这条通路**不做** `__PROMPT__` / `__SEED__` 这类 token 替换 —— 那套占位符
 * 是与内置模板一起移除的「模板作者约定」，导入的工作流按 `paramMap` /
 * 节点检测下发，或由工坊的对外封装逐端口派值。
 */
export function buildCustomWorkflow(
  graph: Record<string, unknown>,
  params: GenerateParams,
  paramMap?: ParamMap | null,
): Record<string, unknown> {
  const out = JSON.parse(JSON.stringify(graph)) as Record<string, unknown>;
  // 优先用用户给的角色映射，没有就回落到自动识别。
  const map: ParamMap =
    paramMap && Object.keys(paramMap).length ? paramMap : detectParamMap(out);
  /* 只有在明确传了 prompt/negative 时才覆盖 —— 否则「自带提示词」的工作流必须
   * 保留它（旧代码会把它清成 ""）。 */
  if (
    map.positiveNode &&
    out[map.positiveNode] &&
    params.prompt !== undefined
  ) {
    setPromptText(asGraphNode(out[map.positiveNode]), params.prompt);
  }
  if (
    map.negativeNode &&
    out[map.negativeNode] &&
    params.negative !== undefined
  ) {
    setPromptText(asGraphNode(out[map.negativeNode]), params.negative);
  }

  if (params.checkpoint && map.checkpointNode) {
    const ck = asGraphNode(out[map.checkpointNode]);
    const inputs = ck?.inputs;
    if (inputs?.ckpt_name !== undefined) inputs.ckpt_name = params.checkpoint;
  }

  const seedNum = params.seed;
  if (map.samplerNode) {
    const samplerNode = asGraphNode(out[map.samplerNode]);

    if (samplerNode?.inputs) {
      const inputs = samplerNode.inputs;

      if (typeof params.steps === "number") inputs.steps = params.steps;

      if (typeof params.cfg === "number") inputs.cfg = params.cfg;
      /* KSampler 用 `seed`，KSamplerAdvanced 用 `noise_seed`。
       * 注意：seed=0 是合法且有意义的值 —— 旧的 `> 0` 判断会把它丢掉。 */

      const seedKey =
        samplerNode.class_type === "KSamplerAdvanced" ? "noise_seed" : "seed";

      if (typeof seedNum === "number" && !Number.isNaN(seedNum)) {
        inputs[seedKey] = clampSeed(seedNum);
      }

      if (params.sampler) inputs.sampler_name = params.sampler;

      if (params.scheduler) inputs.scheduler = params.scheduler;
    }
  }
  /* 把上游生成的（或手动上传的）图片喂进工作流的 LoadImage 节点，
   * 让「图生图」这类链路开箱即用。 */
  if (params.inputImage && map.inputImageNode) {
    const inputNode = asGraphNode(out[map.inputImageNode]);
    if (inputNode?.inputs) inputNode.inputs.image = params.inputImage;
  }
  /* 应用用户挑出来的暴露引脚值（动态表单）。它们优先于上面的自动注入，
   * 因此显式设过的引脚一定会生效。
   * 数值强转：ComfyUI 不接受数值输入收到字符串，所以当该引脚原本就是数字时，
   * 把「看起来像数字的字符串」强转成数字。 */
  if (params.workflowInputs && Array.isArray(params.workflowInputs)) {
    for (const it of params.workflowInputs) {
      const node = asGraphNode(out[it.nodeId]);

      if (!node?.inputs) continue;

      const value = it.value;

      if (value === undefined) continue;

      const cur = node.inputs[it.name];

      node.inputs[it.name] = coerceApiInputValue(cur, value);
    }
  }
  // 有 LoRA 时重连 model/clip（自定义工作流同样适用）。
  if (params.loras?.length) {
    const { baseModel, baseClip, lastLora } = injectLoras(out, params.loras);
    if (lastLora) rewireLoaders(out, baseModel, baseClip, lastLora);
  }

  return out;
}
