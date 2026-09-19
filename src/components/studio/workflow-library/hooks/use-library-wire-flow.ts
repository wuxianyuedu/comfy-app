"use client";

/* ── 工作流库「画布节点」预览的 React Flow 编排（规范 §17.2 第②层）──
 *
 * 库里那三列（对外参数卡片列 + 宿主卡片 + 对外输出参数卡片列）现在是一个真正的
 * React Flow 画布（ISSUE #529）：
 *   · 视口（拖动平移 / 滚轮缩放 / fitView）由 React Flow 自己承担，自绘的
 *     `WorkflowCanvasViewportFrame` 与量 rect 的 SVG 连线层一并退场；
 *   · 端点是真的 `<Handle>`，连线是真的 edge（渲染交给 React Flow）；
 *   · 「这一行收不收这个口子」收敛到一个纯函数 `isValidConnection`。
 *
 * 本层只做编排：把派生出来的连线（`workflow-library-param-cards` 的 wires）与
 * 编辑动作（`use-param-wiring` / `outputWiring`）接上，视图只负责摆 DOM。
 *
 * **不受控 `defaultNodes` / `defaultEdges`**：节点与边的集合由这里派生一次，
 * React Flow 只持有「用户拖过的位置 / 选中」这类瞬时状态。受控写法会在拖动时
 * 每帧重建整棵 DOM —— 而节点内部是一整张表单，代价极高（§2.11 画布性能模式）。
 * 派生结果变化（换工作流 / 改模式 / 改落点）由 `key` 重建画布，与既有
 * `WorkflowCanvasNodePreview` 的 `key={workflow.id}` 同一口径。
 */

import { useCallback, useMemo, useState } from "react";
import {
  type Connection,
  type Edge,
  type Node,
  type OnConnectEnd,
} from "@xyflow/react";

import type { WorkflowIOMap } from "~/components/studio/workflow-io";
import {
  pinAcceptsEntry,
  type ParamEntry,
} from "~/lib/workflow/workflow-param-mapping";
import {
  LIBRARY_EDGE_STYLE,
  LIB_NODE_BACKDROP,
  LIB_NODE_HOST,
  LIB_NODE_OUTPUTS,
  LIB_NODE_PARAMS,
  libraryBackdropSize,
  libraryEdgeId,
  layoutLibraryNodes,
  SELECTED_STROKE,
  type LibraryNodeContent,
} from "../workflow-library-wire-graph";
import type {
  LibraryOutputCards,
  LibraryParamCards,
  ParamCardWire,
} from "../workflow-library-param-cards";

/** 三列节点的节点类型名（注册表在视图里，见 `WorkflowLibraryCanvasNodes`）。 */
export const LIB_NODE_TYPES = {
  libParams: "libParams",
  libHost: "libHost",
  libOutputs: "libOutputs",
  /** 背景板（撑起画布高度，见 `buildLibraryNodes`）。 */
  libBackdrop: "libBackdrop",
} as const;

/** 落点失败时给用户的原因（人类可读）——「拖了没反应」不许是静默的。 */
export type LibraryDropHint = string | null;

export interface LibraryWireFlowArgs {
  io: WorkflowIOMap | null | undefined;
  /** 输入侧卡片派生（entries / resolved / ownersByPin / wires…）。 */
  paramCards: LibraryParamCards;
  /** 输出侧的连线（宿主输出行 → 右列卡片）。 */
  outputWires: readonly ParamCardWire[];
  /** 契约条目表（闸门判「这个口接受什么类型的端口」，与自动落点同一份）。 */
  entries: readonly ParamEntry[];
  /** 三列节点的渲染内容（`LibraryNodeContent` 的三段，见画布的说明）。 */
  paramsNode: LibraryNodeContent["params"];
  hostNode: LibraryNodeContent["host"];
  outputsNode: LibraryNodeContent["outputs"];
  /** 输入侧落点写入（`use-param-wiring.connect`）。 */
  connect?: (entryId: string, ioKey: string) => void;
  /** 输出侧取值行写入。 */
  connectOutput?: (outputIoKey: string, targetIoKey: string) => void;
  /** 背景板尺寸（画布量到容器尺寸后给出；不传用兜底值，见 `buildLibraryNodes`）。 */
  backdropSize?: { width: number; height: number };
  /** 是否允许编辑（有模式 + 上层给了落库回调）。为 false 时连线不可单独点选 /
   *  删除（只读预览，避免误删）。与画布的 `canWire` 同源。 */
  canWire?: boolean;
  /** 画布上当前点选中的边 id 集合（来自 `onEdgeClick`）。命中即注入高亮描边。 */
  selectedEdgeIds?: ReadonlySet<string>;
}

