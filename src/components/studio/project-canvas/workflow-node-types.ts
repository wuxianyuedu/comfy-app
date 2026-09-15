/**
 * `workflow-node-types.ts` — WorkflowNode 家族的共享类型叶子
 * ===========================================================================
 *
 * 为什么单独一个文件：`WorkflowSourceFilter` 同时被 `WorkflowNode.tsx`
 * （宿主）与 `WorkflowSourceFilterChip.tsx`（子件）使用。它此前定义在宿主里，
 * 子件 `import type { WorkflowSourceFilter } from "./WorkflowNode"` —— 而宿主
 * 又 import 子件渲染，于是
 * `WorkflowNode → WorkflowSourceFilterChip → WorkflowNode` 成环（规范 12.7）。
 *
 * 类型不需要「属于谁」，只需要「被谁共用」：需要被多个模块共用的类型下沉到
 * 类型模块（规范 18），环随之消失（依赖方向变成单向的
 * `WorkflowNode / chip → workflow-node-types`）。
 *
 * 宿主 `WorkflowNode.tsx` 仍按原样 re-export，既有导入路径不变。
 */

/** 工作流来源筛选：全部 / 仅本机 / 仅在线。 */
export type WorkflowSourceFilter = "all" | "local" | "online";

/** 当前工作流的 modes 配置（来自 /api/workflows/[id]）。 */
export interface WorkflowModesState {
  modes: string[];
  defaultMode: string | null;
}
