/**
 * RAW（UI 格式）工作流解析助手。
 *
 * 这些纯函数把一份 rawJson 转成详情构建器需要的若干查找表：
 * 逐节点的输入元数据（`rawInputsById`）、ComfyUI 的精确外框尺寸
 * （`sizeById`）、稀疏的输出元数据（`rawNodeMeta`）、class type 查找
 * （`nodeTypeById`）以及 RAW 视图包（`rawView`）。
 *
 * `buildRawInputs`（及其私有 helper）体量最大，已拆到
 * `./workflow-detail-raw-inputs.ts`；5 个共享 interface 已下沉到
 * `./workflow-detail-raw-types.ts`（叶子类型模块）。本文件把两者都
 * re-export 回来，消费者 import 路径不变（§12.18 复用优先——拆包只挪
 * 文件、不动契约）；类型走叶子模块保证 §12.7 的**依赖方向单向**、
 * 不引入循环。
 */
import { extractPositions, type RawWorkflow } from "~/lib/comfyui/raw";
import { buildRawViewGraph } from "~/lib/comfyui/raw-view-graph";
import { buildRawInputs } from "./workflow-detail-raw-inputs";
import type {
  DetailNodeView,
  RawInputEntry,
  RawNodeMeta,
  RawOutputEntry,
  RawViewPacket,
} from "./workflow-detail-raw-types";

export { buildRawInputs };
export type {
  DetailNodeView,
  RawInputEntry,
  RawNodeMeta,
  RawOutputEntry,
  RawViewPacket,
} from "./workflow-detail-raw-types";

/**
 * 稀疏的原始节点元数据 —— 只够画布编辑器渲染 OUTPUT 端口条、
 * 以及喂给子图 UI 节点（它们需要 widget_values 给字段打标签）。
 * 便签节点排除在外。
 */
export function buildRawNodeMeta(raw: RawWorkflow | null): RawNodeMeta[] {
  const rawNodeMeta: RawNodeMeta[] = [];
  if (raw && Array.isArray(raw.nodes)) {
    for (const rn of raw.nodes) {
      if (!rn || rn.type === "Note" || rn.type === "MarkdownNote") continue;
      const outputs: RawOutputEntry[] = [];
      if (Array.isArray(rn.outputs)) {
        for (const o of rn.outputs) {
          if (!o || typeof o.name !== "string") continue;
          outputs.push({
            name: o.name,
            localized:
              typeof o.localized_name === "string"
                ? o.localized_name
                : undefined,
            /* 业务标签（如 `FRAMES` / `IMAGE_FINAL`）。透传出去，
             *  父级 WorkflowSubgraphNode 的输出条与内层 WorkflowIoPortNode
             *  的显示才能一致。 */
            label: typeof o.label === "string" ? o.label : undefined,
            type: typeof o.type === "string" ? o.type : "*",
            links: Array.isArray(o.links)
              ? o.links.map((n) => Number(n) || 0)
              : [],
          });
        }
      }
      // 透传 `flags`，编辑器才能照顾到逐节点的标记，例如
      //  `flags.collapsed === true`（SetNode / Fast Groups Muter /
      //  rgthree Compact 等会用的 ComfyUI LiteGraph 状态）。
      //  只保留纯对象形态的 flags，其余一律丢掉 ——
      //  避免把类实例泄漏进 JSON 载荷。
      const flags =
        rn && typeof rn.flags === "object" && rn.flags !== null ? rn.flags : {};
      rawNodeMeta.push({
        id: String(rn.id),
        widgets_values: Array.isArray(rn.widgets_values)
          ? rn.widgets_values
          : [],
        outputs,
        flags,
        /* 自定义节点的 `properties`。透传出去，画布便能复现由 properties
         *  驱动的运行期 UI —— 最典型的例子是 rgthree 的
         *  `Fast Groups Bypasser`。 */
        properties:
          rn && typeof rn.properties === "object" && rn.properties !== null
            ? rn.properties
            : {},
        mode: typeof rn.mode === "number" ? rn.mode : 0,
      });
    }
  }
  return rawNodeMeta;
}

/** 节点 id → ComfyUI class type 的映射（取自 raw.nodes）。
 *  workflowIO 富化用它解析**直接**（非封装）节点的 COMBO 候选值。 */
export function buildNodeTypeMap(
  raw: RawWorkflow | null,
): Record<string, string> {
  const nodeTypeById: Record<string, string> = {};
  if (raw && Array.isArray(raw.nodes)) {
    for (const n of raw.nodes) {
      if (n?.id != null)
        nodeTypeById[String(n.id)] = typeof n.type === "string" ? n.type : "";
    }
  }
  return nodeTypeById;
}

/** 子工作流内部节点的输入元数据索引（nodeId → raw 条目）。
 *
 *  `buildRawInputs` 只走顶层 `raw.nodes`，子图定义里的内部节点不在其中。
 *  当用户「下钻到子工作流内部」勾选参数时，落库的 `nodeId` 指向的是内部节点
 *  （如 `PrimitiveInt.value`），顶层富化按 id 回查必然落空 —— 类型退化成 `*`、
 *  显示名退化成 pin 名（ISSUE #349：IO 编辑里 seed 显示成别名/原始键）。
 *  这里把每个子图定义的内部节点输入打平索引，供富化在顶层找不到时兜底。
 *
 *  键是内部节点 id 的字符串形式；同名节点在多个子图定义里重复出现时后者覆盖
 *  （ComfyUI 内部节点 id 在工作流内唯一，实际不会冲突）。 */
