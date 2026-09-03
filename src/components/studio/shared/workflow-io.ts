/* ── Shared workflow-IO model (2026-08-09) ──
 *
 * A single source of truth for "what does this custom workflow actually
 * accept / produce", used by BOTH consumers:
 *   • CreatePanel 「自定义工作流」 panel   (src/components/studio/CreatePanel.tsx)
 *   • Canvas `workflow` node               (src/components/studio/project-canvas/CanvasNode.tsx)
 *
 * Data source rule (decided with the user): the ONLY source is the
 * user-curated `workflowIO` selection made in the canvas editor's IO-edit
 * mode.  We never scan the graph to guess parameters — if the author didn't
 * tick a pin, it is not an external parameter.  The server enriches each
 * entry with the ComfyUI data type + current value before it reaches us
 * (see src/app/api/workflows/[id]/route.ts → "workflowIO ENRICHMENT").
 */

import {
  collectModeCodes,
  isVisibleInMode,
  resolveEntryDefault,
  type WorkflowIOEntry,
  type WorkflowIOMap,
  type WorkflowIOModeOverride,
} from "~/lib/workflow-io-types";
export type { WorkflowIOEntry, WorkflowIOMap, WorkflowIOModeOverride };
export { collectModeCodes, isVisibleInMode, resolveEntryDefault };

/** Which control a dynamic form should render for a given entry. */
export type ControlKind =
  | "textarea"
  | "text"
  | "int"
  | "float"
  | "switch"
  | "image"
  | "link" // non-editable connection type (MODEL / CLIP / LATENT / …)
  | "select"; // COMBO with a resolved candidate list (DarkSelect dropdown)

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

/** When a workflowIO entry has no explicit ComfyUI type (e.g. ComfyUI was
 *  offline when the IO map was saved), try to recover the control kind from
 *  the pin name / label / default value so width/height/steps/seed/etc. still
 *  render as numeric steppers and COMBO-like pins like aspect_ratio still
 *  render as select/text instead of plain text.
 *
 *  2026-08-29: this fixes the "DimensionControl disappeared" regression —
 *  without it, every untyped widget falls back to "text", so width/height
 *  pairs are never grouped and the 比例+清晰度 picker never renders. */
function inferControlFromName(e: WorkflowIOEntry): ControlKind | null {
  if (typeof e.defaultValue === "number") {
    return Number.isInteger(e.defaultValue) ? "int" : "float";
  }
  const search = `${e.name} ${e.label ?? ""}`.toLowerCase();
  if (e.name.toLowerCase() === "aspect_ratio" || /\baspect_ratio\b/.test(search)) {
    return Array.isArray(e.options) && e.options.length > 0 ? "select" : "text";
  }
  if (e.name.toLowerCase() === "megapixels" || /megapixel|百万像素/.test(search)) return "float";
  if (
    /\b(width|height|size|resolution|steps|seed|cfg|denoise|strength|scale|weight|batch|count|frames|length|duration|multiple|倍数)\b/.test(
      search
    )
  ) {
    return "int";
  }
  return null;
}

