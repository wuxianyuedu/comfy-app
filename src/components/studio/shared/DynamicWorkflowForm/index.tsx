"use client";

/* DynamicWorkflowForm 目录的聚合出口。原样再导出
 * 此前单文件模块的公开 API，好让从
 * `.../shared/DynamicWorkflowForm`（或别名）导入的消费方毫无差别。 */
export { default, DynamicWorkflowForm } from "./DynamicWorkflowForm";
export type { DynamicWorkflowFormProps } from "./DynamicWorkflowForm";
export { PortHandle } from "../WorkflowFormControls";
