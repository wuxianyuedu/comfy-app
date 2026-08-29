/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
"use client";
/* Extracted pure module-level helpers — originally declared inside
 * WorkflowCanvasEditor.tsx.  No JSX, no React hooks. */
import { getCustomNodePackage } from "@/config/custom-nodes";
import { edgeType, portColor, edgeTypeByInputName } from "@/lib/comfyui/types";
import type { Node, Edge } from "@xyflow/react";
import type {
  ComfyGraphNode,
  WorkflowDetail,
  RawOutputMeta,
  WorkflowGroup,
  NodeJsonViewerRequest,
} from "./workflow-types";
export function rectToAnchor(rect: DOMRect): NodeJsonViewerRequest["anchorRect"] {
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  };
}

/* Raw metadata the parent (`WorkflowCanvasEditor`) has already memoised
 *  at line 4948 — we accept it directly rather than recomputing from
 *  `detail.rawNodes` to avoid a second pass over the same array on every
 *  popover open. */
export function computePos(rect: { left: number; top: number; right: number; width: number; height: number }): {
  left: number;
  top: number;
} {
  const POPOVER_W = 460;
  const GAP = 8;
  const INSET = 24;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  /* Place the popover's LEFT edge here.  Try RIGHT first; flip LEFT if
   *  it would push past the viewport (i.e., chip-left + chip-width + gap
   *  + popover-width > viewport - inset). */
  const rightCandidate = rect.left + rect.width + GAP;
  const leftFits = rightCandidate + POPOVER_W + INSET <= vw;
  const left = leftFits ? rightCandidate : Math.max(INSET, rect.left - GAP - POPOVER_W);
  /* Vertical center on chip — clamp so the popover stays inside vh with
   *  a 24px top and bottom buffer (max-height 60vh is enforced in the
   *  popover style — this just keeps the anchor near the chip). */
  const chipCenter = rect.top + rect.height / 2;
  const desiredTop = chipCenter - 32; // header is ~64px tall
  const top = Math.min(Math.max(INSET, desiredTop), vh - INSET - 64);
  return { left, top };
}

/* Small metadata chip used in the meta strip.  Plain styled span — no
 *  button semantics needed (clicking does nothing). */
export const KNOWN_PACKAGE_HEURISTIC: Record<string, string> = {
  SetNode: "efficiency-nodes",
  GetNode: "efficiency-nodes",
};

/** Resolve the package-source label for a workflow node.
 *
 *  Resolution order (first non-empty wins):
 *    1. `getCustomNodePackage(classType)` — populated by
 *       `refreshCustomNodes()` from the on-disk custom-nodes manifest.
 *       Most accurate when present (exact directory name).
 *    2. `KNOWN_PACKAGE_HEURISTIC[classType]` — manual fallback for
 *       packages the parser missed (see above).
 *    3. `properties.cnr_id` — ComfyUI's own "this node was registered
 *       with registry X" stamp.  Treats the literal `"comfy-core"` as
 *       built-in (ComfyUI uses that string for internal LiteGraph UUID
 *       classes like `Extension` / `Preview3D`).
 *    4. `(rgthree)` suffix shortcut — `Fast Groups Bypasser (rgthree)`,
 *       `Power Lora Loader (rgthree)`, etc. live under the `rgthree-comfy`
 *       directory regardless of manifest/cnr_id state.  Suffix keyword kept
 *       in sync with the registered packages' `MAPPING` convention.
 *
 *  Returns the literal `"ComfyUI"` when nothing matched — `PackageFooter`
 *  treats that as the built-in hint and hides the label entirely. */
export function resolveNodePackage(
  classType: string,
  properties?: Record<string, any>
): string {
  const fromManifest = getCustomNodePackage(classType);
  if (fromManifest) return fromManifest;
  const fromHeuristic = KNOWN_PACKAGE_HEURISTIC[classType];
  if (fromHeuristic) return fromHeuristic;
  const cnr = properties?.cnr_id;
  if (typeof cnr === "string" && cnr.length > 0 && cnr !== "comfy-core") {
    return cnr;
  }
  if (classType.includes("(rgthree)")) return "rgthree-comfy";
  return "ComfyUI";
}

/** ComfyUI-native `frontend_only` pill (bottom-left).  Rendered when a
 *  node's LiteGraph `properties.frontend_only === true`, indicating the
 *  node does all its work in the browser frontend and has no backend
 *  execution.  This is a SEPARATE UI element from the package-source
 *  footer — both can show at once, both sit bottom-left, and they answer
 *  two different questions ("where did this node come from?" vs "does it
 *  run on the server?").  Mirrors ComfyUI's own dim italic label. */
