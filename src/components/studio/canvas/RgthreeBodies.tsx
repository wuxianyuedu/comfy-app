"use client";
import { useRgthreeGroups } from "./IOEditContext";
import type { WorkflowGroup } from "../workflow-types";

export function RgthreeFastGroupsBypasserBody({
  matchTitle,
  groups,
}: {
  matchTitle: string;
  groups: WorkflowGroup[];
}) {
  const ctx = useRgthreeGroups();
  /* useRgthreeGroups 在 store 未挂载时抛错；但该组件只会在编辑器内渲染，
   * 始终在 <WFStoresProvider> 之下，故可直接使用，无需 null 守卫。 */
  const needle = matchTitle.trim().toLowerCase();
  if (!needle) return null;
  const matches = groups
    .filter((group) => (group.title || "").toLowerCase().includes(needle))
    .slice()
    .sort((left, right) => left.title.localeCompare(right.title));
  if (matches.length === 0) return null;
  const pad = Math.max(2, String(matches.length).length);
  return (
    <div className="flex flex-col gap-[2px] px-1 pb-1">
      {matches.map((group, index) => {
        const idx = String(index + 1).padStart(pad, "0");
        const label = `Enable ${matchTitle}${idx}`;
        const bypass = ctx.getBypass(group.id);
        return (
          <div
            key={group.id}
            className="group relative flex h-[22px] items-center gap-1.5 pl-2 pr-2 text-[11px]"
          >
            <span
              className="min-w-0 shrink truncate text-left text-[11px]"
              style={{ flex: "0 1 auto", color: bypass ? "#71717a" : "var(--color-ink-subtle)" }}
              title={group.title}
            >
              {label}
            </span>
            <span className="h-2 w-px shrink-0 bg-white/5" aria-hidden />
            <span
              className="min-w-0 truncate text-right text-[10.5px] tabular-nums"
              style={{ flex: "1 1 0", color: bypass ? "#ec4899" : "#a1a1aa" }}
            >
              {bypass ? "yes" : "no"}
            </span>
            {/* The toggle itself — a small clickable chip that flips the
             *  group's bypass via the context.  Uses a div+role=button
             *  pattern (consistent with the row-inline-button iron law)
             *  and stops pointer events so ReactFlow's drag handler
             *  never sees the click. */}
            <div
              role="button"
              tabIndex={0}
              aria-pressed={bypass}
              title={bypass ? "点击取消旁路" : "点击旁路此 group"}
              onClick={(event) => {
                event.stopPropagation();
                ctx.setBypass(group.id, !bypass);
              }}
              onPointerDown={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  event.stopPropagation();
                  ctx.setBypass(group.id, !bypass);
                }
              }}
              style={{
                marginLeft: 6,
                width: 26,
                height: 14,
                borderRadius: 7,
                background: bypass
                  ? "rgba(236, 72, 153, 0.55)"
                  : "rgba(63, 63, 70, 0.55)",
                border: "1px solid rgba(255,255,255,0.18)",
                position: "relative",
                cursor: "pointer",
                flex: "0 0 auto",
                transition: "background 120ms",
              }}
            >
              <span
                style={{
                  position: "absolute",
                  top: 1,
                  left: bypass ? 13 : 1,
                  width: 10,
                  height: 10,
                  borderRadius: 5,
                  background: bypass ? "#fce7f3" : "var(--color-ink-subtle)",
                  transition: "left 120ms",
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Hardcoded classType → package mapping for well-known custom node packs
 *  that the manifest parser misses (e.g. its source tree isn't on the
 *  parse path, or its `MAPPING/CATEGORY` carries no package declaration).
 *  Keep this list narrow — anything beyond ~5 entries signals we should
 *  extend the parser instead.
 *
 *  Currently:
 *   • efficiency-nodes' SetNode / GetNode — its pkg has no on-disk marker
 *     in our install and its nodes carry no `cnr_id`, so we hard-code the
 *     attribution. */
export function RgthreePowerLoraLoaderBody({ widgets }: { widgets: unknown[] }) {
  const fmtStrength = (v: unknown): string | undefined => {
    if (typeof v === "number") {
      // ComfyUI strips trailing zeros ("1.00" → "1", "0.85" stays).
      const s = v.toFixed(2);
      const stripped = s.replace(/\.?0+$/, "");
      return stripped.length > 0 ? stripped : "0";
    }
    if (typeof v === "string" && v.length > 0 && v !== "undefined") return v;
    return undefined;
  };

  // Per-lora rows: filter out the header widget and empty placeholders.
  // Row shape is pack-dependent (bare filename string or a widget record).
  type PowerLoraWidget = string | Record<string, unknown>;
  const loras: PowerLoraWidget[] = ((widgets ?? []) as PowerLoraWidget[]).filter((widget) => {
    if (widget === null || widget === undefined) return false;
    if (typeof widget !== "object" || Array.isArray(widget)) {
      return typeof widget === "string" && widget.length > 0; // bare lora filename
    }
    if (Object.keys(widget).length === 0) return false; // {} placeholder
    if (widget.type === "PowerLoraLoaderHeaderWidget") return false; // header widget
    return true; // real lora tuple
  });

  return (
    <div className="flex w-full flex-col gap-[3px] px-1 pb-1 pt-0.5">
      {/* Lora Stack section header — always drawn (matches rgthree even on
       *  empty stacks, so the author can always add a lora below it). */}
      <div
        className="flex items-center justify-between rounded px-1.5 py-[3px] text-[10px] font-medium uppercase"
        style={{
          background: "rgba(255, 255, 255, 0.04)",
          color: "rgba(255, 255, 255, 0.55)",
          letterSpacing: 0.4,
        }}
      >
        <span className="inline-flex items-center gap-1">
          <span
            aria-hidden
            style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              background: "rgba(167, 139, 250, 0.95)",
              display: "inline-block",
            }}
          />
          Lora Stack
        </span>
        <span
          className="inline-flex items-center gap-1.5 text-[9px]"
          style={{ color: "rgba(255, 255, 255, 0.36)", letterSpacing: 0.6 }}
        >
          <span>model</span>
          <span style={{ color: "rgba(255, 255, 255, 0.18)" }}>•</span>
          <span>clip</span>
        </span>
      </div>

      {/* Per-lora rows (empty placeholder area in this workflow). */}
      {loras.length === 0 ? (
        <div
          className="rounded px-1.5 py-3 text-center text-[10px]"
          style={{
            background: "rgba(0, 0, 0, 0.25)",
            color: "rgba(255, 255, 255, 0.30)",
            border: "1px dashed rgba(255, 255, 255, 0.08)",
          }}
        >
          暂无 Lora — 点击下方按钮添加
        </div>
      ) : (
        loras.map((widget, index) => {
          const isObj = typeof widget === "object" && !Array.isArray(widget);
          const rec = isObj ? widget : undefined;
          const name =
            typeof widget === "string"
              ? widget
              : ((rec?.name ?? rec?.lora_name ?? rec?.model_name) as string | undefined) ?? "";
          const modelStr = isObj
            ? fmtStrength(rec?.model_strength ?? rec?.model_str ?? rec?.strength)
            : undefined;
          const clipStr = isObj
            ? fmtStrength(rec?.clip_strength ?? rec?.clip_str)
            : undefined;
          return (
            <div
              key={`pll-r-${index}`}
              className="flex items-center gap-2 rounded px-1.5 py-[3px] text-[11px]"
              style={{ background: "rgba(0, 0, 0, 0.30)" }}
            >
              <span
                className="min-widget-0 flex-1 truncate"
                style={{
                  color: name ? "rgba(255, 255, 255, 0.85)" : "rgba(255, 255, 255, 0.30)",
                }}
                title={name}
              >
                {name ?? "（未选择 Lora）"}
              </span>
              {modelStr !== undefined && (
                <span
                  className="shrink-0 tabular-nums"
                  style={{ color: "rgba(255, 255, 255, 0.55)", fontSize: 10 }}
                >
                  {modelStr}
                </span>
              )}
              {clipStr !== undefined && (
                <span
                  className="shrink-0 tabular-nums"
                  style={{ color: "rgba(255, 255, 255, 0.40)", fontSize: 10 }}
                >
                  {clipStr}
                </span>
              )}
            </div>
          );
        })
      )}

      {/* "+ Add Lora" CTA — rgthree shows this even on empty stacks.  Read-only
       *  on the canvas, so it's a static pill (no click handler). */}
      <div
        aria-hidden
        className="mt-1 flex items-center justify-center gap-2 rounded py-[6px] text-[11px] font-medium"
        style={{
          background: "rgba(139, 92, 246, 0.10)",
          border: "1px solid rgba(139, 92, 246, 0.45)",
          color: "rgba(255, 255, 255, 0.78)",
          pointerEvents: "none",
          userSelect: "none",
        }}
      >
        <span
          style={{
            fontSize: 14,
            lineHeight: 1,
            color: "rgba(167, 139, 250, 0.95)",
            fontWeight: 600,
          }}
        >
          +
        </span>
        Add Lora
      </div>
    </div>
  );
}

/** rgthree Label runtime body (2026-08-09).  rgthree's Label node has no
 *  I/O — it paints its title (or `text` property) using the styles in
 *  `properties` (fontSize / fontFamily / fontColor / textAlign /
 *  backgroundColor / borderRadius / angle).  We render the styled text
 *  read-only, filling the node body.  The standard title bar is suppressed
 *  for this classType (ComfyUI shows no separate header) so the painted
 *  text reads as the whole node. */
export function RgthreeLabelBody({
  text,
  properties,
}: {
  text: string;
  properties: Record<string, unknown>;
}) {
  const p = properties ?? {};
  const fontSize = typeof p.fontSize === "number" ? p.fontSize : 24;
  const fontFamily = typeof p.fontFamily === "string" ? p.fontFamily : "sans-serif";
  const fontColor = typeof p.fontColor === "string" ? p.fontColor : "#ffffff";
  const textAlign =
    p.textAlign === "center" || p.textAlign === "right" ? p.textAlign : "left";
  const bg =
    typeof p.backgroundColor === "string" && p.backgroundColor !== "transparent"
      ? p.backgroundColor
      : "transparent";
  const angle = typeof p.angle === "number" ? p.angle : 0;
  return (
    <div
      className="flex min-h-[24px] w-full flex-1 items-center px-2 py-1"
      style={{
        background: bg,
        borderRadius: typeof p.borderRadius === "number" ? p.borderRadius : 0,
        transform: angle ? `rotate(${angle}deg)` : undefined,
        overflow: "hidden",
      }}
    >
      <span
        style={{
          fontFamily,
          fontSize,
          color: fontColor,
          textAlign,
          width: "100%",
          lineHeight: 1.1,
          wordBreak: "break-word",
          whiteSpace: "pre-wrap",
        }}
        title={text}
      >
        {text || "（空标签）"}
      </span>
    </div>
  );
}
