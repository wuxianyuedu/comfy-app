"use client";

/* Barrel for the DynamicWorkflowForm directory.  Re-exports the exact public
 * API of the former single-file module so consumers importing
 * `.../shared/DynamicWorkflowForm` (or the alias) see no difference. */
export { default, DynamicWorkflowForm } from "./DynamicWorkflowForm";
export type { DynamicWorkflowFormProps } from "./DynamicWorkflowForm";
export { PortHandle } from "../WorkflowFormControls";
