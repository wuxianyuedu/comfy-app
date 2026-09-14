"use client";
/* Extracted canvas decoration components — originally inside WorkflowCanvasEditor.tsx. */
import React, { useState, useRef, useMemo } from "react";
import { useReactFlow, useStore, Background, BackgroundVariant } from "@xyflow/react";
import type { CanvasSettings } from "./canvas/WorkflowCanvasSettings";
import { DEFAULT_CANVAS_SETTINGS } from "./canvas/WorkflowCanvasSettings";
import {
  GRID_BASE_LAYER_ID,
  GRID_MAJOR_LAYER_ID,
  GRID_MINOR_LAYER_ID,
} from "./canvas/workflow-canvas-grid";
export const GRID_CELL = 10;
export const GRID_MAJOR_EVERY = 10;
export const CANVAS_BG = "#0a0a0f";
/* 细网格线的**淡出上限**（不是整张网格的关闭阈值）：低于这个缩放，
 *  10px 一格已经糊成噪点，细线不再画，只留 100px 的主参考线。
 *
 *  这里曾经是「整张网格一起关掉」的阈值：缩到 0.3 以下 `<CanvasGrid>` 直接
 *  返回 null，连带承载底色的 `bgColor` 也一起消失 —— 画布上只剩节点卡片那点
 *  像素，整屏读起来就是黑屏（用户侧「缩小到能显示节点」的那一段正是此处）。
 *  细线可以淡出，**底色不能**：底色的有无是画布有没有渲染出来的唯一直观凭据。 */
export const GRID_FINE_FADE_ZOOM = 0.3;

export function CanvasGrid({
  settings = DEFAULT_CANVAS_SETTINGS,
}: {
  /* settings are passed in by the editor root (which owns the
   * single useCanvasSettings() instance) instead of consumed from a
   *  context.  This keeps CanvasGrid a pure function of its props and
   *  avoids crossing any <ReactFlow> internal context boundaries. */
  settings?: CanvasSettings;
}) {
  const { minorAlpha, showFineLines } = useStore((state) => {
    const zoom = state.transform[2];
    const cellPx = settings.gridGap * zoom;
    /* Pick the fade-in curve so:
     *  - zoom 0.30 (≈ cellPx 3): t = 0  → no fine lines (would just be noise)
     *  - zoom 0.45 (≈ cellPx 4.5): t ≈ 0.4 → visible
     *  - zoom 0.60 (≈ cellPx 6):  t ≈ 0.7 → solid
     *  - zoom 0.80+:              t = 1  → full alpha
     * Previously `(cellPx - 5) / 3` started fading in only at cellPx 5
     * (zoom 0.5), which left the post-fitView canvas visually empty for
     * any normal-sized workflow. */
    const t = Math.max(0, Math.min(1, (cellPx - 3) / 3));
    return {
      minorAlpha: Math.round(t * 10) / 10,
      /* 淡出的是**细线**，不是整个网格层（见 GRID_FINE_FADE_ZOOM 的说明）。 */
      showFineLines: zoom > GRID_FINE_FADE_ZOOM,
    };
  });
  /* 用户主动关网格（画布设置里的「显示网格」）时也要保留底色 —— 关的是格子，
   *  不是画布背景。此前 `!settings.showGrid` 也走 return null，关掉网格后整块
   *  画布与「缩小到极限」是同一种黑屏。 */
  return (
    <>
      {settings.showGrid && showFineLines && (
        <Background
          id={GRID_MINOR_LAYER_ID}
          variant={BackgroundVariant.Lines}
          /* gap / lineWidth / alpha are now bound to the user's
           *  canvas settings instead of the hard-coded 10 / 1 / 0.22.
           *  Multiplied by a zoom-fade factor so the lines stay readable
           *  at any zoom (the alpha at zoom 0.5 was previously 0). */
          gap={settings.gridGap}
          lineWidth={settings.gridMinorLineWidth}
          color={`rgba(148,163,184,${(settings.gridMinorAlpha * minorAlpha).toFixed(3)})`}
        />
      )}
      {/* 底色层：**唯一一个恒常渲染**的网格层（它自己就是画布的底色）。
          细线在主参考线之前渲染（都会被后画的层盖在上方），顺序不影响观感。 */}
      <Background id={GRID_BASE_LAYER_ID} variant={BackgroundVariant.Dots} gap={1e6} color="transparent" bgColor={CANVAS_BG} />
      {settings.showGrid && (
        /* Major reference lines always land at `gridGap * 10` to keep the
         *  1:10 ratio users expect; only their alpha + width are tunable. */
        <Background
          id={GRID_MAJOR_LAYER_ID}
          variant={BackgroundVariant.Lines}
          gap={settings.gridGap * GRID_MAJOR_EVERY}
          lineWidth={settings.gridMajorLineWidth}
          color={`rgba(148,163,184,${settings.gridMajorAlpha.toFixed(3)})`}
          bgColor="transparent"
        />
      )}
    </>
  );
}