/** 三列节点的首帧布局尺寸（面板靠 fitView 收进视口，这里只需稳定可读）。
 *
 *  `envelopeHeight` 与 `fillHeight` 是**两个不同的高度**，见
 *  `LibraryNodeSizing` 的说明：前者是卡片列的首帧声明高度，后者是背景板高度。 */
export interface LayoutSizing {
  paramsWidth: number;
  outputsWidth: number;
  hostWidth: number;
  columnGap: number;
  originX: number;
  originY: number;
  /** 宿主节点的首帧声明高度（真实高度由内容撑开，见 `buildLibraryNodes`）。 */
  envelopeHeight: number;
  /** 背景板高度（面板可视高度与卡片列高度取大，见 `backdropSize`）。 */
  fillHeight: number;
}

export const LAYOUT_SIZING: LayoutSizing = {
  paramsWidth: 220,
  outputsWidth: 200,
  hostWidth: 380,
  columnGap: 96,
  originX: 0,
  originY: 0,
  /** 三列的首帧包络高度（真实高度由内容撑开，见 `defaultNodes`）。 */
  envelopeHeight: 720,
  /* 测量还没回来前的兜底（视口未知时按内容量级给）；真值由画布量到容器尺寸
   * 后经 `libraryBackdropSize` 给出（ISSUE #596）。 */
  fillHeight: 720,
} as const;

