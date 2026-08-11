/**
 * Workflow Canvas — Public API
 *
 * `import WorkflowCanvas from "@/components/workflow-canvas"` gives you
 * a fully functional visual workflow editor (ReactFlow-based, MIT).
 */

export { default as WorkflowCanvas } from "./WorkflowCanvas";

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
  WfNode,
  WfEdge,
  NodeData,
  NodeMeta,
  ParamMap,
  NodeTypeConfig,
  FieldDef,
  FieldType,
  NodeRole,
  CanvasState,
} from "./types";
