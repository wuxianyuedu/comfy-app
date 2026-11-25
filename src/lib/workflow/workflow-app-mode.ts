/* ComfyUI App Mode 的引脚选择 → 应用 workflowIO 暴露面的映射层（纯函数，无 IO）。
 *
 * 背景：App Mode builder 里「选了哪些输入/输出」由 ComfyUI 前端写进工作流 JSON 的
 * `extra.linearData`（随 Ctrl+S 落盘到用户工作流目录），形状为
 * `{ inputs: [[widgetId, name, config?], ...], outputs: [nodeId, ...] }`；
 * widgetId 实测形如 `<工作流rootId>:<nodeId>:<widgetName>`（旧版为 `<nodeId>:<name>`）。
 * 本模块只做「身份映射」：产出与编辑器 `toggleIO` 同构的身份四字段条目
 * （direction/kind/nodeId/name，ioKey 同为 `${nodeId}::${kind}::${name}`），
 * type/defaultValue/label 等富化仍由服务端既有链（persistEnrichedWorkflowIO /
 * enrichWorkflowIO）补全 —— 勾选侧不写显示名是本仓既有口径，这里保持一致。
 */

import { isPlainRecord, isUnknownArray } from "~/lib/is-record";

import type { WorkflowIOMap } from "./workflow-io-types";

/** App Mode 输入项：`[widgetId, name, config?]`，config 为前端的输入 UI 配置（可选）。 */
export type LinearInputTuple = [widgetId: string, name: string, config?: Record<string, unknown>];

/** `extra.linearData` 的收窄形状。 */
export type LinearData = {
  inputs: Array<LinearInputTuple>;
  outputs: Array<string>;
};

/** 映射所需的节点视图：只读 RAW 节点上与引脚判型有关的字段（结构兼容 RawNode）。 */
export type LinearSourceNode = {
  id: number | string;
  inputs?: Array<{
    link?: number | null;
    name?: unknown;
    widget?: { name?: unknown } | null;
  }>;
  outputs?: Array<{ name?: unknown }>;
};

/** 从 RAW 工作流 JSON 里收窄出 `extra.linearData`；缺失或形状不符返回 null
 *  （「没有 App Mode 选择」与「选择为空」是两回事：后者返回空 inputs/outputs）。 */
export function extractLinearData(rawJson: unknown): LinearData | null {
  if (!isPlainRecord(rawJson)) {
    return null;
  }
  const extra = rawJson.extra;
  if (!isPlainRecord(extra) || !isPlainRecord(extra.linearData)) {
    return null;
  }
  const rawInputs = extra.linearData.inputs;
  const rawOutputs = extra.linearData.outputs;
  const inputs: Array<LinearInputTuple> = [];
  if (isUnknownArray(rawInputs)) {
    for (const entry of rawInputs) {
      /* 元组收窄：前两项必须是字符串；config（第三项）存在时必须是普通对象。
       * 形状不符的条目整条丢弃 —— 与 parseWorkflowIOMap 对坏条目的口径一致。 */
      if (!isUnknownArray(entry) || entry.length < 2) {
        continue;
      }
      const [widgetId, name, config] = entry;
      if (typeof widgetId !== "string" || typeof name !== "string") {
        continue;
      }
      inputs.push(
        config === undefined || config === null
          ? [widgetId, name]
          : isPlainRecord(config)
            ? [widgetId, name, config]
            : [widgetId, name],
      );
    }
  }
  const outputs: Array<string> = isUnknownArray(rawOutputs)
    ? rawOutputs.filter((id): id is string => typeof id === "string")
    : [];
  if (inputs.length === 0 && outputs.length === 0) {
    return null;
  }
  return { inputs, outputs };
}

/** 拆解 widgetId：取末两段为 `(nodeId, widgetName)`，兼容三段（带 rootId 前缀）
 *  与两段（旧格式）。少于两段或任一段为空返回 null。 */
export function parseLinearWidgetId(widgetId: string): {
  nodeId: string;
  widgetName: string;
} | null {
  const parts = widgetId.split(":");
  if (parts.length < 2) {
    return null;
  }
  const widgetName = parts.at(-1);
  const nodeId = parts.at(-2);
  if (nodeId === undefined || widgetName === undefined || nodeId === "" || widgetName === "") {
    return null;
  }
  return { nodeId, widgetName };
}

/** 映射结果：io 为替换后的暴露面；skipped 逐条说明没映射上的引用（不静默丢）。 */
export type LinearMappingResult = {
  io: WorkflowIOMap;
  skipped: Array<{ kind: "input" | "output"; reason: string; ref: string }>;
};