export function buildInnerNodeInputs(
  raw: RawWorkflow | null,
): Record<string, RawInputEntry[]> {
  const innerInputsById: Record<string, RawInputEntry[]> = {};
  const subgraphs = raw?.definitions?.subgraphs;
  if (!subgraphs) return innerInputsById;
  for (const subKey of Object.keys(subgraphs)) {
    const subDef = subgraphs[subKey];
    if (!subDef || !Array.isArray(subDef.nodes)) continue;
    for (const node of subDef.nodes) {
      if (node?.id == null) continue;
      const inputs = Array.isArray(node.inputs) ? node.inputs : [];
      if (inputs.length === 0) continue;
      const widgetValues: unknown[] = Array.isArray(node.widgets_values)
        ? node.widgets_values
        : [];
      const list: RawInputEntry[] = [];
      for (const inp of inputs) {
        if (!inp || typeof inp.name !== "string") continue;
        const widgetName =
          inp.widget && typeof inp.widget.name === "string"
            ? inp.widget.name
            : undefined;
        const entry: RawInputEntry = {
          name: inp.name,
          label: typeof inp.label === "string" ? inp.label : undefined,
          localized:
            typeof inp.localized_name === "string"
              ? inp.localized_name
              : undefined,
          type:
            typeof inp.type === "string"
              ? inp.type
              : inp.link != null
                ? "*"
                : "STRING",
          isConnection: inp.link != null,
        };
        if (widgetName) {
          entry.widget = { name: widgetName };
          /* 内部节点的值按「inputs[] 中控件出现顺序」对齐 widgets_values，
           *  seed 家族多占一个 control_after_generate 槽位（与顶层解析同口径）。 */
          const slot = list.reduce((count, prev) => {
            if (!prev.widget) return count;
            return prev.name === "seed" || prev.name === "noise_seed"
              ? count + 2
              : count + 1;
          }, 0);
          if (slot < widgetValues.length)
            entry.widgetValue = widgetValues[slot];
        }
        list.push(entry);
      }
      innerInputsById[String(node.id)] = list;
    }
  }
  return innerInputsById;
}

/** raw 视图专用数据包。
 * 存库的 `graph`（即 `detail.nodes` 的来源）在某些工作流里被「拆平」成了
 * `N:xx` 节点（例如某工作流的 flat form，而其 `_t2i` 兄弟保留 wrapper）。
 * 这种情况下画布 RAW 布局会显示 17 个被炸开的节点，而用户期望的是 5 个
 * 原始 ComfyUI 节点（含 wrapper 紫色整卡）。这里直接从 rawJson 再派生一份
 * `rawView`（保留 subgraph wrapper），让 RAW 布局与 wrapper-form 兄弟、与
 * ComfyUI 自身画布一致。派生在 `raw-view-graph.ts`：纯离线、不发网络请求，
 * 也**不是**格式转换（见该模块文件头）。 */
export function buildRawView(
  raw: RawWorkflow | null,
  rawInputsById: Record<string, RawInputEntry[]>,
  sizeById: Record<string, [number, number]>,
): RawViewPacket | null {
  let rawView: RawViewPacket | null = null;
  if (raw && Array.isArray(raw.nodes)) {
    const rawGraph = buildRawViewGraph(raw);
    const rawViewNodes: DetailNodeView[] = Object.entries(rawGraph).map(
      ([nodeId, n]) => {
        /* 与旧 `n?.class_type || (n?.type as string) || "?"` 语义逐值等价
         *  （`a || b` ≡ `a ? a : b`）：class_type/type 为空串时同样回退。 */
        const classType: string = n?.class_type
          ? n.class_type
          : n?.type
            ? (n.type as string)
            : "?";
        const isUuidClass = /^[0-9a-f]{8}-[0-9a-f]{4}/i.test(classType);
        let resolvedTitle: string | undefined;
        if (isUuidClass && raw?.definitions?.subgraphs) {
          const subs = raw.definitions.subgraphs;
          let def = subs[classType];
          if (!def) {
            const matchKey = Object.keys(subs).find(
              (key) => subs[key]?.id === classType,
            );
            if (matchKey) def = subs[matchKey];
          }
          if (def && typeof def.name === "string" && def.name.trim()) {
            resolvedTitle = def.name.trim();
          }
        }
        return {
          id: nodeId,
          class_type: classType,
          title:
            resolvedTitle ??
            n?._meta?.title ??
            (isUuidClass ? "" : classType) ??
            nodeId,
          is_subgraph: isUuidClass,
          raw_inputs: rawInputsById[nodeId] ?? [],
          size: sizeById[nodeId],
        };
      },
    );
    const rawViewPositions = extractPositions(raw);
    rawView = {
      nodes: rawViewNodes,
      positions: rawViewPositions,
      graph: rawGraph,
    };
  }
  return rawView;
}
