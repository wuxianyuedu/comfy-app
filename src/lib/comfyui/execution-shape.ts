/* ── 工作流的「可执行形态」：raw / api 两种格式地位同等 ──
 *
 * ComfyUI 工作流有两种等价的可执行表达，**谁都不能被当成另一种的降级态**：
 *
 *   · 工作流(RAW / UI)格式 —— ComfyUI 前端存盘的那种（`nodes` + `links` +
 *     `widgets_values`）。`comfyui-cli` 直接吃它：cli 按节点类定义做权威的
 *     UI→API 转换并展开子图。库里的 `rawJson` 列就是它。
 *   · API 格式 —— `{ "<id>": { class_type, inputs } }`，可直接 POST /api/prompt。
 *     库里的 `graph` 列就是它。
 *
 * 因此「这条工作流能不能跑」= **两列任有一列有内容**，而不是「有没有 API 图」
 * （后者把 RAW 导入判成了不可执行 —— 用户看到卡片挂着「不可执行」、生成按钮
 * 置灰，而它其实是能跑的）。同理，「跑的时候送哪一份」也只按来源判：作者导入
 * 的是 RAW 就送 rawJson（经 comfy-cli），导入的是 API 就送 graph。
 *
 * 本模块是这条判据的**唯一定义处**：任何地方要回答「有没有可执行的」「送哪份」
 * 都从这里取，别各自 `Object.keys(graph).length > 0` 一遍。
 */

/** 一条工作流模板里与「可执行形态」相关的两列（其余列无关）。 */
export interface ExecutionShapes {
  /** API 格式列（可空）。 */
  graph?: unknown;
  /** 工作流(RAW)格式列（可空）。 */
  rawJson?: unknown;
}

/** 该值是不是一份「有内容」的 API 格式图（对象且至少一个键）。 */
export function hasGraphContent(graph: unknown): boolean {
  return (
    !!graph &&
    typeof graph === "object" &&
    !Array.isArray(graph) &&
    Object.keys(graph).length > 0
  );
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

/** 这条工作流是否可执行 —— **两列任有一列有内容即可**。
 *
 *  用它的地方只有两类：① 卡片 / 按钮的可用性标注；② 运行前的准入。运行期两
 *  条路径本身就是按「哪一列有内容」分流的，所以这里的判据与执行口径同源。 */
export function hasExecutableWorkflow(shapes: ExecutionShapes): boolean {
  return hasGraphContent(shapes.graph) || hasRawContent(shapes.rawJson);
}

/** 执行载荷：交给 comfy-cli 的 raw 原件，或直接 POST 的 API 图，二选一。 */
export type ExecutionPayload =
  | { kind: "raw"; rawJson: unknown }
  | { kind: "api"; graph: Record<string, unknown> };

/** 决定这次执行送哪一份 —— **优先 RAW**。
 *
 *  两列都在时送 RAW：RAW 是作者的原始件，comfy-cli 按节点类定义做转换，结果与
 *  用户在 ComfyUI 里点「运行」逐字一致；`graph` 列此时可能是历史留下的遗留副产
 *  物（早年导入时转出来的），送它反而可能是不准的那一份。
 *
 *  都没有 → null（调用方据此报「工作流没有可执行内容」，别静默提交空图）。 */
export function resolveExecutionPayload(
  shapes: ExecutionShapes,
): ExecutionPayload | null {
  if (hasRawContent(shapes.rawJson))
    return { kind: "raw", rawJson: shapes.rawJson };
  if (hasGraphContent(shapes.graph))
    return { kind: "api", graph: shapes.graph as Record<string, unknown> };
  return null;
}
