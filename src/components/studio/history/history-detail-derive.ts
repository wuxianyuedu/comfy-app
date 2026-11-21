// ── 历史详情弹窗派生计算（规范 17 §17.2 第①层：纯函数，无 React）──
// 原为 HistoryDetailModal JSX 里的三个 IIFE（约 200 行），无法单测；抽出后视图只排版、规则有测试兜底。
// 参数口径：不再有独立提示词块/生成参数卡（与参数表重复且只认硬编码键名）；按来源分块
//（工坊对外值 vs 工作流 IO 参数）；参数名可读 —— 历史只存 pin 名，作者标签在 workflowIO.label，
// 任务本身无快照，只能按 params.workflow 现查（resolveParamLabel）。

import { asRecord, isRecord } from "~/lib/is-record";
import { modeContractEntries, type ModeContract } from "~/lib/workshop/model-mode-contract";
import { upperToken } from "~/lib/upper-token";
import type { WorkflowIOMap } from "~/lib/workflow/workflow-io-types";
import type { TaskDetail } from "./history-types";

/**
 * 参数值 → 展示文本。字符串 / 数字直接 `String()`，其余（数组 / 对象 /
 * 布尔）走 `JSON.stringify`。两种写法此前在「生成参数卡」与「参数表」
 * 各有一份逐字相同的三元 —— 收进这里，改一处即可。
 */
