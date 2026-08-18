"use client";
/* Extracted React contexts + providers + JSON popover + shared checkbox/chip.
 * Originally declared inside WorkflowCanvasEditor.tsx. */
import React, { useCallback, useEffect, useMemo, useRef, useState, useContext } from "react";
import { createPortal } from "react-dom";
import type {
  WorkflowDetail,
  WorkflowGroup,
  RawMetaEntry,
  IOEditContextValue,
  RgthreeGroupsContextValue,
  NodeJsonViewerRequest,
  NodeJsonViewerContextValue,
  IoRef,
  ComfyGraphNode,
  WorkflowIOParam,
} from "./wf-types";
import { rectToAnchor, computePos } from "./wf-utils";
import { Chip } from "./wf-chips";
import type { WorkflowIOMap } from "@/components/updream/shared/workflow-io";
export const IOEditContext = React.createContext<IOEditContextValue | null>(null);

/* 2026-08-11 (R57): footer chip used in the IO preview panel.  Shows a
 *  running tally of how many widget inputs are currently marked required
 *  vs. how many are still optional, so authors can see the contract at a
 *  glance without counting buttons.  Mirrors `splitWorkflowIO` rules:
 *  outputs are excluded. */
export const RgthreeGroupsContext = React.createContext<RgthreeGroupsContextValue | null>(null);

