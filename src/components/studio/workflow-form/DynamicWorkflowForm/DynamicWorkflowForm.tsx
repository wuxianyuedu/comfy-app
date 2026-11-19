"use client";

/* ── DynamicWorkflowForm ── 严格按作者在 IO 编辑模式暴露的针脚渲染自定义工作流参数表单，
 * 不写死提示词/CFG/种子（只暴露 text 就只得到一块 textarea；什么都不暴露则给可行动提示）。
 * 容器层：取 controller → 交给纯展示视图，自身不持有业务规则（规范 17 §17.2）。
 * CreatePanel（宽版）与画布 workflow 节点（compact）共用。 */

import type { DynamicWorkflowFormProps } from "./dynamic-workflow-form-config";
import { DynamicWorkflowFormView } from "./DynamicWorkflowFormView";
import { useDynamicWorkflowForm } from "./hooks/use-dynamic-workflow-form";

export type { DynamicWorkflowFormProps };

export function DynamicWorkflowForm(props: DynamicWorkflowFormProps) {
  const controller = useDynamicWorkflowForm(props);

  return (
    <DynamicWorkflowFormView
      compact={props.compact ?? false}
      controller={controller}
      disabled={props.disabled ?? false}
      emptyHint={props.emptyHint}
      loading={props.loading ?? false}
      mode={props.mode}
      onLabelChange={props.onLabelChange}
      onReorder={props.onReorder}
      onRequiredChange={props.onRequiredChange}
      onSeedModeChange={props.onSeedModeChange}
      onVisibilityChange={props.onVisibilityChange}
      rowTrailing={props.rowTrailing}
      seedModes={props.seedModes}
      showOutputs={props.showOutputs ?? true}
      visibilityMode={props.visibilityMode}
      workflowId={props.workflowId}
    />
  );
}

export default DynamicWorkflowForm;
