"use client";

/* ── DynamicWorkflowForm ──
 * 严格按作者在 IO 编辑模式里暴露的针脚，渲染自定义 ComfyUI 工作流的参数表单。
 * 不写死 提示词/CFG/种子 ——
 * 只暴露一个 `text` 针脚的工作流就只得到一块 textarea；
 * 什么都不暴露的工作流得到一句可行动的提示，而不是一堵
 * 无关字段。
 *
 * Shared by CreatePanel（宽版）and the canvas `workflow` node（compact）.
 *
 * 容器层：取 controller → 交给纯展示视图，自身不持有业务规则。 */

import type { DynamicWorkflowFormProps } from "./dynamic-workflow-form-config";
import { DynamicWorkflowFormView } from "./DynamicWorkflowFormView";
import { useDynamicWorkflowForm } from "./hooks/use-dynamic-workflow-form";

export type { DynamicWorkflowFormProps };

export function DynamicWorkflowForm(props: DynamicWorkflowFormProps) {
  const controller = useDynamicWorkflowForm(props);

  return (
    <DynamicWorkflowFormView
      controller={controller}
      loading={props.loading ?? false}
      disabled={props.disabled ?? false}
      compact={props.compact ?? false}
      showOutputs={props.showOutputs ?? true}
      emptyHint={props.emptyHint}
      workflowId={props.workflowId}
      seedModes={props.seedModes}
      onSeedModeChange={props.onSeedModeChange}
      onLabelChange={props.onLabelChange}
      onRequiredChange={props.onRequiredChange}
      visibilityMode={props.visibilityMode}
      onVisibilityChange={props.onVisibilityChange}
      onReorder={props.onReorder}
      mode={props.mode}
      rowTrailing={props.rowTrailing}
    />
  );
}

export default DynamicWorkflowForm;
