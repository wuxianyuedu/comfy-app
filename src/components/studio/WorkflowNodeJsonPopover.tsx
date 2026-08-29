"use client";
/* ════════════════════════════════════════════════════════════════════════
 *  wf-node-json-popover.tsx — 节点 JSON 查看弹层（纯展示组件）。
 *  从 wf-contexts.tsx 抽出，以打破与 wf-stores.ts 的循环依赖：
 *    wf-stores.ts  →  import { NodeJsonPopover } from 本文件
 *    wf-*-node.tsx →  import store hooks（消费方，无环）
 *  本文件不 import 任何 store / context，只接收 props 渲染。
 * ════════════════════════════════════════════════════════════════════════ */
import { useMemo, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { NodeJsonViewerRequest, RawOutputMeta } from "./workflow-types";
import { computePos } from "./workflow-utils";
import { Chip } from "./RequiredSummary";

/* The popover itself.  Three blocks stacked vertically:
 *   ┌────────────────────────────────────────────────┐
 *   │  Header  ─  📋 节点 JSON · #182 · class_type   │
 *   │              [⧉ 复制]   [× 关闭]                │
 *   ├────────────────────────────────────────────────┤
 *   │  Meta strip — mode / flags / boundaries / etc   │
 *   ├────────────────────────────────────────────────┤
 *   │  JSON dump — monospace, syntax-toned, copyable  │
 *   └────────────────────────────────────────────────┘
 */
/* ── 逐字段收敛的 Raw 节点 JSON 形状 ──
 * 服务端返回的 LiteGraph 节点/RawMeta 荷载是无约束 JSON；组件只消费下述
 * 已声明字段，其余一律保持 unknown 接收，不再以 any 逃生。 */
export type RawNodeJson = {
  class_type?: string;
  id?: string;
  type?: string;
  mode?: number;
  widgets_values?: unknown[];
  inputs?: Record<string, unknown>;
  outputs?: unknown[];
  _meta?: Record<string, unknown>;
  flags?: Record<string, unknown>;
  properties?: Record<string, unknown>;
  pos?: [number, number];
  [key: string]: unknown;
};

export type RawNodeView = {
  entry: RawNodeJson | null;
  raw?: {
    widgets_values: unknown[];
    outputs: RawOutputMeta[];
    flags: Record<string, unknown>;
    properties: Record<string, unknown>;
    mode: number;
  };
  rawNode?: RawNodeJson | null;
  pos: [number, number] | null;
};

export function NodeJsonPopover({
  request,
  getJson,
  getView,
  onDismiss,
}: {
  request: NodeJsonViewerRequest;
  getJson: (nodeId: string) => RawNodeJson | null;
  getView: (nodeId: string) => RawNodeView | null;
  onDismiss: () => void;
}) {
  const json = useMemo(() => getJson(request.nodeId), [getJson, request.nodeId]);
  const nodeView = useMemo(() => getView?.(request.nodeId) ?? null, [getView, request.nodeId]);
  const [tab, setTab] = useState<"saved" | "view">("view");
  const viewObj = useMemo<RawNodeJson | null>(() => {
    if (!nodeView) return null;
    if (nodeView.rawNode && typeof nodeView.rawNode === "object") {
      return nodeView.rawNode;
    }
    const out: RawNodeJson = {};
    const e = nodeView.entry;
    const r = nodeView.raw;
    if (e && typeof e.class_type === "string") out.class_type = e.class_type;
    if (
      e &&
      typeof e === "object" &&
      "inputs" in e &&
      e.inputs &&
      typeof e.inputs === "object"
    ) {
      out.inputs = e.inputs;
    }
    if (e?._meta && Object.keys(e._meta).length) out._meta = e._meta;
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
      const thin: RawNodeJson = {};
      if (typeof json.class_type === "string") thin.class_type = json.class_type;
      if (json.inputs && typeof json.inputs === "object") thin.inputs = json.inputs;
      if (json._meta && Object.keys(json._meta).length) thin._meta = json._meta;
      if (Object.keys(thin).length) return JSON.stringify(thin, null, 2);
    }
    return "（节点详情尚未加载 — 等待 detail.ready）";
  }, [tab, json, viewObj]);
  const [copied, setCopied] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number }>(() =>
    computePos(request.anchorRect)
  );
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
  const accent = request.kind === "subgraph" ? "#7C5CFC" : "#5BC6FF";
  const nodeClass = (json?.class_type ?? "?");
  const nodeMode = (
    typeof nodeView?.raw?.mode === "number"
      ? nodeView.raw.mode
      : typeof json?._meta?.mode === "number"
        ? json._meta.mode
        : typeof json?.mode === "number"
          ? json.mode
          : 0
  );
  const modeLabel =
    nodeMode === 4 ? "Bypass" : nodeMode === 2 ? "Disabled" : "Normal";
  const modeColor =
    nodeMode === 4 ? "#ec4899" : nodeMode === 2 ? "#6b7280" : "#10B981";

  return typeof document === "undefined"
    ? null
    : createPortal(
        <>
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
            onMouseDown={(event) => event.stopPropagation()}
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
              fontFamily: "var(--font-sans)",
            }}
          >
            <div
              aria-hidden
              style={{
                height: 2,
                background: `linear-gradient(90deg, ${accent} 0%, ${accent}55 60%, transparent 100%)`,
              }}
            />
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 12px 8px 14px",
                borderBottom: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
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
                      fontFamily: "var(--font-mono)",
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
              {(["view", "saved"] as const).map((tab) => {
                const active = tab === tab;
                return (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setTab(tab)}
                    title={
                      tab === "saved"
                        ? "API 格式：detail.graph[nodeId] —— ComfyUI /prompt 用的执行条目；不含画布元数据"
                        : "RAW 格式：detail.rawJson.nodes[id] —— 与整工作流「查看 JSON」RAW 逐字节一致"
                    }
                    style={{
                      fontFamily: "var(--font-mono)",
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
                    {tab === "saved" ? "API · 保存格式" : "RAW · 节点视图"}
                  </button>
                );
              })}
            </div>
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
                    <Chip color="#a1a1aa" label={`widgets: ${json.widgets_values?.length ?? 0} 项`} />
                  )}
                  {json && "inputs" in json && (
                    <Chip color="#a1a1aa" label={`inputs: ${Object.keys(json.inputs ?? {}).length} 个`} />
                  )}
                  {json && "outputs" in json && (
                    <Chip color="#a1a1aa" label={`outputs: ${json.outputs?.length ?? 0} 个`} />
                  )}
                  {!json && <Chip color="#f59e0b" label="节点未在 graph 中" />}
                </>
              ) : (
                <>
                  {viewObj?.inputs && (
                    <Chip color="#a1a1aa" label={`inputs: ${Object.keys(viewObj.inputs ?? {}).length} 个`} />
                  )}
                  {viewObj?.outputs && Array.isArray(viewObj.outputs) && (
                    <Chip color="#a1a1aa" label={`outputs: ${(viewObj.outputs).length} 个`} />
                  )}
                  {viewObj?.widgets_values && Array.isArray(viewObj.widgets_values) && (
                    <Chip color="#a1a1aa" label={`widgets: ${(viewObj.widgets_values).length} 项`} />
                  )}
                  {viewObj?.properties && (
                    <Chip color="#a1a1aa" label={`properties: ${Object.keys(viewObj.properties ?? {}).length} 项`} />
                  )}
                  {viewObj?.pos && Array.isArray(viewObj.pos) && (
                    <Chip color="#a1a1aa" label={`pos: ${viewObj.pos.map((num) => Math.round(num)).join(", ")}`} />
                  )}
                  {!viewObj && <Chip color="#f59e0b" label="无画布态数据 — 纯 API 工作流" />}
                </>
              )}
            </div>
            <pre
              key={`${request.nodeId}-${request.kind}-${tab}-${pretty.length}`}
              style={{
                margin: 0,
                padding: "12px 14px",
                overflow: "auto",
                flex: 1,
                fontFamily: "var(--font-mono)",
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
              <span style={{ fontFamily: "var(--font-mono)" }}>esc ×</span>
            </div>
          </div>
        </>,
        document.body
      );
}