export function useLibraryWireFlow({
  io,
  paramCards,
  outputWires,
  entries,
  paramsNode,
  hostNode,
  outputsNode,
  connect,
  connectOutput,
  backdropSize,
  canWire,
  selectedEdgeIds,
}: LibraryWireFlowArgs) {
  /* 落点失败的原因：`onConnectEnd` 的 `connectionState.isValid` 给三态
   * （null = 没落在任何 handle 上、false = 落在 handle 上但被闸门拒了），
   * 据此把原因说清楚，4 秒后自己消失（不只读，可直接重试）。 */
  const [dropHint, setDropHint] = useState<LibraryDropHint>(null);
  const showHint = useCallback((message: string) => {
    setDropHint(message);
    window.setTimeout(() => setDropHint(null), 4000);
  }, []);

  /* ── 节点与边（只在挂载时派生一次）──
   * 换工作流 / 改模式 / 改落点都由**重建画布**（上层给 `key`）兜住，不必每帧
   * 重算 —— 每帧重建边对象会让输入卡顿，重建节点更糟（节点里是一整张表单）。
   *
   * 节点位置与尺寸由布局常量给出：尺寸给出来 React Flow 才能在首帧算出边的落点
   * （jsdom / 首帧布局前量不到 DOM 尺寸会一条边都不画），真实高度由内容撑开。
   * **节点的渲染内容不在这里**：它随渲染变（表单值 / 运行态 / 候选端点），走
   * `nodeContent` 由画布经 Context 下发 —— 塞进 `node.data` 就只能在「冻在首帧」
   * 与「每帧 setNodes 打循环」里二选一（见画布的说明）。 */
  /* 背景板尺寸随容器尺寸变（窗口缩放 / 面板拖动），所以 `defaultNodes` 不再
   *  完全「只在挂载时派生」——尺寸变了要重建。用它的**两个数字**当依赖（而不是
   *  对象引用）：尺寸真的变了，重建才有意义；重建代价是四个节点对象 + 一次
   *  `setNodes`，不是整棵表单。 */
  const backdropWidth = backdropSize?.width;
  const backdropHeight = backdropSize?.height;
  const defaultNodes = useMemo(
    () =>
      buildLibraryNodes(
        LAYOUT_SIZING,
        backdropWidth !== undefined && backdropHeight !== undefined
          ? { width: backdropWidth, height: backdropHeight }
          : undefined,
      ),
    [backdropWidth, backdropHeight],
  );
  /* 边的**集合**跟随派生：改落点（含库内本地 overlay）、恢复默认、换模式之后，
   *  新写入的线要能进画布。只在挂载时派生一次的话，写入成功的线永远进不了画布
   *  —— 用户看到的就是「松手线就消失」（ISSUE #355 复审）。
   *
   *  节点集合仍是固定的（三列布局，见 `defaultNodes` 的说明）：节点内部是整张
   *  表单，逐帧重建代价高；边只是几条线，重建无妨。 */
  const defaultEdges = useMemo(
    () =>
      deriveLibraryEdges(
        paramCards.wires,
        outputWires,
        !!canWire,
        selectedEdgeIds,
      ),
    [paramCards.wires, outputWires, canWire, selectedEdgeIds],
  );

  /* ── 类型闸门（第 2 步的核心）──
   * 拖动中 React Flow 逐个候选调用它，`true` = 这个落点收这个口子。判据与自动
   * 落点**同一份**（`pinAcceptsEntry`）：条目接受的端口分类里必须包含这个端口
   * 自己的分类 —— 不过这道闸门就会连出「提示词 → 宽高比」这种运行期取不到值的
   * **假线**。
   *
   * 方向也在这里判（loose 模式下任意方向都发得出来）：左列卡片 → 宿主输入行、
   * 宿主输出行 → 右列卡片，同列与反向一律拒绝。 */
  const isValidConnection = useCallback(
    (connection: Connection | Edge): boolean =>
      libraryConnectionAllowed(connection, { io, entries }),
    [entries, io],
  );

  /* ── 连线上抛 ──
   * 只有合法落点的松手会走到这里（React Flow 已按 `isValidConnection` 过滤）。
   * 两个方向都要受理：卡片圆点起手（卡片 → 行）与**反向**（行圆点 → 卡片）。 */
  const onConnect = useCallback(
    (connection: Connection) => {
      const { source, target, sourceHandle, targetHandle } = connection;
      if (!sourceHandle || !targetHandle) return;
      /* 左列卡片起手：handle id 就是**条目 id**（落库键），落点取另一端（宿主行的
       *  ioKey）；右列输出卡的 handle id 就是输出口的 ioKey，同样是落库键。 */
      if (source === LIB_NODE_PARAMS && target === LIB_NODE_HOST) {
        connect?.(sourceHandle, targetHandle);
        return;
      }
      if (source === LIB_NODE_HOST && target === LIB_NODE_OUTPUTS) {
        connectOutput?.(targetHandle, sourceHandle);
        return;
      }
      /* 反向：从宿主行起手、落到卡片圆点上（行才是落点）。 */
      if (source === LIB_NODE_HOST && target === LIB_NODE_PARAMS) {
        connect?.(targetHandle, sourceHandle);
        return;
      }
      if (source === LIB_NODE_OUTPUTS && target === LIB_NODE_HOST) {
        connectOutput?.(sourceHandle, targetHandle);
      }
    },
    [connect, connectOutput],
  );

  /* ── 落点失败的原因（上一个提交刚做的能力，换 React Flow 后必须补回来）── */
  const onConnectEnd = useCallback<OnConnectEnd>(
    (_event, connectionState) => {
      /* `FinalConnectionState` 与 `NoConnection` 的并集：没拖过线时
       *  `fromNode === null`，据此早退（此时也不该有任何提示）。 */
      if (!connectionState.fromNode) return;
      if (connectionState.isValid === null) {
        showHint("松手时不在任何端口上（对准那一行 / 卡片再松手）");
        return;
      }
      if (connectionState.isValid === false) {
        /* 被拒的原因**按现场算**，不写死一句话：松手的两端都在 `connectionState`
         *  里（`fromHandle` / `toHandle`），还原出连接形状就能问同一道闸门「为什么
         *  拒」——包括 React Flow 自己拦下的那两类（同列 / 同向）。
         *  写死一句话的代价：方向不对也报「类型不同」，用户照着改类型永远改不对。 */
        const refused = connectionFromDrop(connectionState);
        showHint(
          (refused && libraryConnectionRefusal(refused, { io, entries })) ??
            "这一行不接受这个口子（类型不同：契约口与端口分类要匹配）",
        );
      }
    },
    [showHint, io, entries],
  );

  return {
    defaultNodes,
    nodeContent: { params: paramsNode, host: hostNode, outputs: outputsNode },
    defaultEdges,
    isValidConnection,
    onConnect,
    onConnectEnd,
    dropHint,
  };
}

