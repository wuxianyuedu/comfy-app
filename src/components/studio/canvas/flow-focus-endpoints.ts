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

/* ── 端口行的关注级别 ────────────────────────────────────────────────
 *
 * 选中节点时只把「相连的线」加粗，仍然答不出「这条线落在节点的哪一行」——
 * 上游线接到一串参数行的哪一行、下游从哪个输出口出去，都要沿线去数。所以端口
 * 行跟着连线一起变：被选中的节点上，「有连线落到的行」提亮 + 端点放大，
 * 「没连线的行」压暗，视线直接落到相关的行上。
 *
 * 与连线同源：判据仍是「先解析端点 → 再判方向」，只是端口行要再落到
 * (节点 id, 端口名) 这一对身份上。**只按端口名匹配是错的** —— ComfyUI 图里
 * `seed` / `text` / `image` 这类名字在多个节点上重名，那样会让选中节点的 `seed`
 * 因为另一个节点的 `seed` 也连线而亮起来。
 *
 * 端点 id 的语义（三处渲染层共用同一批常量）：
 *   - 目标端：端口行 Handle 的 id = 端口名（`seed` / `width` / `out:IMAGE`）；
 *   - 源端：输出行 Handle 的 id = `out:<输出名>`；
 *   - 无 handle 的连线（映射线等）：只判节点，不落到任何一行。
 */

/** 源端输出端口 id 的前缀（与 FlowNodePinRows / SubgraphHeader 的 Handle id 同口径）。 */
export const OUTPUT_PORT_HANDLE_PREFIX = "out:";

/* ── 端口行的样式映射（唯一事实源）───────────────────────────────────
 *
 * 一个端口行有「提亮 / 原样 / 压暗」三种观感，而每种观感由多处样式共同表达：
 * 行背景 + 整行透明度 + 标签色与字重 + 端点尺寸与光晕。**收口在这一张表里**
 * 是刻意的：把这些样式散在渲染层的三元链里，新增一种状态（或调整某一档强度）
 * 就要改四五个地方，漏一处就是「行亮了但端点没亮」这种静默不一致（反模式 C9）。
 *
 * `related`（两端都选中的多选 / 自环）单独占一档：它说明「这一行确实有连线」，
 * 但说不出值是从上游来还是往下去，所以只作提示、不提亮 —— 提亮会给人一个错误
 * 的方向暗示。
 */
export type PortRowTone = "focused" | "related" | "plain" | "dimmed";

export interface PortRowStyle {
  /** 整行的背景（提亮档给一层极淡的白）。 */
  background?: string;
  /** 整行透明度（压暗档连标签与端点一起压）。 */
  opacity?: number;
  /** 标签颜色。 */
  labelColor: string;
  /** 标签字重（提亮档加粗半档）。 */
  labelWeight?: number;
  /** 端点直径（px）。 */
  dotSize: number;
  /** 端点光晕是否用强档（提亮档给更强的外发光）。 */
  dotGlowStrong: boolean;
}

/** 端口行三档 + 提示档的样式表。端点色相由端口类型决定，这里只管「强弱」。 */
export const PORT_ROW_TONES: Record<PortRowTone, PortRowStyle> = {
  focused: {
    background: "var(--color-surface-2)",
    labelColor: "var(--color-ink-bright)",
    labelWeight: 500,
    dotSize: 12,
    dotGlowStrong: true,
  },
  related: {
    labelColor: "var(--color-ink-bright)",
    dotSize: 10,
    dotGlowStrong: false,
  },
  plain: {
    labelColor: "var(--color-ink-bright)",
    dotSize: 10,
    dotGlowStrong: false,
  },
  dimmed: {
    opacity: 0.45,
    labelColor: "var(--color-ink-fainter)",
    dotSize: 10,
    dotGlowStrong: false,
  },
};

/** 判出这一行该用哪一档。
 *
 *  压暗与连线同一条判据（`shouldDimEdge`）：只有「画布上确实有选中项」时才压暗，
 *  且标了关注级别的行不压暗。未选中任何东西时全图原样 —— 用户只是滚动 / 阅读
 *  画布，不该因为一次误点整片变灰。 */
export function resolvePortRowTone(args: {
  role: EdgeFocusRole;
  hasSelection: boolean;
}): PortRowTone {
  if (args.role === "upstream" || args.role === "downstream") return "focused";
  if (args.role === "related") return "related";
  return args.hasSelection ? "dimmed" : "plain";
}

/** 端点光晕的两档实色（强 / 常规）。渲染层把端口类型色插进去。
 *
 *  内圈高光用 `--color-port-halo-ring` 而不是写死的白：浅色下
 *  `rgba(255,255,255,0.5)` 是**白描白**（圆点载体在浅色下是浅色），
 *  等于没有高光 —— 与 `--color-port-surface` 同一类根因。 */
export function portDotGlow(portColor: string, strong: boolean): string {
  return strong
    ? `0 0 10px 2px ${portColor}, inset 0 0 0 1px var(--color-port-halo-ring)`
    : `0 0 6px ${portColor}AA, inset 0 0 0 1px var(--color-port-halo-ring-weak)`;
}