export function extractNoteTitle(text: string, fallback?: string): string {
  let raw = "";
  if (fallback?.trim()) {
    raw = fallback.trim();
    // Strip a leading "Note:" / "Note : " prefix ComfyUI bakes in for some
    // converted flows so the rendered title bar doesn't echo "Note: Note: X".
    raw = raw.replace(/^Note\s*[:：]\s*/i, "").trim();
    if (raw) return raw;
  }
  if (!text) return "";
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const match = /^#{1,3}\s+(.+?)\s*$/.exec(line);
    if (match) return match[1]!;
  }
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed) return trimmed.length > 32 ? trimmed.slice(0, 30) + "…" : trimmed;
  }
  return "";
}

/** Node class types that are pure annotations (no inputs/outputs, no ports). */
export function isNoteType(classType: string): boolean {
  return classType === "Note" || classType === "MarkdownNote";
}

/* ── Title bar height ──
 *  LiteGraph (and therefore ComfyUI) draws every titled node with a
 *  fixed `LiteGraph.NODE_TITLE_HEIGHT = 30` bar at the TOP of the node.
 *  2026-08-11 R49 (user rule): the serialised `size: [w, h]` in the
 *  raw archive is the BODY CONTENT height (the 30 px title bar is NOT
 *  included in `size[1]`).  So the actual rendered node box = content
 *  height + NODE_TITLE_H = `size[1] + 30`.
 *
 *  Convention (2026-08-11, user rule):
 *    • `data.size.h` carries the raw BODY CONTENT height = `size[1]`
 *      (NO subtraction).
 *    • The React Flow node `style.height` = `size[1] + NODE_TITLE_H`
 *      (total with title bar).
 *    • Each renderer's body uses `minHeight = data.size.h` as the
 *      content floor; the title bar lives above it and is part of the
 *      React Flow box, not the body flex container.
 *  Untitled notes do not have a separate title bar, so their React Flow
 *  box = `size[1]` (no addition). */
export const NODE_TITLE_H = 30;

/* ---------------------------------------------------------------------------
 *  Pseudo "frosted glass" layer — FAILBACK ONLY, currently NOT rendered.
 *  It paints synthetic coloured blur blobs inside the node box and samples
 *  NO real pixels from behind, so Chromium's small-element re-tile artefact
 *  (4 / 9 / 16 repeated notes at low zoom) can never occur.  It was used
 *  between two real-backdrop attempts, but the user preferred the genuine
 *  see-through blur, so the live path is <NodeFrost> — a REAL
 *  `backdrop-filter` on an inner layer that counter-scales by 1/zoom so its
 *  on-screen footprint never shrinks small enough to re-tile (see WorkflowNode).
 *  Kept here so it can be re-enabled instantly if the real-blur artefact
 *  ever resurfaces on some browser.
 * --------------------------------------------------------------------------- */
export function pseudoFrostPalette(modeColor: string | null) {
  const mode = modeColor ?? "#ec4899";
  return {
    primary:   hexToRgba(mode, 0.45),                    // mode-tinted mass
    secondary: hexToRgba(mode, 0.30),                    // mode-tinted halftone
    cool:      "rgba(110, 145, 215, 0.32)",           // cool blue "leak"
    warm:      "rgba(255, 255, 255, 0.10)",           // light from above
    shadow:    "rgba(0, 0, 0, 0.36)",                 // unlit corner
  };
}

/** Pseudo-frost overlay.  Renders absolutely behind the node content (under
 *  the header / body), with `pointer-events: none` and `aria-hidden` so it
 *  never affects hit-testing, selection, or screen-reader output. */