/** 三列**内容**节点的 id（首帧定向 fitView 的包围盒 = 这三个）。 */
export const LIBRARY_CONTENT_NODE_IDS = [
  LIB_NODE_PARAMS,
  LIB_NODE_HOST,
  LIB_NODE_OUTPUTS,
] as const;

/** 首帧 fitView 的内边距（与既有的 `fitViewOptions` 同值）。 */
export const LIBRARY_FIT_PADDING = 0.08;

/** 首帧定向 fitView 的入参：**只按三列内容节点**缩放。
 *
 *  为什么不交给 `<ReactFlow fitView>` 的默认口径：那个口径按**全部节点**的并集
 *  包围盒缩放，而背景板（`LIB_NODE_BACKDROP`，职责是「把缩放下限钉住 + 铺满画布
 *  底」）在宽高两个方向都严格大于视口 —— 把它算进包围盒会把首帧缩放钉在「铺满
 *  背景板」的那个值上，三列缩成面板中间一小团（ISSUE #596 的另一面）。
 *
 *  `nodes` 只给 id（React Flow 的 `FitViewOptions.nodes` 接受 `{ id }` 形状），
 *  避免把节点对象复制成第二份事实。 */
export function libraryFitViewOptions(): {
  nodes: { id: string }[];
  padding: number;
} {
  return {
    nodes: LIBRARY_CONTENT_NODE_IDS.map((id) => ({ id })),
    padding: LIBRARY_FIT_PADDING,
  };
}

/** 三列节点的位置与首帧尺寸（真实尺寸由内容撑开）。
 *
 *  `nodesDraggable` 要求节点**必须能放得下内容的拖拽命中面**（见画布里的说明），
 *  所以「撑起画布高度」这件事不能靠给卡片节点虚报尺寸 —— 虚报的尺寸会被 React Flow
 *  当作端口几何的依据（见 `contentNode` 的说明）。改为在三列之下垫一层
 *  **背景板**（`LIB_NODE_BACKDROP`，无内容、无端口）：它把画布的包围盒撑到面板
 *  可视高度，`fitView` 于是只会落在「等比铺满视口」的那个缩放上，画布不会在
 *  内容高度处收边、下面留出一块面板底色（ISSUE #596）。
 *
 *  @param sizing       三列布局尺寸
 *  @param backdropSize 背景板尺寸（不传则取 `fillHeight` 见方的兜底值）
 */
