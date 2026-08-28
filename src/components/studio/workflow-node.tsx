/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
/* Extracted FlowNode (custom ComfyUI graph node renderer) + its private
 * rgthree body helpers.  Originally inside WorkflowCanvasEditor.tsx. */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Handle, Position } from "@xyflow/react";
import {
  portColor, portLabel, inferInputType, inferOutputType, inferIsMultiline,
  edgeType, edgeTypeByInputName,
} from "@/lib/comfyui/types";
import { friendlyNodeTitle, friendlyInputName, friendlySubgraphLabel } from "@/lib/comfyui/node-titles";
import { renderMarkdown } from "@/lib/comfyui/markdown";
import { PackageFooter } from "@/components/workflow-canvas/nodes/PackageFooter";
import { DebugChainFooter } from "./DebugChainFooter";
import { getWorkflowRenderChainModules } from "./workflow-render-chain";
import { useDebugStore } from "./debug-store";
import { getCustomNodePackage, refreshCustomNodes } from "@/config/custom-nodes";
import { DynamicWorkflowForm } from "@/components/studio/shared/DynamicWorkflowForm";
import { WorkflowEdge } from "@/components/studio/workflow-edge";
import { SourceModal } from "@/components/studio/SourceModal";
import { useToast } from "@/components/studio/toast-provider";
import type { WorkflowIOMap } from "@/components/studio/shared/workflow-io";
import type {
  WorkflowNodeData, WorkflowSubgraphData, WorkflowGroupData, WorkflowIoPortData, WorkflowNoteData,
  RawInputMeta, RawOutputMeta, ComfyGraphNode, WorkflowDetail, WorkflowGroup,
  WorkflowIOParam, IoRef, IOEditContextValue, RgthreeGroupsContextValue,
  NodeJsonViewerRequest, NodeJsonViewerContextValue, RawMetaEntry,
} from "./workflow-types";
import {
  inferOutputTypeAll, renderWidgetValue, valueCellColor, withAlpha,
  renderSubgraphWidgetValue, sanitizeComboLabel, resolveNodePackage,
  pseudoFrostPalette, NODE_TITLE_H, colorToRgba, hexToRgba,
  lightenHex, parseHex, mixHex,
} from "./workflow-utils";
import { Chip, FrontendOnlyBadge, RequiredSummary } from "./required-summary";
import { RgthreeFastGroupsBypasserBody, RgthreePowerLoraLoaderBody, RgthreeLabelBody } from "./rgthree-bodies";
import { FrostLayer } from "./node-frost";
import { WorkflowImagePreview } from "./workflow-image-preview";
import { StringTextarea } from "./string-textarea";
import { useIOEditContext, IoCheckbox, NodeIdChip } from "./io-edit-context";

/** Small checkbox rendered before a parameter row while in IO-edit mode. */
export const PORT_ROLES: { key: string; label: string; color: string; bg: string }[] = [
  { key: "positiveNode",   label: "正向提示词", color: "#a78bfa", bg: "rgba(167,139,250,0.15)" },
  { key: "negativeNode",   label: "反向提示词", color: "#f87171", bg: "rgba(248,113,113,0.15)" },
  { key: "checkpointNode", label: "模型(Checkpoint)", color: "#60a5fa", bg: "rgba(96,165,250,0.15)" },
  { key: "samplerNode",    label: "采样器",       color: "#fb923c", bg: "rgba(251,146,60,0.15)" },
  { key: "inputImageNode", label: "输入图像",      color: "#22d3ee", bg: "rgba(34,211,238,0.15)" },
];

/* ── Node data for the flow canvas (must satisfy Record<string, unknown> for @xyflow/react) ── */
export const INPUT_ROW_HEIGHT = 22; // px per input row (matches the py-1 + text-[11px] row)
export const HEADER_TOTAL = 60;     // header (32) + #id bar (22) + small breathing room (6)

/* (Note: we used to override `<Handle top: ...>` with these constants to
 *  line Handles up with their rows.  We no longer do that — React Flow
 *  pins every Handle to its row's `top: 50%` automatically, and the
 *  node-root `transform: scale(zoom)` would have skewed any manual
 *  absolute pixel offset.  The constants are kept around as a reference
 *  for any future layout work that may need to know a row's size.) */

/* ── Inline image thumbnail for IMAGE-typed inputs (2026-08-10 R27,
 *  narrowed R28).  Mirrors ComfyUI's LoadImage preview: the uploaded image
 *  is shown inline with its pixel dimensions beneath it.  Image bytes are
 *  proxied from the local ComfyUI through /api/images (the browser can't
 *  reach :8188 directly due to CORS + private-network exposure).
 *
 *  2026-08-10 R28: now ONLY renders for the LoadImage family itself
 *  (downstream IMAGE consumers no longer carry `imageRef`, per user
 *  feedback that showing the unscaled upstream image elsewhere is
 *  misleading).  When `imageRef` is absent (LoadImage with no uploaded
 *  image yet), we paint a 「需要上传图片」 placeholder so the body still
 *  has its preview slot — matching ComfyUI's empty-state affordance. */
