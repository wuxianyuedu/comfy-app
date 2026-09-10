/**
 * Workflow Canvas — Public API
 *
 * 本目录提供画布「节点卡片 / 图变换 / 类型注册表」等基础能力；实际渲染的
 * 画布外壳是 `src/components/studio/canvas/WorkflowCanvasEditor.tsx`。
 * 节点卡片的样式（`.comfy-node*` 等）集中写在 `src/app/globals.css`
 * 「工作流画布表面」一节，随主题 token 两态渲染。
 */

export { default as NodeEditor } from "./NodeEditor";
export { ComfyNode } from "./nodes/ComfyNode";
export { BezierEdge, EdgeGradientDefs } from "./nodes/BezierEdge";

export { comfyGraphToFlow, flowToComfyGraph } from "./graph-utils";
export type { FlowData } from "./graph-utils";

export {
  getNodeConfig,
  NODE_TYPE_REGISTRY,
  getAllNodeTypes,
  CATEGORY_LABELS,
} from "./node-registry";

export type {
  ComfyGraph,
  ComfyGraphNode,
  WorkflowNode,
  WorkflowEdge,
  NodeData,
  NodeMeta,
  ParamMap,
  NodeTypeConfig,
  FieldDef,
  FieldType,
  NodeRole,
  CanvasState,
} from "./types";
