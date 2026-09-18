import type { Node } from "@xyflow/react";
import type { ValidationError } from "~/lib/comfyui/validation";
import { DEFAULT_SIZE_SPEC, type SizeSpec } from "~/lib/media/size-presets";

/* ── Canvas node model ── */

export type NodeKind =
  | "image"
  | "video"
  | "script"
  | "agent"
  | "workflow"
  | "text"
  | "picture"
  | "movie";

/* Which parameters a given model exposes in its node UI.
 * Different models → different param sets.  The node renders only the params
 * listed here, in the order they appear, so swapping models updates the form
 * dynamically. */
export interface ModelParamSchema {
  prompt?: boolean;
  negative?: boolean;
  size?: boolean; // image resolution OR video resolution
  ratio?: boolean; // aspect ratio chip
  duration?: boolean; // video length in seconds
  steps?: boolean;
  cfg?: boolean;
  seed?: boolean;
  frames?: boolean; // video
  fps?: boolean; // video
}

/**
 * 画布逻辑节点的**严格字段声明**（不含索引签名）。
 *
 * 为什么拆成「严格声明 + 兼容类型」两层（ISSUE #320）：
 *
 * ReactFlow 的 `Node<T>` 要求 `T extends Record<string, unknown>`，所以交给
 * ReactFlow 的数据类型必须带索引签名。但索引签名会让**字段名写错也编译通过**
 * （`d.promt` 被解析成 `unknown`）——顶层类型检查里那层「保险」是假的：
 * 过去 14 个画布文件全靠它蒙混，拼错字段名要到运行时才炸。
 *
 * 因此拆开：
 *   - `StrictCanvasNodeData`（本接口）：**所有画布业务代码用这个**。字段少写、
 *     名字拼错、类型用错都会在 tsc 阶段报错（含 "Did you mean" 提示）。
 *   - `CanvasNodeData`（下方 `type`）：仅用于**交给 ReactFlow 类型参数**的位置
 *     （`Node<CanvasNodeData, …>` / `CanvasNodeType`）。它 = 严格声明 +
 *     `Record<string, unknown>` 兼容面。
 *   - 需要在 ReactFlow 与业务之间搬运数据时，走 `asCanvasNodeData()` 收口
 *     （单点断言，替代散落的 `as unknown as`）。
 *
 * 不使用「裸索引签名放在声明体里 + 靠人自觉」：那正是本次要修掉的状态。
 */
export interface StrictCanvasNodeData {
  kind: NodeKind;
  status: "idle" | "running" | "done" | "error";
  error?: string;
  /** 0..100 generation progress surfaced by pollTask
   *  from /api/tasks/[id].task.progress; consumed by ContentAssetBody's
   *  WaterFillProgress overlay while status === "running". Resets to 0 at
   *  the start of each run; cleared by leaving "running" (done/error catch
   *  paths leave it stale — overlay is gated by status, so it's hidden). */
  progress?: number;
  /** Selected model id —— 工坊起来之后模型不再由画布挑（选的是工作流库工作流），
   *  这个字段只剩「用户在旧版本里选过什么」的历史值，**新的默认值恒为空串**。 */
  model: string;

  // image / video common
  prompt: string;
  negative: string;
  mode: string; // image: txt2img | img2img ; video: t2v | i2v | flf
  /** 尺寸表达（比例 + 分辨率 / 比例 + 百万像素 + 倍数，见 `lib/size-presets`）。
   *
   *  发往只认字符串的老接口时才折算成 "WxH"（`sizeSpecToWxH`）；工作流节点的尺寸本来就由
   *  它自己暴露的尺寸口决定（画布上的组合控件走同一套尺寸表），这个字段只服务
   *  「没选工作流」的内置通道。
   *
   *  旧数据（localStorage v1）里存的是 "1024x1024" 这类 WxH 字符串 —— 读的时候
   *  统一走 `toSizeSpec` 归一，不要假定它一定是对象。 */
  size: SizeSpec;
  steps: number;
  cfg: number;
  seed: string;
  // video only
  frames: number;
  fps: number;
  // uploaded references (ComfyUI input filenames)
  inputImage?: string;
  firstFrame?: string;
  lastFrame?: string;

