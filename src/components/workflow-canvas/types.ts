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
  inputs: Record<string, any>;
  // _meta? not in raw export; we attach it client-side for UI hints
  _meta?: NodeMeta;
}

export interface ComfyGraph {
  [nodeId: string]: ComfyGraphNode;
}

/* ── Client-side metadata we attach to each node ── */
export interface NodeMeta {
  title?: string;           // display label (defaults to class_type)
  role?: NodeRole;          // positive | negative | checkpoint | sampler
  color?: string;           // override accent
  collapsed?: boolean;
}

export type NodeRole = "positive" | "negative" | "checkpoint" | "sampler" | "lora" | "output" | "input";

/* ── ReactFlow wrappers ── */
export interface WfNode extends Node {
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
  inputs: Record<string, any>;
  /** Input field definitions (derived from INPUT_TYPES registry) */
  fields: FieldDef[];
  /** Selected state drives the editor panel */
  selected?: boolean;
  [key: string]: any; // Index signature for ReactFlow compatibility
}

export interface WfEdge extends Edge {
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
}

/* ── Node type registry — maps class_type → display info + field specs ── */
export interface NodeTypeConfig {
  label: string;            // default Chinese label
  color: string;            // accent color (CSS var or hex)
  icon?: string;            // emoji or unicode symbol (for non-emoji env)
  category: "input" | "process" | "output" | "model" | "conditioning" | "latent" | "image";
  defaultFields: FieldDef[];
  width: number;            // node card width in px
  height: number;           // min height
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
