/* ── Shared workflow-IO model (2026-08-09) ──
 *
 * A single source of truth for "what does this custom workflow actually
 * accept / produce", used by BOTH consumers:
 *   • CreatePanel 「自定义工作流」 panel   (src/components/updream/CreatePanel.tsx)
 *   • Canvas `workflow` node               (src/components/updream/canvas/CanvasNode.tsx)
 *
 * Data source rule (decided with the user): the ONLY source is the
 * user-curated `workflowIO` selection made in the canvas editor's IO-edit
 * mode.  We never scan the graph to guess parameters — if the author didn't
 * tick a pin, it is not an external parameter.  The server enriches each
 * entry with the ComfyUI data type + current value before it reaches us
 * (see src/app/api/workflows/[id]/route.ts → "workflowIO ENRICHMENT").
 */

/** One exposed pin, as returned by GET /api/workflows/[id]. */
export interface WorkflowIOEntry {
  direction: "input" | "output";
  /** Semantic bucket chosen in IO-edit mode — NOT the data type. */
  kind: "param" | "widget" | "output" | string;
  nodeId: string;
  name: string;
  label?: string;
  /** ComfyUI data type: STRING / INT / FLOAT / BOOLEAN / IMAGE / VIDEO / … */
  type?: string;
  defaultValue?: unknown;
  nodeTitle?: string;
  multiline?: boolean;
  /** 2026-08-11 (R57): mark a widget-backed input as REQUIRED.  Authors
   *  toggle this in IO-edit/preview mode.  At run time, consumers (CreatePanel
   *  / Canvas `workflow` node) refuse to submit while a required value is
   *  empty, surfacing a `getMissingRequiredInputs(io, values)` list. */
  required?: boolean;
}

export type WorkflowIOMap = Record<string, WorkflowIOEntry>;

/** Which control a dynamic form should render for a given entry. */
export type ControlKind =
  | "textarea"
  | "text"
  | "int"
  | "float"
  | "switch"
  | "image"
  | "link"; // non-editable connection type (MODEL / CLIP / LATENT / …)

/** ComfyUI types that only ever arrive over a wire — no user input possible. */
const LINK_ONLY = new Set([
  "MODEL",
  "CLIP",
  "VAE",
  "CONDITIONING",
  "LATENT",
  "CONTROL_NET",
  "SAMPLER",
  "SIGMAS",
  "GUIDER",
  "NOISE",
  "CLIP_VISION",
  "STYLE_MODEL",
  "UPSCALE_MODEL",
]);

const IMAGE_TYPES = new Set(["IMAGE", "MASK"]);

/** Output types that should spawn a *video* node downstream. */
const VIDEO_TYPES = new Set([
  "VIDEO",
  "VHS_FILENAMES",
  "VHS_VIDEOINFO",
  "VHS_AUDIO",
  "AUDIO",
]);

/** Decide the control to render for one exposed input. */
export function controlForEntry(e: WorkflowIOEntry): ControlKind {
  const t = (e.type ?? "*").toUpperCase();
  if (LINK_ONLY.has(t)) return "link";
  if (IMAGE_TYPES.has(t)) return "image";
  if (t === "BOOLEAN" || t === "BOOL") return "switch";
  if (t === "INT") return "int";
  if (t === "FLOAT" || t === "NUMBER") return "float";
  if (t === "STRING" || t === "*" || t === "COMBO") {
    if (e.multiline) return "textarea";
    /* A long current value is a strong hint this is a prompt box even when
     * the server heuristic missed the name. */
    if (typeof e.defaultValue === "string" && e.defaultValue.length > 40) return "textarea";
    return "text";
  }
  /* Unknown custom-node type: if it already holds a scalar we can still
   * edit it as text; otherwise treat it as a wire. */
  if (typeof e.defaultValue === "string" || typeof e.defaultValue === "number") return "text";
  return "link";
}

