"use client";
/* Extracted WorkflowSubgraphNode (ComfyUI subgraph wrapper renderer).
 * Originally inside WorkflowCanvasEditor.tsx. */
import React, { useState } from "react";
import { useTheme } from "next-themes";

import { Handle, Position } from "@xyflow/react";
import {
  portColor, inferIsMultiline,
} from "@/lib/comfyui/types";
import { DarkSelect } from "@/components/studio/ui/DarkSelect";
import type { WorkflowSubgraphData, RawInputMeta,
} from "../workflow-types";

/** COMBO inputs additionally carry their option list (stamped by the import
 *  pipeline; not part of the shared RawInputMeta contract). */
type ComboInputMeta = RawInputMeta & { comboOptions?: unknown };
import { valueCellColor,
  renderSubgraphWidgetValue, sanitizeComboLabel, NODE_TITLE_H, hexToRgba, 
} from "../workflow-utils";
import { FrostLayer } from "./NodeFrost";
import { StringTextarea } from "../StringTextarea";
import { useIOEditContext, IoCheckbox } from "./IOEditContext";
import { SubgraphHeader } from "./SubgraphHeader";
import { useHoverElevation } from "../workflow-editor/HoverElevation";
import { resolveAnchorCylinder } from "./workflow-node-palette";
export const WorkflowSubgraphNode = React.memo(function WorkflowSubgraphNode({ data, selected }: { data: WorkflowSubgraphData; selected?: boolean }) {
  const io = useIOEditContext();
  /* 悬浮置顶：与 FlowNode 同一套语义（ISSUE #400）—— 鼠标指着的子图卡片
   *  也要压住连线。状态在本节点内，悬浮进出不影响其余节点。 */
  const { hoverHandlers, hoverRef } = useHoverElevation();
  /* 收起态的锚柱跟主题联动（浅色下白描白会让锚柱整个消失）。 */
  const { resolvedTheme } = useTheme();
  const anchor = resolveAnchorCylinder(resolvedTheme);

  /* viewport zoom is NO LONGER subscribed here — see FlowNode /
   *  FrostLayer: only frosted (bypass / disabled) nodes need to track zoom.
   *  Parent-graph subgraph card — mirrors WorkflowNode's two-zone layout
   *  a purple HEADER, a TOP PINS zone that zips the
   *  wrapper's pure-connection input ports (left dot) with its exposed
   *  output ports (right dot) on shared 22px rows, and a WIDGET zone
   *  listing the wrapper's exposed widget inputs as LABEL | VALUE rows
   * (a dot only when the widget slot is ALSO wired, matching WorkflowNode's
   * "both" behaviour).  The purple identity + drill-in affordance are
   * the only subgraph-specific bits; the IO rows use the exact same
   * connection model as a regular node so wiring stays uniform. */
  /* Subgraph identity tint: purple by default, switching to bypass-pink
   *  (#ec4899) when the wrapper itself is bypassed and to grey when
   *  muted. Mirrors WorkflowNode's mode→color logic. */
  const nodeMode = data.mode ?? 0;

  /*  Subgraph wrapper uses the same REAL `backdrop-filter` via <NodeFrost>
   *  as WorkflowNode — counter-scaled by 1/zoom to avoid Chromium's low-zoom
   *  re-tile artefact.  <PseudoFrostLayer> stays an unused fallback. */
  const accent =
    nodeMode === 4 ? "#ec4899" :
    nodeMode === 2 ? "#6b7280" :
    "#7C5CFC";  // subgraph default purple identity (mode 0)

  /* Same box semantics as WorkflowNode: when the imported config carries an
   *  explicit size, the root div is forced to width/height: 100% (see the
   *  `style` block below) so the card fills the React Flow node box.  The
   *  textarea then joins the flex chain and fills the box's remaining
   *  vertical space instead of being capped at a fixed pixel height. */
  const hasSize = !!data.size;
  const inputsList = data.inputs ?? [];
  const outputsList = data.outputs ?? [];

  /* User-toggleable collapse state. Mirrors WorkflowNode: the
   *  left-side chevron flips between header-only chip and full body.
   *  Seed `userCollapsed` from the imported `flags.collapsed` so an
   *  initially-collapsed subgraph can still be expanded by the toggle
   *  (same `true || anything` trap as WorkflowNode — must not OR them). */
  const [userCollapsed, setUserCollapsed] = useState<boolean>(
    data.flags?.collapsed === true
  );
  const isCollapsed = userCollapsed;

  /* Filter rows whose display label would be empty (fix).
   *  ComfyUI sometimes exports sentinel / placeholder IO on subgraph
   *  wrappers — e.g. Settings.outputs[11] = `{name:"", type:"*",
   *  label:"PREVIEW"}`.  Without this filter the canvas would render
   *  a 22px-tall empty row that the user mistakes for a render bug. */
  /* 暴露口的显示名。wrapper 本层槽位名是 ComfyUI 自动编号的别名
   *  （`value_1`），业务名在内部真实字段上（proxyField，服务端由
   *  `properties.proxyWidgets` 解析）。先取内部字段的 label → localized →
   *  字段名，再回退本层 label/localized/别名——IO 面板用同一条链
   *  （见 workflow-detail-io 的富化），两处逐字一致。 */
  const exposedName = (inp: RawInputMeta): string =>
    sanitizeComboLabel(inp.proxyField?.label) ||
    sanitizeComboLabel(inp.proxyField?.localized) ||
    sanitizeComboLabel(inp.proxyField?.field) ||
    sanitizeComboLabel(inp.label) ||
    sanitizeComboLabel(inp.localized) ||
    inp.name ||
    "";

  const cleanedInputs = inputsList
    .map((inp) => ({ inp, label: exposedName(inp) }))
    .filter(({ label }) => label.trim().length > 0);

  const cleanedOutputs = outputsList
    .map((out) => ({
      out,
      display:
        sanitizeComboLabel(out.label) ||
        sanitizeComboLabel(out.localized) ||
        out.name ||
        "",
    }))
    .filter(({ display }) => display.trim().length > 0);

  /* Split the wrapper inputs into the two WorkflowNode-style buckets:
   *   - connInputs   — pure-typed ports (no widget marker).  Each gets
   *                    a left-edge dot (always on, shown even when
   *                    unwired) and is zipped with outputs in TOP PINS.
   *                    A wrapper input that ALSO has `isConnection: true`
   *                    from upstream wiring is bucketed here too (the
   *                    wire anchors, the value is upstream).
   *   - widgetInputs — exposed widget slots (widget marker present).
   *                    Rendered in the WIDGET zone as LABEL | VALUE; a
   *                    dot appears only when the slot is ALSO wired
   *                    (`isConnection` / `isBoundary`), mirroring
   *                    WorkflowNode's "both" row.
   *
   * split criterion changed from `widgetValue`
   * (never populated for wrapper nodes since the wrapper's own
   * `widgets_values[]` is empty — ComfyUI exports wrappers without
   * inlining values) to `widget` marker (always present on ComfyUI's
   * exported wrappers, and now also stamped defensively for custom
   * wrappers by the server-side pass). This matches WorkflowNode's
   * splitter and routes every exposed widget slot into the WIDGET
   * zone so the LABEL | VALUE rows render as inline widgets. */
  const connInputs = cleanedInputs.filter(
    ({ inp }) => !inp.widget && !inp.isConnection
  );
  const widgetInputs = cleanedInputs.filter(
    ({ inp }) => !!inp.widget || inp.isConnection === true
  );

  /* Top Pins rows: every declared input port AND every output port is a
   *  row, zipped left/right on 22px rows (same as a regular WorkflowNode). */
  const pinRows = Math.max(connInputs.length, cleanedOutputs.length);

  return (
    <div
      className={`relative flex flex-col rounded-lg border shadow-[0_6px_22px_var(--color-shadow-strong)] ${
        nodeMode !== 0 ? "bg-transparent" : "bg-node"
      }`}
      ref={hoverRef}
      data-node-id={data.nodeId}
      {...hoverHandlers}
      style={{
        // Width tracks ComfyUI's saved `size.w` when present (fixed-width box,
        //  exactly like ComfyUI — only the height is fluid).  Falls back to a
        //  sensible min width when no size is carried.
        width: data.size ? data.size.w : undefined,
        // Height is fully content-driven (`auto`) in BOTH states: the subgraph
        //  card GROWS with its pins when expanded and AUTO-SHRINKS to the title
        //  bar when collapsed.  A `minHeight` floor keeps the expanded box from
        //  dropping below ComfyUI's saved `size.h`, and the collapsed chip never
        //  collapses below its own title bar.
        height: "auto",
        minWidth: data.size ? data.size.w : 280,
        // data.size.h is the BODY CONTENT height (size[1]).
        //  The WorkflowSubgraphNode outer div INCLUDES the pinned 30px title bar,
        //  so the total floor is content + title = size[1] + 30.  Mirrors
        //  WorkflowNode's fix so the card fills the React Flow box instead of
        //  rendering short by 30px.
        minHeight: isCollapsed ? NODE_TITLE_H : (data.size ? (data.size.h ?? 0) + NODE_TITLE_H : undefined),
        // No maxWidth cap here either: ComfyUI lets the user resize the
        //  subgraph box freely, and we must respect whatever `size` the
        //  config carries (a hard 320 cap would clip wider subgraph
        //  boxes the user explicitly set in ComfyUI).
        borderColor: hexToRgba(accent, 0.55),
        // Tint + real blur for bypass/disabled subgraphs live in <NodeFrost>;
        //  the root keeps `isolation` so the frost's negative z stays contained,
        //  and stays transparent so the frost shows through.  Normal subgraphs
        //  take the solid panel from `bg-node` (theme-aware).
        isolation: "isolate",
        // ComfyUI draws a bright selection rectangle around the active node.
        outline: selected ? "2px solid rgba(56,189,248,0.9)" : "none",
        outlineOffset: selected ? "2px" : undefined,
      }}
    >
      {accent && nodeMode !== 0 && <FrostLayer color={accent} nodeMode={nodeMode} />}
      {/* Header — purple accent (subgraph identity).  Same NODE_TITLE_H as
       *  the regular WorkflowNode header so titled nodes line up on the grid. */}
      <SubgraphHeader
        title={data.title}
        nodeId={String(data.nodeId)}
        accent={accent}
        isCollapsed={isCollapsed}
        onToggle={() => setUserCollapsed((value) => !value)}
        onEnter={data.onEnter}
        io={io}
        outputRef={
          cleanedOutputs.length > 0
            ? {
                name: cleanedOutputs[0]!.out.name,
                // forward the subgraph wrapper's output label
                // (e.g. business `IMAGE_FINAL`) so it reaches the IO
                // preview unchanged.
                label:
                  cleanedOutputs[0]!.out.label ??
                  cleanedOutputs[0]!.out.localized ??
                  cleanedOutputs[0]!.out.name,
              }
            : null
        }
      />

      {/* Collapsed-mode handle anchors. Hidden when the
       *  subgraph chip is expanded — body sections below render
       *  instead.  Visual is the same cylinder (rounded vertical
       *  pill): one on the LEFT for wired boundary inputs, one on the
       *  RIGHT whenever the wrapper declares any output.  Invisible
       *  per-port <Handle>s sit underneath so live wire geometry is
       *  preserved across toggle. */}
      {isCollapsed && (() => {
        const wiredInputs = connInputs.filter(({ inp }) => data.connectedInputs?.has(inp.name));
        const wiredOutputs = cleanedOutputs.filter(({ out }) => data.connectedOutputs?.has(out.name));
        const cylH = (count: number) =>
          Math.min(64, Math.max(16, 12 + count * 4));
        return (
          <>
            {wiredInputs.length > 0 && (
              <div
                aria-hidden
                className="pointer-events-none absolute"
                style={{
                  left: -3,
                  top: "50%",
                  transform: "translateY(-50%)",
                  width: 6,
                  height: cylH(wiredInputs.length),
                  borderRadius: 999,
                  background: anchor.gradient,
                  border: anchor.border,
                  boxShadow: anchor.boxShadow,
                  zIndex: 10,
                }}
              />
            )}
            {cleanedOutputs.length > 0 && (
              <div
                aria-hidden
                className="pointer-events-none absolute"
                style={{
                  right: -3,
                  top: "50%",
                  transform: "translateY(-50%)",
                  width: 6,
                  height: cylH(cleanedOutputs.length),
                  borderRadius: 999,
                  background: anchor.gradient,
                  border: anchor.border,
                  boxShadow: anchor.boxShadow,
                  zIndex: 10,
                }}
              />
            )}
            {wiredInputs.map(({ inp, label }, idx) => {
              const col = portColor(inp.type ?? "*");
              const total = wiredInputs.length;
              const offset = total > 1 ? (idx - (total - 1) / 2) * 6 : 0;
              return (
                <Handle
                  key={`collapsed-sub-in-${inp.name}-${idx}`}
                  type="target"
                  position={Position.Left}
                  id={inp.name}
                  isConnectable={false}
                  className="!h-2 !w-2 !rounded-full"
                  style={{ left: 0, top: `calc(50% + ${offset}px)`, background: col, opacity: 0 }}
                  title={`${label} (${inp.type})`}
                />
              );
            })}
            {wiredOutputs.map(({ out, display }, idx) => {
              const col = portColor(out.type ?? "*");
              const total = wiredOutputs.length;
              const offset = total > 1 ? (idx - (total - 1) / 2) * 6 : 0;
              return (
                <Handle
                  key={`collapsed-sub-out-${out.name}-${idx}`}
                  type="source"
                  position={Position.Right}
                  id={`out:${out.name}`}
                  isConnectable={false}
                  className="!h-2 !w-2 !rounded-full"
                  style={{ right: 0, top: `calc(50% + ${offset}px)`, background: col, opacity: 0 }}
                  title={`${display} (${out.type})`}
                />
              );
            })}
          </>
        );
      })()}

      {/* TOP PINS zone — pure-connection input ports (left dot) zipped with
       *  exposed output ports (right dot) on shared rows, exactly like a
       *  regular WorkflowNode.  Every declared pin shows its dot permanently
       *  (always-on) so unconnected ports stay visible.
       *  Hidden when the user / config marks the chip collapsed. */}
      {!isCollapsed && pinRows > 0 && (
        <div
          className="border-border-strong border-b py-0.5"
          style={{ background: "var(--color-subtle)" }}
        >
            {Array.from({ length: pinRows }).map((_, rowIdx) => {
              const inEntry = connInputs[rowIdx];
              const outEntry = cleanedOutputs[rowIdx];
              const inInp = inEntry?.inp;
              const outMeta = outEntry?.out;
              const inName = inInp?.name;
              const outName = outMeta?.name;
              const inType = inInp?.type ?? "*";
              const outType = outMeta?.type ?? "*";
              const inCol = portColor(inType);
              const outCol = portColor(outType);
              const inLabel = inEntry?.label ?? "";
              const outDisplay = outEntry?.display ?? "";
              return (
                <div
                  key={`subpin-${rowIdx}-${inName ?? "_"}-${outName ?? "_"}`}
                  /* long boundary-port labels wrap onto
                   *  multiple lines instead of being clipped to 22 px.  See
                   *  the WorkflowNode inline-branch comment for full rationale. */
                  className="relative flex min-h-[22px] h-auto items-center pl-5 pr-5 py-0.5 text-[11px]"
                  data-sub-pin-input={inName}
                  data-sub-pin-output={outName}
                >
                  {inEntry && (
                    <>
                      <Handle
                        type="target"
                        position={Position.Left}
                        id={inName}
                        isConnectable={false}
                        className="!h-2.5 !w-2.5 !rounded-full !border !border-port-surface"
                        style={{
                          left: 5,
                          background: inCol,
                          boxShadow: `0 0 6px ${inCol}AA, inset 0 0 0 1px var(--color-port-surface)`,
                        }}
                        title={`${inLabel} (${inType})`}
                      />
                      {/* Subgraph boundary inputs that already have an incoming
                       *  wire from the parent workflow (or are themselves a
                       *  sentinel boundary link) get their value upstream — they
                       *  cannot be exposed as workflow inputs.  Skip the checkbox
                       *  for connected slots. */}
                      {io?.ioEditMode && inName && !inInp?.isConnection && !inInp?.isBoundary && (
                        <IoCheckbox
                          io={io}
                          ioRef={{
                            nodeId: String(data.nodeId),
                            hostNodeId: data.hostNodeId,
                            name: inName,
                            kind: "param",
                            direction: "input",
                            // forward the boundary port's
                            // display label (already resolved into
                            // `inLabel` above) so the IO preview shows
                            // the meaningful name instead of the raw
                            // wrapper port key.
                            label: inLabel || inName,
                          }}
                        />
                      )}
                      <span
                        /* drop `truncate` so a long
                         *  boundary-port label (e.g. the Settings wrapper's
                         *  `Model: True = 🟡 Safetensors | False = 🟣 GGUF`
                         *  BOOLEAN widget) wraps onto multiple lines
                         *  instead of being clipped.  Full text stays
                         *  available via the native `title` tooltip. */
                        className="text-ink-bright min-w-0 flex-1 text-left text-[11px] break-words whitespace-normal"
                        title={`${inLabel} (${inType})`}
                      >
                        {inLabel}
                      </span>
                    </>
                  )}
                  {outEntry && (
                    <>
                      <span
                        /* same wrap fix as the
                         *  boundary-input branch above. */
                        className="text-ink-bright min-w-0 flex-1 text-right text-[11px] break-words whitespace-normal"
                        title={`${outDisplay} (${outType})`}
                      >
                        {outDisplay}
                      </span>
                      {/* per-PORT output checkbox removed;
                       *  workflow outputs are node-identified.  The per-node output
                       *  checkbox now lives in the subgraph node header. */}
                      {/* 输出端点**任何视图模式下都必须挂载** —— 同
                       *  FlowNodePinRows：它同时是下游 `out:<name>` 边的锚点，
                       *  条件不渲染会让 React Flow 解析不到 handle 而丢掉整条边
                       *  （error#008），画布上表现为「输出没有连线」。
                       *  IO 编辑模式下改用「缩到几乎不可见」代替「不渲染」。 */}
                      <Handle
                        type="source"
                        position={Position.Right}
                        id={`out:${outName}`}
                        isConnectable={false}
                        className="!rounded-full !border !border-port-surface"
                        style={{
                          right: 5,
                          background: outCol,
                          boxShadow: `0 0 6px ${outCol}AA, inset 0 0 0 1px var(--color-port-surface)`,
                          ...(io?.ioEditMode
                            ? { width: 4, height: 4, opacity: 0.35, right: 0 }
                            : { width: 10, height: 10 }),
                        }}
                        title={`${outDisplay} (${outType})`}
                      />
                    </>
                  )}
                </div>
              );
            })}
          </div>
      )}

      {/* WIDGET zone — exposed wrapper widget inputs as LABEL | VALUE rows.
       *  A dot (target Handle) mounts only when the slot is ALSO wired
       *  (isConnection / isBoundary), matching WorkflowNode's "both" row.  Even
       *  then the value stays visible (连线不消失 + 值照常显示).
       *  STRING widgets with long values break out into a stacked block.
       *  Hidden when the chip is collapsed. */}
      {!isCollapsed && widgetInputs.length > 0 && (
        <div className="bg-surface-1 relative flex min-h-0 flex-1 flex-col py-0.5">
          {widgetInputs.map(({ inp, label }, i) => {
            const v: unknown = inp.widgetValue;
            const isConn = inp.isConnection === true || inp.isBoundary === true;
            const typeCol = portColor(inp.type);
            const stringText: string = typeof v === "string" ? v : "";
            /* (parity with WorkflowNode): STRING widget detection now
             *  uses the shared `inferIsMultiline` helper rather than
             *  the `length >= 32 || \n` heuristic.  Subgraph wrapper
             *  inputs (the wrapper-node's own exposed pins) hit this
             *  branch — without the helper a short prompt input
             *  silently degrades to a one-line chip. */
            const isStringWidget =
              !isConn &&
              inp.type === "STRING" &&
              (inferIsMultiline(data.classType as string | undefined, inp.name, stringText) ||
                stringText.length >= 32 ||
                stringText.includes("\n"));
            const displayValue = isStringWidget ? "" : renderSubgraphWidgetValue(v);
            return (
              <div
                key={`sub-w-${inp.name}-${i}`}
                className={
                  isStringWidget
                    ? /* R17 (parity with WorkflowNode): vertical STACKED layout
                       *  for STRING widgets on the subgraph wrapper too.
                       *  LABEL + charCount chip on the top row, textarea
                       *  fills the remaining vertical space below.
                       *  Previous `flex-row items-start` (kept inline with
                       *  WorkflowNode) had the same title-and-value-
                       *  on-one-row + maxHeight-capped regression; see
                       *  the WorkflowNode branch comment for the full rationale. */
                      "group relative flex min-h-0 flex-1 flex-col gap-1.5 pl-5 pr-2 py-1.5 text-[11px]"
                    /* long widget labels wrap onto
                     *  multiple lines instead of being clipped to 22 px.
                     *  See the WorkflowNode inline-branch comment for full
                     *  rationale. */
                    : "group relative flex min-h-[22px] h-auto items-center gap-1.5 pl-5 pr-2 py-0.5 text-[11px]"
                }
                data-sub-widget-name={inp.name}
                data-sub-widget-value={String(v)}
              >
                {isConn && (
                  <Handle
                    type="target"
                    position={Position.Left}
                    id={inp.name}
                    isConnectable={false}
                    className="!h-2.5 !w-2.5 !rounded-full !border !border-port-surface"
                    style={{
                      left: 5,
                      background: typeCol,
                      boxShadow: `0 0 6px ${typeCol}AA, inset 0 0 0 1px var(--color-port-surface)`,
                    }}
                    title={`${label} (${inp.type})`}
                  />
                )}
                {/* Workflow inputs must be UNCONNECTED — a slot already carrying a wire
                 *  (isConnection / isBoundary) gets its value from upstream, so
                 *  exposing it as a workflow input is meaningless. */}
                {/* this top-level checkbox is for COMPACT (non-STRING) widgets
                 *  only.  STRING widgets render their own IoCheckbox inside the
                 *  stacked block below (L4415), so without the `!isStringWidget`
                 *  guard a STRING row would show TWO checkboxes — one orphaned at
                 *  the top of the row, one correctly next to its label. */}
                {io?.ioEditMode && !isConn && !isStringWidget && (
                  <IoCheckbox
                    io={io}
                    ioRef={{
                      nodeId: String(data.nodeId),
                      hostNodeId: data.hostNodeId,
                      name: inp.name,
                      kind: "widget",
                      direction: "input",
                      // forward the SAME resolved display name the row
                      // shows (内部字段业务名 → 本层 label/localized → 别名),
                      // 这样 IO 面板初值与画布逐字一致（ISSUE #349）。
                      label: label || inp.name,
                    }}
                  />
                )}
                {!isStringWidget && (
                  <>
                    {inp.type === "COMBO" &&
                    Array.isArray((inp as ComboInputMeta).comboOptions) &&
                    ((inp as ComboInputMeta).comboOptions as unknown[]).length > 0 ? (
                      <>
                        <span
                          /* drop `truncate` so a long
                           *  subgraph-wrapper COMBO widget label wraps
                           *  onto multiple lines instead of being clipped
                           *  (same fix as the WorkflowNode inline branch). */
                          className="min-w-0 shrink whitespace-normal break-words text-left text-[11px]"
                          style={{ flex: "0 1 auto", color: isConn ? "var(--color-ink-strong)" : "var(--color-ink-subtle)" }}
                          title={label}
                        >
                          {label}
                        </span>
                        {/* Vertical 1px divider between label and value. */}
                        <span className="bg-border-strong h-2 w-px shrink-0" aria-hidden />
                        {/* COMBO widget on the workflow canvas
                         *  renders as a display-only DarkSelect — it shows the
                         *  currently-selected model as a dropdown shell, but
                         *  stays disabled here (editing happens in the project
                         *  canvas form where the value is persisted).  The
                         *  node is a faithful read-only preview, not an editor.
                         *  The trigger is shrunk to the 22px row height so it
                         *  doesn't break the uniform pin rhythm. */}
                        <DarkSelect
                          value={typeof v === "string" ? v : ""}
                          onChange={() => undefined}
                          options={(inp as ComboInputMeta).comboOptions as string[]}
                          disabled
                          className="!h-[22px] !py-0 !text-[11px] flex-1 min-w-0"
                          popoverMinWidth={220}
                        />
                      </>
                    ) : (
                      <>
                        <span
                          /* drop `truncate` so a long
                           *  subgraph-wrapper widget label wraps onto
                           *  multiple lines instead of being clipped
                           *  (same fix as the WorkflowNode inline branch). */
                          className="min-w-0 shrink whitespace-normal break-words text-left text-[11px]"
                          style={{ flex: "0 1 auto", color: isConn ? "var(--color-ink-strong)" : "var(--color-ink-subtle)" }}
                          title={label}
                        >
                          {label}
                        </span>
                        {/* Vertical 1px divider between label and value.
                         *  now a soft vertical gradient (top/bottom
                         *  fade to transparent) instead of a hard bar — reads as
                         *  a column hint rather than a "cut the row in half" line.
                         *  Width still 1px so it doesn't claim row real estate. */}
                        <span className="bg-border-strong h-2 w-px shrink-0" aria-hidden />
                        <span
                          className="min-w-0 truncate text-right text-[10.5px] tabular-nums"
                          style={{
                            /* Same rationale as the WorkflowNode value span — `truncate`
                             *  is back, but only the text itself ellipsises; the
                             *  node width stays under the user's control
                             *  (ComfyUI resize ↔ canvas mirror).  No `minWidth:
                             *  fit-content` (would blow up to 810px on long
                             *  filenames) and no `maxWidth` cap (would clip
                             *  legitimate wide nodes). */
                            flex: "1 1 0",
                            color: valueCellColor(v),
                          }}
                          title={String(v)}
                        >
                          {displayValue}
                        </span>
                      </>
                    )}
                  </>
                )}
                {/* STRING-widget textbox on subgraph wrapper.  STACKED
                 *  BELOW the LABEL row (parity with WorkflowNode). Row is
                 *  `flex-col gap-1.5 flex-1` so the label + charCount
                 *  chip occupy the top row and the textarea below fills
                 *  the remaining vertical space.  See WorkflowNode branch for
                 *  the full rationale on the `flex-row items-start` →
                 *  `flex-col gap-1.5 flex-1` migration and the removal
                 *  of `maxHeight: 96`.
                 *
                 *  Pairs with the WorkflowNode branch: a real <textarea readOnly>
                 *  so multi-line prompts wrap and any overflow scrolls
                 *  natively (no Tailwind className dependence — WorkflowNode
                 *  subtree historically has unreliable arbitrary-value
                 *  compilation).  `mono` font for subgraph wrapper widgets
                 *  (they're typically system names / IDs).  Empty value
                 *  falls back to a faint "（空）" placeholder wrapped in a
                 *  flex-1 container so the row layout stays balanced. */}
                {isStringWidget && (
                  <div className="flex min-h-0 flex-1 flex-col">
                    <div className="flex shrink-0 items-center gap-1.5">
                      {io?.ioEditMode && !isConn && (
                        <IoCheckbox
                          io={io}
                          ioRef={{
                            nodeId: String(data.nodeId),
                            hostNodeId: data.hostNodeId,
                            name: inp.name,
                            kind: "widget",
                            direction: "input",
                            // 同 compact 行：转发已解析好的显示名
                            // （内部字段业务名 → 本层 label/localized → 别名）。
                            label: label || inp.name,
                          }}
                        />
                      )}
                      <span
                        /* drop `truncate` from the
                         *  subgraph STRING-stacked row label too — same
                         *  rationale as the WorkflowNode inline branch. */
                        className="shrink-0 whitespace-normal break-words text-left text-[11px]"
                        style={{ color: isConn ? "var(--color-ink-strong)" : "var(--color-ink-subtle)" }}
                        title={label}
                      >
                        {label}
                      </span>
                      <span className="bg-border-strong h-2 w-px shrink-0" aria-hidden />
                      <span
                        className="text-ink-muted text-right text-[10px] tracking-wider uppercase"
                        title={`STRING · ${stringText.length} chars`}
                      >
                        {stringText.length}c
                      </span>
                    </div>
                    {stringText.length > 0 ? (
                      <StringTextarea value={stringText} mono hasSize={hasSize} />
                    ) : (
                      <div
                        className="border-border-strong bg-canvas-deep text-ink-fainter flex-1 rounded border px-2 py-1.5 text-[10.5px] leading-snug"
                        style={{ minHeight: 28 }}
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
    </div>
  );
});