/** 幸存条目上要保留的「作者元数据」字段 —— 显示名 / 必填 / seed 行为 / 模式覆盖 /
 *  排序等仍归应用侧编辑，App Mode 只决定暴露哪些引脚，读回时不得抹掉这些值。 */
const PRESERVED_METADATA_KEYS = [
  "classType",
  "defaultValue",
  "displayOrder",
  "label",
  "modeOverrides",
  "multiline",
  "nodeTitle",
  "options",
  "required",
  "seedMode",
  "slotLabel",
  "type",
] as const;

/** 把 App Mode 的引脚选择映射成 workflowIO 暴露面（替换语义）。
 *
 *  - inputs：按 rawNodes 判型 —— 槽位带 widget 标记 → widget；否则 → param
 *    （连线端口，含未接线端口）；节点 inputs[] 里没有该名（纯控件，如文本编码器的
 *    text）→ 兜底 widget。
 *  - outputs：按节点勾选（与编辑器同粒度），name 取该节点首个输出槽位名。
 *  - rawNodes 里找不到的引用计入 skipped；同一 key 重复出现时后写者胜。
 *  - existingIO 中幸存键的元数据字段原样保留（含 hostNodeId 在内的身份字段以本次
 *    映射为准 —— 新条目都是顶层暴露，不带宿主链）。 */
export function buildWorkflowIOFromLinearData(args: {
  existingIO: WorkflowIOMap;
  linearData: LinearData;
  rawNodes: Array<LinearSourceNode>;
}): LinearMappingResult {
  const { linearData, rawNodes, existingIO } = args;
  const nodeById = new Map<string, LinearSourceNode>();
  for (const node of rawNodes) {
    nodeById.set(String(node.id), node);
  }
  const skipped: LinearMappingResult["skipped"] = [];
  const io: WorkflowIOMap = {};

  for (const [widgetId] of linearData.inputs) {
    const parsed = parseLinearWidgetId(widgetId);
    if (parsed === null) {
      skipped.push({ kind: "input", reason: "widgetId 无法解析出节点与引脚名", ref: widgetId });
      continue;
    }
    const { nodeId, widgetName } = parsed;
    const node = nodeById.get(nodeId);
    if (node === undefined) {
      skipped.push({ kind: "input", reason: `节点 ${nodeId} 不在当前图中`, ref: widgetId });
      continue;
    }
    const slot = node.inputs?.find((item) => item.name === widgetName);
    const kind =
      slot === undefined || (slot.widget !== null && slot.widget !== undefined)
        ? "widget"
        : "param";
    const key = `${nodeId}::${kind}::${widgetName}`;
    const previous = existingIO[key];
    const preserved: Record<string, unknown> = {};
    if (previous !== undefined) {
      for (const metaKey of PRESERVED_METADATA_KEYS) {
        const value = (previous as Record<string, unknown>)[metaKey];
        if (value !== undefined) {
          preserved[metaKey] = value;
        }
      }
    }
    io[key] = {
      /* SAFETY: 类型断言已复核 —— preserved 只携带 WorkflowIOEntry 的可选元数据字段 */
      ...(preserved as Partial<WorkflowIOMap[string]>),
      direction: "input",
      kind,
      name: widgetName,
      nodeId,
    };
  }

  for (const nodeId of linearData.outputs) {
    const node = nodeById.get(nodeId);
    if (node === undefined) {
      skipped.push({ kind: "output", reason: `节点 ${nodeId} 不在当前图中`, ref: nodeId });
      continue;
    }
    const firstOutput = node.outputs?.[0]?.name;
    if (typeof firstOutput !== "string" || firstOutput === "") {
      skipped.push({ kind: "output", reason: `节点 ${nodeId} 没有输出槽位名`, ref: nodeId });
      continue;
    }
    const key = `${nodeId}::output::${firstOutput}`;
    const previous = existingIO[key];
    const preserved: Record<string, unknown> = {};
    if (previous !== undefined) {
      for (const metaKey of PRESERVED_METADATA_KEYS) {
        const value = (previous as Record<string, unknown>)[metaKey];
        if (value !== undefined) {
          preserved[metaKey] = value;
        }
      }
    }
    io[key] = {
      /* SAFETY: 类型断言已复核 —— 同上，只携带可选元数据字段 */
      ...(preserved as Partial<WorkflowIOMap[string]>),
      direction: "output",
      kind: "output",
      name: firstOutput,
      nodeId,
    };
  }

  return { io, skipped };
}
