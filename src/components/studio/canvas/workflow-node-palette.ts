"use client";
/* Extracted FlowNode colour-palette computation (workflow-node.tsx ).
 * Pure function: node mode (LiteGraph 0/2/4) + assigned role → card
 * colours.  Behaviour identical to the pre-split inline constants, except
 * the *base* colours are now theme-aware. */
import { mixHex, hexToRgba, lightenHex } from "../workflow-utils";
import type { WorkflowNodeData } from "../workflow-types";

const BYPASS_COLOR = "#ec4899";
const DISABLED_COLOR = "#6b7280";

/**
 * Node-card surface colours.  These used to be hard-coded dark hex
 * (`#16161E` body / `#1A1A22` header / `rgba(255,255,255,0.20)` border /
 * `#E2E2EA` title), which made the card stay near-black in Light — the
 * tints computed below are painted *over* the base, so a dark base plus a
 * role tint still reads as a dark card.  Taking the base from the theme
 * keeps the whole card honest in both modes.
 *
 * Values mirror the semantic tokens used everywhere else on the canvas:
 *   body   → `--color-node`
 *   header → `--color-node-accent`
 *   border → `--color-border-strong`
 *   title  → `--color-ink-bright`
 *   dot    → `--color-ink-muted`
 */
export interface NodePaletteBase {
  body: string;
  header: string;
  borderFallback: string;
  titleFallback: string;
  dotFallback: string;
}

/** Light-theme bases — the defaults shared by the app's `@theme` block. */
export const LIGHT_PALETTE_BASE: NodePaletteBase = {
  body: "#ffffff",
  header: "#f2eeff",
  borderFallback: "#d6d8dd",
  titleFallback: "#18181b",
  dotFallback: "#6b6b76",
};

/** Dark-theme bases — the values the palette used before it went theme-aware. */
export const DARK_PALETTE_BASE: NodePaletteBase = {
  body: "#16161E",
  header: "#1A1A22",
  borderFallback: "#26262e",
  titleFallback: "#E2E2EA",
  dotFallback: "#6b7280",
};

export interface NodePalette {
  nodeMode: number;
  modeColor: string | null;
  effectiveColor: string | undefined;
  headerBg: string;
  nodeBg: string;
  nodeBorder: string;
  titleColor: string;
  dotBg: string;
}

/**
 * Node mode (LiteGraph 0=Always / 2=Never-mute / 4=Bypass) overrides the
 * role tint so the user can read ComfyUI status at a glance: bypass → pink,
 * muted → grey, normal → role/default.  Returns the full card palette.
 *
 * `base` carries the theme's surface colours (see `NodePaletteBase`); the
 * tint algebra is unchanged, only the base moved from a constant to the
 * caller so Light / Dark both start from the right surface.
 */
export function computeNodePalette(
  data: WorkflowNodeData,
  role?: { color?: string },
  base: NodePaletteBase = DARK_PALETTE_BASE,
): NodePalette {
  const nodeMode = data.mode ?? 0;
  const modeColor =
    nodeMode === 4 ? BYPASS_COLOR : nodeMode === 2 ? DISABLED_COLOR : null;
  const effectiveColor = modeColor ?? role?.color;

  const headerBg = effectiveColor
    ? mixHex(base.body, effectiveColor, 0.22)
    : base.header;
  // Body: only ~8% tint so role identity is a hint, not a flood.  Mode
  // nodes keep a translucent tint that the real backdrop blur picks up.
  const nodeBg = modeColor
    ? hexToRgba(modeColor, nodeMode === 4 ? 0.16 : 0.11)
    : role?.color
      ? mixHex(base.body, role.color, 0.08)
      : base.body;
  const nodeBorder = effectiveColor
    ? mixHex(base.body, effectiveColor, 0.55)
    : base.borderFallback;
  const titleColor = modeColor
    ? lightenHex(modeColor, 0.3)
    : (role?.color ?? base.titleFallback);
  const dotBg = effectiveColor ?? base.dotFallback;

  return {
    nodeMode,
    modeColor,
    effectiveColor,
    headerBg,
    nodeBg,
    nodeBorder,
    titleColor,
    dotBg,
  };
}

/**
 * Collapsed-mode handle anchor "cylinder" — the decorative 6px pill that
 * replaces the port stack when a node is collapsed.  It used to be a
 * hard-coded dark gradient (`#d4d4d8 → #52525b → #18181b` + a 45% white
 * border), i.e. a light-on-dark cylinder.  In Light that same value reads
 * as a **white border on white** (`rgba(255,255,255,0.45)` over a pale
 * canvas) — the anchor vanishes.  Take the stops from the theme so the pill
 * stays legible in both modes, same judgement as `--color-port-surface`.
 */
export interface AnchorCylinderTheme {
  gradient: string;
  border: string;
  boxShadow: string;
}

/** Light: metal cylinder reads as a mid-grey pill with a darker rim. */
export const LIGHT_ANCHOR_CYLINDER: AnchorCylinderTheme = {
  gradient: "linear-gradient(180deg, #f4f4f5 0%, #a1a1aa 50%, #52525b 100%)",
  border: "1px solid rgba(0,0,0,0.35)",
  boxShadow:
    "inset 0 1px 0 rgba(255,255,255,0.9), inset 0 -1px 0 rgba(0,0,0,0.25), 0 2px 6px rgba(0,0,0,0.18)",
};

/** Dark: the original values, unchanged. */
export const DARK_ANCHOR_CYLINDER: AnchorCylinderTheme = {
  gradient: "linear-gradient(180deg, #d4d4d8 0%, #52525b 50%, #18181b 100%)",
  border: "1px solid rgba(255,255,255,0.45)",
  boxShadow:
    "inset 0 1px 0 rgba(255,255,255,0.4), inset 0 -1px 0 rgba(0,0,0,0.6), 0 2px 6px rgba(0,0,0,0.6)",
};

/** Resolve the anchor theme from `next-themes`' `resolvedTheme`. */
export function resolveAnchorCylinder(
  resolvedTheme: string | undefined,
): AnchorCylinderTheme {
  return resolvedTheme === "light"
    ? LIGHT_ANCHOR_CYLINDER
    : DARK_ANCHOR_CYLINDER;
}