/** Sensible numeric bounds, keyed off the well-known ComfyUI widget names. */
export function numericBounds(e: WorkflowIOEntry): {
  min: number;
  max: number;
  step: number;
  decimalPlaces: number;
} {
  const n = `${e.name} ${e.label ?? ""}`.toLowerCase();
  const isFloat = (e.type ?? "").toUpperCase() === "FLOAT";
  if (/seed|noise_seed/.test(n)) return { min: 0, max: 4294967295, step: 1, decimalPlaces: 0 };
  if (/steps/.test(n)) return { min: 1, max: 200, step: 1, decimalPlaces: 0 };
  if (/^cfg|cfg$|guidance/.test(n)) return { min: 0, max: 30, step: 0.5, decimalPlaces: 1 };
  if (/denoise|strength|weight|scale|ratio/.test(n))
    return { min: 0, max: 2, step: 0.05, decimalPlaces: 2 };
  if (/width|height|size|resolution/.test(n))
    return { min: 64, max: 4096, step: 64, decimalPlaces: 0 };
  if (/batch|count|frames|length/.test(n)) return { min: 1, max: 512, step: 1, decimalPlaces: 0 };
  return isFloat
    ? { min: 0, max: 1000, step: 0.1, decimalPlaces: 2 }
    : { min: 0, max: 1_000_000, step: 1, decimalPlaces: 0 };
}

/** Best display label for an exposed pin. */
export function ioLabel(e: WorkflowIOEntry): string {
  return (e.label && e.label.trim()) || e.name;
}

/** Stable ordering: images first, then prompts, then numbers, then the rest. */
const ORDER: Record<ControlKind, number> = {
  image: 0,
  textarea: 1,
  text: 2,
  switch: 3,
  int: 4,
  float: 5,
  link: 9,
};

/** Split + sort the IO map into the three buckets the UI actually needs.
 *
 *  Wire inputs (kind === "param") are typed-only ports — they can't be
 *  edited, only consumed via a connection from another node's output.
 *  Widget inputs (kind === "widget") carry an editable value (dropdown /
 *  number / boolean / multiline string).  Outputs are grouped with wire
 *  inputs on the canvas because both are "I/O 端点" — points where the
 *  workflow interfaces with the world — while widget inputs are
 *  parameters the author tunes before the workflow runs.
 *
 *  `inputs` is kept as a flat concatenation of wireInputs + widgetInputs
 *  so consumers that don't yet distinguish the two groups keep working. */
export function splitWorkflowIO(io: WorkflowIOMap | undefined | null): {
  /** Inputs that have no widget — must be wired from another node's output.
   *  In ComfyUI these are the "typed-only" ports (positive_prompt, MODEL,
   *  CLIP, …).  Rendered as read-only chips. */
  wireInputs: (WorkflowIOEntry & { ioKey: string; control: ControlKind })[];
  /** Inputs that carry a widget-backed value (dropdown / number / boolean /
   *  multiline-string etc.) — the user can edit these without connections. */
  widgetInputs: (WorkflowIOEntry & { ioKey: string; control: ControlKind })[];
  /** Back-compat flatten: [wireInputs, widgetInputs] in stable order. */
  inputs: (WorkflowIOEntry & { ioKey: string; control: ControlKind })[];
  outputs: (WorkflowIOEntry & { ioKey: string })[];
} {
  const wireInputs: (WorkflowIOEntry & { ioKey: string; control: ControlKind })[] = [];
  const widgetInputs: (WorkflowIOEntry & { ioKey: string; control: ControlKind })[] = [];
  const outputs: (WorkflowIOEntry & { ioKey: string })[] = [];
  for (const [ioKey, e] of Object.entries(io ?? {})) {
    if (!e || typeof e !== "object") continue;
    if (e.direction === "output") {
      outputs.push({ ...e, ioKey });
    } else {
      const enriched = { ...e, ioKey, control: controlForEntry(e) };
      /* `kind === "widget"` is the signal the canvas-side toggle wrote
       *  when the user checked a node's editable parameter.  Anything
       *  else (legacy "param", missing/unknown) is treated as wire-only
       *  — matches the canvas rendering where these rows render the
       *  🔌 chip via `controlForEntry` → "link". */
      if (e.kind === "widget") widgetInputs.push(enriched);
      else wireInputs.push(enriched);
    }
  }
  const sortInputs = (a: { control: ControlKind } & { [k: string]: unknown }, b: { control: ControlKind } & { [k: string]: unknown }) =>
    (ORDER as Record<string, number>)[a.control] - (ORDER as Record<string, number>)[b.control] ||
    String(ioLabel(a as never)).localeCompare(String(ioLabel(b as never)));
  wireInputs.sort(sortInputs as never);
  widgetInputs.sort(sortInputs as never);
  outputs.sort((a, b) => ioLabel(a).localeCompare(ioLabel(b)));
  return {
    wireInputs,
    widgetInputs,
    inputs: [...wireInputs, ...widgetInputs],
    outputs,
  };
}