export function kvValueText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
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
export function workflowInputsOf<T extends { name: string }>(detail: TaskDetail | null): Array<T> {
  const raw: unknown = paramsOf(detail).workflowInputs;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((item: unknown): item is T => isRecord(item) && typeof item.name === "string");
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
 * 工坊链路的对外值会作为顶层键落进 `params` —— 这是「工坊发起」与「工作流直接发起」现有数据里唯一的形状差异
 *（DB 没有来源列：generate.generate 把整个入参对象直接当 params 落库）。
 * 反面：工作流库就地运行只带 workflow + workflowInputs，画布节点运行再多个 projectId，都算工作流直接发起。
 */
/* SAFETY: 类型断言已复核 */
const WORKSHOP_TOP_LEVEL_KEYS = [
  "prompt",
  "negative",
  "firstFrame",
  "lastFrame",
  "frames",
] as const;

export function deriveTaskOrigin(detail: TaskDetail | null): TaskOrigin {
  const params = paramsOf(detail);
  return WORKSHOP_TOP_LEVEL_KEYS.some((key) => !isBlank(params[key])) ? "workshop" : "workflow";
}

/** 一行「工坊参数」（模式契约的一个对外口 + 该次任务落在它上面的值）。
 *  `value` 为 `undefined` 表示这个口本次没给值——仍占一行（契约配了几个口就显示几个）。 */
export type WorkshopParamRow = {
  id: string;
  label: string;
  value: unknown;
};

/** 契约口 id → params 顶层键的别名。工坊对外值落库时用的是 generate 入参名，
 *  与契约口 id 不完全同名（first-frame ↔ firstFrame、duration ↔ frames…）。 */
const PORT_TO_PARAM_KEYS: Record<string, ReadonlyArray<string>> = {
  prompt: ["prompt"],
  negative: ["negative"],
  "first-frame": ["firstFrame"],
  "last-frame": ["lastFrame"],
  duration: ["duration", "frames"],
  "reference-image": ["inputImage", "image"],
};

/** 「尺寸」口没有单一顶层值——工坊的尺寸被拆进 workflowInputs 的具体 pin。
 *  这几族 pin 名归它（作者连线用的程序名，中英文都兜）。 */
const SIZE_PIN_NAMES = new Set([
  "aspect_ratio",
  "aspect-ratio",
  "megapixels",
  "multiple",
  "width",
  "height",
  "resolution",
]);

type RawWorkflowInput = {
  name: string;
  nodeId?: string;
  value: unknown;
};

/** 解析一个契约口在本次任务里的值：顶层 params（含别名）→ 尺寸口按 size 族 pin
 *  聚合 → 同名 workflowInputs pin 兜底。都取不到返回 `undefined`（不臆造）。 */
function resolvePortValue(
  portId: string,
  params: Record<string, unknown>,
  inputs: Array<RawWorkflowInput>,
  io: WorkflowIOMap | null | undefined,
): unknown {
  const keys = PORT_TO_PARAM_KEYS[portId] ?? [portId];
  for (const key of keys) {
    if (!isBlank(params[key])) {
      return params[key];
    }
  }
  if (portId === "size") {
    const parts = inputs
      .filter((input) => SIZE_PIN_NAMES.has(input.name))
      .map((input) => `${resolveParamLabel(input, io)} ${kvValueText(input.value)}`);
    if (parts.length > 0) {
      return parts.join(" · ");
    }
  }
  const pin = inputs.find((input) => input.name === portId);
  if (pin && !isBlank(pin.value)) {
    return pin.value;
  }
  return undefined;
}

/** 工坊参数：按**该任务模式的生效契约口清单**逐个列出（含本次没给值的口），
 *  值从 params / workflowInputs 解析。契约来源与工坊封装页、工作流库画布卡片
 *  同一份（`modeContractEntries`），不再各写一份硬编码键名清单。 */
export function deriveWorkshopParams(
  detail: TaskDetail | null,
  mode: string | null | undefined,
  contracts: ReadonlyArray<ModeContract> | null | undefined,
  io: WorkflowIOMap | null | undefined,
): Array<WorkshopParamRow> {
  const params = paramsOf(detail);
  const inputs = workflowInputsOf<RawWorkflowInput>(detail);
  return modeContractEntries(mode, contracts).map((port) => ({
    id: port.id,
    label: port.label,
    value: resolvePortValue(port.id, params, inputs, io),
  }));
}

/** 一行「工作流参数」（下发给工作流的 IO 端口）。 */
export type WorkflowParamRow = {
  id: string;
  /** 展示名：工作流 IO 的作者标签，查不到时回退 `name`。 */
  label: string;
  /** 原始 pin 名（`workflowInputs[].name`）。 */
  name: string;
  value: unknown;
};

/**
 * pin 名 → 可读名：按 `nodeId::widget::name` 在工作流 IO 里查作者标签。
 * 三档逐级放宽：精确 ioKey → 同 name 任意节点 → 原始 name —— 子图运行期用 host:inner 节点 id，未必与落库的逐字相同。
 * `io` 可能为 null（工作流已删/详情未回），此时如实显示 pin 名，不能编。
 */
export function resolveParamLabel(
  input: { name: string; nodeId?: string },
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
  if (!io) {
    return null;
  }
  if (nodeId !== undefined && nodeId !== "") {
    const exact = io[`${nodeId}::widget::${name}`] ?? io[`${nodeId}::input::${name}`];
    if (exact) {
      return exact;
    }
  }
  const suffix = `::widget::${name}`;
  for (const [key, entry] of Object.entries(io)) {
    if (key.endsWith(suffix)) {
      return entry;
    }
  }
  return null;
}

/**
 * 工作流参数表 + 原始 JSON 区块的数据。不再过滤 seed / steps / cfg 等键 ——
 * 那条过滤是为躲开已删除的「生成参数卡」重复，却会让种子这类关键参数从表中凭空消失。
 */
export function deriveWorkflowParams(
  detail: TaskDetail | null,
  io: WorkflowIOMap | null | undefined,
): {
  hasAny: boolean;
  rows: Array<WorkflowParamRow>;
  topLevelEntries: Array<[string, unknown]>;
} {
  const params = paramsOf(detail);
  const rows = workflowInputsOf<{
    name: string;
    nodeId?: string;
    value: unknown;
  }>(detail).map((input, index) => ({
    id: `${input.nodeId ?? "?"}:${input.name}:${index}`,
    name: input.name,
    label: resolveParamLabel(input, io),
    value: input.value,
  }));
  const topLevelEntries = Object.entries(params).filter(([key]) => key !== "workflowInputs");
  return {
    rows,
    topLevelEntries,
    hasAny: rows.length > 0 || topLevelEntries.length > 0,
  };
}

/**
 * 参数表里「提示词」行的判据（ISSUE #4665）：这类值可能很长，展示格要定高滚动。
 * 工坊参数按契约口 id 判（`prompt`）；工作流参数只有 pin 名 —— 按常见命名兜底
 * （`prompt` / `positive_prompt`），`negative_prompt` 以 negative 开头、天然不命中。
 */
export function isPromptParamRow(id: string, name?: string | null): boolean {
  if (id === "prompt") {
    return true;
  }
  if (name === null || name === undefined) {
    return false;
  }
  return /^(?:positive[-_])?prompt/i.test(name.trim());
}

/* ── 「复制去重投」的 JSON 载荷（ISSUE #4769）────────────────────────────
 * 历史页把一次提交的**全部参数**折成一个 JSON 复制走，粘贴侧是「测试模型」
 * 的 JSON 输入模式：按 `mode` 切模式页签、把 `inputs` 逐键写回统一输入表单
 * 再生成。两半共用这份形状 —— 键是模式契约口 id（= 测试页表单值键），值统一
 * 字符串化（kvValueText）。 */

export type ReprintPayload = {
  /** 契约口 id → 该次提交落在口上的值（只含有值的口）。 */
  inputs: Record<string, string>;
  /** 任务的模式码（T2I / T2V …）；粘贴侧按它切模式页签。 */
  mode: string;
};

/** 尺寸族 pin 名 → 测试页表单值键。尺寸口在任务行里没有单一顶层值
 *（被封装拆进 workflowInputs 的具体 pin），聚合出的展示串没法反解回表单，
 * 所以这里逐 pin 展开；`width` / `height` 不是测试页承接的输入类型，不带。 */
const SIZE_PIN_TO_INPUT_TYPE: Record<string, string> = {
  "aspect-ratio": "aspect-ratio",
  aspect_ratio: "aspect-ratio",
  megapixels: "megapixels",
  multiple: "multiple",
  resolution: "resolution",
};

/**
 * 把一次提交的全部参数折成可粘贴重跑的 JSON 载荷。
 *
 * 口清单与值解析和详情弹窗的「工坊参数」表同一份派生
 *（`modeContractEntries` + `resolvePortValue`）—— 复制走的内容与用户在详情里
 * 看到的参数表一字不差，另抄一份键名清单必然漂移。尺寸口按 pin 展开
 * （见 `SIZE_PIN_TO_INPUT_TYPE`）；契约口一个值都没落上时（模式码认不出等），
 * 退回原始顶层参数，至少把提示词带走。
 */
export function buildReprintPayload(args: {
  contracts?: ReadonlyArray<ModeContract> | null;
  detail: TaskDetail;
  mode: string | null | undefined;
}): ReprintPayload {
  const params = paramsOf(args.detail);
  const inputs = workflowInputsOf<{ name: string; value: unknown }>(args.detail);
  const expandSizePins = (into: Record<string, string>): void => {
    for (const pin of inputs) {
      const type = SIZE_PIN_TO_INPUT_TYPE[pin.name];
      if (type !== undefined && !isBlank(pin.value)) {
        into[type] = kvValueText(pin.value);
      }
    }
  };
  const out: Record<string, string> = {};
  for (const port of modeContractEntries(args.mode, args.contracts)) {
    if (port.id === "size") {
      expandSizePins(out);
      continue;
    }
    const value = resolvePortValue(port.id, params, inputs, undefined);
    if (value !== undefined) {
      out[port.id] = kvValueText(value);
    }
  }
  /* 模式码认不出时 `exposedParamsForMode` 仍给内置口（至少提示词 / 负向），
   * 所以这里不另设「原始参数兜底」—— 不在契约口上的内部键（workflow /
   * runtime / checkpoint）本来就不该进载荷：粘贴侧（测试模型）消费的是
   * 契约口值，模型本身由用户在测试页重新挑。 */
  return { mode: upperToken(args.mode ?? ""), inputs: out };
}
