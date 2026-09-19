// ── 历史详情弹窗：派生计算（规范 17 §17.2 第①层：纯函数，无 React）────────────
// 原先这些计算内联在 HistoryDetailModal 的 JSX 里（三个 IIFE 共 ~200 行），
// 既无法单测也让视图无法重生成。抽到这里后：视图只负责排版，规则改动有测试兜底。

import type { TaskDetail } from "./history-types";

/** 一条展示用生成参数（种子/步数/CFG…）。 */
export interface GenValue {
  label: string;
  value: unknown;
  /** 取值来源说明（如「本次执行真实使用值」）。 */
  hint?: string;
}

/**
 * 参数值 → 展示文本。字符串 / 数字直接 `String()`，其余（数组 / 对象 /
 * 布尔）走 `JSON.stringify`。两种写法此前在「生成参数卡」与「参数表」
 * 各有一份逐字相同的三元 —— 收进这里，改一处即可。
 */
export function kvValueText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number")
    return String(value);
  return JSON.stringify(value);
}

/** 参数表的一行。 */
export interface ParamRow {
  nodeId?: string;
  name: string;
  value: unknown;
}

/**
 * 常见生成参数的展示顺序与候选键。
 * 同 label 多个源按优先级合并：params > workflowInputs > workflowHints/coverImage。
 */
const GEN_ORDER: Array<{ keys: string[]; label: string }> = [
  { keys: ["seed", "noise_seed", "image_seed"], label: "种子" },
  { keys: ["steps"], label: "步数" },
  { keys: ["cfg"], label: "CFG" },
  { keys: ["sampler_name", "sampler"], label: "采样器" },
  { keys: ["scheduler"], label: "调度器" },
  { keys: ["denoise"], label: "去噪" },
  { keys: ["size", "width"], label: "尺寸" },
];

/** 已从生成参数卡移除的键（避免参数表里再重复一遍）。 */
const GEN_KEYS_LOWER = new Set(
  GEN_ORDER.flatMap((entry) => entry.keys).map((key) => key.toLowerCase()),
);

/** workflowHints 的形状（来自 /api/tasks/[id] 的子字段，可能是任意 JSON）。 */
export interface WorkflowHints {
  steps?: number;
  cfg?: number;
  sampler_name?: string;
  scheduler?: string;
  denoise?: number;
  width?: number;
  height?: number;
  seed?: number;
  seedSource?: "history" | "subgraph" | "top" | "request" | null;
}

/** 把任意值收窄成 workflowHints；非对象返回空对象（视图按「没有提示」处理）。 */
export function toWorkflowHints(value: unknown): WorkflowHints {
  if (typeof value === "object" && value !== null) return value;
  return {};
}

function isBlank(v: unknown): boolean {
  return v === undefined || v === null || v === "";
}

/** 取 detail.params（always object，缺失时给空对象）。 */
function paramsOf(detail: TaskDetail | null): Record<string, unknown> {
  const p: unknown = detail?.params;
  if (typeof p === "object" && p !== null) return p as Record<string, unknown>;
  return {};
}

/** 取 params.workflowInputs，非数组时给空数组。 */
export function workflowInputsOf<T extends { name: string }>(
  detail: TaskDetail | null,
): T[] {
  const raw: unknown = paramsOf(detail).workflowInputs;
  return Array.isArray(raw) ? (raw as T[]) : [];
}

/**
 * 从任务详情里取出要展示的提示词。
 * 工作流任务的 prompt 存在 params.workflowInputs[].value（name 为
 * text/prompt/positive）而不是 detail.prompt——以前取空就显示「—」，
 * 用户以为数据没显示全。故 prompt 为空时回落到 workflowInputs 里的同义字段，
 * 返回值为最终要展示的文本（视图不再做二次兜底）。
 */
