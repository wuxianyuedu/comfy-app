"use client";
/* ════════════════════════════════════════════════════════════════════════
 *  wf-node-json-popover.tsx — 节点 JSON 查看弹层（纯展示组件）。
 *  从 wf-contexts.tsx 抽出，以打破与 wf-stores.ts 的循环依赖：
 *    wf-stores.ts  →  import { NodeJsonPopover } from 本文件
 *    wf-*-node.tsx →  import store hooks（消费方，无环）
 *  本文件不 import 任何 store / context，只接收 props 渲染。
 * ════════════════════════════════════════════════════════════════════════ */
import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "~/components/ui/dialog";
import type { NodeJsonViewerRequest, RawOutputMeta } from "./workflow-types";
import { CHIP_NEUTRAL_COLOR, Chip } from "./RequiredSummary";

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
  const json = useMemo(
    () => getJson(request.nodeId),
    [getJson, request.nodeId],
  );
  const nodeView = useMemo(
    () => getView?.(request.nodeId) ?? null,
    [getView, request.nodeId],
  );
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
      return json
        ? JSON.stringify(json, null, 2)
        : "（节点详情尚未加载 — 等待 detail.ready）";
    }
    if (viewObj) return JSON.stringify(viewObj, null, 2);
    if (json) {
      const thin: RawNodeJson = {};
      if (typeof json.class_type === "string")
        thin.class_type = json.class_type;
      if (json.inputs && typeof json.inputs === "object")
        thin.inputs = json.inputs;
      if (json._meta && Object.keys(json._meta).length) thin._meta = json._meta;
      if (Object.keys(thin).length) return JSON.stringify(thin, null, 2);
    }
    return "（节点详情尚未加载 — 等待 detail.ready）";
  }, [tab, json, viewObj]);
  const [copied, setCopied] = useState(false);
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
      },
    );
  };
  const accent =
    request.kind === "subgraph" ? "var(--color-primary)" : "var(--color-info)";
  /** 带透明度的 accent —— `var()` 不能拼 hex alpha，走 color-mix。 */
  const accentAlpha = (percent: number) =>
    `color-mix(in srgb, ${accent} ${percent}%, transparent)`;
  const nodeClass = json?.class_type ?? "?";
  const nodeMode =
    typeof nodeView?.raw?.mode === "number"
      ? nodeView.raw.mode
      : typeof json?._meta?.mode === "number"
        ? json._meta.mode
        : typeof json?.mode === "number"
          ? json.mode
          : 0;
  const modeLabel =
    nodeMode === 4 ? "Bypass" : nodeMode === 2 ? "Disabled" : "Normal";
  const modeColor =
    nodeMode === 4
      ? "var(--color-accent-soft)"
      : nodeMode === 2
        ? "var(--color-ink-faint)"
        : "var(--color-success-strong)";

  return (
    /* 浮层走 ui/dialog（规范 16 §16.2.3 P2）：遮罩点击关闭、Esc 关闭、焦点
       管理此前是这里手写的一份，`ui/dialog` 里还有一份。尺寸/位置仍是本组件
       自己的形态（贴在锚点下方、不占满视口），故用 popupClassName 覆盖定位。 */
    <Dialog open onOpenChange={(next) => !next && onDismiss()}>
      <DialogContent
        showCloseButton={false}
        aria-label={`节点 #${request.nodeId} 的原始 JSON`}
        className="w-[460px] max-w-[calc(100vw-2rem)] gap-0 border-0 bg-transparent p-0 ring-0"
        popupClassName="fixed top-24 left-1/2 max-h-[60vh] -translate-x-1/2"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <DialogTitle className="sr-only">
          节点 #{request.nodeId} 的原始 JSON
        </DialogTitle>
        <div
          style={{
            width: 460,
            maxHeight: "60vh",
            borderRadius: 12,
            background: "var(--color-bg)",
            border: `1px solid ${accentAlpha(33)}`,
            boxShadow:
              "0 20px 48px var(--color-shadow-strong), 0 0 0 1px var(--color-border-subtle) inset, 0 0 24px " +
              accentAlpha(20),
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
              background: `linear-gradient(90deg, ${accent} 0%, ${accentAlpha(33)} 60%, transparent 100%)`,
            }}
          />
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 12px 8px 14px",
              borderBottom: "1px solid var(--color-border-subtle)",
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
                  color: "var(--color-muted)",
                  textTransform: "uppercase",
                  letterSpacing: 0.6,
                }}
              >
                <span style={{ fontSize: 11 }}>📋</span>
                <span>节点 JSON</span>
                <span style={{ color: "var(--color-ink-faintest)" }}>·</span>
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
                  color: "var(--color-ink)",
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
                background: copied ? accentAlpha(15) : "var(--color-subtle)",
                color: copied ? accent : "var(--color-ink)",
                border: `1px solid ${copied ? accentAlpha(40) : "var(--color-border-strong)"}`,
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
                background: "var(--color-subtle)",
                border: "1px solid var(--color-border-strong)",
                color: "var(--color-muted)",
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
              background: "var(--color-subtle)",
              borderBottom: "1px solid var(--color-border-subtle)",
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
                    border: `1px solid ${active ? accentAlpha(33) : "var(--color-border-subtle)"}`,
                    borderBottom: active
                      ? `1px solid ${accentAlpha(20)}`
                      : "1px solid var(--color-border-subtle)",
                    background: active
                      ? accentAlpha(13)
                      : "var(--color-subtle)",
                    color: active ? "var(--color-ink)" : "var(--color-muted)",
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
              background: accentAlpha(7),
              borderBottom: "1px solid var(--color-border-subtle)",
            }}
          >
            <Chip color={modeColor} label={`mode ${nodeMode} · ${modeLabel}`} />
            {tab === "saved" ? (
              <>
                {json && "widgets_values" in json && (
                  <Chip
                    color={CHIP_NEUTRAL_COLOR}
                    label={`widgets: ${json.widgets_values?.length ?? 0} 项`}
                  />
                )}
                {json && "inputs" in json && (
                  <Chip
                    color={CHIP_NEUTRAL_COLOR}
                    label={`inputs: ${Object.keys(json.inputs ?? {}).length} 个`}
                  />
                )}
                {json && "outputs" in json && (
                  <Chip
                    color={CHIP_NEUTRAL_COLOR}
                    label={`outputs: ${json.outputs?.length ?? 0} 个`}
                  />
                )}
                {!json && (
                  <Chip
                    color="var(--color-warning)"
                    label="节点未在 graph 中"
                  />
                )}
              </>
            ) : (
              <>
                {viewObj?.inputs && (
                  <Chip
                    color={CHIP_NEUTRAL_COLOR}
                    label={`inputs: ${Object.keys(viewObj.inputs ?? {}).length} 个`}
                  />
                )}
                {viewObj?.outputs && Array.isArray(viewObj.outputs) && (
                  <Chip
                    color={CHIP_NEUTRAL_COLOR}
                    label={`outputs: ${viewObj.outputs.length} 个`}
                  />
                )}
                {viewObj?.widgets_values &&
                  Array.isArray(viewObj.widgets_values) && (
                    <Chip
                      color={CHIP_NEUTRAL_COLOR}
                      label={`widgets: ${viewObj.widgets_values.length} 项`}
                    />
                  )}
                {viewObj?.properties && (
                  <Chip
                    color={CHIP_NEUTRAL_COLOR}
                    label={`properties: ${Object.keys(viewObj.properties ?? {}).length} 项`}
                  />
                )}
                {viewObj?.pos && Array.isArray(viewObj.pos) && (
                  <Chip
                    color={CHIP_NEUTRAL_COLOR}
                    label={`pos: ${viewObj.pos.map((num) => Math.round(num)).join(", ")}`}
                  />
                )}
                {!viewObj && (
                  <Chip
                    color="var(--color-warning)"
                    label="无画布态数据 — 纯 API 工作流"
                  />
                )}
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
              color: "var(--color-ink)",
              background: "var(--color-subtle)",
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
              color: "var(--color-muted)",
              borderTop: "1px solid var(--color-border-subtle)",
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
      </DialogContent>
    </Dialog>
  );
}