/** Decide the control to render for one exposed input. */
export function controlForEntry(e: WorkflowIOEntry): ControlKind {
  const type = (e.type ?? "*").toUpperCase();
  if (LINK_ONLY.has(type)) return "link";
  if (IMAGE_TYPES.has(type)) return "image";
  if (type === "BOOLEAN" || type === "BOOL") return "switch";
  if (type === "INT") return "int";
  if (type === "FLOAT" || type === "NUMBER") return "float";
  /* COMBO with a resolved candidate list → render a real <select>
   *  (DarkSelect).  Without options (ComfyUI unreachable / non-enumerable)
   *  fall back to a plain text control so the form never breaks. */
  if (type === "COMBO") {
    if (Array.isArray(e.options) && e.options.length > 0) return "select";
    return "text";
  }
  if (type === "STRING") {
    if (e.multiline) return "textarea";
    /* A long current value is a strong hint this is a prompt box even when
     * the server heuristic missed the name. */
    if (typeof e.defaultValue === "string" && e.defaultValue.length > 40) return "textarea";
    return "text";
  }
  if (type === "*") {
    if (e.multiline) return "textarea";
    /* A long current value is a strong hint this is a prompt box. */
    if (typeof e.defaultValue === "string" && e.defaultValue.length > 40) return "textarea";
    const inferred = inferControlFromName(e);
    if (inferred) return inferred;
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
  const name = `${e.name} ${e.label ?? ""}`.toLowerCase();
  const isFloat = (e.type ?? "").toUpperCase() === "FLOAT";
  if (/seed|noise_seed/.test(name)) return { min: 0, max: 4294967295, step: 1, decimalPlaces: 0 };
  if (name.includes('steps')) return { min: 1, max: 200, step: 1, decimalPlaces: 0 };
  if (/^cfg|cfg$|guidance/.test(name)) return { min: 0, max: 30, step: 0.5, decimalPlaces: 1 };
  if (/denoise|strength|weight|scale|ratio/.test(name))
    return { min: 0, max: 2, step: 0.05, decimalPlaces: 2 };
  if (/width|height|size|resolution/.test(name))
    return { min: 64, max: 4096, step: 64, decimalPlaces: 0 };
  if (/batch|count|frames|length/.test(name)) return { min: 1, max: 512, step: 1, decimalPlaces: 0 };
  return isFloat
    ? { min: 0, max: 1000, step: 0.1, decimalPlaces: 2 }
    : { min: 0, max: 1_000_000, step: 1, decimalPlaces: 0 };
}

/** Best display label for an exposed pin.
 *
 * Per user direction (2026-08-15): the canvas's IO editor prefers the
 * `label` field so authors see `positive_prompt` / `negative_prompt`
 * instead of the bare ComfyUI key (`text` / `text_1`).  When the caller
 * also passes the full list of entries being displayed together
 * (`allEntries`), entries that share a label fall back to `name` so the
 * two pins stay visually distinguishable (e.g. two pins both labeled
 * "image" → one becomes "image (inputImage)", the other "image
 * (outputImage)" — both via the name fallback).
 *
 * Without `allEntries` the function returns the same `label || name`
 * behaviour the rest of the app already relies on, so existing callers
 * in CreatePanel / CanvasNode keep working. */
export function ioLabel(e: WorkflowIOEntry, allEntries?: readonly WorkflowIOEntry[]): string {
  const candidate = (e.label?.trim()) ?? e.name;
  if (allEntries && allEntries.length > 1) {
    for (const entry of allEntries) {
      if (entry === e) continue;
      const other = (entry.label?.trim()) ?? entry.name;
      if (other === candidate) return e.name;
    }
  }
  return candidate;
}

/** Per user direction (2026-08-14): the order of parameter rows is up
 *  to the consumer — each row is an independent block, dynamically shown
 *  or hidden based on which IO pins exist.  No forced ordering.  We rely
 *  on the IO map's natural insertion order (Object.entries order), which
 *  matches what the user sees when authoring the workflow in IO-edit
 *  mode.  Outputs are sorted alphabetically by label as a stable-only
 *  tie-breaker for cases where multiple outputs share an insertion
 *  context.
 *
 *  See §"动态更新" in the design source-of-truth (Ardot 714503087315759):
 *    > 「每一块都是可以动态根据是否有对应的参数需要显示来动态更新的，
 *    >  参数可多可少，但是样式就是这样」
 *  The style of each row is fixed by the design; the order is not. */

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
  for (const [ioKey, entry] of Object.entries(io ?? {})) {
    if (!entry || typeof entry !== "object") continue;
    if (entry.direction === "output") {
      outputs.push({ ...entry, ioKey });
    } else {
      const enriched = { ...entry, ioKey, control: controlForEntry(entry) };
      /* `kind === "widget"` is the signal the canvas-side toggle wrote
       *  when the user checked a node's editable parameter.  Anything
       *  else (legacy "param", missing/unknown) is treated as wire-only
       *  — matches the canvas rendering where these rows render the
       *  🔌 chip via `controlForEntry` → "link". */
      if (entry.kind === "widget") widgetInputs.push(enriched);
      else wireInputs.push(enriched);
    }
  }
  /* R-ardot35 (2026-08-15): apply the user-driven displayOrder.  Absent
   *  (undefined) → leave the IO map's natural insertion order untouched
   *  by treating it as +Infinity, so existing workflows without an order
   *  continue to render exactly as before.  Stable sort keeps the
   *  relative order of items that share the same order (e.g. a brand-new
   *  toggle alongside a manually-positioned one).  Each group
   *  (wire / widget / output) is sorted independently — the canvas-side
   *  IO preview keeps "wire + widget inputs above, outputs below" and the
   *  user only reorders within those groups, which is what the design
   *  intent of the preview panel calls for. */
  const byDisplayOrder = (itemA: { displayOrder?: number }, itemB: { displayOrder?: number }) => {
    const ao = itemA.displayOrder;
    const bo = itemB.displayOrder;
    if (ao === bo) return 0;
    if (ao === undefined) return 1;
    if (bo === undefined) return -1;
    return ao - bo;
  };
  wireInputs.sort(byDisplayOrder);
  widgetInputs.sort(byDisplayOrder);
  outputs.sort(byDisplayOrder);
  return {
    wireInputs,
    widgetInputs,
    inputs: [...wireInputs, ...widgetInputs],
    outputs,
  };
}

