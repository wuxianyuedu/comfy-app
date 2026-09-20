// ── 历史详情弹窗：派生计算（规范 17 §17.2 第①层：纯函数，无 React）────────────
// 原先这些计算内联在 HistoryDetailModal 的 JSX 里（三个 IIFE 共 ~200 行），
// 既无法单测也让视图无法重生成。抽到这里后：视图只负责排版，规则改动有测试兜底。
//
// 参数区的口径（本次整理）：
//   · **不再有「独立」的提示词块与「生成参数」卡** —— 它们显示的东西与下面的
//     参数表重复（同一句提示词出现两次），且卡片只认一小撮硬编码键名；
//   · **按来源分块**：工坊发起的任务把「工坊参数」（工坊对外值）单独摆一块，
//     工作流下发的 IO 参数摆另一块；工作流直接发起的任务只有后者；
//   · **参数名要可读**：历史里存的只有 pin 名（`text` / `aspect_ratio` /
//     `megapixels`），那是 ComfyUI 的程序名；作者在工作流库里改过的名字
//     （「宽高比」「百万像素」）存在 `workflowIO` 的 `label` 上，任务本身没有
//     快照它，只能按 `params.workflow` 现查（见 `resolveParamLabel`）。

import { asRecord } from "~/lib/is-record";
import type { WorkflowIOMap } from "~/lib/workflow/workflow-io-types";
import type { TaskDetail } from "./history-types";

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

function isBlank(v: unknown): boolean {
  return v === undefined || v === null || v === "";
}

/** 取 detail.params（always object，缺失时给空对象）。 */
function paramsOf(detail: TaskDetail | null): Record<string, unknown> {
  return asRecord(detail?.params) ?? {};
}

/** 取 params.workflowInputs，非数组时给空数组。 */
export function workflowInputsOf<T extends { name: string }>(
  detail: TaskDetail | null,
): T[] {
  const raw: unknown = paramsOf(detail).workflowInputs;
  return Array.isArray(raw) ? (raw as T[]) : [];
}

/**
 * 本次任务用的工作流 id（`params.workflow`）—— 查参数可读名要用它。
 * 非字符串 / 空串时返回 `null`（调用方据此不查）。
 */
export function taskWorkflowId(detail: TaskDetail | null): string | null {
  const value = paramsOf(detail).workflow;
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** 这次任务是哪个入口发起的。 */
export type TaskOrigin = "workshop" | "workflow";

/**
 * 工坊链路的**对外值**会作为顶层键落进 `params` —— 这是「工坊发起」与
 * 「工作流直接发起」在现有数据里唯一的形状差异（DB 没有来源列：
 * `generate.generate` 把整个入参对象直接当 `params` 落库）。
 *
 * 反面：工作流库的就地运行只带 `workflow` + `workflowInputs`；画布节点运行
 * 再多个 `projectId`。两者都算「工作流直接发起」，只显示工作流参数。
 */
const WORKSHOP_TOP_LEVEL_KEYS = [
  "prompt",
  "negative",
  "firstFrame",
  "lastFrame",
  "frames",
] as const;

export function deriveTaskOrigin(detail: TaskDetail | null): TaskOrigin {
  const params = paramsOf(detail);
  return WORKSHOP_TOP_LEVEL_KEYS.some((key) => !isBlank(params[key]))
    ? "workshop"
    : "workflow";
}

/** 工坊对外值在历史里的展示名（键即 `/api/generate` 的入参名）。 */
const WORKSHOP_PARAM_LABELS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "prompt", label: "正向提示词" },
  { key: "negative", label: "反向提示词" },
  { key: "firstFrame", label: "首帧图" },
  { key: "lastFrame", label: "尾帧图" },
  { key: "frames", label: "帧数" },
];

/** 一行「工坊参数」。 */
export interface WorkshopParamRow {
  id: string;
  label: string;
  value: unknown;
}

/** 工坊参数：工坊对外值里**真的落到 params 顶层**的那几项。 */
export function deriveWorkshopParams(
  detail: TaskDetail | null,
): WorkshopParamRow[] {
  const params = paramsOf(detail);
  const out: WorkshopParamRow[] = [];
  for (const { key, label } of WORKSHOP_PARAM_LABELS) {
    const value = params[key];
    if (isBlank(value)) continue;
    out.push({ id: key, label, value });
  }
  return out;
}

/** 一行「工作流参数」（下发给工作流的 IO 端口）。 */
export interface WorkflowParamRow {
  id: string;
  /** 原始 pin 名（`workflowInputs[].name`）。 */
  name: string;
  /** 展示名：工作流 IO 的作者标签，查不到时回退 `name`。 */
  label: string;
  value: unknown;
}

/**
 * pin 名 → 可读名：按 `nodeId::widget::name` 在工作流 IO 里查作者标签。
 *
 * 三档匹配，逐档放宽：精确 ioKey → 同 `name` 的任意节点 → 原始 `name`。
 * 放宽是必要的：子图里的条目在运行期用的是 `host:inner` 形态的节点 id，
 * 与落库时写进 `workflowInputs[].nodeId` 的那个未必逐字相同。
 *
 * `io` 可能为 `null`（工作流已被删除 / 详情还没回来）—— 此时**不能编**，
 * 如实显示 pin 名。
 */
export function resolveParamLabel(
  input: { nodeId?: string; name: string },
  io: WorkflowIOMap | null | undefined,
): string {
  const entry = findIoEntry(io, input.nodeId, input.name);
  /* 空串要当「没给标签」处理（作者把名字清空时不能显示空白行）。 */
  const label = entry?.label?.trim() ?? "";
  return label === "" ? input.name : label;
}

function findIoEntry(
  io: WorkflowIOMap | null | undefined,
  nodeId: string | undefined,
  name: string,
): { label?: string } | null {
  if (!io) return null;
  if (nodeId) {
    const exact =
      io[`${nodeId}::widget::${name}`] ?? io[`${nodeId}::input::${name}`];
    if (exact) return exact;
  }
  const suffix = `::widget::${name}`;
  for (const [key, entry] of Object.entries(io)) {
    if (key.endsWith(suffix)) return entry;
  }
  return null;
}

/**
 * 工作流参数表 + 原始 JSON 区块的数据。
 *
 * **不再过滤 `seed` / `steps` / `cfg` 这类键**：那条过滤是为了躲开上面那张
 * 「生成参数卡」的重复（卡已删除），而过滤本身会让种子这类关键参数从参数表里
 * 凭空消失。
 */
export function deriveWorkflowParams(
  detail: TaskDetail | null,
  io: WorkflowIOMap | null | undefined,
): {
  rows: WorkflowParamRow[];
  topLevelEntries: Array<[string, unknown]>;
  hasAny: boolean;
} {
  const params = paramsOf(detail);
  const rows = workflowInputsOf<{
    nodeId?: string;
    name: string;
    value: unknown;
  }>(detail).map((input, index) => ({
    id: `${input.nodeId ?? "?"}:${input.name}:${index}`,
    name: input.name,
    label: resolveParamLabel(input, io),
    value: input.value,
  }));
  const topLevelEntries = Object.entries(params).filter(
    ([key]) => key !== "workflowInputs",
  );
  return {
    rows,
    topLevelEntries,
    hasAny: rows.length > 0 || topLevelEntries.length > 0,
  };
}
