"use client";
/* ════════════════════════════════════════════════════════════════════════
 *  wf-node-json-popover.tsx — 节点 JSON 查看弹层（纯展示组件）。
 *  从 wf-contexts.tsx 抽出，以打破与 wf-stores.ts 的循环依赖：
 *    wf-stores.ts  →  import { NodeJsonPopover } from 本文件
 *    wf-*-node.tsx →  import store hooks（消费方，无环）
 *  本文件不 import 任何 store / context，只接收 props 渲染。
 * ════════════════════════════════════════════════════════════════════════ */
import { useMemo, useState } from "react";
import { Hint } from "~/components/ui/hint";
import { Popover, PopoverContent } from "~/components/ui/popover";
import { Button } from "~/components/ui/button";
import { useFlashState } from "~/components/ui/use-flash-state";
import {
  copyFailureText,
  useCopyFeedback,
} from "~/components/ui/use-copy-feedback";
import { anchorRectToVirtualElement } from "~/lib/dom-rect";
import type { NodeJsonViewerRequest, RawMetaEntry } from "./workflow-types";
import { CHIP_NEUTRAL_COLOR, Chip } from "./RequiredSummary";

/* 浮层本体。垂直堆三块：
 *   ┌────────────────────────────────────────────────┐
 *   │  头部  ─  📋 节点 JSON · #182 · class_type   │
 *   │              [⧉ 复制]   [× 关闭]                │
 *   ├────────────────────────────────────────────────┤
 *   │  元信息条 —— mode / flags / boundaries 等      │
 *   ├────────────────────────────────────────────────┤
 *   │  JSON 转储 —— 等宽、按语法着色、可复制          │
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
  /** 与 `RawMetaEntry` 同源（同一份节点元数据，可选字段在原件里可能缺失）。 */
  raw?: RawMetaEntry;
  rawNode?: RawNodeJson | null;
  pos: [number, number] | null;
};

/**
 * 从「运行视图」快照组装出可展示的节点 JSON（view 页签的正文来源）。
 *
 * 组装优先级：完整 rawNode 原样透出 → 否则按 entry / raw 里**确实存在**的
 * 字段逐个收进一份新对象（mode / widgets_values / outputs / flags /
 * properties 只在非空时收），最后补 pos。全部为空返回 null（调用方退回
 * saved 页签的降级文案）。纯派生（§17.1：删掉 JSX 也能测）。
 */
function buildViewJson(nodeView: RawNodeView | null): RawNodeJson | null {
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
}

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
  const viewObj = useMemo(() => buildViewJson(nodeView), [nodeView]);
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

  /* 用户点下芯片时冻结的矩形 → 虚拟锚点（Floating UI 的 VirtualElement
   *  只需 getBoundingClientRect）。浮层存续期间锚点不跟着画布平移 / 缩放走，
   *  与 anchorRect 的语义一致（见 NodeJsonViewerRequest 的注释）。 */
  const anchorElement = useMemo(
    () => () => anchorRectToVirtualElement(request.anchorRect),
    [request.anchorRect],
  );

  const copied = useFlashState();
  /* 成败都改口（规范 16 §16.2.4.43）：此前失败时静默，按钮一动不动 ——
   * 用户看到的是「点了没反应」，而真正的原因是剪贴板不可用。 */
  const [copyFailed, setCopyFailed] = useState(false);
  const handleCopy = useCopyFeedback({
    onSuccess: () => {
      setCopyFailed(false);
      copied.flash();
    },
    onFailure: () => setCopyFailed(true),
  });
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
    /* 浮层走 ui/popover（规范 16 §16.2.3 P2）：遮罩点击关闭、Esc 关闭由
       base-ui 负责，**定位也交给它的 Positioner** —— 这里把用户点下时冻结的
       锚点矩形包成虚拟锚点，翻转（flip）与视口内收边（shift）由 base-ui 算，
       本组件不再自己夹紧视口。
       此前用 `ui/dialog` 配 `top-24 left-1/2` 是**丢掉了锚点定位**：dialog 的
       基类自带 `top-1/2 -translate-y-1/2`，与 `top-24` 叠加后浮层被推到视口之上
       （实测 `top: -174`），头部与 JSON 开头被裁在视口外（ISSUE #717）。 */
    <Popover open modal onOpenChange={(next) => !next && onDismiss()}>
      <PopoverContent
        anchor={anchorElement}
        aria-label={`节点 #${request.nodeId} 的原始 JSON`}
        className="w-115 max-w-[calc(100vw-2rem)] gap-0 border-0 bg-transparent p-0 shadow-none ring-0"
        positionerClassName="max-h-[60vh]"
        collisionPadding={12}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <span className="sr-only">节点 #{request.nodeId} 的原始 JSON</span>
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
                  color: "var(--color-ink-muted)",
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
            <Hint label={copyFailed ? copyFailureText() : "复制 JSON 到剪贴板"}>
              <Button
                variant="outline"
                size="xs"
                onClick={() => handleCopy(pretty)}
                style={{
                  background: copied.on
                    ? accentAlpha(15)
                    : "var(--color-subtle)",
                  color: copied.on ? accent : "var(--color-ink)",
                  border: `1px solid ${copied.on ? accentAlpha(40) : "var(--color-border-strong)"}`,
                }}
                className="font-normal"
              >
                {copyFailed ? "复制失败" : copied.on ? "✓ 已复制" : "⧉ 复制"}
              </Button>
            </Hint>
            <Hint label="关闭 (Esc)">
              <Button
                variant="outline"
                size="icon-sm"
                onClick={onDismiss}
                aria-label="关闭"
                style={{
                  background: "var(--color-subtle)",
                  border: "1px solid var(--color-border-strong)",
                  color: "var(--color-ink-muted)",
                }}
                className="rounded-md text-[14px] leading-none"
              >
                ×
              </Button>
            </Hint>
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
                <Hint
                  label={
                    tab === "saved"
                      ? "执行条目：detail.graph[nodeId] —— 从工作流原件派生的节点条目；不含画布元数据"
                      : "RAW 格式：detail.rawJson.nodes[id] —— 与整工作流「查看 JSON」RAW 逐字节一致"
                  }
                  key={tab}
                >
                  <Button
                    variant="ghost"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setTab(tab)}
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
                      color: active
                        ? "var(--color-ink)"
                        : "var(--color-ink-muted)",
                    }}
                    className="h-auto font-normal"
                  >
                    {tab === "saved" ? "执行 · 节点条目" : "RAW · 节点视图"}
                  </Button>
                </Hint>
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
                  <Chip color="var(--color-warning)" label="节点未在派生图中" />
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
                    label="无画布态数据 — 缺少工作流原件"
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
              color: "var(--color-ink-muted)",
              borderTop: "1px solid var(--color-border-subtle)",
              display: "flex",
              justifyContent: "space-between",
            }}
          >
            <span>
              {tab === "saved"
                ? "展示的是从工作流原件派生的 `detail.graph[nodeId]` 条目。"
                : "画布视图：聚合 raw 元数据 + 画布坐标；非导出字节 — 仅排查用。"}
            </span>
            <span style={{ fontFamily: "var(--font-mono)" }}>esc ×</span>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
