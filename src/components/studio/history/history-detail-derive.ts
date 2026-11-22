// ── 历史详情弹窗派生计算（规范 17 §17.2 第①层：纯函数，无 React）──
// 原为 HistoryDetailModal JSX 里的三个 IIFE（约 200 行），无法单测；抽出后视图只排版、规则有测试兜底。
// 参数口径：不再有独立提示词块/生成参数卡（与参数表重复且只认硬编码键名）；按来源分块
//（工坊对外值 vs 工作流 IO 参数）；参数名可读 —— 历史只存 pin 名，作者标签在 workflowIO.label，
// 任务本身无快照，只能按 params.workflow 现查（resolveParamLabel）。

import { asRecord, isRecord } from "~/lib/is-record";
import { modeContractEntries, type ModeContract } from "~/lib/workshop/model-mode-contract";
import { upperToken } from "~/lib/upper-token";
import {
  resolveEntryDefault,
  type WorkflowIOEntry,
  type WorkflowIOMap,
} from "~/lib/workflow/workflow-io-types";
import { splitWorkflowIO } from "../workflow-io";
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

/** 一行「工作流参数」（工作流 IO 的一个输入端口）。 */
export type WorkflowParamRow = {
  id: string;
  /** 展示名：工作流 IO 的作者标签，查不到时回退 `name`。 */
  label: string;
  /** 原始 pin 名（`workflowInputs[].name` / IO 条目的 `name`）。 */
  name: string;
  /** 值来源：本次提交 / 工作流 IO 默认值 —— 视图据此标注，避免把默认值误读成提交值。 */
  source: "submitted" | "default";
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
 * 一条 IO 输入端口在本次任务里有没有提交值。
 *
 * 先按 `nodeId + name` 精确匹配 `workflowInputs`（子图条目的 nodeId 是宿主:内部
 * 拼接形态，两种都试），再退化到 name（节点 id 因子图展开 / 工作流改版对不上时
 * 仍能认出来）；作者的 IO 标签也当别名接住，避免 pin 名与 IO 名不同名时漏配。
 * 顶层 `params` 里工坊直接传来的值同样接住 —— 作者没画线时它不会落进
 * `workflowInputs`，但用户确实传了，按「有传值就覆盖」的口径必须生效。
 *
 * 返回 `index` 供调用方排除已匹配的 pin，防止它作为多余行再出现一次。
 */
function submittedValueFor(
  entry: WorkflowIOEntry,
  params: Record<string, unknown>,
  inputs: Array<RawWorkflowInput>,
): { index: number; value: unknown } | null {
  const runtimeIds = new Set([entry.nodeId]);
  if (entry.hostNodeId) {
    runtimeIds.add(`${entry.hostNodeId}:${entry.nodeId}`);
  }
  const names = [entry.name, entry.label?.trim()].filter(
    (name): name is string => typeof name === "string" && name !== "",
  );
  let index = inputs.findIndex(
    (input) =>
      names.includes(input.name) && input.nodeId !== undefined && runtimeIds.has(input.nodeId),
  );
  if (index === -1 && entry.hostNodeId === undefined) {
    index = inputs.findIndex((input) => names.includes(input.name));
  }
  const matched = index === -1 ? undefined : inputs[index];
  let value: unknown = matched?.value;
  if (isBlank(value)) {
    const label = entry.label?.trim() ?? "";
    for (const key of [label, entry.name, ...(PORT_TO_PARAM_KEYS[label] ?? [])]) {
      if (key !== "" && !isBlank(params[key])) {
        value = params[key];
        break;
      }
    }
  }
  return { value: isBlank(value) ? undefined : value, index };
}

/**
 * 工作流参数表 + 原始 JSON 区块的数据。
 *
 * 行清单以**当前工作流 IO 的全量输入端口**为准（与 IO 预览同一份
 * `splitWorkflowIO`），不再按本次落库的 pin 枚举 —— 后者是 ComfyUI 内部程序名
 *（`replace` / `text` …），用户看不懂，且工作流改过之后历史任务的 pin 与当前
 * 端口对不上。每个端口的值：本次有提交值就覆盖，没有就用 IO 默认值。
 * 原始 JSON 折叠仍列 `params` 顶层键（不再过滤 seed / steps / cfg —— 那条过滤
 * 是为躲开已删除的「生成参数卡」重复，却会让种子这类关键参数从表中凭空消失）。
 */
export function deriveWorkflowParams(
  detail: TaskDetail | null,
  io: WorkflowIOMap | null | undefined,
  mode?: string | null,
): {
  hasAny: boolean;
  rows: Array<WorkflowParamRow>;
  topLevelEntries: Array<[string, unknown]>;
} {
  const params = paramsOf(detail);
  const inputs = workflowInputsOf<RawWorkflowInput>(detail);
  const usedInputs = new Set<number>();
  const rows: Array<WorkflowParamRow> = splitWorkflowIO(io).inputs.map((entry) => {
    const submitted = submittedValueFor(entry, params, inputs);
    if (submitted !== null && submitted.index !== -1) {
      usedInputs.add(submitted.index);
    }
    const submittedValue = submitted?.value;
    const trimmedLabel = entry.label?.trim() ?? "";
    return {
      id: entry.ioKey,
      label: trimmedLabel === "" ? entry.name : trimmedLabel,
      name: entry.name,
      source: submittedValue === undefined ? "default" : "submitted",
      value: submittedValue === undefined ? resolveEntryDefault(entry, mode) : submittedValue,
    };
  });

  /* IO 表缺失（工作流已删 / 详情未回）时如实显示本次提交的 pin；IO 表里已
   * 不存在、但本次确实下发过的 pin 也补一行，不丢历史数据（如实回落 pin 名）。 */
  rows.push(
    ...inputs.flatMap((input, index) =>
      usedInputs.has(index)
        ? []
        : [
            {
              id: `${input.nodeId ?? "?"}:${input.name}:${index}`,
              label: resolveParamLabel(input, io),
              name: input.name,
              source: "submitted" as const,
              value: input.value,
            },
          ],
    ),
  );

  const topLevelEntries = Object.entries(params).filter(([key]) => key !== "workflowInputs");
  return {
    rows,
    topLevelEntries,
    hasAny: rows.length > 0 || topLevelEntries.length > 0,
  };
}

/** 提示词名判据：作者的 IO 标签（`prompt` / `提示词` / `正向提示词`）也算。 */
function isPromptName(text: string): boolean {
  const value = text.trim();
  return /^(?:positive[-_])?prompt/i.test(value) || /^(?:正面|正向|positive)?提示词$/i.test(value);
}

/**
 * 参数表里「提示词」行的判据（ISSUE #4665）：这类值可能很长，展示格要定高滚动。
 * 工坊参数按契约口 id 判（`prompt`）；工作流参数按 pin 名**和 IO 作者标签**判 ——
 * 本次任务的提示词 pin 叫 `replace`（ComfyUI 内部 widget 名），但 IO 标签是
 * `prompt`，只认 pin 名会漏掉定高。`negative_prompt` / `负向提示词` 天然不命中。
 */
export function isPromptParamRow(id: string, name?: string | null, label?: string | null): boolean {
  if (id === "prompt") {
    return true;
  }
  return [name, label].some((value) => typeof value === "string" && isPromptName(value));
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
