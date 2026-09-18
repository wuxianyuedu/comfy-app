"use client";
/* 从 workflow-node.tsx 抽出的 FlowNode 配色计算。
 * 纯函数：节点模式（LiteGraph 0/2/4）+ 指定角色 → 卡片颜色。
 * 行为与拆分前内联的常量完全一致，只是**底色**改成了随主题。 */
import { mixHex, hexToRgba, lightenHex } from "../workflow-utils";
import type { WorkflowNodeData } from "../workflow-types";

const BYPASS_COLOR = "#ec4899";
const DISABLED_COLOR = "#6b7280";

/**
 * 节点卡片的表面颜色。这些值原来是写死的深色 hex
 *（卡片体 `#16161E` / 头部 `#1A1A22` / 边框 `rgba(255,255,255,0.20)` /
 * 标题 `#E2E2EA`），导致浅色下卡片依然是近黑 —— 下面算出的着色是**叠在**
 * 底色之上的，深底色加角色色调读出来仍是深色卡片。把底色交给主题，
 * 整张卡片在两种模式下才都诚实。
 *
 * 取值与画布其它地方用的语义 token 对应：
 *   卡片体 → `--color-node`
 *   头部   → `--color-node-accent`
 *   边框   → `--color-border-strong`
 *   标题   → `--color-ink-bright`
 *   圆点   → `--color-ink-muted`
 */
export interface NodePaletteBase {
  body: string;
  header: string;
  borderFallback: string;
  titleFallback: string;
  dotFallback: string;
}

/** 浅色底色 —— 应用 `@theme` 块里的默认值。 */
export const LIGHT_PALETTE_BASE: NodePaletteBase = {
  body: "#ffffff",
  header: "#f2eeff",
  borderFallback: "#d6d8dd",
  titleFallback: "#18181b",
  dotFallback: "#6b6b76",
};

/** 深色底色 —— 也就是转成随主题之前用过的那批值。 */
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
 * 节点模式（LiteGraph 0=始终 / 2=不静音 / 4=旁路）会覆盖角色色调，
 * 让用户一眼读出 ComfyUI 状态：旁路 → 粉，静音 → 灰，正常 → 角色色 / 默认色。
 * 返回整张卡片的配色。
 *
 * `base` 携带主题的表面颜色（见 `NodePaletteBase`）；着色代数不变，
 * 只是把底色从常量挪到了调用方，浅色 / 深色各自从正确的表面出发。
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
  // 卡片体：只 ~8% 着色，让角色身份是个提示而不是铺满。模式
  // 节点保留半透明着色，好让真正的背景模糊接上。
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
 * 折叠态锚点「圆柱」—— 节点折叠时替换端口堆的那个装饰性 6px 药丸。
 * 它原来是一段写死的深色渐变（`#d4d4d8 → #52525b → #18181b` + 45% 白
 * 边框），即「深底上的浅圆柱」。同样的值放到浅色下就成了**白底上的白边框**
 *（`rgba(255,255,255,0.45)` 叠在浅色画布上）—— 锚点直接看不见。把色标
 * 交给主题，药丸在两种模式下都读得出来，与 `--color-port-surface` 同一判断。
 */
export interface AnchorCylinderTheme {
  gradient: string;
  border: string;
  boxShadow: string;
}

/** 浅色：金属圆柱读作带深色包边的中灰药丸。 */
export const LIGHT_ANCHOR_CYLINDER: AnchorCylinderTheme = {
  gradient: "linear-gradient(180deg, #f4f4f5 0%, #a1a1aa 50%, #52525b 100%)",
  border: "1px solid rgba(0,0,0,0.35)",
  boxShadow:
    "inset 0 1px 0 rgba(255,255,255,0.9), inset 0 -1px 0 rgba(0,0,0,0.25), 0 2px 6px rgba(0,0,0,0.18)",
};

/** 深色：原始值，未改。 */
export const DARK_ANCHOR_CYLINDER: AnchorCylinderTheme = {
  gradient: "linear-gradient(180deg, #d4d4d8 0%, #52525b 50%, #18181b 100%)",
  border: "1px solid rgba(255,255,255,0.45)",
  boxShadow:
    "inset 0 1px 0 rgba(255,255,255,0.4), inset 0 -1px 0 rgba(0,0,0,0.6), 0 2px 6px rgba(0,0,0,0.6)",
};

/** 由 `next-themes` 的 `resolvedTheme` 解析锚点主题。 */
export function resolveAnchorCylinder(
  resolvedTheme: string | undefined,
): AnchorCylinderTheme {
  return resolvedTheme === "light"
    ? LIGHT_ANCHOR_CYLINDER
    : DARK_ANCHOR_CYLINDER;
}