export const FlowNode = React.memo(function FlowNode({ data, selected }: { data: WorkflowNodeData; selected?: boolean }) {
  const role = PORT_ROLES.find((PORT_ROLES) => PORT_ROLES.key === data.assignedRole);
  const io = useIOEditContext();
  /* 2026-08-25: viewport zoom is NO LONGER subscribed here — it was only
   *  consumed by <NodeFrost> (bypass / disabled nodes), yet the subscription
   *  forced every node on the canvas to re-render on each zoom step.  The
   *  zoom read now lives inside <FrostLayer>, so only nodes that actually
   *  render a frosted layer re-render while zooming. */
  const debugMode = useDebugStore((state) => state.debugMode);

  /*  Frosted glass uses the REAL `backdrop-filter` (the actual canvas behind
   *  the node is what gets blurred) — rendered by <NodeFrost>, NOT the
   *  synthetic <PseudoFrostLayer> fallback.  <NodeFrost> counter-scales its
   *  blur element by 1/zoom so the on-screen footprint never shrinks small
   *  enough to trigger Chromium's re-tile artefact (the 4/9/16 ghost bug). */

  /* Each row is a `position: relative` flex container (`relative flex
   *  h-[22px]`).  React Flow's <Handle> renders with `position: absolute;
   *  top: 50%` and uses the row as its offsetParent, so the Handle is
   *  automatically pinned to the row's vertical centre.  We do NOT
   *  override `top` here — manual absolute pixel offsets would only be
   *  correct in unscaled viewports, and React Flow applies a CSS
   *  `transform: scale(zoom)` to the node root, which would skew our
   *  math by the zoom factor.  The default `top: 50%` is correct in all
   *  zoom levels. */

  /* Map raw_inputs (per-node metadata with localized labels) into an index
   * keyed by the API `name` field.  Lets us label each connection / widget
   * row with its zh-CN ComfyUI label when available.  Empty array if the
   * workflow was imported as pure API JSON. */
  const rawMeta: Record<string, RawInputMeta> = useMemo(() => {
    const out: Record<string, RawInputMeta> = {};
    for (const r of data.rawInputs ?? []) out[r.name] = r;
    return out;
  }, [data.rawInputs]);

  /* Compose the input rows.  Two sources, in priority order:
   *    1. rawInputs (server-paired widget values from rawJson) — for
   *       nodes like DaSiWa_EnhancedVideoCombine that ship 18+ inputs
   *       but only 2 are wired at the API graph level.  data.inputs
   *       (the API graph) holds only the connected slots; the other
   *       16 widget inputs (codec/container/quality/save_metadata/…)
   *       live in rawJson.inputs[] and are stitched into
   *       `tpl.raw_inputs` by the server (route.ts).  Without
   *       preferring rawInputs here, a node renders as a 270px-tall
   *       "header + 2 IO pins" empty shell — exactly the bug seen
   *       on DaSiWa (2026-08-08).
   *    2. data.inputs (API graph form) — fallback for API-only
   *       imports that have no rawJson (rare, but supported).  Each
   *       entry here is the wire tuple `[]` for connected inputs and
   *       the literal value for inline widget rows.
   *    3. Empty.  A node with no inputs renders just the header +
   *       outputs.
   *
   *  Note: even when the input is ALSO wired (a connected widget
   *  input), the value still occupies a widgets_values slot and must
   *  stay visible — the wire shows the dot, the value shows the
   *  number/string.  We therefore never drop connected rows here. */
  const allEntries: [string, any][] = useMemo(() => {
    if (data.rawInputs && data.rawInputs.length > 0) {
      return data.rawInputs.map((rawInput) =>
{
        // Server-paired widget value — present for EVERY widget-type input,
        // connected or not ("有连线的输入 → 不进 widgets_values" is wrong:
        // a wired widget input still occupies a widgets_values slot).  Show
        // it regardless of link state so a connected widget input is no
        // longer silently dropped from the widgets_values view.
        if (rawInput.widgetValue !== undefined) {
          return [rawInput.name, rawInput.widgetValue] as [string, any];
        }
        // Pure-connection inputs (model / clip / cond) carry no widget
        // value — emit an array so the conn/widget splitter below keeps
        // them as wire rows with a Handle.
        return [rawInput.name, rawInput.isConnection ? [] : ""] as [string, any];
      });
    }
    const fromGraph = Object.entries(data.inputs ?? {});
    if (fromGraph.length > 0) return fromGraph;
    return [];
  }, [data.inputs, data.rawInputs]);
  /* Split inputs into two buckets using ComfyUI's own input definition:
   *    • connEntries   — pure-typed port rows: `rawInputs[i].widget` is
   *                      ABSENT.  These are the node's "ports": every
   *                      entry gets a Handle on the left edge regardless
   *                      of link state.  An unconnected typed port
   *                      (e.g. DaSiWa `audio`, AUDIO with no upstream
   *                      wire) still belongs here — ComfyUI's own
   *                      frontend renders it as a TOP PIN row with an
   *                      empty Handle, not buried in the widget section.
   *    • widgetEntries — rows that back a `widgets_values` slot: their
   *                      `rawInputs[i].widget` is `{ name }`.  Rendered
   *                      below the pins; the value comes from
   *                      `widgets_values[]`.  A widget-with-wire (rare,
   *                      e.g. subgraph wrapper inputs that double as
   *                      defaults) keeps a Handle inline so the wire
   *                      still anchors.
   * The old `Array.isArray(v)` rule mistakenly bucketed unconnected
   * typed ports into the widget section (their `v` was `""`, not `[]`),
   * which:
   *   (a) broke parity with ComfyUI's compact grid (audio floated
   *       below images as a bare label),
   *   (b) prevented the IO-edit mode from surfacing them as workflow
   *       inputs (their checkbox lived in the wrong row).
   * `rawMeta` is built above (L640) from `data.rawInputs`, so this rule
   * applies whenever `data.rawInputs` is populated.  When only the
   * legacy `data.inputs` map is available, `rawMeta` is empty → every
   * entry has `widget === undefined` → every entry goes to connEntries,
   * which matches the legacy behaviour (data.inputs only ever carried
   * connected ports). */
  const connEntries = allEntries.filter(([k]) => {
    const m = rawMeta[k];
    /* 2026-08-10 R28: skip LoadImage's synthetic `preview: true` entry —
     *  it's a body-only thumbnail slot, never an input port.  Without
     *  this exclusion the entry lands here (no widget marker) and paints
     *  a fake target-HANDLE row with the label "图像" duplicated on the
     *  left side of every LoadImage node. */
    return m && m.widget === undefined && !m.preview;
  });
  const widgetEntries = allEntries.filter(([k]) => {
    const m = rawMeta[k];
    /* 2026-08-10 R28: also skip `preview: true` from widgetEntries —
     *  even if we add a widget marker to it (we don't), the regular
     *  widget-row renderer would draw a default control.  Keeping this
     *  exclusion makes the invariant explicit. */
    return m?.widget !== undefined && !m.preview;
  });
  /* R50 (2026-08-11): dedupe by `name` across the two buckets BEFORE
   *  layout — custom nodes that legitimately combine a typed port with
   *  an inline widget (e.g. Z-Image-Base Int8's `宽度 / 高度 /
   *  positive_prompt`) surface the same `name` twice in `rawInputs`:
   *  once as a typed-port entry (`widget === undefined`) and once as a
   *  widget entry (`widget: { name }`).  The old code happily routed
   *  the name into BOTH `connEntries` and `widgetEntries`, which drew
   *  two IoCheckbox rows per parameter (one `kind:"param"` on the TOP
   *  PIN strip, one `kind:"widget"` in the widget body) — visually
   *  rendered as two stacked tick-boxes for the same parameter, exactly
   *  what the user reported.  Drop the typed-port duplicate and keep
   *  the widget one — the widget form carries the live
   *  `widgets_values` slot and is the meaningful row to expose as
   *  workflow IO. */
  const widgetNameSet = new Set(widgetEntries.map(([k]) => k));
  const uniqueConnEntries = connEntries.filter(([k]) => !widgetNameSet.has(k));
  const uniqueWidgetEntries = widgetEntries;
  /* Legacy combined list — kept for the overflow-handle fallback below
   * in case a future cap reconnects some entry to a hidden slot.  Not
   * used for layout. */
  const orderedEntries = [...uniqueConnEntries, ...uniqueWidgetEntries];
  /* No cap on the widget section — render every widget so custom nodes
   * (e.g. DaSiWa with 17 params) show their full parameter list instead
   * of silently hiding the trailing ones.  The top-pins section is
   * uncapped too.  Long custom nodes simply grow taller, matching how
   * ComfyUI's own canvas renders them. */
  const visibleWidgetEntries = uniqueWidgetEntries;

  /* IMAGE-input inline thumbnail previews (2026-08-10 R27, narrowed R28).
   *  Filter targets the LoadImage synthetic entry marked `preview: true`,
   *  regardless of whether `imageRef` is set:
   *    • `imageRef` present  → WorkflowImagePreview paints the thumbnail + dimensions
   *    • `imageRef` absent   → WorkflowImagePreview paints 「需要上传图片」 placeholder
   *  Downstream IMAGE inputs (ImageScale / CLIPVisionEncode / …) are NOT
   *  tagged `preview` since R28, so they're filtered out here.  Only the
   *  source LoadImage renders the preview — exactly the ComfyUI parity the
   *  user wanted (no misleading unscaled-view thumbnails on consumers). */
  const imagePreviewEntries = useMemo(
    () => (data.rawInputs ?? []).filter((raw) => raw.preview === true),
    [data.rawInputs]
  );

  /* Output ports.  ComfyUI's frontend reads these from /object_info; we
   *  fall back to three sources, in priority order:
   *    1. The static `inferOutputTypeAll` table (KSampler → LATENT, etc.).
   *    2. The raw `outputs[]` array from the imported JSON — this is the
   *       only place we can find custom-node outputs like
   *       ResolutionSelector.width/height or subgraph IMAGE outputs.
   *    3. An empty list (no outputs, save node etc.). */
  const outputs: [string, string][] = useMemo(() => {
    const staticOuts = Object.entries(inferOutputTypeAll(data.classType));
    if (staticOuts.length > 0) return staticOuts;
    if (data.rawOutputs && data.rawOutputs.length > 0) {
      return data.rawOutputs.map((rawOutput) => [rawOutput.name, rawOutput.type] as [string, string]);
    }
    return [];
  }, [data.classType, data.rawOutputs]);

  // No cap on the widget section — every custom-node parameter renders
  // (the old 14-item clamp hid the trailing widgets of nodes like DaSiWa).
  // Connection ports in the top pins section are also uncapped.  Long
  // custom nodes simply grow taller, matching ComfyUI's own canvas.
  // (visibleWidgetEntries = uniqueWidgetEntries, defined above)

  /* Collapsed state (ComfyUI LiteGraph flag `flags.collapsed`).  When
   *  true we render the header-only chip — outputs strip and inputs
   *  list are skipped, but connected handles still need an anchor so
   *  wires don't visually detach.  We render those handles inline below
   *  in a sibling block with absolute positioning.
   *
   *  User-toggle: a small `>` chevron in the top-left of the header
   *  lets the user collapse / re-expand at will, on top of the
   *  The imported ComfyUI config's `flags.collapsed` is treated as the
   *  INITIAL value — `userCollapsed` is seeded from it on mount, then the
   *  user toggle owns the state thereafter.  This is critical: if we kept
   *  `isCollapsed = dataCollapsed || userCollapsed`, an initially-collapsed
   *  node (dataCollapsed === true) could NEVER be expanded, because
   *  `true || anything === true` always wins.  Seeding useState from the
   *  config and letting the toggle fully own `isCollapsed` fixes that.
   *  Resetting the page keeps the user's state for the current session
   *  (per-node useState, in-memory). */
  const [userCollapsed, setUserCollapsed] = useState<boolean>(
    data.flags?.collapsed === true
  );
  const isCollapsed = userCollapsed;

  /* ComfyUI's color palette is port-driven.  In default state, the node
   * is dark gray; the role assignment (positive/sampler/etc.) gives a
   * tinted header.  We keep both — role highlight on top of type colours.
   *
   *  Contrast-vs-canvas tweak (2026-08-04): the old defaults (`#0F0F15`
   *  body + `rgba(255,255,255,0.12)` border) sat almost flush with the
   *  `#0a0a0f` canvas — node frames vanished against the grid and
   *  selection was hard to read.  Bumped body to `#16161E` and border
   *  to `rgba(255,255,255,0.20)` so the chip clearly stands out at any
   *  zoom level without becoming visually heavy. */
  /* Opaque node-card backgrounds — body keeps the role tint very subtle so
   *  internal text / image previews stay readable against a near-neutral
   *  panel; header + border carry the role-colour identity.  See mixHex()
   *  doc for the (base, tint, t) convention.
   *  Mix with the canvas-ish dark base (`#16161E`) so roles such as a
   *  saturated green render as rgb(24, 49, 40) instead of rgb(32,171,84);
   *  the previous call swapped base↔tint and produced a vivid body that
   *  obscured inputs / image previews on tall nodes like First-Frame-Image. */
  /* Node mode (LiteGraph 0=Always / 2=Never-mute / 4=Bypass) overrides
   *  the role tint when set, so the user can read the ComfyUI status at
   *  a glance: bypass → pink (#ec4899), muted → grey, normal →
   *  role/default.  Mode 0 leaves roleColor untouched.
   *  See WorkflowSubgraphNode for the matching subgraph-side override. */
  const BYPASS_COLOR = "#ec4899";
  const DISABLED_COLOR = "#6b7280";
  const nodeMode = data.mode ?? 0;
  const modeColor =
    nodeMode === 4 ? BYPASS_COLOR :
    nodeMode === 2 ? DISABLED_COLOR :
    null;
  const effectiveColor = modeColor ?? role?.color;

  const headerBg = effectiveColor ? mixHex("#16161E", effectiveColor, 0.22) : "#1A1A22";
  /* Body: only ~8% tint so role identity is a hint, not a flood.  The body
   *  carries no role accent beyond the subtle cast, so 1024×1024 image
   *  previews and value cells sit on a near-neutral panel. */
  /* Body background: stable mode-tinted shade.  The "see-through" feel comes
   *  from the real `backdrop-filter: blur(6px)` on the root div blurring the
   *  canvas behind; this `nodeBg` alpha (0.16 / 0.11) just tints the frost
   *  with the mode colour so bypass = pink-purple, muted = grey at a glance. */
  const nodeBg = modeColor
    ? hexToRgba(modeColor, nodeMode === 4 ? 0.16 : 0.11)
    : role ? mixHex("#16161E", role.color, 0.08) : "#16161E";
  /* Border: stronger tint so the silhouette still reads as "this is the
   *  green-role node" at a glance.  Mode override applies the same mix
   *  recipe so bypass / disabled nodes have a fully tinted frame. */
  const nodeBorder = effectiveColor ? mixHex("#16161E", effectiveColor, 0.55) : "rgba(255,255,255,0.20)";
  /* Title colour: lightened mode color for readability on the dark header,
   *  otherwise role color → light grey default. */
  const titleColor = modeColor ? lightenHex(modeColor, 0.3) : (role?.color ?? "#E2E2EA");
  const dotBg = effectiveColor ?? "#6b7280";
  /* Display title prefers zh-CN friendly map → raw `title` from ComfyUI →
   * prettified class_type. */
  const displayTitle = friendlyNodeTitle(data.classType, data.title, "zh");
  /* rgthree Label nodes paint their text across the whole card and have NO
   *  separate ComfyUI title bar — suppress our standard header for them so
   *  the styled text reads as the entire node (matches native rgthree). */
  const isLabel = data.classType === "Label (rgthree)";
  /* rgthree Power Lora Loader renders its own Lora Stack body (header +
   *  per-lora rows + "+ Add Lora" CTA).  The standard widget-body section
   *  would otherwise double up the widgets — skip it for this classType. */
  const isPowerLoraLoader = data.classType === "Power Lora Loader (rgthree)";

  /* When the imported config carries an exact box size, the node is forced
   *  to those dimensions: `style.width` = size.w, `style.height` = the raw
   *  content height + NODE_TITLE_H (the 30 px title bar is NOT included in
   *  `size[1]` per the R49 rule — see the NODE_TITLE_H comment).  So the
   *  React Flow box is `size[1] + NODE_TITLE_H`.  `data.size.h` carries
   *  the raw CONTENT height (`size[1]`) that the body flexes to.  The
   *  content-driven min/max-width layout is bypassed and the card fills
   *  the React Flow node box set by the builder's `style`, so whitespace
   *  in oversized ComfyUI boxes (e.g. a 530×1190 LoadImage) is preserved
   *  and the card stays exactly where the config places it. */
  const hasSize = !!data.size;

  return (
    <div
      className="relative flex flex-col rounded-lg border shadow-[0_4px_20px_rgba(0,0,0,0.55)]"
      style={{
        // Width tracks ComfyUI's saved `size.w` when present — the node box
        //  width is fixed (exactly like ComfyUI; only the height is fluid).
        //  When no size is carried we fall back to a sensible min width.
        width: hasSize ? data.size?.w : undefined,
        // Height is fully content-driven (`auto`) in BOTH states so the card
        //  GROWS with its ports/widgets when expanded and AUTO-SHRINKS to the
        //  title bar when collapsed (ports collapse from many → one cylinder,
        //  and the body + footer are hidden).  A `minHeight` floor keeps the
        //  expanded box from dropping below ComfyUI's saved `size.h`, while the
        //  collapsed chip never collapses below its own title bar.
        height: "auto",
        minWidth: hasSize ? data.size?.w : (outputs.length > 0 ? 268 : 248),
        // R49 (2026-08-11): data.size.h is the BODY CONTENT height (size[1]).
        //  The FlowNode outer div INCLUDES the pinned 30px title bar, so the
        //  total floor for the outer div is content + title = size[1] + 30.
        //  This keeps the card filling the React Flow box (`size[1] + 30`)
        //  when content is smaller than the configured content height —
        //  matching ComfyUI's actual rendered height (content + title bar)
        //  instead of rendering short by 30px.
        minHeight: isCollapsed ? NODE_TITLE_H : (hasSize ? (data.size?.h ?? 0) + NODE_TITLE_H : undefined),
        // No maxWidth cap here: ComfyUI lets the user resize the node box
        //  freely and we must mirror that — a hard 320px cap would silently
        //  clip any wider box the user dragged in ComfyUI, breaking the
        //  config-fidelity contract established for `size`.
        borderColor: nodeBorder,
        // For mode (bypass/disabled) nodes the tint + real blur now live in
        //  <NodeFrost>, so the root is transparent and only a stacking context
        //  (isolation) so the frost's negative z-index stays contained and
        //  never bleeds behind sibling nodes.  Normal nodes keep a solid panel.
        isolation: "isolate",
        background: modeColor ? "transparent" : nodeBg,
        // ComfyUI draws a bright selection rectangle around the active node.
        outline: selected ? "2px solid rgba(56,189,248,0.9)" : "none",
        outlineOffset: selected ? "2px" : undefined,
      }}
    >
      {modeColor && nodeMode !== 0 && <FrostLayer color={modeColor} nodeMode={nodeMode} />}
      {/* Header — ComfyUI uses a darker top bar with the node class name.
       *  Pinned to NODE_TITLE_H (litegraph's NODE_TITLE_HEIGHT) so every
       *  titled node has an identical header height regardless of icon
       *  size or how many optional chips (role, #id) are present — and so
       *  it stays outside the body box that `size[1]` measures.
       *  Suppressed entirely for rgthree Label nodes (see `isLabel`). */}
      {!isLabel && (
      <div
        className="flex shrink-0 items-center gap-2 rounded-t-lg px-2 text-xs"
        style={{
          height: NODE_TITLE_H,
          background: headerBg,
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        {/* Collapse / expand toggle (2026-08-08).  Sits at the top-left
         *  of the header (matching ComfyUI's native `>` icon), controls
         *  per-user visibility independent of any `flags.collapsed`
         *  baseline carried by the imported config.  We:
         *   • `type="button"` so submitting any future <form> doesn't
         *     accidentally toggle the chip.
         *   • stopPropagation on `onClick` AND `onMouseDown` so the
         *     node-drag handler React Flow attaches to the root does
         *     not pick this up as a drag-start.
         *   • `pointer-events: auto` is the default but we keep it
         *     explicit in case the root is ever made `none`-ish.
         *  The chevron points RIGHT `>` when the node is COLLAPSED
         *  (clicking will expand it, revealing the body), and rotates
         *  90° clockwise to point DOWN `v` when EXPANDED (clicking will
         *  collapse again).  Tooltip mirrors the action in Chinese. */}
        <button
          type="button"
          aria-label={isCollapsed ? "展开节点" : "折叠节点"}
          title={isCollapsed ? "展开" : "折叠"}
          onClick={(event) => {
            event.stopPropagation();
            setUserCollapsed((value) => !value);
          }}
          onMouseDown={(event) => event.stopPropagation()}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-zinc-400 transition-colors hover:bg-white/10 hover:text-white active:bg-white/15"
          style={{ pointerEvents: "auto" }}
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            style={{
              transform: isCollapsed ? "rotate(0deg)" : "rotate(90deg)",
              transition: "transform 120ms ease",
            }}
          >
            <path
              d="M3.5 2 L7 5 L3.5 8"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <span
          className="inline-block h-2 w-2 shrink-0 rounded-full"
          style={{ background: dotBg, boxShadow: `0 0 6px ${dotBg}` }}
        />
        <span
          className="flex-1 truncate text-[12px] font-medium tracking-wide"
          style={{ color: titleColor }}
          title={data.title && data.title !== displayTitle ? data.title : displayTitle}
        >
          {displayTitle}
        </span>
        {/* R-ardot28 (2026-08-14): PER-NODE output checkbox at the node's
         *  top-right.  Workflow outputs are identified by NODE (the comfy-cli
         *  execution dict is keyed by nodeId), NOT by a specific output port —
         *  so the old per-port `images ☐` checkbox inside the outEntry row is
         *  removed.  A single checkbox here marks the WHOLE node as a workflow
         *  output source.  Only shown when the node declares outputs AND we're
         *  in IO-edit mode. */}
        {io?.ioEditMode && outputs.length > 0 && (
          <IoCheckbox
            io={io}
            ioRef={{
              nodeId: data.nodeId,
              name: outputs[0]![0],
              kind: "output",
              direction: "output",
              // 2026-08-15: prefer the rawJson's output label /
              // zh localized_name (e.g. `IMAGE_FINAL`) so the IO
              // preview shows the meaningful name instead of the bare
              // port key (`images`).  Falls back to the port name when
              // no richer label is available.
              label:
                data.rawOutputs?.[0]?.label ??
                data.rawOutputs?.[0]?.localized ??
                outputs[0]![0],
            }}
          />
        )}
        {/* Right-aligned `#<nodeId>` chip — click to open the
         *  NodeJsonPopover (2026-08-10).  Replaces the previous plain
         *  `<span>`: the chip now acts as the disclosure trigger for the
         *  raw workflow JSON viewer.  `stopPropagation` is required
         *  because the React Flow root swallows mousedown for drag-handling,
         *  AND because double-click on the chip shouldn't fire the parent's
         *  `onNodeDoubleClick` (drilldown).  Hover hint via title="…" — a
         *  small 🔍 icon prepended so the affordance reads at a glance even
         *  without text label.  Border becomes more saturated on hover for
         *  a tactile feel. */}
        <NodeIdChip nodeId={data.nodeId} variant="node" />
        {role && (
          <span
            className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium"
            style={{ background: colorToRgba(role.color, 0.25), color: role.color }}
          >
            {role.label}
          </span>
        )}
      </div>
      )}

      {/* Collapsed-mode handle anchors.  When the node is collapsed
       *  (`isCollapsed === true`), the body is hidden but wires still
       *  need an anchor so they don't visually snap to the node centre.
       *
       *  Visually each side collapses to a single vertical "cylinder"
       *  (a tall pill with rounded ends) — that matches ComfyUI's own
       *  collapsed-node look (every port of the same side piles into
       *  one rounded-bar shape).  The cylinder is purely decorative;
       *  underneath it we still render the per-port <Handle> stack as
       *  tiny invisible anchors so each wire's specific id ties to its
       *  own anchor and edges never detach when toggling.  ReactFlow
       *  pins every <Handle> to `top: 50%`, so stacking them inside the
       *  container's translateY(-50%) keeps them centred on the
       *  cylinder's midpoint.
       *
       *  Left cylinder: shown only when there ARE connected inputs.
       *  Right cylinder: shown whenever the node declares any output
       *  (matching ComfyUI's "outputs always visible" rule). */}
      {isCollapsed && (() => {
        /* Connected inputs (those whose value is a wire tuple `[]`).
         *  We rely on the existing split: allEntries[i] = [k, v], with
         *  Array.isArray(v) === true ⇒ wire-only / port-only input. */
        const connectedInputs = orderedEntries.filter(([, v]) => Array.isArray(v));
        const connectedOutputs = outputs.filter(([n]) => data.connectedOutputs?.has(n));
        /* Cylinder visual height scales with port count, clamped between
         *  16px (just a pill for one or two ports) and 64px (no longer
         *  than the chip body itself, otherwise the cylinder bleeds
         *  past the icon/title bar). */
        const cylH = (count: number) =>
          Math.min(64, Math.max(16, 12 + count * 4));
        return (
          <>
            {/* LEFT cylinder — only when there are connected inputs.
             *  Opaque gray→darker gradient sits on top of the wires
             *  (zIndex:10 above the wire layer + Handle anchors) so the
             *  user can clearly see "my ports are here" even when the
             *  canvas is busy with edges of arbitrary colour. */}
            {connectedInputs.length > 0 && (
              <div
                aria-hidden
                className="pointer-events-none absolute"
                style={{
                  left: -3,
                  top: "50%",
                  transform: "translateY(-50%)",
                  width: 6,
                  height: cylH(connectedInputs.length),
                  borderRadius: 999,
                  background:
                    "linear-gradient(180deg, #d4d4d8 0%, #52525b 50%, #18181b 100%)",
                  border: "1px solid rgba(255,255,255,0.45)",
                  boxShadow:
                    "inset 0 1px 0 rgba(255,255,255,0.4), inset 0 -1px 0 rgba(0,0,0,0.6), 0 2px 6px rgba(0,0,0,0.6)",
                  zIndex: 10,
                }}
              />
            )}
            {/* RIGHT cylinder — whenever the node declares an output.
             *  Same opaque styling as the LEFT cylinder. */}
            {outputs.length > 0 && (
              <div
                aria-hidden
                className="pointer-events-none absolute"
                style={{
                  right: -3,
                  top: "50%",
                  transform: "translateY(-50%)",
                  width: 6,
                  height: cylH(outputs.length),
                  borderRadius: 999,
                  background:
                    "linear-gradient(180deg, #d4d4d8 0%, #52525b 50%, #18181b 100%)",
                  border: "1px solid rgba(255,255,255,0.45)",
                  boxShadow:
                    "inset 0 1px 0 rgba(255,255,255,0.4), inset 0 -1px 0 rgba(0,0,0,0.6), 0 2px 6px rgba(0,0,0,0.6)",
                  zIndex: 10,
                }}
              />
            )}

            {/* Invisible per-port Handles — wires anchor here so the
             *  live edge geometry never breaks when toggling collapse.
             *  Centre on top:50% (ReactFlow default).  Hidden via
             *  opacity:0 but still `isConnectable:false` to avoid
             *  accidental new wires. */}
            {connectedInputs.map(([k, v], idx) => {
              const inputType = (data.rawInputs?.find((raw) => raw.name === k)?.type) ?? "*";
              const col = portColor(inputType);
              const total = connectedInputs.length;
              const offset = total > 1 ? (idx - (total - 1) / 2) * 6 : 0;
              return (
                <Handle
                  key={`collapsed-in-${k}-${idx}`}
                  type="target"
                  position={Position.Left}
                  id={k}
                  isConnectable={false}
                  className="!h-2 !w-2 !rounded-full"
                  style={{
                    left: 0,
                    top: `calc(50% + ${offset}px)`,
                    background: col,
                    opacity: 0,
                  }}
                  title={`${k} (${inputType})`}
                />
              );
            })}
            {connectedOutputs.map(([name, type], idx) => {
              const col = portColor(type);
              const total = connectedOutputs.length;
              const offset = total > 1 ? (idx - (total - 1) / 2) * 6 : 0;
              return (
                <Handle
                  key={`collapsed-out-${name}-${idx}`}
                  type="source"
                  position={Position.Right}
                  id={`out:${name}`}
                  isConnectable={false}
                  className="!h-2 !w-2 !rounded-full"
                  style={{
                    right: 0,
                    top: `calc(50% + ${offset}px)`,
                    background: col,
                    opacity: 0,
                  }}
                  title={`Output: ${name} (${type})`}
                />
              );
            })}
          </>
        );
      })()}

      {/* TOP PINS section — pure-connection inputs paired with outputs on
       *  shared rows (2026-08-06 redesign).
       *
       *  Layout principle: a ComfyUI node reads as "ports at the top,
       *  knobs below".  The two kinds of ports — INPUTS (left edge,
       *  target Handle) and OUTPUTS (right edge, source Handle) — are
       *  zipped positionally so a single 22-px row can hold one input
       *  on the left AND one output on the right.  When max(inputs,
       *  outputs) > 1 the rows stack; the leftover of the longer side
       *  keeps filling the trailing rows alone.
       *
       *  "Dot stays on permanently" rule (user feedback 2026-08-06):
       *  handles in this section are ALWAYS rendered, regardless of
       *  whether a wire is actually attached.  Previously outputs only
       *  showed their dot when `hasDownstream` was true; that made
       *  unconnected ports invisible and easy to overlook.  Every
       *  declared pin → visible port.
       *
       *  When the node is collapsed (`flags.collapsed`) the body is
       *  hidden; collapsed-mode handles live in the sibling block above. */}
      {!isCollapsed && (uniqueConnEntries.length > 0 || outputs.length > 0) && (
        <div
          className="border-b border-white/[0.05] py-0.5"
          style={{ background: "rgba(255,255,255,0.015)" }}
        >
          {Array.from({ length: Math.max(uniqueConnEntries.length, outputs.length) }).map(
            (_, rowIdx) => {
              const inEntry = uniqueConnEntries[rowIdx];
              const outEntry = outputs[rowIdx];
              const inName = inEntry?.[0];
              const outName = outEntry?.[0];
              const outType = outEntry?.[1];

              /* Input side — colour by declared slot type, label via the
               *  same zh-CN / label / friendly fallback chain the widget
               *  rows use, so e.g. "clip" surfaces as "CLIP" while a
               *  rawInputs entry with `localized_name` shows the
               *  localised label. */
              const inMeta = inName ? rawMeta[inName] : undefined;
              const inType = inMeta?.type ?? "*";
              const inCol = portColor(inType);
              const inLabel = inName
                ? sanitizeComboLabel(inMeta?.localized) ||
                  sanitizeComboLabel(inMeta?.label) ||
                  friendlyInputName(inName)
                : "";

              /* Output side — colour by `outputs[i][1]` (always set, even
               *  for static / dynamic fallbacks), label via rawOutputs
               *  `localized`, else the raw key. */
              const outCol = outType ? portColor(outType) : undefined;
              const outRaw = outName
                ? data.rawOutputs?.find((output) => output.name === outName)
                : undefined;
              const outDisplay = outRaw?.localized ?? outName;

              return (
                <div
                  /* Key includes both names so number-slot ports ("1",
                   *  "2", …) don't collide inside the array, AND so a
                   *  re-zip after a layout change remounts cleanly. */
                  key={`pinrow-${rowIdx}-${inName ?? "_"}-${outName ?? "_"}`}
                  className="relative flex h-[22px] items-center pl-5 pr-5 text-[11px]"
                  data-pin-input={inName}
                  data-pin-output={outName}
                >
                  {inEntry && (
                    <>
                      <Handle
                        type="target"
                        position={Position.Left}
                        id={inName}
                        isConnectable={false}
                        className="!h-2.5 !w-2.5 !rounded-full !border !border-[var(--color-canvas)]"
                        style={{
                          left: 5,
                          background: inCol,
                          boxShadow: `0 0 6px ${inCol}AA, inset 0 0 0 1px rgba(255,255,255,0.25)`,
                        }}
                        title={`${inName} (${inType})`}
                      />
                      {/* IO checkbox for TOP PINS inputs that are UNCONNECTED.
                       *  `connEntries` now includes both connected AND
                       *  unconnected typed ports (e.g. DaSiWa `audio` — AUDIO
                       *  with no upstream wire).  Workflow inputs MUST be
                       *  unconnected — a slot that already has an incoming
                       *  wire gets its value from upstream, so exposing it
                       *  as a workflow input is meaningless.  Only render
                       *  the checkbox when `!inMeta.isConnection` (and not a
                       *  subgraph boundary sentinel, which is also a wire). */}
                      {io?.ioEditMode && inMeta && !inMeta.isConnection && !inMeta.isBoundary && (
                        <IoCheckbox
                          io={io}
                          ioRef={{
                            nodeId: data.nodeId,
                            name: inName ?? "",
                            kind: "param",
                            direction: "input",
                            // 2026-08-15: prefer the raw port's display
                            // label / zh localized_name so the IO preview
                            // resolves to the meaningful name.  Falls
                            // back to the raw key (`inName`) when neither
                            // is present.
                            label: inMeta?.label ?? inMeta?.localized ?? inName,
                          }}
                        />
                      )}
                      <span
                        className="min-w-0 flex-1 truncate text-left text-[11px] text-zinc-200"
                        title={String(inName)}
                      >
                        {inLabel}
                      </span>
                    </>
                  )}
                  {outEntry && (
                    <>
                      <span
                        className="min-w-0 flex-1 truncate text-right text-[11px] text-gray-200"
                        title={`${outName} (${outType})`}
                      >
                        {outDisplay}
                      </span>
                      {/* R-ardot28 (2026-08-14): the per-PORT output checkbox
                       *  that used to sit here (`images ☐`) is REMOVED — workflow
                       *  outputs are identified by NODE, not by output port, so a
                       *  per-port checkbox is meaningless.  The per-node output
                       *  checkbox now lives in the node header (top-right). */}
                      {/* R-ardot27 (2026-08-14): hide the output source Handle
                       *  while in IO-edit mode.  The user said the OLD way of
                       *  showing the output as a port on the node is useless —
                       *  workflow outputs are identified by node (the comfy-cli
                       *  execution dict is keyed by nodeId), so the checkbox
                       *  above is the only handle the author needs in this
                       *  mode.  Outside IO-edit mode the Handle stays so the
                       *  user can still wire outputs to downstream nodes. */}
                      {!io?.ioEditMode && (
                        <Handle
                          type="source"
                          position={Position.Right}
                          id={`out:${outName}`}
                          isConnectable={false}
                          className="!h-2.5 !w-2.5 !rounded-full !border !border-[var(--color-canvas)]"
                          style={{
                            right: 5,
                            background: outCol,
                            boxShadow: `0 0 6px ${outCol}AA, inset 0 0 0 1px rgba(255,255,255,0.25)`,
                          }}
                          title={`${outDisplay} (${outType})`}
                        />
                      )}
                    </>
                  )}
                </div>
              );
            }
          )}
        </div>
      )}

      {/* Widget inputs section — knobs only (every entry here carries a
       *  widgets_values slot).  Pure-connection ports live in the TOP
       *  PINS section above; this section renders the actual scalar /
       *  object inputs with their values.
       *
       *  Inputs that ALSO carry a wire (subgraph wrappers with sentinel
       *  links, e.g. RandomNoise.noise_seed inside a NOISE subgraph)
       *  still keep their Handle so the wire anchors, but the row stays
       *  in the compact "NAME | VALUE" layout — exactly the same shape
       *  as an unwired widget row.
       *
       *  Hidden when the node is collapsed (collapsed-mode handles live
       *  in the sibling block above the header). */}
      {!isCollapsed && visibleWidgetEntries.length > 0 && !isPowerLoraLoader && (
        <div className="relative flex min-h-0 flex-1 flex-col py-0.5">
          {visibleWidgetEntries.map(([k, v], idx) => {
            /* `widgetEntries` only ever contains non-array scalars
             *  (the connection rows are filtered into `connEntries`
             *  above).  A row carries a wire only when `rawInputs`
             *  flags it as both connected AND a widget (rare — chiefly
             *  subgraph wrapper inputs that double as a default-value
             *  slot).  Render the Handle so the wire anchors, keep the
             *  compact widget layout. */
            const isConn = rawMeta[k]?.isConnection === true;
            const srcClass = isConn ? data.inputSources?.[k]?.classType : undefined;

            /* Boundary wire (2026-08-06): the wrapper-exposes-this-slot
             *  flag — surfaced by the subgraph route when the input is
             *  fed by a sentinel link (`origin_id === -10`).  Treat the
             *  row as a connection for Handle/colour but keep the
             *  compact widget row layout. */
            const isBoundary =
              rawMeta[k]?.isBoundary === true || data.boundaryInputs?.has(k) === true;

            // The *type* of this input — always inferred from the JS-typed
            // scalar value (no wire-tuple edgeType path here, those live
            // in the top pins section).
            const inputType = inferInputType(data.classType, k, v);
            const typeCol = portColor(inputType);

            /* Display label for the input.  ComfyUI's `localized_name` is the
             *  canonical zh-CN UI label; falling back through:
             *    localized_name → friendly map of input names → raw key.
             *  Custom COMBO widgets (KJNodes etc.) bake their full options
             *  list into `label` as "opt1 | opt2 | opt3" — those option
             *  lists are stripped by `sanitizeComboLabel`.  A BOOLEAN toggle
             *  descriptor ("Model: True = 🟡 Safetensors | False = 🟣 GGUF",
             *  rgthree Settings nodes) is kept intact (R-ardot71) so the
             *  full label is visible and wraps rather than being clipped. */
            const meta = rawMeta[k];
            const friendlyLabel =
              sanitizeComboLabel(meta?.localized) ||
              sanitizeComboLabel(meta?.label) ||
              friendlyInputName(k);

            /* STRING widget inputs are rendered as a single inline row
             *  (label | value) by default — short scalars like "auto" /
             *  "fp16" / "small" / "true" don't justify a 56-px textbox
             *  that pushes the row to two visual lines.  Only collapse
             *  to a bordered textbox when the string is genuinely long
             *  (>=32 chars, e.g. a CLIPTextEncode prompt) OR
             *  multi-line — so authors still get a readable prompt
             *  surface, while Combo-flavoured inputs (KJNodes `sage_
             *  attention`, `allow_compile`, etc.) stay on the same
             *  22px line as INT/FLOAT widgets.
             *
             *  Connections (isConn) keep the compact single-line row
             *  (their names UNet / CLIP / VAE etc. must NOT be omitted).
             *
             *  Empty strings stay inline too — the `（空）` placeholder
             *  would otherwise add a 28-px textbox that draws the eye to
             *  inputs the author hasn't touched yet (every empty STRING
             *  widget would have to be ignored). */
            const stringText = typeof v === "string" ? v : "";
            /* 2026-08-10 R18: STRING widget detection now consults
             *  `inferIsMultiline(classType, name, defaultValue)` —
             *  the same helper that `DynamicWorkflowForm`'s
             *  `controlForEntry` uses on the workflowIO path.  Order of
             *  the conditions matters:
             *    1. inputType === "STRING" — only STRING-typed slots
             *       qualify; INT/FLOAT/COMBO keep their 22px row.
             *    2. inferIsMultiline — ComfyUI native multiline flag
             *       cannot survive the API-format export (our rawJson
             *       carries no widgets[] / inputs[]), so the helper
             *       backfills it from a static (class, name) table +
             *       name heuristic + length heuristic.  (Previously
             *       this branch required `stringText.length >= 32 ||
             *       \n`, which quietly dropped SHORT prompt inputs
             *       such as `negative_prompt` even when the author
             *       intended them to be multiline.)
             *
             *  2026-08-11 (R36): dropped the `!isConn` gate.  The old
             *  rule forced any *connected* STRING (e.g. CLIPTextEncode
             *  fed by a downstream text combiner) to fall back to the
             *  22px inline chip — a prompt like
             *  "狭小出租屋厨房的俯瞰中景镜头..." got truncated to
             *  "狭小出租屋厨房的俯瞰中景镜头, 午后阳光..." with the
             *  rest hidden behind `truncate`.  Removing the gate lets
             *  connected multiline STRING also render as the stacked
             *  textarea (R17/R18).  The Handle stays anchored at the
             *  LEFT edge regardless of layout because React Flow
             *  positions Handles from the node bbox, not from CSS —
             *  so the wire still lands on the dot even when the row
             *  is `flex-col` instead of `flex-row`.  SHORT connected
             *  STRING (`clip`, `vae_name`, etc.) still uses the
             *  compact inline chip since multiline stays false. */
            const isStringWidget =
              inputType === "STRING" &&
              (inferIsMultiline(data.classType, k, stringText) ||
                stringText.length >= 32 ||
                stringText.includes("\n"));

            return (
              <div
                /* `idx` is appended to the key so ComfyUI number-slot
                 *  inputs ("1", "2", …) don't collide across rows —
                 *  rgthree and similar packs carry those, and React
                 *  would throw "two children with the same key, `1`"
                 *  if two such slots landed in the same
                 *  `visibleWidgetEntries` list. */
                key={`${k}-${idx}`}
                data-input-key={k}
                data-input-type={inputType}
                /* 2026-08-10 R17: STRING widgets always render as a STACKED
                 *  block — LABEL/chip row on top, textarea fills the
                 *  remaining vertical space below.  Previous `flex-row
                 *  items-start gap-2` (2026-08-08, retained up through
                 *  R13) put them on the SAME row, squeezing the textarea
                 *  against the label and forcing it under `maxHeight: 96`
                 *  — the layout users reported as "标题和内容同一排 +
                 *  不可自适应高度 + 不铺满可用空间".  Vertical flex-col
                 *  frees the textarea to flex-1 fill the row's remaining
                 *  height; StringTextarea's own `flex: 1 1 0` + `minHeight:
                 *  0` lets it claim whatever space the box has left.
                 *  `flex-1` on the row makes the textarea compete
                 *  legitimately with the rest of the widget zone for the
                 *  box's leftover height (no more single-line prompt rows
                 *  inflated to node-tall by a zero-width label). */
                className={
                  isStringWidget
                    ? "group relative flex min-h-0 flex-1 flex-col gap-1.5 pl-5 pr-2 py-1.5 text-[11px]"
                    /* 2026-08-16 R-ardot71: long widget labels (e.g.
                     *  `Model: True = 🟡 Safetensors | False = 🟣 GGUF`
                     *  coming from a power-user node's BOOLEAN input)
                     *  were clipped to ~5 chars because the row used
                     *  `h-[22px]` + `truncate` and the node's fixed
                     *  LiteGraph `size.w` left only ~30 px for the
                     *  label.  Replace the hard 22 px with `min-h-[22px]
                     *  h-auto` so a wrapping label pushes the row
                     *  taller (the body is `auto` height — see R49 —
                     *  so the node grows naturally); keep the 22 px
                     *  floor so short labels don't drift. */
                    : "group relative flex min-h-[22px] h-auto items-center gap-1.5 pl-5 pr-2 py-0.5 text-[11px]"
                }
              >
                {isConn || isBoundary ? (
                  /* The Handle IS the dot — single point, single click
                   * target.  ReactFlow's Handle applies
                   * `transform: translate(50%, -50%)` which shifts the
                   * box 5px outward.  Setting `left: 5px` compensates
                   * so the dot's *centre* lands exactly on the node's
                   * left edge — incoming edge anchors through the
                   * dot's centre with no visible gap.  Widget inputs
                   * without a connection AND without a boundary wire
                   * get NO dot — only connected ports show a Handle.
                   * Connected STRING inputs never enter the textbox
                   * branch (`isStringWidget` requires `!isConn`), so
                   * the Handle always sits on the compact 22px row.
                   *
                   * `isBoundary` (2026-08-06): see sibling comment
                   * above — without this branch the boundary wire's
                   * Handle never mounts and the wire is silently
                   * dropped by React Flow at reconcile time. */
                  <Handle
                    type="target"
                    position={Position.Left}
                    id={k}
                    isConnectable={false}
                    className="!h-2.5 !w-2.5 !rounded-full !border !border-[var(--color-canvas)]"
                    style={{
                      left: 5,
                      background: typeCol,
                      boxShadow: `0 0 6px ${typeCol}AA, inset 0 0 0 1px rgba(255,255,255,0.25)`,
                    }}
                    title={`${k} (${inputType})`}
                  />
                ) : null}

                {/* Top row: label + (inline value).  The variable type
                 *  label was removed (2026-08-04) — it cluttered every row
                 *  with a near-meaningless COMBO/STRING/INT tag and added
                 *  no actionable info.  The connection dot still shows the
                 *  port colour via `typeCol` above; the label is ALWAYS
                 *  rendered (incl. enum names like UNet / CLIP / VAE).
                 *
                 *  STRING scalars below the 32-char threshold render
                 *  inline (e.g. `sage_attention | auto`) — only long /
                 *  multi-line STRING values (real prompts) get the
                 *  bordered textbox below.
                 *
                 *  Layout rules (2026-08-07 dynamic-value pass):
                 *    • LABEL — content width (no hard cap; flex: 0 1 auto
                 *              with min-width: 0).  Long keys still
                 *              ellipsise via `truncate` when the value
                 *              needs every remaining pixel.
                 *    • VALUE — flex: 1 1 auto, takes ALL row space the
                 *              label doesn't claim, capped at 75% so a
                 *              label is always at least 25% visible.
                 *              Filenames like
                 *              `DaSiWa_Wan22_I2V_14B_SnatchKiss_v1-…`
                 *              finally show in full on the wrapper
                 *              subgraph node (was being clipped by the
                 *              label's old 55% cap). */}
                {isStringWidget ? (
                  /* Top row of the STRING STACKED block (R17) — LABEL +
                   *  IoCheckbox sit on a horizontal flex at the top of a
                   *  `flex-col` row, leaving the StringTextarea below to
                   *  claim the remaining vertical space.  R7-R13 used
                   *  `flex-row items-start` here, which kept label and
                   *  textarea on the SAME row and forced the textarea
                   *  under `maxHeight: 96` — the "标题和内容同一排,
                   *  不铺满可用空间" layout the user reported.  shrink-0
                   *  kept the label at its natural width when the row
                   *  was inline; now that the row is vertical it is
                   *  harmless but left in place to defend against a
                   *  future regression where someone re-introduces a
                   *  flex-1 sibling at this level. */
                  <div className="flex shrink-0 items-center gap-1.5">
                    {io?.ioEditMode && !isConn && !isBoundary && (
                      <IoCheckbox
                        io={io}
                        ioRef={{ nodeId: data.nodeId, name: k, kind: "widget", direction: "input" }}
                      />
                    )}
                    <span
                      /* 2026-08-16 R-ardot71: drop `truncate` from the
                       *  STRING-stacked row label too — same rationale
                       *  as the inline branch above. */
                      className="shrink-0 whitespace-normal break-words text-left text-[11px]"
                      style={{ color: isConn ? "var(--color-ink-strong)" : "var(--color-ink-subtle)" }}
                      title={k}
                    >
                      {friendlyLabel}
                    </span>
                  </div>
                ) : (
                  <div className="flex min-w-0 flex-1 items-center gap-1.5">
                    {/* Workflow inputs must be UNCONNECTED — a slot that already
                     *  has an incoming wire (or a sentinel boundary link) gets
                     *  its value from upstream, so exposing it as a workflow
                     *  input is meaningless.  Skip the checkbox for those. */}
                    {io?.ioEditMode && !isConn && !isBoundary && (
                      <IoCheckbox
                        io={io}
                        ioRef={{
                          nodeId: data.nodeId,
                          name: k,
                          kind: "widget",
                          direction: "input",
                          // 2026-08-15: prefer the raw widget's display
                          // label (resolved via `friendlyLabel` in the
                          // enclosing block) so the IO preview shows
                          // positive_prompt / negative_prompt instead of
                          // bare `text` / `text_1`.  Falls back to the
                          // raw key when neither is set.
                          label: friendlyLabel,
                        }}
                      />
                    )}
                    <span
                      /* 2026-08-16 R-ardot71: dropped `truncate` so a long
                       *  widget label can wrap onto multiple lines when
                       *  the row width can't hold it (e.g. the power-user
                       *  Settings node's `Model: True = 🟡 Safetensors |
                       *  False = 🟣 GGUF` BOOLEAN label was being clipped
                       *  to `Model…`).  `whitespace-normal` lets browsers
                       *  wrap at spaces; `break-words` falls back to
                       *  mid-word breaks when a single token (like
                       *  `DaSiWa_Wan22_…_safetensors`) overruns the
                       *  row.  Full text is still available via the
                       *  native `title` tooltip. */
                      className="min-w-0 shrink whitespace-normal break-words text-left text-[11px]"
                      style={{ flex: "0 1 auto", color: isConn ? "var(--color-ink-strong)" : "var(--color-ink-subtle)" }}
                      title={k}
                    >
                      {friendlyLabel}
                    </span>

                    {/* Soft 1px vertical divider between label and value
                     *  (2026-08-07 softened: was `bg-white/10 h-3` —
                     *  too heavy next to the type-coloured value text,
                     *  it read as "cut the row in half").  Halving the
                     *  alpha to 0.05 and dropping the height to 8px
                     *  keeps a subtle column anchor without dominating
                     *  the row. */}
                    {/* A widget input that ALSO carries a wire (e.g. KSampler
                     *  seed / steps / cfg, CLIPTextEncode.text,
                     *  VAEDecode.samples) must still show its control value —
                     *  ComfyUI keeps the widget control (readonly) when wired,
                     *  it never hides it.  Always render the value; only dim
                     *  it one notch on a wired row so the reader can tell the
                     *  live value arrives from the wire while this is the
                     *  widget's stored default.  The old `!isConn` guard
                     *  wrongly blanked exactly these rows. */}
                    <>
                      <span
                        className={
                          isConn
                            ? "h-2 w-px shrink-0 bg-white/[0.05] opacity-50"
                            : "h-2 w-px shrink-0 bg-white/[0.05]"
                        }
                        aria-hidden
                      />
                      <span
                        className="min-w-0 truncate text-right text-[10.5px] tabular-nums"
                        style={{
                          flex: "1 1 0",
                          color: isConn ? withAlpha(valueCellColor(v)) : valueCellColor(v),
                        }}
                        title={String(v)}
                      >
                        {renderWidgetValue(v, data.classType, k)}
                      </span>
                    </>
                  </div>
                )}
                {/* STRING-widget textbox — STACKED BELOW the LABEL row
                 *  (2026-08-10 R17).  The row is `flex-col gap-1.5 flex-1`
                 *  (label on top, textarea fills the rest of the row).
                 *  Previous `flex-row items-start` (R7-R13) paired label
                 *  and textarea inline and capped the textarea's height
                 *  with `maxHeight: 96`, which the user reported as
                 *  "标题和内容同一排 + 内容不铺满可用空间".  Now the
                 *  label sits on a dedicated top row, and the textarea
                 *  container (already `flex min-w-0 flex-1 flex-col` since
                 *  the original layout work) occupies every remaining
                 *  pixel of the row.
                 *
                 *  Implementation notes (unchanged from 2026-08-07 / -08):
                 *  — `<textarea readOnly>` (browser-native scroll-on-overflow)
                 *    beats `<div>` + Tailwind arbitrary-value classes that
                 *    silently drop inside this FlowNode subtree.
                 *  — In `hasSize` path the container's `flex-1 min-h-0`
                 *    claims height; the textarea inside adds `flex: 1 1 0`
                 *    via inline style so it fills the container, not just
                 *    the row.
                 *  — In `!hasSize` path the useLayoutEffect grows the
                 *    textarea to its full `scrollHeight` (uncapped since
                 *    R17 — the old 96 cap is gone).
                 *  — Empty value falls back to a faint "（空）" placeholder
                 *    (an empty textarea still draws a caret rectangle). */}
                {isStringWidget && (
                  <div className="flex min-w-0 flex-1 flex-col">
                    {stringText.length > 0 ? (
                      <StringTextarea value={stringText} hasSize={hasSize} />
                    ) : (
                      <div
                        className="rounded border border-white/10 bg-black/30 px-2 py-1.5 text-[10.5px] leading-snug text-gray-600"
                        style={{ minHeight: 28 }}
                        title={stringText}
                      >
                        （空）
                      </div>
                    )}
                  </div>
                )}

              </div>
            );
          })}
        </div>
      )}

      {/* rgthree Fast Groups Bypasser runtime body (2026-08-09).
       *  Rendered as a static child of the node card so it flows under
       *  the (empty) I/O rows.  Only fires for the rgthree classType
       *  with a non-empty `matchTitle` property; every other node
       *  keeps the default empty body.  The body filters `data.groups`
       *  by `matchTitle` and renders one toggle row per match; each
       *  toggle flips the group's `flags.bypass` via
       *  `RgthreeGroupsContext.setBypass` (PATCH → rawJson write). */}
      {data.classType === "Fast Groups Bypasser (rgthree)" &&
        typeof data.properties?.matchTitle === "string" && (
          <RgthreeFastGroupsBypasserBody
            matchTitle={data.properties.matchTitle}
            groups={data.groups ?? []}
          />
        )}

      {/* rgthree Power Lora Loader runtime body (2026-08-09).  Renders the
       *  lora stack from the node's `widgets_values` (header widget + per-lora
       *  slots).  Flows under the MODEL/CLIP top pins, mirroring rgthree's
       *  own layout.  Read-only. */}
      {data.classType === "Power Lora Loader (rgthree)" && (
        <RgthreePowerLoraLoaderBody widgets={data.rawWidgetValues ?? []} />
      )}

      {/* rgthree Label runtime body (2026-08-09).  No I/O — paints the title
       *  in the styles carried by `properties`.  Renders whenever the node is
       *  a Label, filling the (header-less) card. */}
      {isLabel && (
        <RgthreeLabelBody text={data.title} properties={data.properties ?? {}} />
      )}

      {/* IMAGE-input inline thumbnail preview (2026-08-10 R27).  Every rawInput
       *  that carries `imageRef` (resolved server-side from a LoadImage upstream)
       *  gets a ComfyUI-style preview: label + thumbnail + pixel dimensions,
       *  rendered once at the node-body tail so it never disturbs the pinned
       *  two-column TOP-PINS layout above. */}
      {!isCollapsed && imagePreviewEntries.length > 0 && (
        <div className="flex flex-col gap-2 px-2 pb-2 pt-1">
          {imagePreviewEntries.map((entry) => (
            <WorkflowImagePreview key={entry.name} entry={entry} />
          ))}
        </div>
      )}

      {/* Default target handle for nodes with no inputs at all
       *  (unmapped/fallback edges need somewhere to anchor).  Kept on
       *  the left so legacy edges still find a slot. */}
      {uniqueConnEntries.length === 0 && uniqueWidgetEntries.length === 0 && (
        <Handle
          type="target"
          position={Position.Left}
          id="__default_in"
          className="!h-2.5 !w-2.5 !border-2 !border-[var(--color-canvas)] !bg-violet-400/80"
          style={{ left: -5 }}
        />
      )}

      {/* Generic source handle — always present but invisible.  Edges that
       *  can't resolve a precise "out:<name>" handle (e.g. a node whose output
       *  slot isn't in our offline type table) fall back to this id so the wire
       *  still anchors instead of silently vanishing. */}
      <Handle
        type="source"
        position={Position.Right}
        id="out"
        isConnectable={false}
        style={{ opacity: 0, right: -5 }}
      />

      {/* ComfyUI-native bottom-left footers.  Two independent labels can
       *  appear here:
       *   1. Package source (PackageFooter) — where the node came from.
       *      Built-in nodes hide it; custom nodes show the package (e.g.
       *      "rgthree-comfy").  Unregistered rgthree classes fall back to
       *      `properties.cnr_id` so they still show their package instead of
       *      being hidden under the old "ComfyUI" default.
       *   2. `frontend_only` badge — shown when the node's LiteGraph
       *      `properties.frontend_only === true` (a SEPARATE concept from the
       *      package name: it means "runs only in the browser frontend").
       *  Both are HIDDEN when the node is collapsed — a collapsed chip is just
       *  the title bar + a single port cylinder, matching ComfyUI's collapsed
       *  silhouette (no package / frontend_only label competing for the space). */}
      {!isCollapsed && (
        <>
          <PackageFooter
            classType={data.classType}
            name={resolveNodePackage(data.classType, data.properties)}
          />
          {data.properties?.frontend_only === true && <FrontendOnlyBadge />}
        </>
      )}
      {/* 2026-08-24: 调试模式 — 非折叠时在 PackageFooter 下方渲染渲染链路
       *  模块标签（仅 debugMode 开启时由 DebugChainFooter 自行显示）。 */}
      {!isCollapsed && debugMode && (
        <DebugChainFooter modules={getWorkflowRenderChainModules(data.classType)} />
      )}
    </div>
  );
});

/** Wrap inferOutputType so we always get a [name, type] tuple list. */