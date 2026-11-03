"use client";

/* ── 工作流库「画布节点」预览的 React Flow 编排（规范 §17.2 第②层）──
 * 三列现在是真正的 React Flow 画布（ISSUE #529）：视口、真 `<Handle>`、真 edge，以及
 * 「这一行收不收这个口子」的纯函数 `isValidConnection`。本层只做编排（接上 wires 与
 * 编辑动作），视图负责摆 DOM。**不受控 `defaultNodes` / `defaultEdges`**：集合由这里
 * 派生一次，React Flow 只持有拖拽/选中；受控写法会在拖动时每帧重建整张表单。 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Connection, Edge, Node, OnConnectEnd } from "@xyflow/react";

import type { WorkflowIOMap } from "~/components/studio/workflow-io";
import { pinAcceptsEntry, type ParamEntry } from "~/lib/workflow/workflow-param-mapping";
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
  type LibNodeId,
} from "../workflow-library-wire-graph";
import type {
  LibraryOutputCards,
  LibraryParamCards,
  ParamCardWire,
} from "../workflow-library-param-cards";

/** 三列节点的节点类型名（注册表在视图里，见 `WorkflowLibraryCanvasNodes`）。 */
/* SAFETY: 类型断言已复核 */
export const LIB_NODE_TYPES = {
  libParams: "libParams",
  libHost: "libHost",
  libOutputs: "libOutputs",
  /** 背景板（撑起画布高度，见 `buildLibraryNodes`）。 */
  libBackdrop: "libBackdrop",
} as const;

/** 落点失败时给用户的原因（人类可读）——「拖了没反应」不许是静默的。 */
export type LibraryDropHint = string | null;

export type LibraryWireFlowArgs = {
  /** 背景板尺寸（画布量到容器尺寸后给出；不传用兜底值，见 `buildLibraryNodes`）。 */
  backdropSize?: { height: number; width: number };
  /** 是否允许编辑（有模式 + 上层给了落库回调）。为 false 时连线不可单独点选 /
   *  删除（只读预览，避免误删）。与画布的 `canWire` 同源。 */
  canWire?: boolean;
  /** 输入侧落点写入（`use-param-wiring.connect`）。 */
  connect?: (entryId: string, ioKey: string) => void;
  /** 输出侧取值行写入。 */
  connectOutput?: (outputIoKey: string, targetIoKey: string) => void;
  /** 契约条目表（闸门判「这个口接受什么类型的端口」，与自动落点同一份）。 */
  entries: ReadonlyArray<ParamEntry>;
  hostNode: LibraryNodeContent["host"];
  io: WorkflowIOMap | null | undefined;
  outputsNode: LibraryNodeContent["outputs"];
  /** 输出侧的连线（宿主输出行 → 右列卡片）。 */
  outputWires: ReadonlyArray<ParamCardWire>;
  /** 输入侧卡片派生（entries / resolved / ownersByPin / wires…）。 */
  paramCards: LibraryParamCards;
  /** 三列节点的渲染内容（`LibraryNodeContent` 的三段，见画布的说明）。 */
  paramsNode: LibraryNodeContent["params"];
  /** 画布上当前点选中的边 id 集合（来自 `onEdgeClick`）。命中即注入高亮描边。 */
  selectedEdgeIds?: ReadonlySet<string>;
};

/** 三列节点的首帧布局尺寸（面板靠 fitView 收进视口，这里只需稳定可读）。
 *
 *  `envelopeHeight` 与 `fillHeight` 是**两个不同的高度**，见
 *  `LibraryNodeSizing` 的说明：前者是卡片列的首帧声明高度，后者是背景板高度。 */
export type LayoutSizing = {
  columnGap: number;
  /** 宿主节点的首帧声明高度（真实高度由内容撑开，见 `buildLibraryNodes`）。 */
  envelopeHeight: number;
  /** 背景板高度（面板可视高度与卡片列高度取大，见 `backdropSize`）。 */
  fillHeight: number;
  hostWidth: number;
  originX: number;
  originY: number;
  outputsWidth: number;
  paramsWidth: number;
};