export function inferOutputTypeAll(classType: string): Record<string, string> {
  // ComfyUI lets nodes name their outputs; we don't have that info offline,
  // so we use slot-based names.  For CheckpointLoaderSimple etc. this is
  // MODEL/CLIP/VAE which lines up with ComfyUI's default display.
  const KNOWN_NAMES: Record<string, string[]> = {
    CheckpointLoaderSimple:          ["MODEL", "CLIP", "VAE"],
    CheckpointLoader:                ["MODEL", "CLIP", "VAE"],
    UNETLoader:                      ["MODEL"],
    UNetLoader:                      ["MODEL"],
    CLIPLoader:                      ["CLIP"],
    DualCLIPLoader:                  ["CLIP", "CLIP"],
    VAELoader:                       ["VAE"],
    ControlNetLoader:                ["CONTROL_NET"],
    LoraLoader:                      ["MODEL", "CLIP"],
    KSampler:                        ["LATENT"],
    KSamplerAdvanced:                ["LATENT"],
    CLIPTextEncode:                  ["CONDITIONING"],
    CLIPTextEncodeSDXL:              ["positive", "negative"],
    VAEDecode:                       ["IMAGE"],
    VAEEncode:                       ["LATENT"],
    EmptyLatentImage:                ["LATENT"],
    LoadImage:                       ["IMAGE", "MASK"],
    ImageScale:                      ["IMAGE"],
    ImageUpscaleWithModel:           ["IMAGE"],
    LatentUpscale:                   ["LATENT"],
    SetLatentNoiseMask:              ["LATENT"],
    ControlNetApply:                 ["CONDITIONING"],
    ConditioningCombine:             ["CONDITIONING"],
    ConditioningAverage:             ["CONDITIONING"],
    SaveImage:                       [],
    PreviewImage:                    [],
    WanVideoSampler:                 ["LATENT"],
    WanVideoDecode:                  ["IMAGE"],
    WanVideoImageToVideoEncode:      ["LATENT"],
    WanVideoTextEncode:              ["CONDITIONING"],
    WanVideoT5TextEncode:            ["CONDITIONING"],
    WanVideoModelLoader:             ["MODEL", "CLIP", "VAE"],
  };
  const types = KNOWN_NAMES[classType] ?? [];
  const out: Record<string, string> = {};
  for (let i = 0; i < types.length; i++) {
    out[types[i] ?? `out${i + 1}`] = types[i] ?? "UNKNOWN";
  }
  return out;
}

/** Render a widget value as ComfyUI would:
 *   - numbers → 4dp trailing-zero strip (e.g. 1.00)
 *   - booleans → ✓ / ✕ icon
 *   - long strings → first 50 chars + ellipsis (full text in title)
 *   - objects → "{...}" */
export function renderWidgetValue(value: any, classType: string, key: string): string {
  if (value === undefined || value === null) return "—";
  if (typeof value === "boolean") return value ? "✓" : "✕";
  if (typeof value === "number") {
    // Keep small floats as 2dp; integers without dp.
    if (Number.isInteger(value) || value >= 10000) return String(value);
    const str = (Math.round(value * 100) / 100).toFixed(2);
    // strip trailing zeros (1.00 → 1) but keep precision
    return str.replace(/\.?0+$/, "") || "0";
  }
  if (typeof value === "string") {
    /* Filenames like "DaSiWa_Wan22_I2V_14B_SnatchKiss_v1.safetensors" run
     *  40+ chars; previously this function hard-truncated to 48 chars,
     *  which produced the "DaSiWa_Wan22_…" inline display regardless of
     *  node width.  The truncation now lives in CSS (`maxWidth: 480px`
     *  on the consuming <span>) — that way a wider node shows the full
     *  filename, and the full text remains available via `title`. */
    return value;
  }
  if (Array.isArray(value)) return "[…]";
  if (typeof value === "object") return "{…}";
  return String(value);
}

/** Choose a text color for the value cell based on its JS type.  The
 *  goal is to make the value-column visually subordinate to the label
 *  column while still being easy to scan at a glance — we keep all
 *  hues inside a low-saturation palette so the chip never looks like
 *  a rainbow.  Returns a CSS color (rgba) suitable for inline style. */
export function valueCellColor(value: any): string {
  if (value === undefined || value === null) return "rgba(255,255,255,0.30)";
  if (typeof value === "boolean") return value ? "#86efac" /* green-300 */ : "#fca5a5" /* red-300 */;
  if (typeof value === "number") return "#fcd34d" /* amber-300 */;
  if (typeof value === "string") return "#c7d2fe" /* indigo-200 */;
  return "rgba(255,255,255,0.55)";
}

/** Append an alpha channel to a value-cell color so a wired-widget row's
 *  control value reads one notch dimmer than an unwired one — signalling
 *  "this is the widget default; the live value comes from the wire".
 *  `valueCellColor` returns 6-digit hex for real values; for any
 *  edge-case rgba input we lower the alpha instead. */
export function withAlpha(color: string): string {
  if (color.startsWith("#") && color.length === 7) return color + "66";
  const match = /rgba\(([^)]+)\)/.exec(color);
  if (match) {
    const parts = match[1]!.split(",").map((str) => str.trim());
    if (parts.length === 4) return `rgba(${parts[0]},${parts[1]},${parts[2]},0.40)`;
  }
  return color;
}