export interface PortFocusConnection {
  /** 源端节点 id；解析不出来（如映射线的参数卡片）时可传 null 或靠 resolveSourceId 过滤。 */
  source: string | null;
  target: string | null;
  /** 源端输出端口名（已含 `out:` 前缀时按原样使用）。 */
  sourceHandle?: string | null;
  /** 目标端端口名（端口行 Handle id）。 */
  targetHandle?: string | null;
  /**
   * 这条线是不是「对外参数 → 宿主节点端口」的映射线。
   *
   * true 时整条线不参与端口行判定：它表达的是「这个对外参数落到宿主节点的哪一行」，
   * 不是图上的数据流。选中宿主节点时把所有映射线的落点一起点亮，反而看不清真正的
   * 上下游（与连线高亮对映射线的口径一致，见 `use-related-edges-highlight`）。
   */
  paramMap?: boolean;
}

/** 单个节点上各端口行的关注级别（`upstream` 与 `downstream` 不可能同时生效）。 */
export interface NodePortFocus {
  upstream: ReadonlySet<string>;
  downstream: ReadonlySet<string>;
  related: ReadonlySet<string>;
}

export interface ResolvePortFocusArgs {
  connections: readonly PortFocusConnection[];
  /** 选中节点 id 集合（已按实际节点 id 归一）。 */
  selectedIds: ReadonlySet<string>;
  /** 源端节点 id 的解析（映射线的参数卡片等合成端点返回 null 表示「不是图上的端口」）。 */
  resolveSourceId?: (visualNodeId: string) => string | null;
  /** 目标端节点 id 的解析（折叠锚点等）。 */
  resolveTargetId?: (visualNodeId: string) => string | null;
}

/** 端口行的实际 Handle id：输出侧的 `out:` 前缀在这里补全，避免各处各写一遍。 */
export function portHandleId(side: "source" | "target", name: string): string {
  if (side !== "source") return name;
  return name.startsWith(OUTPUT_PORT_HANDLE_PREFIX)
    ? name
    : `${OUTPUT_PORT_HANDLE_PREFIX}${name}`;
}

/** 一个端口行的关注级别；`none` = 该行没有连线落到。 */
export type PortFocusRole = "upstream" | "downstream" | "related";

interface PortFocusBucket {
  upstream: Set<string>;
  downstream: Set<string>;
  related: Set<string>;
}

/** 把一次占用记进节点的端口桶。**互斥**：一个端口行只持有一个级别 ——
 *  既是上游又是下游时按上游（值确实是上游喂进来的），`related` 只用于
 *  「说不清方向」的两端都选中，不会把已经判定的上下游覆盖掉。 */
function assignPortRole(
  bucket: PortFocusBucket,
  handle: string,
  role: PortFocusRole,
): void {
  const decided = bucket.upstream.has(handle)
    ? "upstream"
    : bucket.downstream.has(handle)
      ? "downstream"
      : bucket.related.has(handle)
        ? "related"
        : null;
  const next: PortFocusRole =
    decided === "upstream"
      ? "upstream"
      : decided === "downstream" && role !== "upstream"
        ? "downstream"
        : decided === "related" && role === "related"
          ? "related"
          : role;
  bucket.upstream.delete(handle);
  bucket.downstream.delete(handle);
  bucket.related.delete(handle);
  if (next === "upstream") {
    bucket.upstream.add(handle);
  } else if (next === "downstream") {
    bucket.downstream.add(handle);
  } else {
    bucket.related.add(handle);
  }
}

export function resolvePortFocusRoles({
  connections,
  selectedIds,
  resolveSourceId = (visualNodeId) => visualNodeId,
  resolveTargetId = (visualNodeId) => visualNodeId,
}: ResolvePortFocusArgs): { nodes: ReadonlyMap<string, NodePortFocus> } {
  const nodes = new Map<string, PortFocusBucket>();
  if (selectedIds.size === 0) return { nodes };

  const bucket = (nodeId: string): PortFocusBucket => {
    const existing = nodes.get(nodeId);
    if (existing) return existing;
    const created: PortFocusBucket = {
      upstream: new Set(),
      downstream: new Set(),
      related: new Set(),
    };
    nodes.set(nodeId, created);
    return created;
  };

  for (const connection of connections) {
    if (connection.paramMap === true) continue;
    const source = connection.source
      ? resolveSourceId(connection.source)
      : null;
    const target = connection.target
      ? resolveTargetId(connection.target)
      : null;
    const sourceSelected = source !== null && selectedIds.has(source);
    const targetSelected = target !== null && selectedIds.has(target);
    if (!sourceSelected && !targetSelected) continue;

    const targetHandle = connection.targetHandle;
    const sourceHandle = connection.sourceHandle;
    /* 两端都选中（多选 / 自环）→ related：加粗仍说明「这一行有连线」，但不提亮，
     * 因为说不清值是从上游来还是往下去。 */
    const role: PortFocusRole =
      sourceSelected && targetSelected
        ? "related"
        : targetSelected
          ? "upstream"
          : "downstream";

    if (target !== null && targetHandle) {
      assignPortRole(bucket(target), targetHandle, role);
    }
    if (source !== null && sourceHandle) {
      assignPortRole(
        bucket(source),
        portHandleId("source", sourceHandle),
        role,
      );
    }
  }

  return { nodes };
}
