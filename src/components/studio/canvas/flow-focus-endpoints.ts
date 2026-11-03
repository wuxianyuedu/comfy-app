/* ── 选中节点的「相关连线」判据（纯函数，无 React/DOM）──
 * 判据：把一条线两端解析成当前图的节点 id，能解析到选中节点即相关。
 * 用 resolveNodeId 而非 edge.source === nodeId：项目画布需折叠锚点替换，
 * 工作流编辑器有边界口/映射线等合成端点；React Flow 内部表以 internals.userNode 持业务节点。
 * 方向按解析后端点判；解析不出时给 "related"；两层各提供 resolveNodeId / isSelected，本模块只判定。 */

/* 端点在当前图里的相对位置：upstream = 指向选中节点，downstream = 由它流出，
 * related = 相关但方向无法判定，none = 与选中节点无关。 */
export type EdgeFocusRole = "upstream" | "downstream" | "related" | "none";

export type EdgeFocusEndpoints = {
  /** 上游端点 id，解析不出时为 null。 */
  source: string | null;
  /** 下游端点 id，解析不出时为 null。 */
  target: string | null;
};

export type ResolveEdgeFocusArgs = {
  /** 一条连线的两个端点（已按当前画布坐标系解析）。 */
  endpoints: EdgeFocusEndpoints;
  /** 该「实际节点 id」是否处于选中态。 */
  isSelected: (resolvedNodeId: string) => boolean;
  /** 端点 id → 渲染该节点时的实际节点 id。返回 null 表示该端点在当前图里不存在。 */
  resolveNodeId: (visualNodeId: string) => string | null;
};

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

  if (targetSelected && !sourceSelected) {
    return "upstream";
  }
  if (sourceSelected && !targetSelected) {
    return "downstream";
  }
  /* 两端都是选中节点（多选同组、或自环）→ 相关，但没有单一方向。 */
  if (sourceSelected || targetSelected) {
    return "related";
  }
  return "none";
}

/**
 * 这条连线此刻该不该「降噪」：画布存在选中项且此线无关 → 压暗，相关上下游跳出来。
 * 无选中项时返回 false，全图原样（移动/缩放/阅读不该因一次误点整片变淡）。
 * 与 `resolveEdgeFocus` 共用判据；focus === "none" 只说明无关，是否压暗还要看画布有无选中项。
 */
export function shouldDimEdge(args: {
  focus: EdgeFocusRole;
  /** 当前画布是否存在任何选中项（节点被选中即算）。 */
  hasSelection: boolean;
}): boolean {
  return args.hasSelection && args.focus === "none";
}

/* ── 端口行的关注级别 ──
 * 选线加粗仍答不出「线落在节点哪一行」，故端口行同源：有连线落到的行提亮 + 端点放大，未连线行压暗。
 * 判据「先解析端点 → 再判方向」，且必须落到 (节点 id, 端口名)：只按端口名匹配会让别处同名 seed/text/image 误亮。
 * 端点 id 契约：目标端 = 端口名，源端 = `out:<输出名>`；无 handle 的映射线只判节点、不落到行。 */

/** 源端输出端口 id 的前缀（与 FlowNodePinRows / SubgraphHeader 的 Handle id 同口径）。 */
export const OUTPUT_PORT_HANDLE_PREFIX = "out:";

/* ── 端口行样式映射（唯一事实源）──
 * 三种观感（提亮/原样/压暗）各由行背景 + 整行透明度 + 标签色/字重 + 端点尺寸/光晕共同表达；
 * 收口在此避免散落三元链导致「行亮了但端点没亮」的静默不一致。
 * `related`（两端都选中/自环）只作提示不提亮 —— 它说不出方向，提亮会误导。 */
export type PortRowTone = "focused" | "related" | "plain" | "dimmed";