export function buildLibraryNodes(
  sizing: LayoutSizing,
  backdropSize?: { width: number; height: number },
): Node[] {
  const at = layoutLibraryNodes(sizing);
  const extent = libraryBackdropSize(sizing, {
    width: sizing.paramsWidth + sizing.hostWidth + sizing.outputsWidth,
    height: sizing.fillHeight,
  });
  /* 三列内容节点的首帧尺寸**只用 `initialWidth` / `initialHeight`**。
   *
   * 写成 `width` / `height` 会把节点**永久钉死**在声明值上（用户报「线没连到端点
   * 上、有的线连不上也没有提示」的根因）：那两个键会被 React Flow 当尺寸写进
   * 节点 DOM 的内联样式，而且 `handleBounds` 量到之后**仍然**取声明值
   * （`getNodeInlineStyleDimensions`：`node.width ?? node.style.width`）。于是：
   *
   *   1. 卡片列的真实高度由内容撑开（表单随 IO 到位长高、行数变多），外框却不动
   *      → 节点元素**不再触发 ResizeObserver** → `updateNodeInternals` 不再跑
   *      → `handleBounds`（端点圆点的坐标）停在**挂载后第一次**量到的那一份；
   *   2. 边按 `handleBounds` 画（`getHandlePosition` = 记录坐标 + 节点绝对位置），
   *      坐标一旧，线就从卡片半空出发 / 落在圆点旁边 —— 截图里那几根没接上的线；
   *   3. 更糟的是**首帧之后才出现的端点**（IO 到位后新增的行）从未进过
   *      `handleBounds`：React Flow 起手就按它找 handle（`getHandle`），找不到便
   *      **静默 return**，连 `onConnectEnd` 都不回调 —— 「连不上，也没有提示」。
   *
   * `initial*` 正是为这件事准备的键：只在**还没量到尺寸**时充当内联尺寸
   * （`handleBounds === undefined` 那一支），量到即撤、外框改由内容决定。首帧几何
   * 照旧（jsdom / 布局前也算得出落点），内容一变就重新量。
   * 背景板相反：它的尺寸**就是**声明值（没有内容可量、也没有端点），继续用
   * `width` / `height`（视口变化时由画布 `setNodes` 改它的声明尺寸）。 */
  const contentNode = (id: string, type: string, width: number): Node => ({
    id,
    type,
    position: at[id]!,
    initialWidth: width,
    initialHeight: sizing.envelopeHeight,
    /* 三列卡片是固定布局列：不可选中 / 不可删，否则点选会挂蓝框、按 Delete
     *  还会删掉整列；连线的选中与删除只针对 edge（见 buildInputEdge /
     *  buildOutputEdge 的 `selectable` / `deletable`）。卡片内的表单与端点
     *  交互不受影响（draggable / connectable 仍按全局开关生效）。 */
    selectable: false,
    deletable: false,
    data: {},
  });

  return [
    {
      id: LIB_NODE_BACKDROP,
      /* 背景板不可交互、不参与连线：它只是画布上的一块底。 */
      type: LIB_NODE_TYPES.libBackdrop,
      position: at[LIB_NODE_BACKDROP]!,
      width: backdropSize?.width ?? extent.width,
      height: backdropSize?.height ?? extent.height,
      selectable: false,
      draggable: false,
      deletable: false,
      connectable: false,
      data: {},
    },
    contentNode(LIB_NODE_PARAMS, LIB_NODE_TYPES.libParams, sizing.paramsWidth),
    contentNode(LIB_NODE_HOST, LIB_NODE_TYPES.libHost, sizing.hostWidth),
    contentNode(
      LIB_NODE_OUTPUTS,
      LIB_NODE_TYPES.libOutputs,
      sizing.outputsWidth,
    ),
  ];
}

/** 三列的**端点清单**（画布用它判断「要不要请 React Flow 重算落点」，见
 *  `WorkflowLibraryCanvas` 的 `useHandleInventoryRefresh`）。
 *
 *  左列一个口一颗点（handle id = 条目 id）、右列一个输出口一颗点（handle id = ioKey）、
 *  宿主的表单行与输出行按 ioKey 认；`canWire` 也算进来 —— 它决定端点是否
 *  `connectable`（只读档下同一颗点不接受拖线）。
 *
 *  拼成**字符串**是关键：纯重渲染（同一批口的新数组）得到同一个串，不会白发一次
 *  重算请求；只有口真的增减 / 换 id 才变。 */
export function handleInventoryOf(
  paramCards: LibraryParamCards,
  outputCards: LibraryOutputCards,
  io: WorkflowIOMap | null | undefined,
  canWire: boolean,
): string {
  return [
    paramCards.entries.map((entry) => entry.id).join(","),
    outputCards.outputs.map((output) => output.ioKey).join(","),
    io ? Object.keys(io).sort().join(",") : "",
    canWire ? "wire" : "readonly",
  ].join("|");
}

/** 库内一次连接的形状（闸门只看这四个字段）。
 *
 *  React Flow 交给闸门的 connection 已经**归一化成 source → target**（从 target
 *  端起手也一样），所以「反着拖」与「正着拖」在这里是同一件事，闸门不必分两套。 */
export type LibraryConnection = Pick<
  Connection | Edge,
  "source" | "target" | "sourceHandle" | "targetHandle"
>;

/** 闸门需要的上下文：IO 表（端口分类） + 契约条目表。 */
export interface LibraryGateContext {
  io: WorkflowIOMap | null | undefined;
  entries: readonly ParamEntry[];
}