export function RgthreeGroupsProvider({
  workflowId,
  detail,
  children,
}: {
  workflowId: string;
  detail: WorkflowDetail | null;
  children: React.ReactNode;
}) {
  /* Optimistic overrides: groupId → bypass.  Wins over
   * `detail.groups[].bypass` until cleared (a successful PATCH followed
   * by a detail refetch reconciles).  This is the standard
   * "optimistic-update" pattern — the toggle snaps to the new state
   * immediately and the server write is fire-and-forget.  A failure
   * leaves the override in place; the next detail refetch will
   * reconcile once the cache TTL (30s) elapses. */
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const getBypass = useCallback(
    (groupId: string) => {
      if (Object.prototype.hasOwnProperty.call(overrides, groupId)) {
        return overrides[groupId];
      }
      const g = detail?.groups?.find((x) => x.id === groupId);
      return !!g?.bypass;
    },
    [overrides, detail]
  );
  const setBypass = useCallback(
    (groupId: string, bypass: boolean) => {
      setOverrides((prev) => ({ ...prev, [groupId]: bypass }));
      void fetch(`/api/workflows/${encodeURIComponent(workflowId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groups: [{ id: groupId, bypass }] }),
      }).catch(() => {});
    },
    [workflowId]
  );
  const value = useMemo<RgthreeGroupsContextValue>(
    () => ({ getBypass, setBypass }),
    [getBypass, setBypass]
  );
  return (
    <RgthreeGroupsContext.Provider value={value}>
      {children}
    </RgthreeGroupsContext.Provider>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 *  NodeJsonViewer  ─  clickable #id chip → popover with raw workflow JSON
 * ────────────────────────────────────────────────────────────────────────
 *  When the user clicks a node's right-aligned `#182` chip in its header
 *  (or `#abcdef12` for a subgraph), a popover opens pinned next to that
 *  chip and shows the EXACT entry of `detail.graph[nodeId]` — i.e. the
 *  literal JSON record ComfyUI would serialise back when you re-export
 *  this workflow.  Nothing gets rounded, summarised, or filtered: the
 *  author can see `widgets_values[2]`, `[1, 28]`, etc. byte-for-byte.
 *
 *  Rationale:
 *   • Diagnose "what did the JSON actually save?"  Field name drift
 *     between LiteGraph local IDs (`9b9009e4-…`) and ComfyUI IDs (`76`)
 *     used to confuse the eye — this puts the raw entry on screen.
 *   • Discover `mode` toggles (`mode: 2` → muted/grey), extra properties
 *     (`cnr_id`, `frontend_only`), and what the saved `widgets_values`
 *     array looks like vs. what's displayed.
 *
 *  Data flow:
 *   • `NodeJsonViewerProvider` lives at the `WorkflowCanvasEditor` root,
 *     so the whole tree sees the current `detail`.
 *   • WfNode / WfSubgraphNode call `ctx.requestShow(anchorEl, nodeId,
 *     kind)` from the `#id` chip — a stopPropagation-guarded click.
 *   • The popover is rendered through a React Portal to `document.body`
 *     so it floats ABOVE the React Flow viewport's `overflow: hidden`
 *     without being clipped at the canvas edge.  Position is computed
 *     from the chip's bounding-rect + viewport scroll, NOT from the
 *     React Flow `transform` — that way zoom/pan never shifts it.
 *
 *  Close triggers:
 *   • ESC key       ─ top-level listener cleared on unmount.
 *   • Outside click ─ click on the floating backdrop dismisses.
 *   • × button     ─ explicit close.
 *  The chip itself stays registered as a "double-tap to reopen" anchor
 *  to allow quick re-toggle. */
export const NodeJsonViewerContext = React.createContext<NodeJsonViewerContextValue | null>(null);

/* Capture-rect helper: read a `DOMRect` and freeze the stable bits
 *  (positions only; width/height are recomputed live from the rect
 *  snapshot so an editor font load doesn't desync).  Done as a helper
 *  rather than inline so the same shape is used by requestShow and
 *  by the popover positioning effect. */
export function NodeJsonViewerProvider({
  detail,
  rawMetaById,
  positions,
  /* 2026-08-11 R47: 子图单节点 RAW 需要父 rawJson 切出的子图 raw def。
   * 这两个值在主组件声明、provider 拿不到，故以 prop 传入。 */
  subgraphRawContext,
  subgraphStackLength,
  children,
}: {
  detail: WorkflowDetail | null;
  rawMetaById: Record<string, RawMetaEntry>;
  positions: Record<string, [number, number]> | null;
  subgraphRawContext: { parentRawJson: unknown; subUid: string } | null;
  subgraphStackLength: number;
  children: React.ReactNode;
}) {
  const [viewer, setViewer] = useState<NodeJsonViewerRequest | null>(null);

  const getNodeJson = useCallback(
    (nodeId: string) => {
      if (!detail || !detail.graph) return null;
      const entry = detail.graph[nodeId];
      return entry && typeof entry === "object" ? (entry as Record<string, any>) : null;
    },
    [detail]
  );

  const getNodeView = useCallback(
    (nodeId: string) => {
      if (!detail) return null;
      const rawEntry = detail.graph?.[nodeId];
      const entry =
        rawEntry && typeof rawEntry === "object" ? (rawEntry as Record<string, any>) : null;

      /* 2026-08-11 R47: 子图视图下 `detail.rawJson` 为 undefined（sub-detail
       * 不返回 rawJson），导致 sub 节点的 RAW · 节点视图退回「合成体」、
       * 与非子图（直接展示真·RAW 节点）结构不一致。子图自己的 LiteGraph
       * 定义其实藏在父 `rawJson.definitions.subgraphs[subUid].nodes` 里
       * （route.ts 确认其 nodes 形状与顶层 raw.nodes[i] 完全一致）。
       * 这里优先从 `subgraphRawContext` 切出子图 raw def 的 nodes 查 rawNode；
       * 顶层 / 无 ctx / 父非 RAW 导入时回退到顶层 `detail.rawJson.nodes`
       * （仍无则 null → 合成体，与 API-only 导入行为一致，不退化）。 */
      let rawNodesSource: any[] | null = null;
      const isSubView = subgraphStackLength > 0 && subgraphRawContext;
      if (isSubView) {
        const subs = (
          subgraphRawContext!.parentRawJson as
            | { definitions?: { subgraphs?: Record<string, any> } }
            | null
        )?.definitions?.subgraphs;
        /* 镜像 server route (route.ts line 73-78) 的兜底：
         *  - 先按 key 直接查 `subs[uid]`（标准 ComfyUI 工作流：subgraphs
         *    的 key 就是子图节点的 class_type，即 UUID）
         *  - miss 时按 sub.id 回查（处理 subgraphs 按数字 ID 编号的旧格式）
         *  这样无论 server 端能查到哪个子图 def，client 都能找到同一份
         *  raw def，节点 JSON 结构与非子图完全一致。 */
        const targetUid = subgraphRawContext!.subUid;
        let subDef: any = subs?.[targetUid];
        if (!subDef || !Array.isArray(subDef.nodes)) {
          const matchKey = subs
            ? Object.keys(subs).find((k) => subs[k]?.id === targetUid)
            : undefined;
          if (matchKey && subs) subDef = subs[matchKey];
        }
        if (subDef && Array.isArray(subDef.nodes)) {
          rawNodesSource = subDef.nodes as any[];
        }
      }
      if (!rawNodesSource && Array.isArray((detail.rawJson as any)?.nodes)) {
        rawNodesSource = (detail.rawJson as any).nodes as any[];
      }
      const rawNode = rawNodesSource
        ? (rawNodesSource.find((n) => String(n?.id) === nodeId) ?? null)
        : null;

      return {
        entry,
        raw: rawMetaById?.[nodeId],
        rawNode,
        pos: positions?.[nodeId] ?? null,
      };
    },
    [detail, rawMetaById, positions, subgraphRawContext, subgraphStackLength]
  );

  const requestShow = useCallback(
    (anchorEl: HTMLElement, nodeId: string, kind: "node" | "subgraph") => {
      const rect = anchorEl.getBoundingClientRect();
      setViewer({
        anchorRect: rectToAnchor(rect),
        nodeId,
        kind,
      });
    },
    []
  );

  const dismiss = useCallback(() => setViewer(null), []);

  const value = useMemo<NodeJsonViewerContextValue>(
    () => ({ getNodeJson, getNodeView, requestShow, dismiss, viewer }),
    [getNodeJson, getNodeView, requestShow, dismiss, viewer]
  );

  return (
    <NodeJsonViewerContext.Provider value={value}>
      {children}
      {viewer && (
        <NodeJsonPopover
          key={`${viewer.nodeId}-${viewer.kind}`}
          request={viewer}
          getJson={getNodeJson}
          getView={getNodeView}
          onDismiss={dismiss}
        />
      )}
    </NodeJsonViewerContext.Provider>
  );
}

/* The popover itself.  Three blocks stacked vertically:
 *   ┌────────────────────────────────────────────────┐
 *   │  Header  ─  📋 节点 JSON · #182 · class_type   │
 *   │              [⧉ 复制]   [× 关闭]                │
 *   ├────────────────────────────────────────────────┤
 *   │  Meta strip — mode / flags / boundaries / etc   │
 *   ├────────────────────────────────────────────────┤
 *   │  JSON dump — monospace, syntax-toned, copyable  │
 *   └────────────────────────────────────────────────┘
 *
 *  Where it sits:
 *    • Pin to the RIGHT of the chip, 8px gap, 24px inset from the screen
 *      edge.  If overflowing, flip LEFT of the chip.
 *    • Vertically aligned to the chip's centre, but clamped to within
 *      24px of the viewport's top and bottom (max-height: 60vh).
 *
 *  Visual mirrors the SourceModal (2026-08-09): dark aurora + monospace +
 *  friendly copy-button + backdrops match --color-bg from globals.css. */
export function NodeJsonPopover({
  request,
  getJson,
  getView,
  onDismiss,
}: {
  request: NodeJsonViewerRequest;
  getJson: (nodeId: string) => Record<string, any> | null;
  /** Richer accessor returning `{ entry, raw, pos }` — `raw` and `pos` are
   *  undefined/null for API-only imports. */
  getView: (
    nodeId: string
  ) => {
    entry: Record<string, any> | null;
    raw?: {
      widgets_values: any[];
      outputs: RawOutputMeta[];
      flags: Record<string, any>;
      properties: Record<string, any>;
      mode: number;
    };
    /** Literal RAW node (`detail.rawJson.nodes[i]`) when present. */
    rawNode?: Record<string, any> | null;
    pos: [number, number] | null;
  } | null;
  onDismiss: () => void;
}) {
  const json = useMemo(() => getJson(request.nodeId), [getJson, request.nodeId]);
  const nodeView = useMemo(() => getView?.(request.nodeId) ?? null, [getView, request.nodeId]);
  /* Tab: "saved" = byte-perfect `detail.graph[nodeId]` (default OFF since
   *  users hit the chip wanting to see MORE, not less), "view" =
   *  synthesised canvas-state entry aggregating `raw` + `pos` from the
   *  raw metadata layer.  Default "view" because the "saved" tab was
   *  exactly what the user already saw and complained about. */
  const [tab, setTab] = useState<"saved" | "view">("view");
  /* Synthesised node-view object (only meaningful on `view` tab).  When the
   *  workflow was RAW-imported we prefer the LITERAL raw node
   *  (`nodeView.rawNode` = `detail.rawJson.nodes[i]`) so this tab is
   *  byte-identical to the corresponding slice of the whole-workflow RAW
   *  view.  We fall back to a sparse recombination (graph entry + raw
   *  metadata + pos) only for API-only imports where no rawJson exists. */
  const viewObj = useMemo<Record<string, any> | null>(() => {
    if (!nodeView) return null;
    if (nodeView.rawNode && typeof nodeView.rawNode === "object") {
      return nodeView.rawNode as Record<string, any>;
    }
    const out: Record<string, any> = {};
    const e = nodeView.entry;
    const r = nodeView.raw;
    if (e && typeof e.class_type === "string") out.class_type = e.class_type;
    if (e && typeof e === "object" && "inputs" in e) out.inputs = e.inputs;
    if (e && e._meta && Object.keys(e._meta as Record<string, any>).length) out._meta = e._meta;
    if (r) {
      if (r.mode !== 0) out.mode = r.mode;
      if (r.widgets_values?.length) out.widgets_values = r.widgets_values;
      if (r.outputs?.length) out.outputs = r.outputs;
      const flagKeys = Object.keys(r.flags ?? {});
      if (flagKeys.length) out.flags = r.flags;
      const propKeys = Object.keys(r.properties ?? {});
      if (propKeys.length) out.properties = r.properties;
    }
    if (nodeView.pos) out.pos = nodeView.pos;
    return Object.keys(out).length ? out : null;
  }, [nodeView]);
  const pretty = useMemo(() => {
    if (tab === "saved") {
      return json ? JSON.stringify(json, null, 2) : "（节点详情尚未加载 — 等待 detail.ready）";
    }
    if (viewObj) return JSON.stringify(viewObj, null, 2);
    if (json) {
      /* No raw metadata (API-only import) — still synthesise a thin view
       *  from the byte-perfect entry so the user sees SOMETHING on this
       *  tab instead of a confusing empty box. */
      const thin: Record<string, any> = {};
      if (typeof json.class_type === "string") thin.class_type = json.class_type;
      if (json.inputs && typeof json.inputs === "object") thin.inputs = json.inputs;
      if (json._meta && Object.keys(json._meta as Record<string, any>).length) thin._meta = json._meta;
      if (Object.keys(thin).length) return JSON.stringify(thin, null, 2);
    }
    return "（节点详情尚未加载 — 等待 detail.ready）";
  }, [tab, json, viewObj]);
  const [copied, setCopied] = useState(false);

  /* Position computation runs on every render — nothing here depends
   *  on dynamic layout (the chip rect is FROZEN at request-time), so
   *  pan/zoom/etc. don't move the popover.  We also re-run on each
   *  resize via window listener so dragging the editor border keeps
   *  the popover aligned with the chip (the chip itself moves when
   *  the canvas resizes, so we watch it). */
  const [position, setPosition] = useState<{ left: number; top: number }>(() => computePos(request.anchorRect));
  useEffect(() => {
    const update = () => setPosition(computePos(request.anchorRect));
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [request.anchorRect]);

  /* ESC dismiss.  Listener attached/detached on demand so other
   *  components (SourceModal, settings dialogs) can keep their own
   *  ESC handlers — only one effect is active at a time, but if two
   *  were mounted we'd let both fire and the higher layer would
   *  close.  Acceptable for now; revisit when simultaneous modals
   *  become a real concern. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  const handleCopy = () => {
    void navigator.clipboard.writeText(pretty).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      },
      () => {
        /* Clipboard denied (offline / sandbox / non-secure context).  Fall
         *  back to the legacy textarea selection dance. */
        const ta = document.createElement("textarea");
        ta.value = pretty;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand("copy");
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        } catch {
          /* give up; user can still select-and-copy manually */
        } finally {
          document.body.removeChild(ta);
        }
      }
    );
  };

  /* Popover accent — echo the colour of the trigger chip so the user
   *  sees a visual continuity (subgraphs: violet, regular: muted grey).
   *  Same accent drives both the title bar underline and the meta strip
   *  background tint. */
  const accent = request.kind === "subgraph" ? "#7C5CFC" : "#5BC6FF";
  const nodeClass = (json?.class_type ?? "?") as string;
  /* Mode resolution order: raw.mode (most reliable, present for raw-imported
   *  workflows) → json._meta.mode (ComfyUI's official _meta title/mode
   *  channel, when set by `convertRawToApi`) → top-level json.mode (legacy,
   *  never the case for API format but harmless) → 0. */
  const nodeMode = (
    typeof nodeView?.raw?.mode === "number"
      ? nodeView.raw.mode
      : typeof (json as any)?._meta?.mode === "number"
        ? (json as any)._meta.mode
        : typeof json?.mode === "number"
          ? json.mode
          : 0
  ) as number;
  const modeLabel =
    nodeMode === 4 ? "Bypass" : nodeMode === 2 ? "Disabled" : "Normal";
  const modeColor =
    nodeMode === 4 ? "#ec4899" : nodeMode === 2 ? "#6b7280" : "#10B981";

  return typeof document === "undefined"
    ? null
    : createPortal(
        <>
          {/* Semi-opaque click catcher.  NOT a modal — the canvas stays
           *  draggable behind it (pointer-events on the backdrop are
           *  auto, but stacked below the card); a click outside dismisses
           *  via the backdrop's `onMouseDown`. */}
          <div
            aria-hidden
            onMouseDown={onDismiss}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.20)",
              zIndex: 9000,
            }}
          />
          <div
            role="dialog"
            aria-modal="false"
            aria-label={`节点 #${request.nodeId} 的原始 JSON`}
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              position: "fixed",
              left: position.left,
              top: position.top,
              zIndex: 9001,
              width: 460,
              maxHeight: "60vh",
              borderRadius: 12,
              background: "var(--color-bg, #0a0a0f)",
              border: `1px solid ${accent}55`,
              boxShadow:
                "0 20px 48px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.04) inset, 0 0 24px " +
                accent +
                "33",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              fontFamily:
                'system-ui, -apple-system, "Segoe UI", "Noto Sans SC", sans-serif',
            }}
          >
            {/* Top accent stripe — 2px coloured ribbon under the header. */}
            <div
              aria-hidden
              style={{
                height: 2,
                background: `linear-gradient(90deg, ${accent} 0%, ${accent}55 60%, transparent 100%)`,
              }}
            />

            {/* HEADER — node id, class_type, controls */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 12px 8px 14px",
                borderBottom: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  minWidth: 0,
                  flex: 1,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 11,
                    color: "var(--color-muted, #9A9AAD)",
                    textTransform: "uppercase",
                    letterSpacing: 0.6,
                  }}
                >
                  <span style={{ fontSize: 11 }}>📋</span>
                  <span>节点 JSON</span>
                  <span style={{ color: "rgba(255,255,255,0.18)" }}>·</span>
                  <span
                    style={{
                      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                      color: accent,
                    }}
                  >
                    #{request.nodeId}
                  </span>
                </div>
                <div
                  title={nodeClass}
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "var(--color-ink, #EDEDF2)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {nodeClass}
                </div>
              </div>
              <button
                type="button"
                onClick={handleCopy}
                title="复制 JSON 到剪贴板"
                style={{
                  fontSize: 11,
                  padding: "4px 8px",
                  borderRadius: 6,
                  background: copied ? `${accent}26` : "rgba(255,255,255,0.04)",
                  color: copied ? accent : "var(--color-ink, #EDEDF2)",
                  border: `1px solid ${copied ? accent + "66" : "rgba(255,255,255,0.08)"}`,
                  cursor: "pointer",
                  transition: "all 120ms ease",
                }}
              >
                {copied ? "✓ 已复制" : "⧉ 复制"}
              </button>
              <button
                type="button"
                onClick={onDismiss}
                title="关闭 (Esc)"
                aria-label="关闭"
                style={{
                  width: 26,
                  height: 26,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 6,
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  color: "var(--color-muted, #9A9AAD)",
                  cursor: "pointer",
                  fontSize: 14,
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            </div>

            {/* TAB STRIP — RAW (left, default) shows the literal raw node
             *  `detail.rawJson.nodes[id]` so it is byte-identical to the
             *  corresponding slice of the whole-workflow RAW view; API
             *  (right) shows the byte-perfect `detail.graph[nodeId]`
             *  execution entry.  Default "view" (RAW) because that's what
             *  the user wants to inspect the canvas metadata. */}
            <div
              role="tablist"
              aria-label="节点 JSON 视图切换"
              style={{
                display: "flex",
                gap: 4,
                padding: "6px 10px 0 14px",
                background: "rgba(255,255,255,0.01)",
                borderBottom: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              {(["view", "saved"] as const).map((t) => {
                const active = tab === t;
                return (
                  <button
                    key={t}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setTab(t)}
                    title={
                      t === "saved"
                        ? "API 格式：detail.graph[nodeId] —— ComfyUI /prompt 用的执行条目；不含画布元数据(pos/size/flags/order/inputs.spec)"
                        : "RAW 格式：detail.rawJson.nodes[id] —— 与整工作流「查看 JSON」RAW 逐字节一致；无 rawJson(API 导入)时回退到合成体"
                    }
                    style={{
                      fontFamily:
                        'ui-monospace, SFMono-Regular, Menlo, "Cascadia Mono", Consolas, monospace',
                      fontSize: 11,
                      padding: "5px 10px",
                      borderRadius: "6px 6px 0 0",
                      border: `1px solid ${active ? accent + "55" : "rgba(255,255,255,0.04)"}`,
                      borderBottom: active
                        ? `1px solid ${accent}33`
                        : "1px solid rgba(255,255,255,0.04)",
                      background: active
                        ? `${accent}22`
                        : "rgba(255,255,255,0.02)",
                      color: active
                        ? "var(--color-ink, #EDEDF2)"
                        : "var(--color-muted, #9A9AAD)",
                      cursor: "pointer",
                      transition: "all 120ms ease",
                    }}
                  >
                    {t === "saved" ? "API · 保存格式" : "RAW · 节点视图"}
                  </button>
                );
              })}
            </div>

            {/* META STRIP — mode / flags badges, lets the user see "why
             *  is the node grey?" without scrolling the JSON.  On the
             *  "saved" tab we read from the byte-perfect entry; on the
             *  "view" tab we read from the synthesised viewObj (which
             *  prefers raw.metadata.* as the source of truth). */}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 6,
                padding: "8px 14px",
                background: `${accent}11`,
                borderBottom: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <Chip color={modeColor} label={`mode ${nodeMode} · ${modeLabel}`} />
              {tab === "saved" ? (
                <>
                  {json && "widgets_values" in json && (
                    <Chip color="#a1a1aa" label={`widgets: ${(json.widgets_values as any[])?.length ?? 0} 项`} />
                  )}
                  {json && "inputs" in json && (
                    <Chip color="#a1a1aa" label={`inputs: ${Object.keys((json.inputs as Record<string, any>) ?? {}).length} 个`} />
                  )}
                  {json && "outputs" in json && (
                    <Chip color="#a1a1aa" label={`outputs: ${(json.outputs as any[])?.length ?? 0} 个`} />
                  )}
                  {!json && <Chip color="#f59e0b" label="节点未在 graph 中" />}
                </>
              ) : (
                <>
                  {viewObj?.inputs && (
                    <Chip color="#a1a1aa" label={`inputs: ${Object.keys(viewObj.inputs as Record<string, any> ?? {}).length} 个`} />
                  )}
                  {viewObj?.outputs && Array.isArray(viewObj.outputs) && (
                    <Chip color="#a1a1aa" label={`outputs: ${(viewObj.outputs as any[]).length} 个`} />
                  )}
                  {viewObj?.widgets_values && Array.isArray(viewObj.widgets_values) && (
                    <Chip color="#a1a1aa" label={`widgets: ${(viewObj.widgets_values as any[]).length} 项`} />
                  )}
                  {viewObj?.properties && (
                    <Chip color="#a1a1aa" label={`properties: ${Object.keys(viewObj.properties as Record<string, any> ?? {}).length} 项`} />
                  )}
                  {viewObj?.pos && Array.isArray(viewObj.pos) && (
                    <Chip color="#a1a1aa" label={`pos: ${(viewObj.pos as number[]).map((n) => Math.round(n)).join(", ")}`} />
                  )}
                  {!viewObj && (
                    <Chip color="#f59e0b" label="无画布态数据 — 纯 API 工作流" />
                  )}
                </>
              )}
            </div>

            {/* JSON DUMP — scrollable body, monospace, syntax-toned by
             *  wrapping the value in a <pre>.  Native copy is still
             *  possible (Ctrl/Cmd+A → C works inside).  Re-keying on
             *  nodeId + tab re-mounts the pre so e.g. selection is
             *  preserved on the SAME tab but reset when switching. */}
            <pre
              key={`${request.nodeId}-${request.kind}-${tab}-${pretty.length}`}
              style={{
                margin: 0,
                padding: "12px 14px",
                overflow: "auto",
                flex: 1,
                fontFamily:
                  'ui-monospace, SFMono-Regular, Menlo, "Cascadia Mono", Consolas, monospace',
                fontSize: 11.5,
                lineHeight: 1.55,
                color: "var(--color-ink, #EDEDF2)",
                background: "rgba(255,255,255,0.02)",
                whiteSpace: "pre",
                userSelect: "text",
              }}
            >
              {pretty}
            </pre>

            {/* FOOTER — per-tab footer copy so each tab's guarantee is
             *  stated unambiguously.  Same UX as before for "saved";
             *  "view" makes it explicit that this is a diagnostic
             *  synthesis and NOT what's saved to disk. */}
            <div
              style={{
                padding: "6px 14px 8px",
                fontSize: 10.5,
                color: "var(--color-muted, #9A9AAD)",
                borderTop: "1px solid rgba(255,255,255,0.06)",
                display: "flex",
                justifyContent: "space-between",
              }}
            >
              <span>
                {tab === "saved"
                  ? "展示的是 `detail.graph[nodeId]` 原始条目，再导出后字节级一致。"
                  : "画布视图：聚合 raw 元数据 + 画布坐标；非导出字节 — 仅排查用。"}
              </span>
              <span style={{ fontFamily: "ui-monospace, monospace" }}>esc ×</span>
            </div>
          </div>
        </>,
        document.body
      );
}

/* Compute popover anchor position relative to viewport.
 *  Heuristic:
 *    • default ─ to the RIGHT of the chip, 8px gap
 *    • fallback ─ if right would overflow 24px screen inset, flip LEFT
 *    • vertical ─ align chip center, clamped 24px from top/bottom */
export function NodeIdChip({ nodeId, variant }: { nodeId: string; variant: "node" | "subgraph" }) {
  const ctx = useContext(NodeJsonViewerContext);
  const ref = useRef<HTMLButtonElement | null>(null);

  /* If the provider hasn't been mounted (component used outside
   *  WorkflowCanvasEditor), fall back to a non-interactive span so the
   *  build doesn't crash.  In practice this branch is never taken —
   *  WfNode / WfSubgraphNode are only rendered inside the editor — but
   *  the nullish-narrowing keeps TS happy and is cheap insurance. */
  if (!ctx) {
    return (
      <span
        className={
          variant === "subgraph"
            ? "shrink-0 rounded border border-violet-400/40 bg-violet-500/10 px-1 font-mono text-[9.5px] font-semibold uppercase tracking-wider text-violet-200"
            : "shrink-0 rounded border border-cyan-400/40 bg-cyan-500/10 px-1 font-mono text-[9.5px] font-semibold text-cyan-200"
        }
      >
        #{nodeId}
      </span>
    );
  }

  const handleOpen = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    ctx.requestShow(el, nodeId, variant);
  };

  return (
    <button
      ref={ref}
      type="button"
      data-node-id-chip={nodeId}
      data-variant={variant}
      onClick={handleOpen}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      title="查看节点在工作流 JSON 中的原始数据"
      aria-label={`查看节点 #${nodeId} 的原始 JSON 数据`}
      className={
        variant === "subgraph"
          ? "nodrag nopan group inline-flex shrink-0 cursor-pointer items-center gap-0.5 rounded border border-violet-400/40 bg-violet-500/10 px-1 font-mono text-[9.5px] font-semibold uppercase tracking-wider text-violet-200 transition-colors hover:border-violet-300/70 hover:bg-violet-500/25 hover:text-violet-50 focus:outline-none focus:ring-1 focus:ring-violet-400/40"
          : "nodrag nopan group inline-flex shrink-0 cursor-pointer items-center gap-0.5 rounded border border-cyan-400/45 bg-cyan-500/15 px-1 font-mono text-[9.5px] font-semibold text-cyan-200 transition-colors hover:border-cyan-300/70 hover:bg-cyan-500/25 hover:text-cyan-50 focus:outline-none focus:ring-1 focus:ring-cyan-400/40"
      }
    >
      <span aria-hidden style={{ fontSize: 9, lineHeight: 1 }}>🔍</span>
      <span>#{nodeId}</span>
    </button>
  );
}