/* SAFETY: 类型断言已复核 */
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
  const dropHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (dropHintTimerRef.current) {
        clearTimeout(dropHintTimerRef.current);
      }
    };
  }, []);
  const showHint = useCallback((message: string) => {
    setDropHint(message);
    if (dropHintTimerRef.current) {
      clearTimeout(dropHintTimerRef.current);
    }
    dropHintTimerRef.current = setTimeout(() => {
      setDropHint(null);
    }, 4000);
  }, []);

  /* ── 节点与边（只在挂载时派生一次）──
   * 换工作流 / 改模式 / 改落点都由**重建画布**（上层给 `key`）兜住。节点位置与
   * 尺寸由布局常量给出：首帧要能算出边落点（jsdom 量不到 DOM 尺寸会一条边都不画）。
   * **节点渲染内容不在这里**（表单值/运行态/候选端点随渲染变），走 `nodeContent`
   * 经 Context 下发 —— 塞进 `node.data` 只能在「冻在首帧」与「每帧 setNodes」二选一。 */
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
  /* 边的**集合**跟随派生：改落点、恢复默认、换模式后新线要能进画布；只在挂载时
   *  派生一次的话，写入成功的线永远进不了画布（「松手线就消失」，ISSUE #355 复审）。
   *  节点集合仍固定（三列布局）：节点内部是整张表单，逐帧重建代价高；边只是几条线。 */
  const defaultEdges = useMemo(
    () => deriveLibraryEdges(paramCards.wires, outputWires, !!canWire, selectedEdgeIds),
    [paramCards.wires, outputWires, canWire, selectedEdgeIds],
  );

  /* ── 类型闸门（第 2 步的核心）──
   * 拖动中 React Flow 逐个候选调用，`true` = 这个落点收这个口子。判据与自动落点
   * **同一份**（`pinAcceptsEntry`）：条目接受的端口分类里必须包含该端口自己的分类，
   * 否则会连出「提示词 → 宽高比」这种运行期取不到值的假线。方向也在这里判：左列
   * 卡片 → 宿主输入行、宿主输出行 → 右列卡片，同列与反向一律拒绝。 */
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
      if (!sourceHandle || !targetHandle) {
        return;
      }
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
      if (!connectionState.fromNode) {
        return;
      }
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
/* SAFETY: 类型断言已复核 */
export const LIBRARY_CONTENT_NODE_IDS = [LIB_NODE_PARAMS, LIB_NODE_HOST, LIB_NODE_OUTPUTS] as const;

/** 首帧 fitView 的内边距（与既有的 `fitViewOptions` 同值）。 */
export const LIBRARY_FIT_PADDING = 0.08;

/** 首帧定向 fitView 的入参：**只按三列内容节点**缩放。
 *  默认 fitView 按全部节点的并集包围盒缩放，背景板（`LIB_NODE_BACKDROP`）在两个
 *  方向都大于视口，三列会被缩成面板中间一小团（ISSUE #596 的另一面）。
 *  `nodes` 只给 id，避免把节点对象复制成第二份事实。
 */
export function libraryFitViewOptions(): {
  nodes: Array<{ id: string }>;
  padding: number;
} {
  return {
    nodes: LIBRARY_CONTENT_NODE_IDS.map((id) => ({ id })),
    padding: LIBRARY_FIT_PADDING,
  };
}

/** 三列节点的位置与首帧尺寸（真实尺寸由内容撑开）。`nodesDraggable` 要求节点有可
 *  放置内容的拖拽命中面，但「撑起画布高度」不能靠给卡片节点虚报尺寸（虚报会被当作
 *  端口几何依据）。改为在三列之下垫背景板（`LIB_NODE_BACKDROP`，无内容、无端口）：
 *  包围盒撑到可视高度，fitView 只会落在「等比铺满视口」的缩放上（ISSUE #596）。 */