/**
 * What kind of downstream canvas node should receive this workflow's result?
 * Driven by the exposed OUTPUT pins (the user's own curation), falling back
 * to the workflow's declared taskType, then to an image node.
 */
export function outputTargetKind(
  io: WorkflowIOMap | undefined | null,
  taskType?: string | null
): "image" | "video" {
  const { outputs } = splitWorkflowIO(io);
  for (const o of outputs) {
    const t = (o.type ?? "").toUpperCase();
    if (VIDEO_TYPES.has(t)) return "video";
  }
  for (const o of outputs) {
    if (IMAGE_TYPES.has((o.type ?? "").toUpperCase())) return "image";
  }
  const tt = (taskType ?? "").toLowerCase();
  if (tt.includes("video") || tt === "t2v" || tt === "i2v" || tt === "flfvideo") return "video";
  return "image";
}

/** Seed a value map from the enriched `defaultValue`s. */
export function defaultInputValues(io: WorkflowIOMap | undefined | null): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const { inputs } = splitWorkflowIO(io);
  for (const e of inputs) {
    if (e.control === "link") continue;
    if (e.defaultValue !== undefined) out[e.ioKey] = e.defaultValue;
    else if (e.control === "switch") out[e.ioKey] = false;
    else if (e.control === "int" || e.control === "float") out[e.ioKey] = numericBounds(e).min;
    else if (e.control === "textarea" || e.control === "text") out[e.ioKey] = "";
  }
  return out;
}

/**
 * Merge stored values over freshly-derived defaults.  Keys that no longer
 * exist in the workflow (pin un-ticked / workflow re-imported) are dropped so
 * a stale value can never be POSTed into a node that doesn't accept it.
 */
export function reconcileInputValues(
  io: WorkflowIOMap | undefined | null,
  stored: Record<string, unknown> | undefined
): Record<string, unknown> {
  const base = defaultInputValues(io);
  if (!stored) return base;
  for (const k of Object.keys(base)) {
    if (stored[k] !== undefined) base[k] = stored[k];
  }
  return base;
}

/**
 * Turn the flat `{ ioKey: value }` map into the wire payload consumed by
 * /api/generate → buildCustomWorkflow, i.e. explicit (nodeId, name, value)
 * triples.  Keys are re-resolved against the live IO map so a renamed /
 * removed pin never leaks through.
 */
export function toWorkflowInputsPayload(
  io: WorkflowIOMap | undefined | null,
  values: Record<string, unknown>
): { nodeId: string; name: string; value: unknown }[] {
  const { inputs } = splitWorkflowIO(io);
  const payload: { nodeId: string; name: string; value: unknown }[] = [];
  for (const e of inputs) {
    if (e.control === "link") continue;
    const v = values[e.ioKey];
    if (v === undefined || v === "") continue;
    payload.push({ nodeId: e.nodeId, name: e.name, value: v });
  }
  return payload;
}

/**
 * 2026-08-11 (R57): treat a value as "filled" for the purpose of
 * required-field validation.  `undefined` / `null` / empty string / NaN
 * all count as empty; `false` (boolean switch) DOES count as filled,
 * since a switch is either explicitly on or off — there's no third state.
 */
export function isInputFilled(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  /* boolean / object / array — anything truthy-by-presence counts as filled. */
  return true;
}

/**
 * Return the ioKeys of every required widget input that has no usable
 * value yet.  Used by CreatePanel / CanvasNode as a submit guard so a
 * user can never enqueue a workflow with a missing `positive_prompt`
 * when the author marked it as required.  Wire (param) inputs are
 * intentionally excluded — those are validated by canvas wiring checks
 * elsewhere (an unwired required wire still surfaces as a missing
 * connection in the form's I/O 端点 strip).
 */
export function getMissingRequiredInputs(
  io: WorkflowIOMap | undefined | null,
  values: Record<string, unknown>
): string[] {
  if (!io) return [];
  const out: string[] = [];
  for (const [key, e] of Object.entries(io)) {
    if (!e || typeof e !== "object") continue;
    if (e.direction !== "input") continue;
    if (!e.required) continue;
    if (e.kind !== "widget") continue;
    if (!isInputFilled(values[key])) out.push(key);
  }
  return out;
}