/* ── Canvas rulers ──
 *  Tiny coordinate readout along the four edges of the canvas window
 *  so the user can read a node's world position at a glance.  Each
 *  ruler renders the *world* X / Y of every major grid line that
 *  currently crosses the corresponding edge, positioned in screen
 *  pixels (so labels stay readable regardless of zoom).
 *
 *  Step size auto-doubles when the major lines would be < 48px apart
 *  on screen — at zoom 0.1 labels would otherwise stack on top of
 *  each other.  Negative world coords render as `−N` via Unicode
 *  minus for typographic consistency.
 *
 *  The whole overlay is `pointer-events: none` so it never blocks
 *  node/edge interaction, and sits at `z-index: 3` — above the
 *  transformed viewport (z 0) but below Controls/MiniMap (z 5+),
 *  which means a ruler label that happens to land on a zoom button
 *  is hidden behind it instead of occluding the control. */

/**
 * Zoom readout chip — sits in the top-right corner and shows the live canvas
 *  zoom as a percentage.  Two ways to adjust it:
 *    • Click the chip to type an exact percentage, Enter (or blur) to apply —
 *      `rf.zoomTo` honours the `<ReactFlow>` minZoom/maxZoom bounds (0.15–2).
 *    • Press and hold, then drag vertically (up = zoom in, down = zoom out)
 *      for a continuous scrub.  A press with <4px of travel counts as a click.
 *  ESC cancels the editor; empty / non-numeric input leaves zoom untouched.
 *
 *  clamp bounds now read from `useCanvasSettings()`
 *  so the chip respects the same minZoom/maxZoom the user sets in the panel. */
export function ZoomIndicator({
  minZoom = DEFAULT_CANVAS_SETTINGS.minZoom,
  maxZoom = DEFAULT_CANVAS_SETTINGS.maxZoom,
}: {
  minZoom?: number;
  maxZoom?: number;
} = {}) {
  const zoom = useStore((state) => state.transform[2]);
  const rf = useReactFlow();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startY: number; startZoom: number; moved: boolean } | null>(null);
  const justDraggedRef = useRef(false);

  const pct = Math.round(zoom * 100);

  const applyZoom = (z: number) => {
    const clamped = Math.min(maxZoom, Math.max(minZoom, z));
    void rf.zoomTo(clamped, { duration: 0 });
  };

  const beginEdit = () => {
    setDraft(String(pct));
    setEditing(true);
  };

  const commit = () => {
    const n = parseInt(draft, 10);
    if (!Number.isNaN(n) && n > 0) applyZoom(n / 100);
    setEditing(false);
  };

  //  Scrub: hold + drag vertically to scale zoom continuously.  Up zooms in,
  //  down zooms out, using a multiplicative (log) mapping so each pixel of
  //  travel feels proportional at any zoom level.
  const onScrubStart = (e: React.MouseEvent) => {
    if (editing) return;
    e.preventDefault();
    justDraggedRef.current = false;
    dragRef.current = { startY: e.clientY, startZoom: zoom, moved: false };
    setDragging(true);

    const onMove = (ev: MouseEvent) => {
      const st = dragRef.current;
      if (!st) return;
      const dy = st.startY - ev.clientY; // up = positive
      if (Math.abs(dy) > 4) st.moved = true;
      applyZoom(st.startZoom * Math.exp(dy / 220));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      const st = dragRef.current;
      dragRef.current = null;
      setDragging(false);
      if (st?.moved) justDraggedRef.current = true;
      else if (st) beginEdit();
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        inputMode="numeric"
        onChange={(event) => setDraft(event.target.value.replace(/[^\d]/g, ""))}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            setEditing(false);
          }
        }}
        title="输入缩放百分比后回车"
        className="absolute right-3 top-3 z-6 h-7 w-16 rounded-md border border-purple-400/60 bg-panel px-2 text-right text-[11px] font-medium tabular-nums text-ink-bright shadow-lg outline-none"
      />
    );
  }

  return (
    <button
      type="button"
      onMouseDown={onScrubStart}
      onClick={() => {
        if (justDraggedRef.current) {
          justDraggedRef.current = false;
          return;
        }
        beginEdit();
      }}
      title="点击输入缩放倍数，或按住上下拖动调整"
      className={`pointer-events-auto absolute right-3 top-3 z-6 select-none rounded-md border border-border-strong bg-panel/90 px-2.5 py-1 text-[11px] font-medium tabular-nums tracking-tight text-ink-soft shadow-lg backdrop-blur-sm transition-colors hover:border-white/25 hover:text-ink-bright ${
        dragging ? "cursor-grabbing border-purple-400/50" : "cursor-ns-resize"
      }`}
    >
      {pct}%
    </button>
  );
}

