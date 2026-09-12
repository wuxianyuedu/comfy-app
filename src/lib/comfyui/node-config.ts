/**
 * 节点展示配置 —— ComfyUI `class_type` → 卡片外观 / 字段规格。
 *
 * 这一组类型原先定义在旧流程画布的 `components/workflow-canvas/types.ts`
 * （已删除）。现由三处继续消费，故落在 lib 层：
 *   1. `src/config/custom-nodes.ts` —— manifest → 自定义节点配置；
 *   2. `src/lib/comfyui/node-registry.ts` —— 内置节点配置表；
 *   3. `src/components/studio/canvas/*` —— 节点卡片（PackageFooter 等）的展示。
 *
 * 本文件必须是**纯类型**（H2：lib 不得使用 React），且不得反向 import
 * `components/**`（H1 依赖倒置）。
 */

import type { FieldType } from "./field-types";

export type { FieldType };

/** 编辑器参数行定义（旧的「参数编辑器」FieldDef，现仅作字段规格复用）。 */
export interface FieldDef {
  key: string;          // input key in ComfyUI inputs object
  label: string;        // display name
  type: FieldType;
  options?: string[];   // for select type
  placeholder?: string;
  multiline?: boolean;   // for text type
  hidden?: boolean;     // don't show in editor (e.g. internal wiring)
  group?: string;       // section grouping
  /** Numeric bounds (mirrors ComfyUI INPUT_TYPES min/max/step). */
  min?: number;
  max?: number;
  step?: number;
  /** Model folder for file dropdowns (checkpoints/loras/vae/...). When set and
   *  a matching list is supplied, the editor renders a real file <select>. */
  modelFolder?: string;
}

/* ── Port spec (from custom-node manifest) ── */
export interface PortSpec {
  name: string;             // input/output name
  type: string;             // e.g. "FLOAT" | "IMAGE" | "COMBO" ...
  widget?: FieldType;       // editor widget (absent for pure connection ports)
  options?: string[];       // for COMBO
  default?: unknown;        // default value (for value chip / placeholder)
  required: boolean;
}

/* ── Node type registry — maps class_type → display info + field specs ── */
export interface NodeTypeConfig {
  label: string;            // default Chinese label
  color: string;            // accent color (CSS var or hex)
  icon?: string;            // emoji or unicode symbol (for non-emoji env)
  category: "input" | "process" | "output" | "model" | "conditioning" | "latent" | "image" | "custom";
  defaultFields: FieldDef[];
  width: number;            // node card width in px
  height: number;           // min height
  /* custom-node support (populated from customNodes manifest) */
  custom?: boolean;
  rawCategory?: string;     // original ComfyUI category string
  inputsSpec?: PortSpec[];
  outputsSpec?: PortSpec[];
  /** OUTPUT_NODE === true：终端节点（后端仍执行，只是不向下游传值）。 */
  outputNode?: boolean;
  /** properties.frontend_only === true：纯前端节点（后端不执行）。与 outputNode 是两回事。 */
  frontendOnly?: boolean;
  description?: string;
}
