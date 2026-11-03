/**
 * `workflow-node-types.ts` — WorkflowNode 家族的共享类型叶子。
 * 单独成文件：`WorkflowSourceFilter` 同时被宿主与子件使用，此前定义在宿主里导致 `WorkflowNode → chip → WorkflowNode` 成环（规范 12.7）。
 * 类型下沉后依赖变单向（规范 18）；宿主仍按原样 re-export，既有导入路径不变。
 */

/** 工作流来源筛选：全部 / 仅本机 / 仅在线。 */
export type WorkflowSourceFilter = "all" | "local" | "online";

/** 当前工作流的 modes 配置（来自 /api/workflows/[id]）。 */
export type WorkflowModesState = {
  defaultMode: string | null;
  modes: Array<string>;
};