/** Same shape as WorkflowNode's widget values but stripped of any classType
 *  / key-aware sanitisation — a Subgraph has no `class_type` to ask
 *  for a friendly name from, and the inputs are already chosen by
 *  their `name` (and `localized_name`).  We only need the JS-type-driven
 *  colour family here; the cell on the parent card shows the raw paired
 *  value as ComfyUI stored it. */
export function renderSubgraphWidgetValue(value: unknown): string {
  if (value === undefined || value === null) return "—";
  if (typeof value === "boolean") return value ? "✓" : "✕";
  if (typeof value === "number") {
    if (Number.isInteger(value) || value >= 10000) return String(value);
    const str = (Math.round(value * 100) / 100).toFixed(2);
    return str.replace(/\.?0+$/, "") || "0";
  }
  if (typeof value === "string") {
    /* Same rationale as `renderWidgetValue`: the CSS layer (now with
     *  `maxWidth: 480px` + `text-overflow: ellipsis`) owns display
     *  truncation.  The previous 36-char data-truncation made every long
     *  filename render as "DaSiWa_Wan22_…" inline regardless of how
     *  wide the user had made the node — that broke once the user
     *  asked for value cells to actually use the available width.  Full
     *  text stays available via the `title` attr on the <span>. */
    return value;
  }
  if (Array.isArray(value)) return "[…]";
  if (typeof value === "object") return "{…}";
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return "";
}

/** Trim a raw `label` / `localized_name` down to its user-facing key.
 *  Custom COMBO widgets (KJNodes etc.) bake their full options list
 *  into the label as `"<Key>: opt1 | opt2 | opt3"`, which clutters the
 *  row — those option lists are stripped.  BUT a BOOLEAN toggle
 *  descriptor such as `"Model: True = 🟡 Safetensors | False = 🟣 GGUF"`
 *  (rgthree Settings nodes) is *semantic*, not a list of selectable
 *  options — it tells the reader what the on/off states switch between,
 *  so it must be kept intact.  (2026-08-16 R-ardot71: the previous build
 *  stripped these to a bare `Model`, which read as a truncated /
 *  incomplete label; the full descriptor now renders and wraps via the
 *  R-ardot71 CSS fix on the widget-label span.)  Plain colon-bearing
 *  sentences like "Note: keep this secret" are also kept untouched. */
export function sanitizeComboLabel(label: string | undefined | null): string {
  if (!label) return "";
  const colon = label.indexOf(":");
  if (colon <= 0 || colon === label.length - 1) return label.trim();
  const tail = label.slice(colon + 1);
  /* Strip only when the tail looks like a multi-option COMBO list:
   * contains another `=` or `|` *and* is NOT a BOOLEAN descriptor
   * (`true =` / `false =` markers).  A BOOLEAN descriptor is kept so the
   * full label reaches the layout — where the R-ardot71 CSS fix lets it
   * wrap onto multiple lines instead of being clipped. */
  const isBooleanDescriptor = /\b(?:true|false)\s*=/i.test(tail);
  if (/[=|]/.test(tail) && !isBooleanDescriptor) {
    return label.slice(0, colon).trim();
  }
  return label.trim();
}


/* ── Group frame node (ComfyUI group / frame rectangle) ──
 * Pure decoration: a translucent filled rectangle with a coloured border and a
 * title chip.  It never carries ports and never intercepts pointer events, so
 * it sits behind the real graph nodes and clicks pass straight through. */
export function colorToRgba(hex: string, alpha: number): string {
  const red = parseInt(hex.slice(1, 3), 16);
  const green = parseInt(hex.slice(3, 5), 16);
  const blue = parseInt(hex.slice(5, 7), 16);
  return `rgba(${red},${green},${blue},${alpha})`;
}

/** Parse a #rgb / #rrggbb colour into an rgba() string, tolerating
 *  malformed input by falling back to a neutral slate. */
export function hexToRgba(hex: string, alpha: number): string {
  let hexValue = (hex || "").trim();
  if (hexValue.startsWith("#")) hexValue = hexValue.slice(1);
  if (hexValue.length === 3) hexValue = hexValue.split("").map((char) => char + char).join("");
  if (hexValue.length < 6) return `rgba(120,120,135,${alpha})`;
  const red = parseInt(hexValue.slice(0, 2), 16);
  const green = parseInt(hexValue.slice(2, 4), 16);
  const blue = parseInt(hexValue.slice(4, 6), 16);
  return `rgba(${red},${green},${blue},${alpha})`;
}

/** Mix a hex colour towards white by `amt` (0..1) so dark group colours still
 *  produce a readable title chip on the dark canvas. */