  // chaining: id of the upstream node this inputImage was auto-fed from
  upstreamId?: string;

  // result
  taskId?: string;
  resultPath?: string;
  resultMediaType?: string;
  /** Backend task status that triggered the last `error` state; null when
   *  the error came from a client-side exception (no task ever started) or
   *  from `requestFailure` upstream (network/CORS/etc.). */
  errorStatus?: "FAILED" | "CANCELLED" | "ERROR" | "TIMEOUT" | null;
  /** Structured context for the error panel.
   *  `request` = exact request payload that was sent to /api/generate
   *  (mirrored from pollTask().params on the failure path).
   *  `timestamp` = ISO client-side time of the failure patch.
   *  Stored on d so the canvas JSON-serializes it into the persisted
   *  project and survives reloads. */
  errorContext?: { request?: unknown; timestamp?: string };

  /** structured ComfyUI /prompt validation errors
   *  (flattened `node_errors`), surfaced in the canvas error panel as a
   *  precise per-field list so the user can locate the bad input. Plumbed
   *  from `pollTask().validationErrors`. */
  validationErrors?: ValidationError[];

  // script node
  theme: string;
  scriptText?: string;

  // agent node
  agentHistory: { role: "user" | "assistant"; content: string }[];
  agentReply?: string;
  agentReady?: boolean;
  agentSpec?: {
    prompt: string;
    negative?: string;
    kind?: "image" | "video";
    params?: {
      steps?: number;
      cfg?: number;
      sampler?: string;
      scheduler?: string;
      size?: string;
    };
  };

  // workflow node (user-uploaded ComfyUI workflow)
  workflowId?: string;
  /** 该工作流的「对外参数 → 节点端口」映射（paramMap.source）。
   *  运行期据此决定用户值落到哪个端口；未连线仍走默认值兜底。 */
  paramMap?: Record<string, unknown>;
  workflowName?: string;
  workflowTaskType?: string;
  /** Dynamic form values keyed by ioKey (`${nodeId}::${kind}::${name}`), driven by the workflow's exposed IO. */
  workflowInputs?: Record<string, unknown>;
  /** Downstream node auto-spawned for this workflow's output (so we only create it once). */
  workflowSinkId?: string;
  /** 生图/生成视频三步级联的「模型」步骤所选模型标签名
   *  （与 WorkflowNode 的 modelFilter 同源，均来自 WorkflowModelTag 名称）。
   *  工作流按 taskType + 该标签严格匹配。仅 image/video 节点在级联流程中使用。 */
  genModelTag?: string;
  /** Per-pin seed "control after generate" mode, keyed by ioKey.
   *  Values: "fixed" | "increment" | "decrement" | "random".  Captured from
   *  the canvas seed popover; forwarded to /api/generate so the backend can
   *  map it onto ComfyUI's widgets_values control_after_generate slot. */
  seedModes?: Record<string, string>;

  // ── Content-carrier nodes (text / picture / movie) ──
  /** Free text entered by the user on a `text` node; fed to downstream prompt/negative ports. */
  content?: string;
  /** Original filename of the uploaded asset (picture/movie), shown in the card header. */
  mediaName?: string;
  /** ComfyUI input-dir filename produced by `/api/upload` (already a valid LoadImage/LoadVideo source). */
  mediaPath?: string;
  /** Discriminator: picture → image, movie → video. */
  mediaKind?: "image" | "video";
}

/** ReactFlow 要求 `data` 可索引；这是**唯一**允许挂索引签名的地方。 */
export type CanvasNodeData = StrictCanvasNodeData & Record<string, unknown>;

/**
 * 把 ReactFlow 上的 `node.data`（兼容面）收口成严格声明。
 *
 * 为什么需要它：`Node<CanvasNodeData>` 的 `data` 类型仍是宽索引面，直接读
 * `node.data.prompt` 会得到 `unknown`。过去各文件用 `as unknown as NodeData`
 * 各自绕开——断言散落、改字段无人发现。这里集中一处收口：
 *   - 输入是运行时真实数据（ReactFlow 给的对象），断言在此是**唯一**的；
 *   - 输出是严格类型，下游字段访问全部受类型检查保护。
 *
 * 收口不做运行时校验（画布数据由本应用写入、结构自持），因此单点断言是
 * 恰当的成本——继续保留零散断言才是问题。
 */
