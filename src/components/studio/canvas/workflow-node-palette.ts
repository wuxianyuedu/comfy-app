/* FlowNode 配色计算 —— 纯函数：节点模式（LiteGraph 0/2/4）+
 * 指定角色 → 卡片颜色。底色随主题，不再写死深色 hex。 */
import { mixHex, hexToRgba, lightenHex } from "../workflow-utils";
import type { WorkflowNodeData } from "../workflow-types";

const BYPASS_COLOR = "#ec4899";
const DISABLED_COLOR = "#6b7280";

/**
 * 节点卡片表面颜色。原值写死为深色 hex（体 #16161E / 头 #1A1A22 / 边框 rgba(255,255,255,.2) / 标题 #E2E2EA），
 * 浅色下仍是近黑卡片 —— 着色叠在底色上，深底加角色色调仍读作深色。
 * 取值对应语义 token：体 --color-node、头 --color-node-accent、边框 --color-border-strong、
 * 标题 --color-ink-bright、圆点 --color-ink-muted。 */
export type NodePaletteBase = {
  body: string;
  borderFallback: string;
  dotFallback: string;
  header: string;
  titleFallback: string;
};

/** 浅色底色 —— 应用 `@theme` 块里的默认值。 */
export const LIGHT_PALETTE_BASE: NodePaletteBase = {
  body: "#ffffff",
  header: "#f2eeff",
  borderFallback: "#d6d8dd",
  titleFallback: "#18181b",
  dotFallback: "#6b6b76",
};

/** 深色底色 —— 与 `.dark` 块的 `--color-node` / `--color-node-accent` 同源
 *  （`body` 就是 `--color-node` 的值，改动要两处一起改）。
 *
 *  底色**不再是近黑**（原 `#16161E`）：它和画布底 `#0a0a0f` 几乎同深，节点框
 *  在暗色下看不出边界（用户口径：「和黑色背景相比有些看不清」），现在是一档灰。 */
export const DARK_PALETTE_BASE: NodePaletteBase = {
  body: "#2B2B36",
  header: "#34343F",
  borderFallback: "#26262e",
  titleFallback: "#E2E2EA",
  dotFallback: "#6b7280",
};

export type NodePalette = {
  dotBg: string;
  effectiveColor: string | undefined;
  headerBg: string;
  modeColor: string | null;
  nodeBg: string;
  nodeBorder: string;
  nodeMode: number;
  titleColor: string;
};

/**
 * 节点模式（LiteGraph 0 始终 / 2 静音 / 4 旁路）覆盖角色色调：旁路→粉、静音→灰、正常→角色/默认色。
 * 返回整张卡片配色；`base` 携带主题表面颜色，着色代数不变，只把底色从常量挪到调用方。
 */
export function computeNodePalette(
  data: WorkflowNodeData,
  role?: { color?: string },
  base: NodePaletteBase = DARK_PALETTE_BASE,
): NodePalette {
  const nodeMode = data.mode ?? 0;
  const modeColor = nodeMode === 4 ? BYPASS_COLOR : nodeMode === 2 ? DISABLED_COLOR : null;
  const effectiveColor = modeColor ?? role?.color;

  const headerBg = effectiveColor ? mixHex(base.body, effectiveColor, 0.22) : base.header;
  // 卡片体：只 ~8% 着色，让角色身份是个提示而不是铺满。模式
  // 节点保留半透明着色，好让真正的背景模糊接上。
  const nodeBg = modeColor
    ? hexToRgba(modeColor, nodeMode === 4 ? 0.16 : 0.11)
    : role?.color
      ? mixHex(base.body, role.color, 0.08)
      : base.body;
  const nodeBorder = effectiveColor ? mixHex(base.body, effectiveColor, 0.55) : base.borderFallback;
  const titleColor = modeColor ? lightenHex(modeColor, 0.3) : (role?.color ?? base.titleFallback);
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
 * 折叠态锚点「圆柱」—— 折叠时替换端口堆的 6px 装饰药丸。
 * 原为写死深色渐变（#d4d4d8→#52525b→#18181b + 45% 白边框），浅色下成了白底白边框、锚点看不见。
 * 色标交给主题后两种模式都可读，与 --color-port-surface 同一判断。
 */
export type AnchorCylinderTheme = {
  border: string;
  boxShadow: string;
  gradient: string;
};

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
export function resolveAnchorCylinder(resolvedTheme: string | undefined): AnchorCylinderTheme {
  return resolvedTheme === "light" ? LIGHT_ANCHOR_CYLINDER : DARK_ANCHOR_CYLINDER;
}
