/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/prefer-nullish-coalescing */
"use client";

import { colorFor, type ManifestNodeRaw } from "@/config/custom-nodes";
import { PortRow, WidgetValueChip } from "./SettingsParts";

/* ──────────────────────────────────────────────────────────────────────── */
/* NodePreviewCard — a small ComfyUI-style preview of one custom node.       */
/*                                                                            */
/*  Layout mirrors what you see in the official ComfyUI web UI for the same  */
/*  node: solid coloured header (drawn from the node's `category`) with a     */
/*  collapse chevron and category badge, then a body split into two zones:    */
/*                                                                            */
/*    1. typed ports (inputs / outputs without a `widget` field) — drawn as   */
/*       small left/right paired rows with coloured handle dots and an       */
/*       uppercase type badge, mimicking the ComfyUI border on node cards.   */
/*    2. widgets (inputs with `widget` field) — a label + default-value row   */
/*       laid out like the parameter rows on the canvas itself.              */
/*                                                                            */
/*  Default state is collapsed: just the coloured header plus a 1-line tally */
/*  ("3 typed / 7 widgets / 1 output"). Click the header to expand. This      */
/*  matches ComfyUI's own behaviour and keeps the package list scannable    */
/*  even for the 146-node WanVideoWrapper package.                            */
/* ──────────────────────────────────────────────────────────────────────── */
export function NodePreviewCard({
  data,
  fallbackName,
  expanded,
  onToggle,
}: {
  data: ManifestNodeRaw | undefined;
  fallbackName: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const color = colorFor(data?.category);
  const inputs = data?.inputs ?? [];
  const outputs = data?.outputs ?? [];
  const typed = inputs.filter((input) => !input.widget);
  const widgets = inputs.filter((input) => input.widget != null);
  const title = data?.displayName || fallbackName;

  return (
    <div
      className="overflow-hidden rounded-lg font-sans"
      style={{
        background: "rgba(15, 10, 30, 0.95)",
        border: `1px solid ${expanded ? color : "rgba(255,255,255,0.18)"}`,
      }}
    >
      {/* Header — clickable to expand. Solid colour band, category-derived. */}
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggle();
          }
        }}
        className="flex cursor-pointer items-center gap-2 px-2.5 outline-none"
        style={{
          height: 28,
          background: color,
          color: "#fff",
        }}
      >
        <span className="text-[11px] leading-none">{expanded ? "▾" : "▸"}</span>
        <span
          className="flex-1 truncate text-[11.5px] font-bold"
          style={{ letterSpacing: 0.2 }}
          title={title}
        >
          {title}
        </span>
        {data?.category && (
          <span
            className="rounded-full px-1.5 py-px text-[8.5px] font-semibold"
            style={{ background: "rgba(0,0,0,0.28)" }}
          >
            {data.category}
          </span>
        )}
        {data?.outputNode && (
          <span
            className="rounded-full px-1.5 py-px text-[8.5px] font-semibold"
            style={{ background: "rgba(255,255,255,0.22)" }}
            title="前端专属 (OUTPUT_NODE)"
          >
            ⇪
          </span>
        )}
      </div>

      {!data ? (
        <div className="px-2.5 py-1.5 text-[10px] italic text-muted">
          清单中未找到该节点（可能解析后未重导入此包）
        </div>
      ) : !expanded ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2.5 py-1.5 text-[10px] text-white/55">
          <span>
            <span className="font-mono text-white/85">{typed.length}</span> typed
          </span>
          <span>
            <span className="font-mono text-white/85">{widgets.length}</span> widget
          </span>
          <span>
            <span className="font-mono text-white/85">{outputs.length}</span> output
          </span>
        </div>
      ) : (
        <div className="px-2.5 pb-2 pt-1.5">
          {/* Zone 1 — typed ports (inputs left, outputs right) */}
          {(typed.length > 0 || outputs.length > 0) && (
            <div className="mb-1.5 grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 4 }}>
              <div className="flex flex-col gap-[3px]">
                {typed.map((i, idx) => (
                  <PortRow key={`ti-${idx}`} side="in" color={color} type={i.type} name={i.name} />
                ))}
              </div>
              <div className="flex flex-col items-end gap-[3px]">
                {outputs.map((output, idx) => (
                  <PortRow key={`to-${idx}`} side="out" color={color} type={output.type} name={output.name} />
                ))}
              </div>
            </div>
          )}

          {/* Zone 2 — widgets (labelled parameters) */}
          {widgets.length > 0 && (
            <div
              className="flex flex-col gap-[2px] border-t pt-1.5"
              style={{ borderColor: "rgba(255,255,255,0.07)" }}
            >
              {widgets.slice(0, 32).map((widget, idx) => (
                <div key={`w-${idx}`} className="flex items-center gap-1.5 text-[10.5px]">
                  <span
                    className="inline-block shrink-0 rounded-full"
                    style={{ width: 6, height: 6, background: color, opacity: 0.7 }}
                  />
                  <span
                    className="min-w-0 flex-1 truncate text-[#CFC9E5]"
                    title={widget.name}
                  >
                    {widget.name}
                  </span>
                  <WidgetValueChip widget={widget.widget ?? null} value={widget.default} />
                </div>
              ))}
              {widgets.length > 32 && (
                <div className="pl-3 text-[10px] text-muted">
                  … +{widgets.length - 32} more
                </div>
              )}
            </div>
          )}

          {typed.length === 0 && widgets.length === 0 && outputs.length === 0 && (
            <div className="py-1 text-center text-[10px] italic text-muted">
              无输入 / 输出参数
            </div>
          )}
        </div>
      )}
    </div>
  );
}