export function CanvasRulers({
  settings = DEFAULT_CANVAS_SETTINGS,
}: {
  /* rulers can be hidden via the canvas settings panel so
   *  that authors who want an unobstructed canvas (or who are working
   *  on screenshots) don't have to live with the coordinate overlay. */
  settings?: CanvasSettings;
} = {}) {
  const tx = useStore((state) => state.transform[0]);
  const ty = useStore((state) => state.transform[1]);
  const zoom = useStore((state) => state.transform[2]);
  const width = useStore((state) => state.width);
  const height = useStore((state) => state.height);

  // Pick the smallest world-unit step that keeps screen spacing ≥ 48px
  // so labels never overlap.  Always a multiple of the major grid step.
  const labelStep = useMemo(() => {
    const base = settings.gridGap * GRID_MAJOR_EVERY; // 100
    let s = base;
    while (s * zoom < 48) s *= 2;
    return s;
  }, [zoom, settings.gridGap]);

  // World X of each visible major vertical line → screen X.
  const xLabels = useMemo(() => {
    if (zoom <= 0.01 || !width) return [] as { world: number; screen: number }[];
    const start = Math.floor(-tx / zoom / labelStep) * labelStep;
    const end = Math.ceil((width - tx) / zoom / labelStep) * labelStep;
    const out: { world: number; screen: number }[] = [];
    for (let x = start; x <= end + 0.5; x += labelStep) {
      const sx = x * zoom + tx;
      if (sx < -4 || sx > width + 4) continue;
      out.push({ world: x, screen: sx });
    }
    return out;
  }, [tx, zoom, width, labelStep]);

  // World Y of each visible major horizontal line → screen Y.
  const yLabels = useMemo(() => {
    if (zoom <= 0.01 || !height) return [] as { world: number; screen: number }[];
    const start = Math.floor(-ty / zoom / labelStep) * labelStep;
    const end = Math.ceil((height - ty) / zoom / labelStep) * labelStep;
    const out: { world: number; screen: number }[] = [];
    for (let y = start; y <= end + 0.5; y += labelStep) {
      const sy = y * zoom + ty;
      if (sy < -4 || sy > height + 4) continue;
      out.push({ world: y, screen: sy });
    }
    return out;
  }, [ty, zoom, height, labelStep]);

  if (!settings.showRulers) return null;

  // Unicode minus for typographic parity (the existing widget values
  // use plain `-`; rulers use `−` because they sit at a larger size
  // and the difference is noticeable on negative coords).
  const fmt = (n: number) => (n < 0 ? `−${-n}` : `${n}`);

  const labelBase =
    "pointer-events-none absolute select-none whitespace-nowrap text-[10px] font-medium tabular-nums tracking-tight";

  return (
    <div className="pointer-events-none absolute inset-0 z-3" aria-hidden>
      {/* Top edge — X coords */}
      {xLabels.map(({ world, screen }) => (
        <div
          key={`rt-${world}`}
          className={labelBase}
          style={{
            left: screen,
            top: 2,
            transform: "translateX(-50%)",
            color: "rgba(203, 213, 225, 0.85)",
            textShadow: "0 0 3px rgba(10,10,15,0.95), 0 0 1px rgba(10,10,15,0.95)",
          }}
        >
          {fmt(world)}
        </div>
      ))}
      {/* Bottom edge — X coords (offset above the zoom controls so the
       *  bottom-left button cluster doesn't cover the leftmost labels) */}
      {xLabels.map(({ world, screen }) => (
        <div
          key={`rb-${world}`}
          className={labelBase}
          style={{
            left: screen,
            bottom: 2,
            transform: "translateX(-50%)",
            color: "rgba(203, 213, 225, 0.85)",
            textShadow: "0 0 3px rgba(10,10,15,0.95), 0 0 1px rgba(10,10,15,0.95)",
          }}
        >
          {fmt(world)}
        </div>
      ))}
      {/* Left edge — Y coords */}
      {yLabels.map(({ world, screen }) => (
        <div
          key={`rl-${world}`}
          className={labelBase}
          style={{
            top: screen,
            left: 3,
            transform: "translateY(-50%)",
            color: "rgba(203, 213, 225, 0.85)",
            textShadow: "0 0 3px rgba(10,10,15,0.95), 0 0 1px rgba(10,10,15,0.95)",
          }}
        >
          {fmt(world)}
        </div>
      ))}
      {/* Right edge — Y coords */}
      {yLabels.map(({ world, screen }) => (
        <div
          key={`rr-${world}`}
          className={labelBase}
          style={{
            top: screen,
            right: 3,
            transform: "translateY(-50%)",
            color: "rgba(203, 213, 225, 0.85)",
            textShadow: "0 0 3px rgba(10,10,15,0.95), 0 0 1px rgba(10,10,15,0.95)",
          }}
        >
          {fmt(world)}
        </div>
      ))}
    </div>
  );
}

/* ── Color helper ── */
