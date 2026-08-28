"use client";
/* Extracted FlowNode colour-palette computation (workflow-node.tsx T12).
 * Pure function: node mode (LiteGraph 0/2/4) + assigned role → card
 * colours.  Behaviour identical to the pre-split inline constants. */
import { mixHex, hexToRgba, lightenHex } from "./workflow-utils";
import type { WorkflowNodeData } from "./workflow-types";

const BYPASS_COLOR = "#ec4899";
const DISABLED_COLOR = "#6b7280";

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
 */
export function computeNodePalette(
  data: WorkflowNodeData,
  role?: { color?: string }
): NodePalette {
  const nodeMode = data.mode ?? 0;
  const modeColor =
    nodeMode === 4 ? BYPASS_COLOR :
    nodeMode === 2 ? DISABLED_COLOR :
    null;
  const effectiveColor = modeColor ?? role?.color;

  const headerBg = effectiveColor ? mixHex("#16161E", effectiveColor, 0.22) : "#1A1A22";
  // Body: only ~8% tint so role identity is a hint, not a flood.  Mode
  // nodes keep a translucent tint that the real backdrop blur picks up.
  const nodeBg = modeColor
    ? hexToRgba(modeColor, nodeMode === 4 ? 0.16 : 0.11)
    : role?.color ? mixHex("#16161E", role.color, 0.08) : "#16161E";
  const nodeBorder = effectiveColor ? mixHex("#16161E", effectiveColor, 0.55) : "rgba(255,255,255,0.20)";
  const titleColor = modeColor ? lightenHex(modeColor, 0.3) : (role?.color ?? "#E2E2EA");
  const dotBg = effectiveColor ?? "#6b7280";

  return { nodeMode, modeColor, effectiveColor, headerBg, nodeBg, nodeBorder, titleColor, dotBg };
}