export function lightenHex(hex: string, amt: number): string {
  let hexValue = (hex || "").trim();
  if (hexValue.startsWith("#")) hexValue = hexValue.slice(1);
  if (hexValue.length === 3) hexValue = hexValue.split("").map((char) => char + char).join("");
  if (hexValue.length < 6) return hex;
  let red = parseInt(hexValue.slice(0, 2), 16);
  let green = parseInt(hexValue.slice(2, 4), 16);
  let blue = parseInt(hexValue.slice(4, 6), 16);
  red = Math.round(red + (255 - red) * amt);
  green = Math.round(green + (255 - green) * amt);
  blue = Math.round(blue + (255 - blue) * amt);
  return `rgb(${red},${green},${blue})`;
}

/** Parse #rgb / #rrggbb → [r,g,b]; falls back to a neutral slate on
 *  malformed input. */
export function parseHex(hex: string): [number, number, number] {
  let hexValue = (hex || "").trim();
  if (hexValue.startsWith("#")) hexValue = hexValue.slice(1);
  if (hexValue.length === 3) hexValue = hexValue.split("").map((char) => char + char).join("");
  if (hexValue.length < 6 || /[^0-9a-fA-F]/.test(hexValue)) return [120, 120, 135];
  return [parseInt(hexValue.slice(0, 2), 16), parseInt(hexValue.slice(2, 4), 16), parseInt(hexValue.slice(4, 6), 16)];
}

/** Blend hex `a` (the *base*, e.g. a node's canvas-coloured body) towards
 *  hex `b` (the *tint*, e.g. the node's role colour) by factor `t ∈ [0,1]`,
 *  returning an opaque `rgb(r,g,b)`.  Convention:
 *
 *    t=0  →  pure `a` (the base colour, no tint applied)
 *    t=1  →  pure `b` (fully replaced by the tint)
 *    0<t<1 → opaque equivalent of "semi-transparent tint painted over the
 *            base" (what a CSS `rgba(tint, t)` over the base would look
 *            like, baked into a single solid `rgb()`).
 *
 *  Always call as `mixHex(baseColor, tintColor, t)` — same direction as
 *  "mix X% of the tint into the base".  Behaviour mirrors CSS
 *  `color-mix(in srgb, base X%, tint Y%)` where Y/(X+Y) ≡ t. */
export function mixHex(colorA: string, colorB: string, ratio: number): string {
  const pa = parseHex(colorA);
  const pb = parseHex(colorB);
  const red = Math.round(pa[0] + (pb[0] - pa[0]) * ratio);
  const green = Math.round(pa[1] + (pb[1] - pa[1]) * ratio);
  const bl = Math.round(pa[2] + (pb[2] - pa[2]) * ratio);
  return `rgb(${red},${green},${bl})`;
}

/* Build ReactFlow edges from a ComfyUI graph: every input value of shape
 * [nodeId, outputIndex] becomes an edge from that node to the consumer.
 *  - `targetHandle` is the input field name so ReactFlow snaps the wire to
 *    the matching Handle id (which WorkflowNode renders for each connection row).
 *  - `sourceHandle` is "out:<outputName>" so the wire lands on the
 *    per-output Handle we render at the bottom of each node.
 *  - Stroke colour comes from the data type flowing through the wire —
 *    MODEL→purple, CLIP→yellow, LATENT→violet, etc. — so the canvas
 *    reads like a faithful ComfyUI graph. */

/* 2026-08-12 R78.2: longest-path (Kahn) topological layout.  Returns a
 * position for EVERY real graph node (no truncation, unlike
 * `buildWorkflowPreview` which caps at 14 for the card preview).  Used
 * by both the legacy auto-layout fallback (API-only imports with no
 * saved positions) and the new "API 布局" view mode (force the
 * execution-graph topology regardless of the imported rawJson layout). */
