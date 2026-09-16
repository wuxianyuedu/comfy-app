// ── LoRA 训练工作室：配置层（规范 17 §17.2 第①层）──────────────────────────
// 类型、表单默认值、选项表与纯派生函数。原先这些内容散落在 TrainingStudio.tsx
// 的 700 行里与网络和状态混写；抽出来后视图只剩渲染，表单校验与 loss 曲线
// 这两块业务逻辑可以脱离 React 直接单测。

export type ModelOpt = { id: string; fileName: string; name: string };

export type TrainLogEntry = { t: number; level: string; msg: string };

export type TrainJobStatus =
  "QUEUED" | "RUNNING" | "DONE" | "FAILED" | "CANCELLED";

export type TrainJob = {
  id: string;
  name: string;
  baseModel: string;
  triggerWord: string;
  classWord: string | null;
  datasetImages: { name: string; caption?: string }[];
  resolution: number;
  steps: number;
  batchSize: number;
  learningRate: number;
  rankDim: number;
  networkAlpha: number;
  optimizer: string;
  scheduler: string;
  seed: number;
  status: TrainJobStatus;
  progress: number;
  outputName: string | null;
  logs: TrainLogEntry[] | null;
  error: string | null;
  createdAt: string;
};

/** 表单里一张数据集图片（文件名 + 用户填的 caption）。 */
export interface DatasetItem {
  name: string;
  caption: string;
}

/** 提交给后端的训练参数（与 train.create 的入参一致）。 */
export interface TrainJobInput {
  name: string;
  baseModel: string;
  triggerWord: string;
  classWord?: string;
  datasetImages: { name: string; caption: string }[];
  resolution: number;
  steps: number;
  batchSize: number;
  learningRate: number;
  rankDim: number;
  networkAlpha: number;
  optimizer: string;
  scheduler: string;
  seed: number;
}

/** 任务列表的轮询间隔。 */
export const JOBS_POLL_MS = 4000;

export const OPTIMIZERS = ["AdamW8bit", "AdamW", "Lion", "SGD"];
export const SCHEDULERS = [
  "cosine",
  "constant",
  "linear",
  "constant_with_warmup",
];
export const RESOLUTIONS = [512, 768, 1024];

/** 表单默认值：提交成功后会重置回这些值（原组件行为，不可改）。 */
export const DEFAULTS = {
  steps: 1500,
  batchSize: 4,
  learningRate: 0.0001,
  rankDim: 32,
  networkAlpha: 16,
  optimizer: "AdamW8bit",
  scheduler: "cosine",
  seed: 0,
  resolution: 512,
} as const;

export const STATUS_META: Record<
  TrainJobStatus,
  { label: string; cls: string }
> = {
  QUEUED: { label: "等待中", cls: "text-ink-soft bg-surface-2" },
  RUNNING: {
    label: "训练中",
    cls: "text-violet-700 dark:text-violet-300 bg-violet-500/15",
  },
  DONE: {
    label: "已完成",
    cls: "text-emerald-700 dark:text-emerald-300 bg-emerald-500/15",
  },
  FAILED: {
    label: "失败",
    cls: "text-red-700 dark:text-red-300 bg-red-500/15",
  },
  CANCELLED: {
    label: "已取消",
    cls: "text-amber-700 dark:text-amber-300 bg-amber-500/15",
  },
};

/** 未知状态（后端新增枚举）一律按「等待中」渲染，不崩、不留空白。 */
export function statusMeta(status: string): { label: string; cls: string } {
  return STATUS_META[status as TrainJobStatus] ?? STATUS_META.QUEUED;
}

/**
 * 当前监控卡片要展示的任务：进行中 > 排队中 > 列表首条。
 * 原组件里的 `useMemo` 派生，抽成纯函数后可直接断言优先级。
 */
export function pickActiveJob(jobs: TrainJob[]): TrainJob | null {
  return (
    jobs.find((job) => job.status === "RUNNING") ??
    jobs.find((job) => job.status === "QUEUED") ??
    jobs[0] ??
    null
  );
}

/**
 * 提交前的表单校验。返回第一条错误的文案；通过则返回 null。
 * 顺序即原组件的提示顺序（名称 → 底模 → 触发词 → 数据集）。
 */
export function validateTrainForm(
  form: Pick<
    TrainJobInput,
    "name" | "baseModel" | "triggerWord" | "datasetImages"
  >,
): string | null {
  if (!form.name.trim()) return "请填写任务名称";
  if (!form.baseModel) return "请选择底模（Checkpoint）";
  if (!form.triggerWord.trim()) return "请填写触发词";
  if (form.datasetImages.length === 0) return "请至少上传一张数据集图片";
  return null;
}

/**
 * 把空白 caption 用触发词填满——单概念 LoRA 训练的常见捷径。
 * 触发词为空时原样返回（原组件里按钮此时也是禁用的）。
 */
export function fillBlankCaptions(
  items: DatasetItem[],
  triggerWord: string,
): DatasetItem[] {
  const tw = triggerWord.trim();
  if (!tw) return items;
  return items.map((item) => ({
    ...item,
    caption: item.caption.trim() ? item.caption : tw,
  }));
}

/** 提交给后端的图片列表：caption 统一去空白（原组件行为）。 */
export function toDatasetPayload(
  items: DatasetItem[],
): { name: string; caption: string }[] {
  return items.map((item) => ({
    name: item.name,
    caption: item.caption.trim(),
  }));
}

/* ── Loss 曲线的合成几何（设计稿固定形状，与真实训练数据无关）── */

export interface LossGeometry {
  W: number;
  H: number;
  train: string;
  val: string;
}

/** 训练/验证两条 SVG path。纯函数，无随机、无网络，可快照测试。 */
export function buildLossGeometry(
  W = 320,
  H = 120,
  pad = 12,
  n = 26,
): LossGeometry {
  const train: string[] = [];
  const val: string[] = [];
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1);
    const base = 1.0 - 0.82 * Math.pow(x, 0.62);
    const noise = Math.sin(i * 1.7) * 0.018 + Math.cos(i * 0.9) * 0.012;
    const ty = Math.max(0.02, base + noise);
    const vy = Math.max(0.04, base * 0.96 + 0.06 + noise * 0.6);
    const px = pad + x * (W - 2 * pad);
    const pty = H - pad - ty * (H - 2 * pad);
    const pvy = H - pad - vy * (H - 2 * pad);
    train.push(`${i === 0 ? "M" : "L"}${px.toFixed(1)} ${pty.toFixed(1)}`);
    val.push(`${i === 0 ? "M" : "L"}${px.toFixed(1)} ${pvy.toFixed(1)}`);
  }
  return { W, H, train: train.join(" "), val: val.join(" ") };
}