/** 按当前模式过滤掉 `modes[mode].visible === false` 的行。未开启模式时原样返回，
 *  既有调用方行为完全不变。
 *
 *  刻意只在「展示层」过滤：`defaultInputValues` 依旧给被隐藏的参数播种模式默认值，
 *  因此提交给 ComfyUI 的 payload 不会因为某个参数在当前模式不可见就缺字段——
 *  隐藏只是不打扰用户，不代表这个值不需要下发给工作流。 */
export function filterVisibleInMode<
  T extends { modes?: Record<string, WorkflowIOModeOverride> },
>(entries: T[], mode?: string | null): T[] {
  if (!mode) return entries;
  return entries.filter((entry) => isVisibleInMode(entry, mode));
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
  for (const output of outputs) {
    const type = (output.type ?? "").toUpperCase();
    if (VIDEO_TYPES.has(type)) return "video";
  }
  for (const output of outputs) {
    if (IMAGE_TYPES.has((output.type ?? "").toUpperCase())) return "image";
  }
  const tt = (taskType ?? "").toLowerCase();
  if (tt.includes("video") || tt === "t2v" || tt === "i2v" || tt === "flfvideo") return "video";
  return "image";
}

/** Seed a value map from the enriched `defaultValue`s.
 *
 *  2026-09-03 多模式：传入 `mode` 时走两级回退「模式默认值 → 通用默认值」
 *  （`resolveEntryDefault`），未开启模式时与旧行为完全一致。
 *  注意：这里**不过滤**被隐藏的参数——它们同样需要拿到模式默认值，否则提交
 *  给 ComfyUI 的 payload 会缺字段。隐藏只影响展示层（filterVisibleInMode）。 */