export function derivePrompt(detail: TaskDetail | null): {
  prompt: string;
  negativePrompt: string;
  /** 有内容才展示正向提示词区块。 */
  showPrompt: boolean;
} {
  const inputs = workflowInputsOf<{ name: string; value: unknown }>(detail);
  const hit = inputs.find(
    (input) =>
      input.name === "text" ||
      input.name === "prompt" ||
      input.name === "positive",
  );
  const fallbackPrompt = hit && typeof hit.value === "string" ? hit.value : "";
  const prompt = detail?.prompt ?? fallbackPrompt;
  return {
    prompt,
    negativePrompt: detail?.negativePrompt ?? "",
    showPrompt: prompt.length > 0,
  };
}

/**
 * 生成参数卡：seed/steps/cfg/sampler/scheduler/denoise/size。
 *
 * 有些工作流把 steps/cfg 等硬编码在 subgraph 的 KSampler 节点里，
 * 从不暴露给用户、也写不进 params——故再从 workflowHints 回填这些非随机字段。
 * seed 优先用 workflowHints.seed（后端从 ComfyUI history 抽的真值），
 * 并在 hint 里标明来源，区分「真值 / 用户填值 / 默认值」。
 */
export function deriveGenValues(
  detail: TaskDetail | null,
  workflowHints: unknown,
): GenValue[] {
  if (!detail) return [];
  const params = paramsOf(detail);
  const inputs = workflowInputsOf<{
    nodeId?: string;
    name: string;
    value: unknown;
  }>(detail);
  const wf = toWorkflowHints(workflowHints);
  const images = detail.images ?? [];
  const coverImage =
    images.length > 0 ? (images.find((im) => im.isCover) ?? images[0]) : null;
  const coverSize =
    coverImage?.width && coverImage.height
      ? `${coverImage.width}×${coverImage.height}`
      : undefined;

  const findVal = (keys: string[]): unknown => {
    for (const key of keys) {
      const value: unknown = params[key];
      if (!isBlank(value)) return value;
    }
    for (const key of keys) {
      const hit = inputs.find(
        (input) => String(input.name).toLowerCase() === key.toLowerCase(),
      );
      if (hit && !isBlank(hit.value)) return hit.value;
    }
    for (const key of keys) {
      if (key === "size") {
        if (wf.width && wf.height) return `${wf.width}×${wf.height}`;
        if (coverSize) return coverSize;
      } else if (
        key === "seed" &&
        coverImage?.seed != null &&
        String(coverImage.seed).trim() !== ""
      ) {
        return coverImage.seed;
      } else if (key in wf) {
        const value: unknown = wf[key as keyof WorkflowHints];
        if (!isBlank(value)) return value;
      }
    }
    return undefined;
  };

  const seen = new Set<string>();
  const out: GenValue[] = [];
  for (const { keys, label } of GEN_ORDER) {
    if (seen.has(label)) continue;
    const value = findVal(keys);
    if (value !== undefined) {
      out.push({ label, value });
      seen.add(label);
    }
  }

  if (wf.seed !== undefined) {
    const seedEntry = out.find((item) => item.label === "种子");
    if (seedEntry) {
      seedEntry.hint =
        wf.seedSource === "history"
          ? "本次执行真实使用值"
          : wf.seedSource === "request"
            ? "用户提交时填写的 seed"
            : undefined;
    }
  }
  return out;
}

/**
 * 参数表 + 原始 JSON 区块的数据。
 * 已出现在生成参数卡里的键会被过滤掉，避免两处重复展示。
 */
export function deriveParamRows(detail: TaskDetail | null): {
  rows: ParamRow[];
  topLevelEntries: Array<[string, unknown]>;
  hasAny: boolean;
} {
  const params = paramsOf(detail);
  const rows = workflowInputsOf<ParamRow>(detail).filter(
    (input) => !GEN_KEYS_LOWER.has(String(input.name).toLowerCase()),
  );
  const topLevelEntries = Object.entries(params).filter(
    ([k]) => k !== "workflowInputs",
  );
  return {
    rows,
    topLevelEntries,
    hasAny: rows.length > 0 || topLevelEntries.length > 0,
  };
}