/** 库内连线的**类型闸门**（纯函数，可单测）。
 *
 *  拖动中 React Flow 逐个候选调用它，`true` = 这个落点收这个口子。判据与自动
 *  落点**同一份**（`pinAcceptsEntry`）：条目接受的端口分类里必须包含这个端口
 *  自己的分类 —— 不过这道闸门就会连出「提示词 → 宽高比」这种运行期取不到值的
 *  **假线**（ISSUE #529 把这件事从手势层收进一个纯函数）。
 *
 *  方向也在这里判，允许的只有两段：
 *     · 左列卡片圆点（source）→ 宿主卡片的某一行（target）；
 *     · 宿主输出行（source）→ 右列卡片圆点（target）。
 *  同列、跨列、两端同向一律拒绝。 */
export function libraryConnectionAllowed(
  connection: LibraryConnection,
  ctx: LibraryGateContext,
): boolean {
  return libraryConnectionRefusal(connection, ctx) === null;
}

/** 一次落点**被拒的原因**（人类可读）；允许则 `null`。
 *
 *  与 `libraryConnectionAllowed` 是同一判据的两面（`null ⇔ 放行`）：闸门拿它出
 *  提示，免得「能不能连」与「为什么连不上」各写一套、互相打架（用户报的「连不上
 *  也没有提示」里，一半就是提示说错了方向）。 */
export function libraryConnectionRefusal(
  connection: LibraryConnection,
  ctx: LibraryGateContext,
): string | null {
  const { source, target, sourceHandle, targetHandle } = connection;
  if (!source || !target || source === target) {
    return "一条线要跨两列（同一列里的口不能相连）";
  }
  if (!sourceHandle || !targetHandle) {
    return "松手的位置不是端点（对准圆点再松手）";
  }
  if (source === LIB_NODE_PARAMS && target === LIB_NODE_HOST) {
    const entry = entryForHandle(ctx.entries, sourceHandle);
    if (!entry) {
      return "这个口不在当前模式的契约里（换模式后重试，或重做一次 IO 整理）";
    }
    return pinAcceptsEntry(entry.cls, ctx.io?.[targetHandle])
      ? null
      : "这一行不接受这个口子（类型不同：契约口与端口分类要匹配）";
  }
  if (source === LIB_NODE_HOST && target === LIB_NODE_OUTPUTS) {
    /* 输出侧只需要起手那一行是**真实存在的输出行**：`targetHandle` 是卡片圆点
     * 自己的 handle id（端口名，不是 ioKey 键空间），合法性不由它决定 ——
     * 方向已在 handle 的 source / target 类型上收窄。 */
    return ctx.io?.[sourceHandle]
      ? null
      : "起手的那一行不是这份工作流的输出行（输出行才能连到右列卡片）";
  }
  return "只能「对外参数 → 宿主卡片」或「宿主输出行 → 对外输出参数」";
}

/** `onConnectEnd` 交回来的两端（只取还原连接需要的字段）。 */
type DropHandle =
  { id?: string | null; nodeId?: string; type?: string } | null | undefined;

/** 从松手现场还原这次连接的形状（`null` = 有一端没落在端点上）。
 *
 *  React Flow 只把「起手 / 松手的两个 handle」交出来，connection 自己留着 ——
 *  而「为什么被拒」得按**同一道闸门**算才准，所以按它的口径在这里还原一次：
 *  哪一端是 target，另一端就是 source。 */
function connectionFromDrop(state: {
  fromHandle?: DropHandle;
  toHandle?: DropHandle;
}): LibraryConnection | null {
  const { fromHandle: from, toHandle: to } = state;
  if (!from?.nodeId || !to?.nodeId) return null;
  const fromIsTarget = from.type === "target";
  return {
    source: fromIsTarget ? to.nodeId : from.nodeId,
    sourceHandle: (fromIsTarget ? to.id : from.id) ?? "",
    target: fromIsTarget ? from.nodeId : to.nodeId,
    targetHandle: (fromIsTarget ? from.id : to.id) ?? "",
  };
}

/** 两条 wire 列表 → 库内的边集合（纯函数，可单测）。
 *
 *  输入侧与输出侧共用同一个 id 形状（`libraryEdgeId`），但**两端与 handle 取值
 *  刚好相反**：输入侧从卡片出发去宿主行，输出侧从宿主行出发去卡片。
 *  `interactive` 控制边是否可被单独点选 / 删除（只读时不可，避免误删）；
 *  `selectedIds` 是画布上当前点选中的边 id 集合 —— 命中的边在 `style` 里直接注入
 *  高亮（内联 style 优先级确定，不依赖 React Flow 是否给 `<g>` 加 `.selected`）。 */
