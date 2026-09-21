/**
 * RAW 详情构建器共享的**形状契约**（叶子类型模块）。
 *
 * 5 个 interface 从 `workflow-detail-raw.ts` 抽出，让 detail 主模块与拆分件
 * `workflow-detail-raw-inputs.ts` 都从这里 `import type`——依赖方向**单向**，
 * 不构成 §12.7 禁止的模块循环。原路径
 * `~/lib/comfyui/workflow-detail-raw` 的 re-export 保持不变，
 * `workflow-detail-io` / `workflow-subgraph-parse` 等下游消费者无需改 import。
 */
import type { ApiWorkflowNode } from "~/lib/comfyui/raw";

/** rawInputsById / raw_inputs 的单条输入元数据（镜像客户端 RawInputMeta）。 */
export interface RawInputEntry {
  name: string;
  label?: string;
  localized?: string;
  type: string;
  isConnection: boolean;
  /** 哨兵边界线（子图暴露输入/输出）标记，画布渲染 Handle 用 */
  isBoundary?: boolean;
  widget?: { name: string };
  widgetValue?: unknown;
  multiline?: boolean;
  imageRef?: { filename: string; subfolder: string; type: string };
  preview?: boolean;
  /** wrapper 解析的内部暂存字段：代理目标 (class, field)，COMBO 解析后删除 */
  __comboClass?: string;
  __comboField?: string;
  /** COMBO 候选列表（object_info 解析成功时写入，随 detail 下发） */
  comboOptions?: string[];
  /** 子工作流封装节点暴露口背后的「内部真实字段」。
   *
   *  wrapper 的 `inputs[]` 里那一条是本层生成的别名槽位（ComfyUI 为
   *  proxyWidgets 自动编号成 `value_1` / `value_2`），字段名与业务语义都在
   *  内部节点上（`proxyWidgets[i] = [internalNodeId, fieldName]`）。富化只按
   *  `name` 回查时拿不到内部字段的业务名，标签就退化成别名（ISSUE #349）。
   *  这里把解析结果随条目下发，让富化（workflow-detail-io）能在别名之外
   *  找到真实字段名与它的 label / localized。 */
  proxyField?: {
    nodeId: string;
    field: string;
    label?: string;
    localized?: string;
  };
}

/** outputs[] 单条元数据（镜像客户端 RawOutputMeta；isBoundary 仅子图路径写入）。 */
export interface RawOutputEntry {
  name: string;
  localized?: string;
  label?: string;
  type: string;
  links: number[];
  isBoundary?: boolean;
}

/** sparse raw-node 元数据（detail.rawNodes / subgraph rawNodeMeta）。 */
export interface RawNodeMeta {
  id: string;
  widgets_values: unknown[];
  outputs: RawOutputEntry[];
  flags: Record<string, unknown>;
  /** 自定义节点 properties（rgthree Fast Groups Bypasser 等）；子图路径未采集 */
  properties?: Record<string, unknown>;
  mode: number;
}

/** detail.nodes / rawView.nodes / 子图 nodes 的条目形状（镜像客户端 ComfyGraphNode）。 */
export interface DetailNodeView {
  id: string;
  class_type: string;
  title: string;
  is_subgraph: boolean;
  raw_inputs: RawInputEntry[];
  size?: [number, number];
  is_input_endpoint?: boolean;
  is_output_endpoint?: boolean;
  boundary_input?: { name: string; type: string; value: unknown } | null;
  boundary_output?: { name: string; type: string } | null;
  connects_to?: string | null;
  connects_from?: string | null;
}

/** RAW 视图数据包（从 rawJson 派生、保留 subgraph wrapper）。 */
export interface RawViewPacket {
  nodes: DetailNodeView[];
  positions: Record<string, [number, number]>;
  graph: Record<string, ApiWorkflowNode>;
}