export function asCanvasNodeData(data: unknown): StrictCanvasNodeData {
  return data as StrictCanvasNodeData;
}

/** ReactFlow 节点联合：逻辑节点（canvasNode）与纯视觉节点（workflowArdot）。 */
export type CanvasNodeType =
  | Node<CanvasNodeData, "canvasNode">
  | Node<Record<string, never>, "workflowArdot">;

/** 类型守卫：是否是带 CanvasNodeData 的逻辑节点（排除 workflowArdot 纯视觉节点）。 */
export function isCanvasNode(
  node: CanvasNodeType,
): node is Extract<CanvasNodeType, { type: "canvasNode" }> {
  return node.type === "canvasNode";
}

/* ── Sizes ──
 *  尺寸不再有「画布专用候选表」：全项目只有两种表达（比例 + 分辨率 /
 *  比例 + 百万像素 + 倍数），档位与换算都在 `lib/size-presets`。节点数据里存的是
 *  尺寸表达本身（`CanvasNodeData.size`），由工作流封装层逐端口派值。 */

/* ── Node palette metadata ── */
export const NODE_META: Record<
  NodeKind,
  {
    label: string;
    icon: string;
    color: string;
    desc: string;
    /** Single-character type indicator shown in the top-left circle of every node (header + result). */
    typeChar: string;
  }
> = {
  image: {
    label: "生图",
    icon: "image",
    color: "#8B5CF6",
    desc: "文生图 / 图生图",
    typeChar: "I",
  },
  video: {
    label: "生视频",
    icon: "film",
    color: "#22D3EE",
    desc: "文生视频 / 图生视频 / 首尾帧",
    typeChar: "V",
  },
  script: {
    label: "生成剧本",
    icon: "filetext",
    color: "#F59E0B",
    desc: "一句话扩写为分镜剧本",
    typeChar: "T",
  },
  agent: {
    label: "Agent 模式",
    icon: "bot",
    color: "#34D399",
    desc: "多轮对话引导创作",
    typeChar: "A",
  },
  workflow: {
    label: "自定义工作流",
    icon: "puzzle",
    color: "#A78BFA",
    desc: "运行你上传的 ComfyUI 工作流",
    typeChar: "W",
  },
  text: {
    label: "文本",
    icon: "filetext",
    color: "#FBBF24",
    desc: "输入提示词 / 参考文字",
    typeChar: "T",
  },
  picture: {
    label: "图片",
    icon: "image",
    color: "#FB7185",
    desc: "上传图片作为参考图",
    typeChar: "P",
  },
  movie: {
    label: "视频",
    icon: "film",
    color: "#818CF8",
    desc: "上传视频作为参考帧",
    typeChar: "V",
  },
};

/** Human-readable labels for the status badge shown on the node header + result card. */
export const STATUS_LABEL: Record<CanvasNodeData["status"], string> = {
  idle: "待开始",
  running: "生成中…",
  done: "运行后生成",
  error: "生成失败",
};

/** Build a fresh node-data object for the given kind. */
export function defaultData(kind: NodeKind): CanvasNodeData {
  const base: CanvasNodeData = {
    kind,
    status: "idle",
    model: "",
    prompt: "",
    negative: "",
    mode: kind === "video" ? "T2V" : "T2I",
    /* 尺寸默认取尺寸表：图片 1:1 1k（= 1024×1024，与旧默认一致）、
     * 视频 16:9 1k（视频场景表 → 1280×720）。 */
    size: {
      ...DEFAULT_SIZE_SPEC,
      ratio: kind === "video" ? "16:9 横屏" : "1:1 正方",
    },
    steps: kind === "video" ? 25 : 25,
    cfg: kind === "video" ? 6 : 7,
    seed: "",
    content: "",
    frames: 49,
    fps: 16,
    theme: "",
    agentHistory: [],
    workflowInputs: {},
  };
  return base;
}
