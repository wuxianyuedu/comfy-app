"use client";
import { useMemo } from "react";
import {
  resolveEntryRequired,
  type WorkflowIOMap,
} from "~/components/studio/workflow-io";
export function RequiredSummary({
  io,
  mode,
}: {
  io: WorkflowIOMap | null;
  /** 多模式：传入当前模式码时按该模式解析 required（显示该模式必填数）。 */
  mode?: string | null;
}) {
  const counts = useMemo(() => {
    let required = 0;
    let optional = 0;
    if (!io) return { required, optional };
    for (const e of Object.values(io)) {
      if (e?.direction !== "input") continue;
      if (e.kind !== "widget") continue;
      if (resolveEntryRequired(e, mode)) required++;
      else optional++;
    }
    return { required, optional };
  }, [io, mode]);
  return (
    <span className="ml-2 inline-flex items-center gap-1.5">
      <span className="border-destructive/40 bg-destructive/15 text-destructive text-3xs rounded border px-1.5 py-px font-mono">
        必填 {counts.required}
      </span>
      <span className="border-border-strong bg-subtle text-ink-soft text-3xs rounded border px-1.5 py-px font-mono">
        可选 {counts.optional}
      </span>
    </span>
  );
}

/** 统计徽标的「中性」取值 —— 一个灰色圆点/文字既可以走写死的 `#a1a1aa`，
 *  也可以走随主题的弱文字 token。后者在浅色下才读得出来（浅底上的
 *  `#a1a1aa` 只有 ~2:1）。调用方传这个常量即表示「中性统计」。 */
export const CHIP_NEUTRAL_COLOR = "var(--color-ink-muted)";

export function Chip({ color, label }: { color: string; label: string }) {
  return (
    <span
      style={{
        fontSize: 10,
        fontFamily: "var(--font-mono)",
        padding: "2px 7px",
        borderRadius: 999,
        background: `color-mix(in srgb, ${color} 12%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 33%, transparent)`,
        color,
        letterSpacing: 0.2,
      }}
    >
      {label}
    </span>
  );
}

/** `frontend_only` 徽标 —— 标出「此节点只在浏览器前端运行、没有后端执行」
 *  的节点（如 rgthree 的 `Fast Groups Bypasser`：它的 LiteGraph 定义里没有输入，
 *  整个节点体是前端按图扫描出来的）。 */
export function FrontendOnlyBadge() {
  return (
    <div
      className="comfy-node__frontend-only"
      style={{
        display: "inline-block",
        alignSelf: "flex-start",
        marginTop: 4,
        marginLeft: 2,
        padding: "1px 5px",
        fontSize: 9,
        lineHeight: 1.2,
        fontFamily: "var(--font-mono)",
        fontStyle: "italic",
        color: "var(--color-ink-muted)",
        letterSpacing: 0.2,
        border: "1px solid var(--color-border-strong)",
        borderRadius: 4,
        pointerEvents: "none",
        userSelect: "none",
        whiteSpace: "nowrap",
      }}
      title="此节点仅在浏览器前端运行（无后端执行）"
    >
      frontend_only
    </div>
  );
}
