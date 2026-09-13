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

/** 细网格线层。 */
export const GRID_MINOR_LAYER_ID = "wf-grid-minor";
/** 画布底色层。 */
export const GRID_BASE_LAYER_ID = "wf-grid-base";
/** 主参考线层。 */
export const GRID_MAJOR_LAYER_ID = "wf-grid-major";