export function computeKahnLayout(
  realNodes: ComfyGraphNode[],
  graph: Record<string, any>,
  colW: number,
  rowH: number,
  padX: number,
  padY: number
): Record<string, { x: number; y: number }> {
  const level: Record<string, number> = {};
  const incoming: Record<string, Set<string>> = {};
  const outAdj: Record<string, Set<string>> = {};
  for (const node of realNodes) {
    incoming[node.id] = new Set();
    outAdj[node.id] = new Set();
  }
  for (const [id, raw] of Object.entries(graph)) {
    const inputs = (raw)?.inputs;
    if (!inputs || typeof inputs !== "object") continue;
    for (const value of Object.values(inputs)) {
      if (
        Array.isArray(value) &&
        value.length >= 1 &&
        typeof value[0] === "string" &&
        outAdj[value[0]] &&
        incoming[id]
      ) {
        incoming[id].add(value[0]);
        outAdj[value[0]]!.add(id);
      }
    }
  }
  const remaining = new Map(Object.entries(incoming).map(([key, links]) => [key, links.size]));
  const queue: string[] = [];
  for (const [id, deg] of remaining) {
    if (deg === 0) {
      level[id] = 0;
      queue.push(id);
    }
  }
  while (queue.length) {
    const id = queue.shift()!;
    for (const nxt of outAdj[id]!) {
      level[nxt] = Math.max(level[nxt] ?? 0, (level[id] ?? 0) + 1);
      remaining.set(nxt, (remaining.get(nxt) ?? 0) - 1);
      if ((remaining.get(nxt) ?? 0) === 0) queue.push(nxt);
    }
  }
  for (const node of realNodes) if (!(node.id in level)) level[node.id] = 0;

  const byLevel: Record<number, string[]> = {};
  for (const node of realNodes) {
    const lv = level[node.id] ?? 0;
    (byLevel[lv] ||= []).push(node.id);
  }
  for (const arr of Object.values(byLevel)) arr.sort();

  const pos: Record<string, { x: number; y: number }> = {};
  for (const node of realNodes) {
    const lv = level[node.id] ?? 0;
    const arr = byLevel[lv] ?? [];
    const row = arr.indexOf(node.id);
    pos[node.id] = { x: padX + lv * colW, y: padY + row * rowH };
  }
  return pos;
}

export function buildEdges(
  detail: WorkflowDetail | null,
  _nodes: Node[],
  outSlotNameById?: Record<string, string[]>
): Edge[] {
  if (!detail) return [];
  // Only real graph nodes carry edges; group/note frames never do.
  const known = new Set(detail.nodes.map((node) => node.id));
  const nodesById: Record<string, ComfyGraphNode> = {};
  for (const node of detail.nodes) nodesById[node.id] = node;

  const edges: Edge[] = [];
  let i = 0;
  for (const [nodeId, raw] of Object.entries(detail.graph ?? {})) {
    if (!raw || typeof raw !== "object") continue;
    const inputs = (raw).inputs;
    if (!inputs || typeof inputs !== "object") continue;
    for (const [inputName, value] of Object.entries(inputs)) {
      if (!Array.isArray(value) || value.length < 1 || typeof value[0] !== "string") continue;
      const srcId = value[0];
      if (!known.has(srcId) || !known.has(nodeId)) continue;
      const srcSlot = Number(value[1] ?? 0);
      const srcClass = nodesById[srcId]?.class_type;
      const type =
        edgeType(srcClass, srcSlot) !== "UNKNOWN"
          ? edgeType(srcClass, srcSlot)
          : edgeTypeByInputName(inputName);
      const stroke = portColor(type);
      // Pin to the precise output handle when we know its name; otherwise
      // fall back to the generic hidden "out" handle every node exposes.
      // For unknown custom nodes the inferred slot→name table (built by
      // inferSourceOutNames) fills in names like `width` / `height` that
      // both `inferOutputTypeAll` and `raw.outputs[]` miss.
      const slotNames = outSlotNameById?.[srcId];
      const staticNames = Object.keys(inferOutputTypeAll(srcClass ?? ""));
      let outName: string | null = null;
      if (slotNames && srcSlot < slotNames.length) outName = slotNames[srcSlot]!;
      else if (srcSlot < staticNames.length) outName = staticNames[srcSlot]!;
      edges.push({
        id: `e-${srcId}-${nodeId}-${inputName}-${i++}`,
        source: srcId,
        target: nodeId,
        sourceHandle: outName ? `out:${outName}` : "out",
        targetHandle: inputName,
        animated: false,
        style: {
          /* 2026-08-13 R79: match the WorkflowEdge crisp+glow pair (strokeWidth
           *  2.5, opacity 1) so even edges that fall through to React
           *  Flow's default renderer still look as strong as `wf`-typed
           *  ones.  The earlier 2/0.9 baseline was tuned for the old
           *  thin-glow-free WorkflowEdge. */
          stroke,
          strokeWidth: 2.5,
          opacity: 1,
        },
      });
    }
  }

  /* Boundary-pin wiring (2026-08-06 fix): direction matters — React Flow
   * only renders an edge when the source handle is `type="source"` and
   * the target handle is `type="target"`.  Our pin nodes expose:
   *   - input pin:  Left handle `id="in"`, type="source"
   *   - output pin: Right handle `id="out"`, type="target"
   * So an "input" boundary link flows pin → inner (external seed feeds
   * into the wrapper), and an "output" boundary link flows inner → pin
   * (wrapper exposes inner result).  Previously these were inverted and
   * pointed at the wrong handle id, which yielded zero rendered edges. */
  if (detail.boundaryLinks) {
    const bp = detail.boundaryPins;
    const lookupPin = (pinId: string): { type: string } | null => {
      if (!bp) return null;
      return bp.inputs.find((item) => item.id === pinId) ?? bp.outputs.find((item) => item.id === pinId) ?? null;
    };
    for (const bl of detail.boundaryLinks) {
      const pinNodeId = `bpin:${bl.pinId}`;
      const stroke = portColor(lookupPin(bl.pinId)?.type ?? "*");
      if (bl.kind === "input") {
        /* Pin (external seed) → inner node's matching input slot. */
        edges.push({
          id: `e-bb-${bl.linkId}-in`,
          source: pinNodeId,
          sourceHandle: "in",
          target: bl.innerNodeId,
          targetHandle: bl.innerSlotName || "in",
          animated: false,
          style: { stroke, strokeWidth: 2, opacity: 0.9 },
        });
      } else {
        /* Inner node's matching output handle → output pin. */
        edges.push({
          id: `e-bb-${bl.linkId}-out`,
          source: bl.innerNodeId,
          sourceHandle: bl.innerSlotName ? `out:${bl.innerSlotName}` : "out",
          target: pinNodeId,
          targetHandle: "out",
          animated: false,
          style: { stroke, strokeWidth: 2, opacity: 0.9 },
        });
      }
    }
  }

  return edges;
}

