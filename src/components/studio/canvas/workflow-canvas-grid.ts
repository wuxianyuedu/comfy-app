/* 画布网格分层的标识契约 —— 渲染侧 <CanvasGrid> 与断言侧共用同一份常量。
 * 三层 id 还决定「画布有没有底色」：散写字符串时测试只能抄，抄错就静默失去覆盖
 *（曾发生整张网格层连带底色被关掉、画布全黑）。顺序即叠放：minor 细网格随缩放淡出；
 * base 画布底色恒常渲染（画布已渲染的唯一直观凭据）；major 主参考线（每 10 格）始终保留。 */

import { trimFixed } from "~/lib/number-format";

/** 细网格线层。 */
export const GRID_MINOR_LAYER_ID = "wf-grid-minor";
/** 画布底色层。 */
export const GRID_BASE_LAYER_ID = "wf-grid-base";
/** 主参考线层。 */
export const GRID_MAJOR_LAYER_ID = "wf-grid-major";

/* ── 网格线的颜色出口（三处画布同源）─────────────────────────── */

/**
 * 画布网格线颜色表达式：色相随主题、透明度由调用处给。
 * α 不烤进 token：线强度由画布设置（gridMinorAlpha / gridMajorAlpha）与缩放淡出系数决定；
 * 点阵 --color-canvas-grid-dot 的强度设计定死，故烤进去 —— 两颗 token 形态不同是有意的。
 * 必须走这一个出口：此前三份写法（两处写死 rgba、一处引用从未定义的 token 走兜底），现在色相只在 globals.css 定义一次。 */
export function gridLineColor(alpha: number): string {
  const percent = trimFixed(alpha * 100, 3) ?? "0";
  return `color-mix(in srgb, var(--color-canvas-grid-line) ${percent}%, transparent)`;
}