export function deriveLibraryEdges(
  inputWires: readonly ParamCardWire[],
  outputWires: readonly ParamCardWire[],
  interactive: boolean,
  selectedIds?: ReadonlySet<string>,
): Edge[] {
  const sel = selectedIds ?? new Set<string>();
  const out: Edge[] = [];
  for (const wire of inputWires)
    out.push(
      buildInputEdge(
        wire,
        interactive,
        sel.has(libraryEdgeId("param", wire.entryId, wire.handleId)),
      ),
    );
  for (const wire of outputWires)
    out.push(
      buildOutputEdge(
        wire,
        interactive,
        sel.has(libraryEdgeId("output", wire.entryId, wire.handleId)),
      ),
    );
  return out;
}

/** 卡片圆点的 handle id → 契约条目。
 *
 *  库里给卡片圆点的 handle id 是**端口名**（`paramOutputPorts` 的 `handleId`），
 *  而契约条目的 id 是 `prompt` / `size` 这类键 —— 两者不是一回事，闸门必须按
 *  端口名反查条目。查不到（端口已从 IO 移除 / 过期快照）时拒绝连线。 */
/** handle id 就是**条目 id**：一个口一颗点（见 `paramOutputPorts`），条目 id 在
 *  同一个画布节点内天然唯一（尺寸卡的六行各是子口 id，普通卡就是契约口 id）。 */
function entryForHandle(
  entries: readonly ParamEntry[],
  handleId: string,
): ParamEntry | null {
  return entries.find((item) => item.id === handleId) ?? null;
}

/** 输入侧一条边：左列卡片圆点 → 宿主卡片的落点行。
 *
 *  边**可被单独点选 / 删除**（`selectable` / `deletable` 受 `canWire` 控制）：连错
 *  某一条线时不必用卡片头 ↺ 把整张卡（尺寸卡是六条形态线）一起清掉 —— 点这条线、
 *  按 Delete 即可只断这一条（断开的就是它对应的那个 entryId）。只读（无模式 /
 *  无落库回调）时不可交互，避免误删。 */
export function buildInputEdge(
  wire: ParamCardWire,
  interactive: boolean,
  selected = false,
): Edge {
  return {
    id: libraryEdgeId("param", wire.entryId, wire.handleId),
    source: LIB_NODE_PARAMS,
    target: LIB_NODE_HOST,
    /* 圆点按端口名打锚点（一个候选一颗），边必须从**被落到的那一颗**出发。 */
    sourceHandle: wire.handleId,
    targetHandle: wire.targetIoKey,
    /* 库里的线一律是作者画的（实线）：未连过的口不画线，见 `deriveLibraryOutputCards`。
     * 选中的线（点选欲删的那一条）加粗 + 换亮紫，和默认细线拉开对比。 */
    style: selected
      ? { ...LIBRARY_EDGE_STYLE, stroke: SELECTED_STROKE, strokeWidth: 4 }
      : { ...LIBRARY_EDGE_STYLE },
    selectable: interactive,
    deletable: interactive,
    focusable: false,
  };
}

/** 输出侧一条边：宿主卡片的输出行圆点 → 右列卡片圆点。 */
export function buildOutputEdge(
  wire: ParamCardWire,
  interactive: boolean,
  selected = false,
): Edge {
  return {
    id: libraryEdgeId("output", wire.entryId, wire.handleId),
    source: LIB_NODE_HOST,
    target: LIB_NODE_OUTPUTS,
    sourceHandle: wire.targetIoKey,
    targetHandle: wire.handleId,
    /* 库里的线一律是作者画的（实线）：未连过的口不画线，见 `deriveLibraryOutputCards`。 */
    style: selected
      ? { ...LIBRARY_EDGE_STYLE, stroke: SELECTED_STROKE, strokeWidth: 4 }
      : { ...LIBRARY_EDGE_STYLE },
    selectable: interactive,
    deletable: interactive,
    focusable: false,
  };
}