/* Resolve a node's input map into per-connection source metadata.  For every
 * input whose value is `[srcId, slot]`, we look up the source node's title
 * and class_type from the provided `nodesById` map so the renderer can show
 * "← <title> #id" next to that row and so the edge colour can be chosen
 * by data type.  Inputs that aren't connections are skipped. */
export function buildInputSources(
  inputs: Record<string, any> | undefined,
  nodesById: Record<string, ComfyGraphNode>
): Record<string, { id: string; title: string; slot: number; classType?: string }> {
  const out: Record<string, { id: string; title: string; slot: number; classType?: string }> = {};
  if (!inputs) return out;
  for (const [key, value] of Object.entries(inputs)) {
    if (!Array.isArray(value) || value.length < 1 || typeof value[0] !== "string") continue;
    const src = nodesById[value[0]];
    out[key] = {
      id: value[0],
      title: src?.title ?? `#${value[0]}`,
      slot: Number(value[1] ?? 0),
      classType: src?.class_type,
    };
  }
  return out;
}

/* Scan the workflow graph once and produce, for every source node, the set
 * of output *names* that have at least one downstream edge.  Used by both
 * WorkflowNode and WorkflowSubgraphNode to decide whether to render a source Handle on
 * each output row — "no wire ⇒ no dot".  Output names are resolved the same
 * way the buildWfNode / buildSubgraphNode output list does so that
 * `connectedOutputs.has(name)` matches the row key.  The optional
 * `outSlotNameById` table is produced by `inferSourceOutNames` for nodes
 * whose outputs are absent from the static table *and* the raw JSON. */
export function buildConnectedOutputs(
  detail: WorkflowDetail,
  nodesById: Record<string, ComfyGraphNode>,
  rawMetaById: Record<string, { widgets_values: any[]; outputs: RawOutputMeta[]; flags?: Record<string, any>; properties?: Record<string, any> }>,
  outSlotNameById?: Record<string, string[]>
): Record<string, Set<string>> {
  const map: Record<string, Set<string>> = {};
  for (const raw of Object.values(detail.graph ?? {})) {
    const inp = (raw)?.inputs ?? {};
    for (const value of Object.values(inp)) {
      if (!Array.isArray(value) || value.length < 1 || typeof value[0] !== "string") continue;
      const srcId = value[0];
      const slot = Number(value[1] ?? 0);
      const node = nodesById[srcId];
      if (!node) continue;
      const slotNames = outSlotNameById?.[srcId];
      const staticOuts = Object.keys(inferOutputTypeAll(node.class_type));
      const rawOuts = rawMetaById[srcId]?.outputs ?? [];
      let name: string | null = null;
      if (slotNames && slot < slotNames.length) {
        name = slotNames[slot] ?? null;
      } else if (slot < staticOuts.length) {
        name = staticOuts[slot]!;
      } else if (slot < rawOuts.length) {
        name = rawOuts[slot]!.name;
      }
      if (!name) continue;
      map[srcId] ??= new Set();
      map[srcId].add(name);
    }
  }
  return map;
}

