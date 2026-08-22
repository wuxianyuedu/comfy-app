"use client";
/* Extracted frost / overlay components — originally inside WorkflowCanvasEditor.tsx. */
import { pseudoFrostPalette, hexToRgba } from "./wf-utils";
export const PSEUDO_FROST_NOISE_URL =
  // 180×180 turbulence tile; alpha ~0.55; inlined SVG ⇒ no extra HTTP cost.
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='1.7' numOctaves='2' seed='9'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='0.55'/></svg>";

/* Synthetic blob layout — five overlapping ellipses covering the node body.
 *  Positions/sizes are in percentages so the layer reflows with the node's
 *  React-Flow-applied `minWidth` without any layout gymnastics.  Each blob
 *  uses its own `filter: blur(Npx)` so the silhouette stays soft even when
 *  the user's CSS `transform: scale(...)` is applied via parent zoom. */
export const PSEUDO_FROST_BLOBS: { left: string; top: string; w: string; h: string; alphaKey: "primary" | "secondary" | "cool" | "warm" | "shadow"; blurPx: number }[] = [
  { left: "6%",  top: "10%", w: "58%", h: "42%", alphaKey: "primary",   blurPx: 28 },
  { left: "18%", top: "62%", w: "62%", h: "32%", alphaKey: "secondary", blurPx: 22 },
  { left: "62%", top: "6%",  w: "40%", h: "50%", alphaKey: "cool",      blurPx: 32 },
  { left: "30%", top: "30%", w: "32%", h: "32%", alphaKey: "warm",      blurPx: 18 },
  { left: "66%", top: "56%", w: "30%", h: "34%", alphaKey: "shadow",    blurPx: 24 },
];

/** Build the per-mode colour table consumed by `PSEUDO_FROST_BLOBS.alphaKey`.
 *  Disabled nodes lean grey, bypass leans pink-purple; the cool/warm/shadow
 *  channels stay constant so the panel reads as a coherent glass surface
 *  regardless of mode. */
export function PseudoFrostLayer({ modeColor }: { modeColor: string | null }) {
  if (!modeColor) return null;
  const palette = pseudoFrostPalette(modeColor);
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden rounded-lg"
      style={{ zIndex: 0 }}
    >
      {PSEUDO_FROST_BLOBS.map((blob, idx) => (
        <div
          key={idx}
          className="absolute rounded-full"
          style={{
            left: blob.left,
            top: blob.top,
            width: blob.w,
            height: blob.h,
            background: palette[blob.alphaKey],
            filter: `blur(${blob.blurPx}px)`,
          }}
        />
      ))}
      {/* Final noise overlay — adds the fine "frosted" texture that pure
       *  blurred blobs alone would lack.  Mix-blend lets the colour blobs
       *  tint it instead of being hidden under it. */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `url("${PSEUDO_FROST_NOISE_URL}")`,
          backgroundSize: "180px 180px",
          opacity: 0.085,
          mixBlendMode: "overlay",
        }}
      />
    </div>
  );
}

/* ---------------------------------------------------------------------------
 *  NodeFrost — REAL see-through frosted layer for bypass / disabled nodes.
 *
 *  Uses an actual `backdrop-filter: blur(...)` so the REAL canvas behind the
 *  node is what gets blurred (not synthetic blobs).  The classic Chromium bug
 *  is that `backdrop-filter` RE-TILES on very small on-screen elements — at low
 *  zoom a node's screen footprint shrinks, the blur kernel outgrows its
 *  backing texture, and the edge pixels wrap → the 2² / 3² / 4² (= 4 / 9 / 16)
 *  repeated-ghost artefact the user hit.
 *
 *  Fix: counter-scale the blur element by 1/zoom when zoomed out, holding its
 *  ON-SCREEN footprint at ~ the node's zoom=1 size (always large enough to
 *  blur cleanly).  The outer wrapper clips it back to the node bounds
 *  (`overflow:hidden`), so only the node-shaped slice of the — now correctly
 *  large — sampled backdrop is shown.  The blur radius is divided by the same
 *  scale so the effective on-screen blur stays ≈ 6px at every zoom.  Result:
 *  a genuine blurred view of the real canvas, with NO tiling at any zoom. */
export function NodeFrost({ zoom, color, nodeMode }: { zoom: number; color: string | null; nodeMode: number }) {
  if (!color || nodeMode === 0) return null;
  // Hold the on-screen footprint ≥ the node's zoom=1 size.
  const scale = Math.max(1, 1 / Math.max(zoom, 0.01));
  const blur = 6 / scale; // keep on-screen blur ≈ 6px regardless of zoom
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-[-1] overflow-hidden rounded-[inherit]"
    >
      <div
        className="absolute inset-0"
        style={{
          background: hexToRgba(color, nodeMode === 4 ? 0.16 : 0.11),
          backdropFilter: `blur(${blur}px)`,
          WebkitBackdropFilter: `blur(${blur}px)`,
          transform: `scale(${scale})`,
          transformOrigin: "center center",
        }}
      />
    </div>
  );
}

/* ---------------------------------------------------------------------------
 *  StringTextarea — multi-line read-only text box for long STRING widgets
 *  (prompts, captions, …).  Replaces the old `<div>` (whose Tailwind
 *  whitespace/overflow classes compiled unreliably inside this subtree) with
 *  the browser's native scrollable textarea, so wrapping + scroll work without
 *  any class dependency.
 *
 *  Height strategy (2026-08-10 R17, fully vertical STACKED layout):
 *    • Row uses `flex-col gap-1.5 flex-1` — LABEL row on top,
 *      this container fills the remaining vertical space below.
 *    • When the node has a fixed box (`hasSize`), the textarea container's
 *      `flex-1 min-h-0` chain handles height in CSS: the box has a fixed
 *      height, the WIDGET zone flex-1 claims the box's leftover space after
 *      header + body rows, and this textarea fills the STRING row's share.
 *      `maxHeight` is intentionally REMOVED (used to be 96px) so a 12-line
 *      prompt can claim the full STRING-row slot instead of being capped
 *      and silently scrolling behind a "标题内容同一排" layout.  Overflow
 *      scrolls natively inside this fixed box.
 *    • When the node is content-sized (no fixed box), useLayoutEffect sets
 *      the textarea height to `scrollHeight` uncapped so a 12-line prompt
 *      makes the row tall enough to show every line — same fill intent as
 *      the `flex-1` chain, just driven from JS instead of CSS. */
