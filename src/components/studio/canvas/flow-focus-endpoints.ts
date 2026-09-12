/* ── 选中节点的「相关连线」判据（纯函数，无 React / DOM） ──
 *
 * 画布上选中一个节点时，它的上下游连线需要与其余连线区分开（加粗 + 高亮），
 * 否则在一张几十个节点的图里「这个节点连到哪」只能靠人眼沿线追。
 *
 * 判据只有一条：把一条连线的两个端点都解析成「当前图里的节点 id」，
 * 能解析到选中节点 → 这条线与该节点相关；否则不相关。
 *
 * 之所以要「解析端点」而不是直接 `edge.source === nodeId`：
 *  - 不同画布对端点坐标系的要求不同（项目画布需要折叠状态的锚点替换，
 *    工作流编辑器有边界口/映射线这类合成端点）；
 *  - React Flow 的内部节点表以 `internals.userNode` 持有业务侧原始节点，
 *    选中事实源与渲染事实源未必同名（如折叠节点用锚点 id 渲染）。
 *  两层各自提供 `resolveNodeId` 与 `isSelected` 两个窄回调，本模块只做判定。
 *
 * 方向同样按解析后的端点判定：解析不出方向（端点不在当前图里）时给 "related"，
 * 宁可高亮也不要让用户看到一条「选中节点明明连着、却没高亮」的线。
 */

/* 端点在当前图里的相对位置：upstream = 指向选中节点，downstream = 由它流出，
 * related = 相关但方向无法判定，none = 与选中节点无关。 */
export type EdgeFocusRole = "upstream" | "downstream" | "related" | "none";

export interface EdgeFocusEndpoints {
  /** 上游端点 id，解析不出时为 null。 */
  source: string | null;
  /** 下游端点 id，解析不出时为 null。 */
  target: string | null;
}

export interface ResolveEdgeFocusArgs {
  /** 一条连线的两个端点（已按当前画布坐标系解析）。 */
  endpoints: EdgeFocusEndpoints;
  /** 端点 id → 渲染该节点时的实际节点 id。返回 null 表示该端点在当前图里不存在。 */
  resolveNodeId: (visualNodeId: string) => string | null;
  /** 该「实际节点 id」是否处于选中态。 */
  isSelected: (resolvedNodeId: string) => boolean;
}

export function resolveEdgeFocus({
  endpoints,
  resolveNodeId,
  isSelected,
}: ResolveEdgeFocusArgs): EdgeFocusRole {
  const source = endpoints.source;
  const target = endpoints.target;

  const sourceId = source ? resolveNodeId(source) : null;
  const targetId = target ? resolveNodeId(target) : null;

  const sourceSelected = sourceId ? isSelected(sourceId) : false;
  const targetSelected = targetId ? isSelected(targetId) : false;

  if (targetSelected && !sourceSelected) return "upstream";
  if (sourceSelected && !targetSelected) return "downstream";
  /* 两端都是选中节点（多选同组、或自环）→ 相关，但没有单一方向。 */
  if (sourceSelected || targetSelected) return "related";
  return "none";
}

/**
 * 这条连线此刻该不该「降噪」。
 *
 * 语义是「画布上存在选中项、而这条线与它无关」——此时把无关线压暗，相关的
 * 上下游线才会跳出来。没有选中任何东西时返回 false，全图保持原样（用户只是
 * 在移动 / 缩放 / 阅读，不应该因为一次误点就整片变淡）。
 *
 * 与 `resolveEdgeFocus` 共用同一个判据入口：`focus` 为 "none" 只说明「这条线
 * 与选中节点无关」，是否真的压暗还要看画布上有没有选中项，两个条件缺一不可。
 */
export function shouldDimEdge(args: {
  focus: EdgeFocusRole;
  /** 当前画布是否存在任何选中项（节点被选中即算）。 */
  hasSelection: boolean;
}): boolean {
  return args.hasSelection && args.focus === "none";
}