export type PortRowStyle = {
  /** 整行的背景（提亮档给一层极淡的白）。 */
  background?: string;
  /** 端点光晕是否用强档（提亮档给更强的外发光）。 */
  dotGlowStrong: boolean;
  /** 端点直径（px）。 */
  dotSize: number;
  /** 标签颜色。 */
  labelColor: string;
  /** 标签字重（提亮档加粗半档）。 */
  labelWeight?: number;
  /** 整行透明度（压暗档连标签与端点一起压）。 */
  opacity?: number;
};

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
  hasSelection: boolean;
  role: EdgeFocusRole;
}): PortRowTone {
  if (args.role === "upstream" || args.role === "downstream") {
    return "focused";
  }
  if (args.role === "related") {
    return "related";
  }
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

export type PortFocusConnection = {
  /**
   * 这条线是否「对外参数 → 宿主节点端口」的映射线。
   * true 时不参与端口行判定：它表达参数落到宿主的哪一行，不是数据流；
   * 选中宿主时点亮所有映射线落点反而看不清真正上下游（与连线高亮口径一致）。
   */
  paramMap?: boolean;
  /** 源端节点 id；解析不出来（如映射线的参数卡片）时可传 null 或靠 resolveSourceId 过滤。 */
  source: string | null;
  /** 源端输出端口名（已含 `out:` 前缀时按原样使用）。 */
  sourceHandle?: string | null;
  target: string | null;
  /** 目标端端口名（端口行 Handle id）。 */
  targetHandle?: string | null;
};

/** 单个节点上各端口行的关注级别（`upstream` 与 `downstream` 不可能同时生效）。 */
export type NodePortFocus = {
  downstream: ReadonlySet<string>;
  related: ReadonlySet<string>;
  upstream: ReadonlySet<string>;
};

export type ResolvePortFocusArgs = {
  connections: ReadonlyArray<PortFocusConnection>;
  /** 源端节点 id 的解析（映射线的参数卡片等合成端点返回 null 表示「不是图上的端口」）。 */
  resolveSourceId?: (visualNodeId: string) => string | null;
  /** 目标端节点 id 的解析（折叠锚点等）。 */
  resolveTargetId?: (visualNodeId: string) => string | null;
  /** 选中节点 id 集合（已按实际节点 id 归一）。 */
  selectedIds: ReadonlySet<string>;
};

/** 端口行的实际 Handle id：输出侧的 `out:` 前缀在这里补全，避免各处各写一遍。 */
export function portHandleId(side: "source" | "target", name: string): string {
  if (side !== "source") {
    return name;
  }
  return name.startsWith(OUTPUT_PORT_HANDLE_PREFIX) ? name : `${OUTPUT_PORT_HANDLE_PREFIX}${name}`;
}

/** 一个端口行的关注级别；`none` = 该行没有连线落到。 */
export type PortFocusRole = "upstream" | "downstream" | "related";

type PortFocusBucket = {
  downstream: Set<string>;
  related: Set<string>;
  upstream: Set<string>;
};

/** 把一次占用记进节点的端口桶。**互斥**：一个端口行只持有一个级别 ——
 *  既是上游又是下游时按上游（值确实是上游喂进来的），`related` 只用于
 *  「说不清方向」的两端都选中，不会把已经判定的上下游覆盖掉。 */
function assignPortRole(bucket: PortFocusBucket, handle: string, role: PortFocusRole): void {
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
  if (selectedIds.size === 0) {
    return { nodes };
  }

  const bucket = (nodeId: string): PortFocusBucket => {
    const existing = nodes.get(nodeId);
    if (existing) {
      return existing;
    }
    const created: PortFocusBucket = {
      upstream: new Set(),
      downstream: new Set(),
      related: new Set(),
    };
    nodes.set(nodeId, created);
    return created;
  };

  for (const connection of connections) {
    if (connection.paramMap === true) {
      continue;
    }
    const source = connection.source ? resolveSourceId(connection.source) : null;
    const target = connection.target ? resolveTargetId(connection.target) : null;
    const sourceSelected = source !== null && selectedIds.has(source);
    const targetSelected = target !== null && selectedIds.has(target);
    if (!sourceSelected && !targetSelected) {
      continue;
    }

    const targetHandle = connection.targetHandle;
    const sourceHandle = connection.sourceHandle;
    /* 两端都选中（多选 / 自环）→ related：加粗仍说明「这一行有连线」，但不提亮，
     * 因为说不清值是从上游来还是往下去。 */
    const role: PortFocusRole =
      sourceSelected && targetSelected ? "related" : targetSelected ? "upstream" : "downstream";

    if (target !== null && targetHandle) {
      assignPortRole(bucket(target), targetHandle, role);
    }
    if (source !== null && sourceHandle) {
      assignPortRole(bucket(source), portHandleId("source", sourceHandle), role);
    }
  }

  return { nodes };
}