/** rgthree Power Lora Loader runtime body (2026-08-09, v2).  Always paints
 *  the Lora Stack section header + Add Lora CTA — rgthree's frontend shows
 *  these regardless of stack contents so the stack visually exists even when
 *  empty (so authors can grow it by clicking the button).  Per-lora rows
 *  are rendered between, parsing each entry from `widgets_values`.
 *
 *  Empty placeholders (`{}` / `""`) are dropped; the header widget
 *  (`{type:"PowerLoraLoaderHeaderWidget"}`) is recognised and not drawn
 *  here (the static header below stands in).  Strength sliders use the
 *  raw tuple's `model_strength` / `clip_strength` keys (rgthree uses
 *  `model_str` / `clip_str` aliases in some builds — we accept both).
 *
 *  Read-only: the canvas is a viewer, so the "+ Add Lora" button is a
 *  static pill that does not fire any handlers. */
export function IoCheckbox({
  ioRef,
  io,
}: {
  ioRef: IoRef;
  io: IOEditContextValue;
}) {
  const key = `${ioRef.nodeId}::${ioRef.kind}::${ioRef.name}`;
  const checked = !!io.workflowIO[key];
  const isOut = ioRef.direction === "output";
  const dirLabel = isOut ? "输出" : "输入";
  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={() => io.toggleIO(ioRef)}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      title={checked ? `已暴露为工作流${dirLabel}` : `点击将其暴露为工作流${dirLabel}`}
      style={{
        width: 13,
        height: 13,
        // Direction-aware gutter: inputs read left→right (checkbox, then name),
        // outputs read right-aligned (name, then checkbox, then the Handle dot
        // which is absolutely positioned at right:5).  Mirror the margin so the
        // box never sits flush against the label on either side.
        marginLeft: isOut ? 6 : 0,
        marginRight: 6,
        flex: "0 0 auto",
        accentColor: checked ? "#fbbf24" : "#a1a1aa",
        cursor: "pointer",
      }}
    />
  );
}
export interface RawOutputMeta {
  name: string;
  localized?: string;
  /** Business label for the slot — `FRAMES` / `IMAGE_FINAL`.  Forwarded
   *  by /api/workflows/[id] from rawJson.outputs[].label so both the
   *  parent WfSubgraphNode outputs strip and the inner WfIoPortNode
   *  IO rail show the same name (2026-08-06 fix). */
  label?: string;
  type: string;
  /** Source link ids coming out of this output (used to derive wires). */
  links: number[];
  /** True when at least one outgoing link targets the boundary sentinel
   *  `-20` (this output is exposed by the parent subgraph wrapper).
   *  Set by /api/workflows/[id]/subgraph.  Outer workflows always false. */
  isBoundary?: boolean;
}
export interface WorkflowNote {
  id: string;
  /** Display title — extracted from `title` field or first `#`-heading line. */
  title: string;
  text: string;
  pos: [number, number];
  size: [number, number];
  color: string;
}

/** Extract a note's display title from its raw JSON.  ComfyUI stores the title
 *  either at the root level (newer versions) or as the first markdown heading
 *  line (`# Title`) in the text body.  Falls back to the first non-empty line
 *  when no markdown heading is present, and finally to "" when even that is
 *  missing.  Leading "Note:" prefixes are stripped so the title bar doesn't
 *  echo "Note: Note: Foo". */