/* For every source node, derive the per-slot output NAME we'd attach to
 * its source Handle, even for nodes that aren't in the static
 * `inferOutputTypeAll` table and that have no `outputs[]` in the raw
 * JSON.  Sources lookup chain, per node:
 *   1. Static `inferOutputTypeAll` table (KSampler → LATENT, etc.).
 *   2. Raw `outputs[]` array from the imported JSON.
 *   3. Destinations' input key, stripped of ComfyUI's "duplicate field"
 *      suffix (`_N`).  Returns `width` for input `width_1`, etc. — this
 *      is the only way to recover names for fully custom nodes like
 *      ResolutionSelector whose exported workflow carries no outputs.
 *   4. Generic `out<N>` fallback if none of the above produced a name. */
export function inferSourceOutNames(
  detail: WorkflowDetail,
  nodesById: Record<string, ComfyGraphNode>,
  rawMetaById: Record<string, { widgets_values: any[]; outputs: RawOutputMeta[]; flags?: Record<string, any> }>
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [nodeId, node] of Object.entries(nodesById)) {
    const staticNames = Object.keys(inferOutputTypeAll(node.class_type));
    if (staticNames.length > 0) { out[nodeId] = staticNames; continue; }
    const rawNames = (rawMetaById[nodeId]?.outputs ?? []).map((output) => output.name);
    if (rawNames.length > 0) { out[nodeId] = rawNames; continue; }

    // 静态 + raw 都没有，从消费者（下游节点）的输入键反推
    const bySlot: Record<number, string[]> = {};
    for (const [_, consumerRaw] of Object.entries(detail.graph ?? {})) {
      const inp = (consumerRaw)?.inputs ?? {};
      for (const [inputKey, value] of Object.entries(inp)) {
        if (!Array.isArray(value) || value.length < 1 || typeof value[0] !== "string") continue;
        if (value[0] !== nodeId) continue;
        const slot = Number(value[1] ?? 0);
        const stripped = inputKey.replace(/_\d+$/g, "");
        bySlot[slot] ??= [];
        if (!bySlot[slot].includes(stripped)) bySlot[slot].push(stripped);
      }
    }
    const slotCount = Math.max(1, ...Object.keys(bySlot).map(Number), 0);
    const slotNames: string[] = [];
    for (let i = 0; i <= slotCount; i++) {
      const candidates = bySlot[i] ?? [];
      slotNames.push(candidates[0] ?? `out${i + 1}`);
    }
    if (slotNames.length > 0) out[nodeId] = slotNames;
  }
  return out;
}

/* Compute nesting depth for each group by bounding-box containment.  A group's
 * depth is how many other groups directly/indirectly contain it, so child frames
 * render on top of (above) their parents and nested groups read correctly. */
export function computeGroupDepths(groups: WorkflowGroup[]): Record<string, number> {
  if (groups.length === 0) return {};
  const inside = (inner: WorkflowGroup, outer: WorkflowGroup) => {
    const [ix, iy, iw, ih] = inner.bounding;
    const [ox, oy, ow, oh] = outer.bounding;
    const tolerance = 2;
    const same = ix === ox && iy === oy && iw === ow && ih === oh;
    return (
      !same &&
      ox - tolerance <= ix && oy - tolerance <= iy &&
      ox + ow + tolerance >= ix + iw && oy + oh + tolerance >= iy + ih
    );
  };
  const findParent = (group: WorkflowGroup): WorkflowGroup | null => {
    let best: WorkflowGroup | null = null;
    let bestArea = Infinity;
    for (const candidate of groups) {
      if (candidate.id === group.id) continue;
      if (inside(group, candidate)) {
        const area = candidate.bounding[2] * candidate.bounding[3];
        if (area < bestArea) {
          bestArea = area;
          best = candidate;
        }
      }
    }
    return best;
  };
  const depth: Record<string, number> = {};
  for (const group of groups) {
    let depthCount = 0;
    let parent = findParent(group);
    const visited = new Set<string>([group.id]);
    // Defensive: near-duplicate frame bounds (within tolerance) can make two
    // groups report each other as parent, forming a cycle that would otherwise
    // hang the main thread forever on subgraph expand.  Bail out instead.
    while (parent && !visited.has(parent.id) && depthCount < 64) {
      visited.add(parent.id);
      depthCount++;
      parent = findParent(parent);
    }
    depth[group.id] = depthCount;
  }
  return depth;
}

/* ── Inner editor (must be inside ReactFlowProvider) ── */
