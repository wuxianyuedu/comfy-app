"use client";

/* ── DynamicWorkflowForm ──
 * Renders the parameter form for a custom ComfyUI workflow strictly from the
 * pins the author exposed in IO-edit mode.  No hard-coded 提示词/CFG/种子 —
 * a workflow that exposes one `text` pin gets exactly one textarea; a
 * workflow that exposes nothing gets an actionable hint instead of a wall of
 * irrelevant fields.
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
    />
  );
}

export default DynamicWorkflowForm;