export function defaultInputValues(
  io: WorkflowIOMap | undefined | null,
  mode?: string | null
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const { inputs } = splitWorkflowIO(io);
  for (const entry of inputs) {
    if (entry.control === "link") continue;
    /* R94 (2026-08-17): an author override (`value`) wins over the
     *  graph-derived `defaultValue`, so the IO-edit preview + runtime forms
     *  seed with the custom default.  Restoring a pin clears `value` (see
     *  resetIOPreviewValues in wf-editor-inner) and falls back to
     *  `defaultValue`.  2026-09-03: 模式默认值再压在两者之上。 */
    const resolved = resolveEntryDefault(entry, mode);
    if (resolved !== undefined) out[entry.ioKey] = resolved;
    else if (entry.control === "switch") out[entry.ioKey] = false;
    else if (entry.control === "int" || entry.control === "float") out[entry.ioKey] = numericBounds(entry).min;
    else if (entry.control === "textarea" || entry.control === "text") out[entry.ioKey] = "";
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
  stored: Record<string, unknown> | undefined,
  mode?: string | null
): Record<string, unknown> {
  const base = defaultInputValues(io, mode);
  if (!stored) return base;
  for (const key of Object.keys(base)) {
    if (stored[key] !== undefined) base[key] = stored[key];
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
  for (const entry of inputs) {
    // 2026-08-13 项目级产出：连线传入的 wire-input（link 控件）值也一并下发。
    // 这类 key 仅在用户真正连线时才会写进 values（reconcile 会丢弃无值的 link key），
    // 所以这里无需担心把无意义的 link 默认值发出去。
    const value = values[entry.ioKey];
    if (value === undefined || value === "") continue;
    payload.push({ nodeId: entry.nodeId, name: entry.name, value: value });
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
  for (const [key, entry] of Object.entries(io)) {
    if (!entry || typeof entry !== "object") continue;
    if (entry.direction !== "input") continue;
    if (!entry.required) continue;
    if (entry.kind !== "widget") continue;
    if (!isInputFilled(values[key])) out.push(key);
  }
  return out;
}

/* ─────────────────────────────────────────────────────────────────────────
 * R-ardot98 (2026-08-17): parameter GROUP inference.
 *
 * A custom workflow often exposes a tightly-coupled set of widgets that the
 * user would rather tune as one "paradigm" than as N separate boxes:
 *   • Dimension group  — `width` + `height` (image workflows).  Two fill
 *     styles: (A) edit W/H separately, (B) pick 比例(ratio) + 清晰度(scale)
 *     and let the form compute W/H back into the two widgets.
 *   • Video group      — `length`(frames) + `aspect`(比例) + `quality`(画质).
 *     Two fill styles: (A) edit each widget separately, (B) pick 时长 + 画质
 *     + 比例 from friendly presets that write the real widget values.
 *
 * Inference is purely name/label based (mirrors `numericBounds`'s keyword
 * heuristic) so it needs no schema change and works for any workflow that
 * exposes the conventional pins.  The grouping is discovered by the single
 * consumer `DynamicWorkflowForm` and the matched widgets are then WITHHELD
 * from the generic row rendering (so width/height never appear twice).
 * ───────────────────────────────────────────────────────────────────────── */

/** Enriched widget entry as produced by `splitWorkflowIO().widgetInputs`. */
export type EnrichedWidget = WorkflowIOEntry & { ioKey: string; control: ControlKind };

export interface DimensionGroup {
  kind: "dimension";
  groupId: string;
  /** Conventional W/H pair — renders the "比例 + 清晰度" picker. */
  width?: EnrichedWidget;
  height?: EnrichedWidget;
  /** ResolutionSelector-style pair — renders a "比例 + 像素" quick picker
   *  that writes directly into the two exposed widgets. */
  aspect?: EnrichedWidget;
  megapixels?: EnrichedWidget;
}

export interface VideoGroup {
  kind: "video";
  groupId: string;
  length?: EnrichedWidget;
  aspect?: EnrichedWidget;
  quality?: EnrichedWidget;
}

export type InferredGroup = DimensionGroup | VideoGroup;

/* ── Dimension presets (比例 + 清晰度 → 宽高) ──
 * `ratio` = width / height. R-ardot104 (2026-08-17) splits `DIM_CLARITY_PRESETS`
 * into two `kind`s:
 *   • "pixel"     — long-edge in px (1k = 1024, 2k = 2048, 4k = 4096).  The
 *                   user provides the longer side and the other side is
 *                   derived from the ratio.
 *   • "megapixel" — total pixel count (1M = 1,000,000, 2M = 2,000,000,
 *                   4M = 4,000,000).  Both sides are derived from the
 *                   ratio so each orientation is roughly the same file size.
 *
 * `dimsForRatio` recognises both kinds — `pixel` callers pass `longEdge`,
 * `megapixel` callers pass `totalPixels` (the long edge is computed as
 * `sqrt(totalPixels / ratio)` and then rounded through the same snap-to-8
 * grid as the pixel path).
 *
 * `dimsForRatio` snaps the result to multiples of 8 and clamps to [64, 4096]
 * (the same bounds `numericBounds` gives width/height). */
export const DIM_RATIO_PRESETS: { label: string; ratio: number }[] = [
  { label: "1:1 正方", ratio: 1 },
  { label: "4:3", ratio: 4 / 3 },
  { label: "3:2", ratio: 3 / 2 },
  { label: "16:9 横屏", ratio: 16 / 9 },
  { label: "21:9 超宽", ratio: 21 / 9 },
  { label: "3:4", ratio: 3 / 4 },
  { label: "2:3", ratio: 2 / 3 },
  { label: "9:16 竖屏", ratio: 9 / 16 },
];

/** R-ardot104 (2026-08-17): clarity presets now carry a `kind` field so the
 *  UI can group pixel-based (1k / 2k / 4k) and megapixel-based (1M / 2M /
 *  4M) presets in two sub-rows inside the 清晰度 segment of the
 *  MultiSegmentPopover. */
export interface DimClarityPreset {
  kind: "pixel" | "megapixel";
  /** Display label as shown in the popover chip (e.g. "1k", "1M"). */
  label: string;
  /** Pixel kind: the long-edge in px. */
  longEdge?: number;
  /** Megapixel kind: total pixel count (width * height). */
  totalPixels?: number;
}

export const DIM_CLARITY_PRESETS: DimClarityPreset[] = [
  // Pixel (long edge) — R99 default
  { kind: "pixel", label: "1k", longEdge: 1024 },
  { kind: "pixel", label: "2k", longEdge: 2048 },
  { kind: "pixel", label: "4k", longEdge: 4096 },
  // Megapixel (total pixels) — R104
  { kind: "megapixel", label: "1M", totalPixels: 1_000_000 },
  { kind: "megapixel", label: "2M", totalPixels: 2_000_000 },
  { kind: "megapixel", label: "4M", totalPixels: 4_000_000 },
];

/* ── ResolutionSelector quick presets (2026-08-29) ──
 *  Some custom nodes (e.g. ResolutionSelector) don't expose raw
 *  width/height; they expose `aspect_ratio` (a COMBO whose value is a label
 *  string like "16:9 (Widescreen)") plus `megapixels` (a FLOAT where 1 ≈
 *  1M total pixels).  The dimension picker needs explicit value mappings
 *  for that paradigm because nothing derives W/H from them.
 *
 *  `parseRatioFromLabel` below lets the picker still detect the ACTUAL
 *  ratio from a workflow-specific label string, so a workflow whose node
 *  spells the option differently ("16:9 宽屏", "16:9") still highlights
 *  the right chip instead of silently falling back to "自定义". */
export const ASPECT_RATIO_LABEL_PRESETS: { label: string; value: string; ratio: number }[] = [
  { label: "1:1", value: "1:1 (Square)", ratio: 1 },
  { label: "4:3", value: "4:3 (Standard)", ratio: 4 / 3 },
  { label: "3:2", value: "3:2 (Photo)", ratio: 3 / 2 },
  { label: "16:9", value: "16:9 (Widescreen)", ratio: 16 / 9 },
  { label: "21:9", value: "21:9 (Ultrawide)", ratio: 21 / 9 },
  { label: "9:16", value: "9:16 (Portrait)", ratio: 9 / 16 },
  { label: "2:3", value: "2:3 (Portrait Photo)", ratio: 2 / 3 },
];

export const MEGAPIXEL_VALUE_PRESETS: { label: string; value: number }[] = [
  { label: "1M", value: 1 },
  { label: "2M", value: 2 },
  { label: "4M", value: 4 },
];

/** Pull a numeric w/h ratio out of a free-form aspect label ("16:9 (Wide)").
 *  Returns null when the string carries no recognisable ratio. */
export function parseRatioFromLabel(value: string): number | null {
  const match = /(\d+(?:\.\d+)?)\s*[:x×]\s*(\d+(?:\.\d+)?)/.exec(value);
  if (!match) return null;
  const w = Number(match[1]);
  const h = Number(match[2]);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return w / h;
}

/** Given a target ratio + clarity preset, return snapped {width, height}.
 *
 *  Pixel preset:     long edge = preset.longEdge; other side is derived
 *                    from the ratio.  "Long edge" is whichever side
 *                    of 1 the ratio sits on.
 *  Megapixel preset: both sides are derived symmetrically — the
 *                    constraint `totalPixels = w*h` together with
 *                    `w/h = ratio` gives
 *                      h = sqrt(totalPixels / ratio)
 *                      w = totalPixels / h = sqrt(totalPixels * ratio)
 *                    so the rectangle honours the total-pixel budget
 *                    regardless of orientation.
 *
 *  R-ardot107 (2026-08-17) [fix #2]:
 *    The previous megapixel branch took `rawLongEdge = sqrt(totalPixels)`
 *    and used ratio only to scale the *other* side.  That produced a
 *    geometrically-16:9 rectangle whose actual pixel count was
 *    `totalPixels / ratio` — for 16:9 the user-visible area was
 *    `totalPixels * 9/16 ≈ 0.56M`, exactly the "1M gives 1000×560" the
 *    user reported.  Fix: keep `totalPixels = w*h` as a constraint by
 *    letting ratio enter the square root.
 *
 *  Snap to multiples of 8 (pixel kind) or a user-selectable alignment
 *  multiple (megapixel kind).  R-ardot108 (2026-08-17) made the megapixel
 *  snap configurable because ComfyUI video / SDXL pipelines generally
 *  expect W and H to be multiples of 64; the legacy 8-grid silently
 *  produced non-64-aligned outputs (1336×752 for 1M@16:9) that some
 *  model checkpoint unloaders refused.  Range [8, 128] in steps of 8,
 *  default 64 (matches the user-pinned requirement).  The pixel kind
 *  keeps the fine 8-grid because its long-edge values are already
 *  64-aligned (1k=1024, 2k=2048, 4k=4096). */
export const DEFAULT_ALIGN_MULTIPLE = 64;
export const MIN_ALIGN_MULTIPLE = 8;
export const MAX_ALIGN_MULTIPLE = 128;
/** Clamp `m` into [MIN..MAX] and snap to the nearest multiple of 8.
 *  Anything non-finite / NaN / sub-8 falls back to DEFAULT_ALIGN_MULTIPLE. */
export function normalizeAlignMultiple(multiple: number): number {
  if (!Number.isFinite(multiple) || multiple < MIN_ALIGN_MULTIPLE) return DEFAULT_ALIGN_MULTIPLE;
  const clamped = Math.min(MAX_ALIGN_MULTIPLE, multiple);
  const snapped = Math.round(clamped / 8) * 8;
  return snapped >= MIN_ALIGN_MULTIPLE ? snapped : DEFAULT_ALIGN_MULTIPLE;
}
export function dimsForRatio(
  ratio: number,
  presetOrBase: DimClarityPreset | number,
  alignMultiple: number = DEFAULT_ALIGN_MULTIPLE
): { width: number; height: number } {
  /* R-ardot108 (2026-08-17): megapixel branch honours the user
   *  alignment; pixel branch keeps the legacy 8-grid. */
  const alignM = normalizeAlignMultiple(alignMultiple);
  const snapMega = (value: number) => {
    const snapped = Math.round(value / alignM) * alignM;
    return Math.max(64, Math.min(4096, snapped));
  };
  const snapPixel = (n: number) =>
    Math.max(64, Math.min(4096, Math.round(n / 8) * 8));
  /* Guard against a degenerate / missing ratio: NaN / 0 / negative falls
   * back to a 1:1 square so the form still gets a finite, in-bounds
   * answer. */
  const safeRatio = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;

  if (typeof presetOrBase === "number" || presetOrBase.kind === "pixel") {
    /* Pixel-kind geometry: caller supplies the long edge in pixels, the
     * other side is derived from ratio. */
    const rawLongEdge =
      typeof presetOrBase === "number"
        ? presetOrBase
        : presetOrBase.longEdge ?? 1024;
    const horizontal = safeRatio >= 1;
    const rawW = horizontal ? rawLongEdge : rawLongEdge * safeRatio;
    const rawH = horizontal ? rawLongEdge / safeRatio : rawLongEdge;
    return { width: snapPixel(rawW), height: snapPixel(rawH) };
  }

  /* Megapixel-kind geometry: totalPixels = w*h, w/h = ratio.  h and w
   * derived symmetrically so the total-pixel budget is honoured for
   * both landscape and portrait.  The user-selectable alignMultiple
   * (default 64) snaps W and H to a ComfyUI-friendly grid. */
  const totalPixels = presetOrBase.totalPixels ?? 1_000_000;
  const rawH = Math.sqrt(totalPixels / safeRatio);
  const rawW = totalPixels / rawH;
  return { width: snapMega(rawW), height: snapMega(rawH) };
}

/** R-ardot107 (2026-08-17): rewrite the inverse preset picker.
 *
 *  The previous relative-error scorer had two problems:
 *   (a) [previously documented] For 16:9 the cross-kind comparison
 *       could silently flip a freshly-picked "4M" back to "2k", leaving
 *       two highlights in the popover.
 *   (b) [newly discovered] `dimsForRatio` itself was wrong for the
 *       megapixel kind — see [fix #2] above.  At 16:9 the buggy
 *       `dimsForRatio("4M")` snapped to 1504×848 (= 0.51 × 4M), so even
 *       the "correct" round-trip answer was the wrong preset.
 *
 *  R-ardot108 (2026-08-17): the megapixel snap is now configurable
 *  (`alignMultiple`, default 64).  The inverse picker must mirror the
 *  same multiple — otherwise the forward and inverse functions fall
 *  out of sync (e.g. dimsForRatio(16/9,"1M",64) → 1280×768 but
 *  pickClarityPreset(1280,768) without the parameter → 2M).
 *
 *  The current implementation uses Manhattan distance over the
 *  round-tripped dims: "which preset, when re-applied through
 *  `dimsForRatio`, produces dims closest to the input?"  Ties resolve
 *  to the first preset encountered in `DIM_CLARITY_PRESETS`
 *  (deterministic). */
export function pickClarityPreset(
  width: number,
  height: number,
  alignMultiple: number = DEFAULT_ALIGN_MULTIPLE
): DimClarityPreset {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return DIM_CLARITY_PRESETS[0]!;
  }
  const alignM = normalizeAlignMultiple(alignMultiple);
  const ratio = width / height;
  let best: DimClarityPreset = DIM_CLARITY_PRESETS[0]!;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const preset of DIM_CLARITY_PRESETS) {
    const { width: dw, height: dh } = dimsForRatio(ratio, preset, alignM);
    const dist = Math.abs(width - dw) + Math.abs(height - dh);
    if (dist < bestDist) {
      best = preset;
      bestDist = dist;
    }
  }
  return best;
}

/* ── Keyword matchers (name + label, case-insensitive) ── */
function isDimWidth(e: EnrichedWidget): boolean {
  const name = (e.name || "").toLowerCase();
  const label = (e.label ?? "").toLowerCase();
  if (name.includes('width')) return true;
  if (label === "宽度" || label === "横" || label === "横向") return true;
  if (name === "宽") return true;
  return false;
}
function isDimHeight(e: EnrichedWidget): boolean {
  const name = (e.name || "").toLowerCase();
  const label = (e.label ?? "").toLowerCase();
  /* NOTE: a bare "高" inside a 画质 label like "高清" must NOT count as the
   *  height pin — we only accept the exact Chinese shape 高度/纵向/纵 or the
   *  English name, never a substring of an unrelated label. */
  if (/height|heigth/.test(name)) return true;
  if (label === "高度" || label === "纵" || label === "纵向") return true;
  if (name === "高") return true;
  return false;
}
function isDimAspect(e: EnrichedWidget): boolean {
  const name = (e.name || "").toLowerCase();
  const label = (e.label ?? "").toLowerCase();
  if (/\baspect_ratio\b/.test(name) || /\baspect\b|\bratio\b/.test(name)) return true;
  if (label === "宽高比" || label.includes("比例") || label.includes("纵横")) return true;
  return false;
}
function isDimMegapixels(e: EnrichedWidget): boolean {
  const name = (e.name || "").toLowerCase();
  const label = (e.label ?? "").toLowerCase();
  if (name.includes("megapixel")) return true;
  if (label.includes("百万像素") || label.includes("像素")) return true;
  return false;
}
function isVideoLength(e: EnrichedWidget): boolean {
  const searchText = `${e.name} ${e.label ?? ""}`.toLowerCase();
  return /length|duration|时长|帧数|frames|seconds|秒/.test(searchText);
}
function isVideoAspect(e: EnrichedWidget): boolean {
  const searchText = `${e.name} ${e.label ?? ""}`.toLowerCase();
  return /aspect|ratio|比例|纵横/.test(searchText);
}
function isVideoQuality(e: EnrichedWidget): boolean {
  const searchText = `${e.name} ${e.label ?? ""}`.toLowerCase();
  return /quality|clarity|清晰|画质/.test(searchText);
}

/** Detect a dimension-like widget group from the widget list.
 *
 *  Supports two paradigms:
 *    • width + height            → renders the classic "比例 + 清晰度" picker
 *    • aspect_ratio + megapixels → renders a "比例 + 像素" quick picker that
 *      writes directly into the two exposed widgets (e.g. ResolutionSelector).
 */
export function inferDimensionGroup(widgets: EnrichedWidget[]): DimensionGroup | null {
  const widthWidgets = widgets.filter(
    (entry) => (entry.control === "int" || entry.control === "float") && isDimWidth(entry)
  );
  const heightWidgets = widgets.filter(
    (entry) => (entry.control === "int" || entry.control === "float") && isDimHeight(entry)
  );
  if (widthWidgets.length > 0 && heightWidgets.length > 0) {
    const width = widthWidgets[0]!;
    const height = heightWidgets[0]!;
    if (width.ioKey === height.ioKey) return null;
    return {
      kind: "dimension",
      groupId: `dim:${width.ioKey}|${height.ioKey}`,
      width,
      height,
    };
  }

  /* ResolutionSelector-style: the user exposed "宽高比" + "百万像素" instead
   *  of raw width/height.  We don't require a specific control kind because
   *  these pins are often COMBO/FLOAT but may arrive as untyped "text" when
   *  ComfyUI was offline during IO curation. */
  const aspectWidgets = widgets.filter(isDimAspect);
  const mpWidgets = widgets.filter(isDimMegapixels);
  if (aspectWidgets.length > 0 && mpWidgets.length > 0) {
    const aspect = aspectWidgets[0]!;
    const megapixels = mpWidgets[0]!;
    if (aspect.ioKey === megapixels.ioKey) return null;
    return {
      kind: "dimension",
      groupId: `aspect-mp:${aspect.ioKey}|${megapixels.ioKey}`,
      aspect,
      megapixels,
    };
  }

  return null;
}

/** Detect a length+aspect+quality video group from the widget list. */
export function inferVideoGroup(widgets: EnrichedWidget[]): VideoGroup | null {
  const len = widgets.filter(isVideoLength);
  const asp = widgets.filter(isVideoAspect);
  const quality = widgets.filter(isVideoQuality);
  if (len.length === 0) return null;
  if (asp.length === 0 && quality.length === 0) return null;
  return {
    kind: "video",
    groupId: `video:${len[0]!.ioKey}|${(asp[0]?.ioKey) ?? ""}|${(quality[0]?.ioKey) ?? ""}`,
    length: len[0],
    aspect: asp[0],
    quality: quality[0],
  };
}

/** Run both inferences, excluding dimension pins from the video scan so a
 *  single widget can never belong to two groups.  Returns the matched groups
 *  plus the complete set of ioKeys they consume (so the caller can suppress
 *  the generic per-widget rows for those pins). */
export function inferGroups(widgets: EnrichedWidget[]): {
  dimension: DimensionGroup | null;
  video: VideoGroup | null;
  groupedKeys: Set<string>;
} {
  const dimension = inferDimensionGroup(widgets);
  /* R-ardot109 (2026-08-29): a dimension group may be either the W/H pair or
   *  the 宽高比 + 百万像素 pair, so collect whichever pins it actually holds
   *  instead of assuming `width`/`height` are present. */
  const dimKeys = new Set<string>();
  if (dimension) {
    if (dimension.width) dimKeys.add(dimension.width.ioKey);
    if (dimension.height) dimKeys.add(dimension.height.ioKey);
    if (dimension.aspect) dimKeys.add(dimension.aspect.ioKey);
    if (dimension.megapixels) dimKeys.add(dimension.megapixels.ioKey);
  }
  const rest = widgets.filter((widget) => !dimKeys.has(widget.ioKey));
  const video = inferVideoGroup(rest);
  const groupedKeys = new Set<string>([...dimKeys]);
  if (video) {
    if (video.length) groupedKeys.add(video.length.ioKey);
    if (video.aspect) groupedKeys.add(video.aspect.ioKey);
    if (video.quality) groupedKeys.add(video.quality.ioKey);
  }
  return { dimension, video, groupedKeys };
}