export function buildLibraryNodes(
  sizing: LayoutSizing,
  backdropSize?: { height: number; width: number },
): Array<Node> {
  const at = layoutLibraryNodes(sizing);
  const extent = libraryBackdropSize(sizing, {
    width: sizing.paramsWidth + sizing.hostWidth + sizing.outputsWidth,
    height: sizing.fillHeight,
  });
  /* 三列内容节点的首帧尺寸**只用 `initialWidth` / `initialHeight`**：写成
   *  `width` / `height` 会永久钉死外框，节点不再触发 ResizeObserver，端点坐标停在
   *  首次测量那份（线从半空出发）；首帧后新增的端点登记不上，`getHandle` 找不到
   *  就静默 return（无提示）。`initial*` 只在未量到尺寸时充当内联尺寸，量到即撤；
   *  背景板无内容可量，继续用 `width` / `height`。 */
  const contentNode = (id: LibNodeId, type: string, width: number): Node => ({
    id,
    type,
    position: at[id],
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
      position: at[LIB_NODE_BACKDROP],
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
    contentNode(LIB_NODE_OUTPUTS, LIB_NODE_TYPES.libOutputs, sizing.outputsWidth),
  ];
}

/** 三列的**端点清单**（画布据此判断要不要请 React Flow 重算落点）。
 *  左列一个口一颗点（handle id = 条目 id）、右列一个输出口一颗点（handle id = ioKey）、
 *  宿主表单行与输出行按 ioKey 认；`canWire` 也算进来（只读档下端点不可拖）。
 *  拼成字符串：纯重渲染得到同一个串，不白发重算请求；只有口增减 / 换 id 才变。
 */
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
export type LibraryGateContext = {
  entries: ReadonlyArray<ParamEntry>;
  io: WorkflowIOMap | null | undefined;
};

/** 库内连线的**类型闸门**（纯函数，可单测）。判据与自动落点**同一份**
 *  （`pinAcceptsEntry`）：条目接受的端口分类里必须包含该端口自己的分类，否则会连出
 *  「提示词 → 宽高比」这种运行期取不到值的假线（ISSUE #529 把这件事从手势层收进纯
 *  函数）。只允许两段：左列卡片圆点（source）→ 宿主行（target）、宿主输出行
 *  （source）→ 右列卡片圆点（target）。 */
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
type DropHandle = { id?: string | null; nodeId?: string; type?: string } | null | undefined;

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
  if (!from?.nodeId || !to?.nodeId) {
    return null;
  }
  const fromIsTarget = from.type === "target";
  return {
    source: fromIsTarget ? to.nodeId : from.nodeId,
    sourceHandle: (fromIsTarget ? to.id : from.id) ?? "",
    target: fromIsTarget ? from.nodeId : to.nodeId,
    targetHandle: (fromIsTarget ? from.id : to.id) ?? "",
  };
}

/** 两条 wire 列表 → 库内的边集合（纯函数，可单测）。
 *  输入侧与输出侧共用同一个 id 形状（`libraryEdgeId`），但两端与 handle 取值刚好
 *  相反。`interactive` 控制边是否可单独点选/删除（只读时不可，避免误删）；
 *  `selectedIds` 命中的边在 `style` 里直接注入高亮（内联 style 优先级确定）。
 */
export function deriveLibraryEdges(
  inputWires: ReadonlyArray<ParamCardWire>,
  outputWires: ReadonlyArray<ParamCardWire>,
  interactive: boolean,
  selectedIds?: ReadonlySet<string>,
): Array<Edge> {
  const sel = selectedIds ?? new Set<string>();
  const out: Array<Edge> = [];
  for (const wire of inputWires) {
    out.push(
      buildInputEdge(
        wire,
        interactive,
        sel.has(libraryEdgeId("param", wire.entryId, wire.handleId)),
      ),
    );
  }
  for (const wire of outputWires) {
    out.push(
      buildOutputEdge(
        wire,
        interactive,
        sel.has(libraryEdgeId("output", wire.entryId, wire.handleId)),
      ),
    );
  }
  return out;
}

/** 卡片圆点的 handle id → 契约条目。
 *
 *  库里给卡片圆点的 handle id 是**端口名**（`paramOutputPorts` 的 `handleId`），
 *  而契约条目的 id 是 `prompt` / `size` 这类键 —— 两者不是一回事，闸门必须按
 *  端口名反查条目。查不到（端口已从 IO 移除 / 过期快照）时拒绝连线。 */
/** handle id 就是**条目 id**：一个口一颗点（见 `paramOutputPorts`），条目 id 在
 *  同一个画布节点内天然唯一（尺寸卡的六行各是子口 id，普通卡就是契约口 id）。 */
function entryForHandle(entries: ReadonlyArray<ParamEntry>, handleId: string): ParamEntry | null {
  return entries.find((item) => item.id === handleId) ?? null;
}

/** 输入侧一条边：左列卡片圆点 → 宿主卡片的落点行。
 *  边**可被单独点选/删除**（`selectable` / `deletable` 受 `canWire` 控制）：连错
 *  一条不必用卡片头 ↺ 清掉整张卡，点线按 Delete 只断这一条。只读（无模式 / 无
 *  落库回调）时不可交互，避免误删。
 */
export function buildInputEdge(wire: ParamCardWire, interactive: boolean, selected = false): Edge {
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
export function buildOutputEdge(wire: ParamCardWire, interactive: boolean, selected = false): Edge {
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
