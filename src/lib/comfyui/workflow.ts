/**
 * `workflow.ts` — 工作流图相关的**客户端安全**出入口
 *
 * 本模块只做两件事：
 *   ① 转出 `workflow-preview.ts` 的预览助手 —— 浏览器组件要能导入它而不连带
 *      拉进 `fs` / ComfyUI 客户端这类仅服务端的模块；
 *   ② 转出执行载荷的覆盖口径 `coerceApiInputValue`（与 `raw-overrides`
 *      同一份实现，供执行点与测试共用）。
 *
 * 历史包袱已清理：本模块曾承载「把 API 格式图按角色节点回填成可执行 prompt」的
 * 自动注水链路（`buildCustomWorkflow` / `detectParamMap` / LoRA 重连）。本应用
 * 只接受 ComfyUI 的原始工作流格式，转可执行图由 comfy-cli 在执行时按节点类定义
 * 完成，那条链路已无任何消费方。参数落点由「对外参数 → 端口」映射
 * （`workflow-param-mapping`）与执行点的 `applyApiOverrides` 承担。
 */

export {
  buildWorkflowPreview,
  buildWorkflowPreviewFull,
  FULL_PREVIEW_LEVEL_GAP,
  FULL_PREVIEW_MARGIN,
  FULL_PREVIEW_NODE_H,
  FULL_PREVIEW_NODE_W,
  FULL_PREVIEW_ROW_GAP,
  type WorkflowPreview,
  type WorkflowPreviewEdge,
  type WorkflowPreviewNode,
  type WorkflowPreviewNodeKind,
} from "./workflow-preview";

export { linkTargetId } from "./workflow-preview";
