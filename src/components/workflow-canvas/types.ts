/**
 * Workflow Canvas — Core Types
 *
 * Bridges ComfyUI graph JSON (API format) ↔ ReactFlow nodes/edges.
 * All node IDs are string keys from the ComfyUI graph object.
 */

import type { Node, Edge } from "@xyflow/react";

/* ── ComfyUI graph shape (Export API Format) ── */
export interface ComfyGraphNode {
  class_type: string;
  inputs: Record<string, unknown>;
  // _meta? not in raw export; we attach it client-side for UI hints
  _meta?: NodeMeta;
}

export type ComfyGraph = Record<string, ComfyGraphNode>;

/* ── Client-side metadata we attach to each node ── */
export interface NodeMeta {
  title?: string;           // display label (defaults to class_type)
  role?: NodeRole;          // positive | negative | checkpoint | sampler
  color?: string;           // override accent
  collapsed?: boolean;
}

export type NodeRole = "positive" | "negative" | "checkpoint" | "sampler" | "lora" | "output" | "input";

/* ── ReactFlow wrappers ── */
export interface WorkflowNode extends Node {
  data: NodeData;
}

export interface NodeData {
  /** ComfyUI node id (key in graph object) */
  comfyId: string;
  /** ComfyUI class_type e.g. "CLIPTextEncode" */
  classType: string;
  /** Display label */
  label: string;
  /** Role badge */
  role?: NodeRole;
  /** Current input values (mirrors graph[nodeId].inputs) */
  inputs: Record<string, unknown>;
  /** Input field definitions (derived from INPUT_TYPES registry) */
  fields: FieldDef[];
  /** Selected state drives the editor panel */
  selected?: boolean;
  [key: string]: unknown; // Index signature for ReactFlow compatibility
}

export interface WorkflowEdge extends Edge {
  sourceHandle?: string;
  targetHandle?: string;
}

/* ── Field definition for parameter editor ── */
export type FieldType =
  | "text"          // multi-line prompt
  | "string"        // single-line (ckpt_name, lora_name, etc.)
  | "number"        // steps, cfg, seed, denoise, strength
  | "select"        // sampler_name, scheduler (dropdown)
  | "toggle"        // boolean flags
  | "image"         // image upload / reference
  | "latent";       // latent size (width x height)

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

/* ── Canvas state ── */
export interface CanvasState {
  graph: ComfyGraph;
  paramMap: Record<string, string>;  // nodeId → role
  selectedNodeId: string | null;
  zoom: number;
}

/**
 * Maps a user-imported workflow's role nodes to specific node ids,
 * so the UI can override which CLIPTextEncode is the positive prompt, etc.
 */
export type ParamMap = {
  positiveNode?: string;
  negativeNode?: string;
  checkpointNode?: string;
  samplerNode?: string;
};
