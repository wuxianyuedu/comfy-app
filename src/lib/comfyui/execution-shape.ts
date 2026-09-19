/* ── 工作流的「可执行形态」：只认 RAW 原件 ──
 *
 * 本应用只接受 ComfyUI 的原始工作流格式（工作流 / RAW / UI 格式，`nodes` +
 * `links` + `widgets_values`）。`comfyui-cli` 直接吃它：cli 按节点类定义做权威的
 * UI→API 转换并展开子图。库里的 `rawJson` 列就是它。
 *
 * 因此「这条工作流能不能跑」= **rawJson 列有内容**。API 格式不是可导入的形态，
 * 没有任何一条路径会从 API 格式的库行出发。
 *
 * 本模块是这条判据的**唯一定义处**：任何地方要回答「有没有可执行的」都从这里取，
 * 别各自 `Object.keys(...).length > 0` 一遍。
 */

/** 一条工作流模板里与「可执行形态」相关的列（其余列无关）。 */
export interface ExecutionShapes {
  /** 工作流(RAW)格式列（可空）。 */
  rawJson?: unknown;
}

/** 该值是不是一份「有内容」的 RAW 工作流原件（对象，且带非空 `nodes` 数组）。
 *
 *  `nodes` 是 RAW 形态的成立条件：litegraph 存盘一定有它，空数组等于没有节点，
 *  拿去 comfy-cli 只会得到一份空图。 */
export function hasRawContent(rawJson: unknown): boolean {
  if (!rawJson || typeof rawJson !== "object" || Array.isArray(rawJson))
    return false;
  const nodes = (rawJson as Record<string, unknown>).nodes;
  return Array.isArray(nodes) && nodes.length > 0;
}

/** 这条工作流是否可执行 —— RAW 原件有内容即可。 */
export function hasExecutableWorkflow(shapes: ExecutionShapes): boolean {
  return hasRawContent(shapes.rawJson);
}
