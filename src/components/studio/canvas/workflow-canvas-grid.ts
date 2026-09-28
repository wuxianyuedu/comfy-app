/* 画布网格分层的**标识契约** —— 渲染侧（<CanvasGrid>）与断言侧共用同一份常量。
 *
 * 为什么单独成文件：这三层的 id 参与的不只是渲染，还决定「画布有没有底色」
 * 这件用户可见的事实（见 WorkflowCanvasDecorations 里 GRID_FINE_FADE_ZOOM 的
 * 说明）。散在 JSX 里写字符串字面量，测试只能跟着抄一遍，抄错就静默失去覆盖
 * —— 分层策略出过一次事故（整张网格层连带底色一起被关掉，画布全黑），
 * 契约必须显式可引用。
 *
 * 分层职责（后画的盖在先画的上面，顺序即叠放）：
 *   · minor —— 细网格线，随缩放淡出到完全不画；
 *   · base  —— 画布底色，**恒常渲染**，是画布已渲染的唯一直观凭据；
 *   · major —— 主参考线（每 10 格一条），始终保留。
 */

import { trimFixed } from "~/lib/number-format";

/** 细网格线层。 */
export const GRID_MINOR_LAYER_ID = "wf-grid-minor";
/** 画布底色层。 */
export const GRID_BASE_LAYER_ID = "wf-grid-base";
/** 主参考线层。 */
export const GRID_MAJOR_LAYER_ID = "wf-grid-major";

/* ── 网格线的颜色出口（三处画布同源）─────────────────────────── */

/**
 * 画布网格线的颜色表达式：**色相随主题、透明度由调用处给**。
 *
 * 为什么 α 不烤进 token：线强度是用户在画布设置里调的
 * （`gridMinorAlpha` / `gridMajorAlpha`），细线还要再乘一个随缩放淡出的系数；
 * 而点阵（`--color-canvas-grid-dot`）的强度是设计定死的，所以那颗烤了 ——
 * 两颗 token 形态不同是**有意的**，各自的注释都写了理由。
 *
 * 为什么必须走这一个出口：同一件事此前有三份写法 —— 工作流画布两处写死
 * `rgba(148,163,184, α)`，工作流库预览一处写 `var(--color-canvas-grid-line, …)`
 * 而那颗 token 从来没定义过、永远走兜底。豁免清单里只能用**散文**记一句
 * 「与 WorkflowCanvasDecorations 同源」，机器兜不住（规范 §12.12 / 03 §3.6.1.1）。
 * 现在色相只在 `globals.css` 定义一次，调用处只给 α。
 */
export function gridLineColor(alpha: number): string {
  const percent = trimFixed(alpha * 100, 3) ?? "0";
  return `color-mix(in srgb, var(--color-canvas-grid-line) ${percent}%, transparent)`;
}
