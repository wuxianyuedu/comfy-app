"use client";

/* 工作流库「画布节点」预览的 **React Flow 画布**（ISSUE #529）。
 *
 * 三列各一个节点（对外参数卡片列 / 宿主运行卡片 / 对外输出参数卡片列），连线是
 * 真正的 edge、端点是真正的 <Handle>：
 *   · 视口（拖动平移 / 滚轮缩放 / 适应）由 React Flow 承担 —— 自绘的
 *     `WorkflowCanvasViewportFrame` 与量 rect 的 SVG 连线层一并退场；
 *   · 「这一行收不收这个口子」是 `isValidConnection` 一个纯函数（与自动落点
 *     同一份判据 `pinAcceptsEntry`），不再由手势层各写一套；
 *   · 拖线没落上时的原因提示由 `onConnectEnd` 补回来（不许功能回退）；
 *   · 三列节点只用 `initialWidth` / `initialHeight` 声明首帧尺寸，端点清单变化时再
 *     主动重算一次 `handleBounds` —— 这两件事合起来保证「线永远接在圆点上、首帧
 *     之后新出现的口一定连得上」（见 hooks 的 `buildLibraryNodes` 与下面的
 *     `useHandleInventoryRefresh`）。
 *
 * **`onlyRenderVisibleElements` 关掉**：编辑器画布那边开它是为了 130 节点的模板，
 * 代价是「长边可见、端点节点未挂载」会成批刷 error#008（ISSUE #374）。库里一共
 * 三个节点，全是卡片与表单，视口裁剪省不下什么、却要接一份同样的过滤 —— 直接关掉，
 * 三列常驻挂载，边永远量得到 handleBounds。
 *
 * 节点位置不受控（`defaultNodes`）：用户拖过的位置由 React Flow 自己持有；节点与
 * 边的**集合**由 `key` 重建（换工作流 / 改模式 / 改落点），避免每帧重建整棵表单。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useUpdateNodeInternals,
  type Edge,
  type Node,
  type OnNodeDrag,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { Button } from "~/components/ui/button";
import { useElementBox } from "~/components/ui/use-element-box";
import type { ElementBox } from "~/lib/dom-rect";

import type { WorkflowIOMap } from "~/components/studio/workflow-io";
import type { ParamEntry } from "~/lib/workflow/workflow-param-mapping";
import type {
  LibraryOutputCards,
  LibraryParamCards,
} from "./workflow-library-param-cards";
import {
  buildLibraryNodes,
  handleInventoryOf,
  LAYOUT_SIZING,
  libraryFitViewOptions,
  useLibraryWireFlow,
} from "./hooks/use-library-wire-flow";
import {
  libraryBackdropSize,
  libraryEdgeOwner,
  LIB_NODE_HOST,
  LIB_NODE_OUTPUTS,
  LIB_NODE_PARAMS,
} from "./workflow-library-wire-graph";
import {
  LibraryBackdropNode,
  LibraryHostNode,
  LibraryNodeContentContext,
  LibraryOutputsNode,
  LibraryParamsNode,
} from "./WorkflowLibraryCanvasNodes";
import { gridLineColor } from "../canvas/workflow-canvas-grid";

/* 预览画布的网格线强度：库里不做尺寸表与标尺，只给「这是一块画布」的观感，
 * 所以取一个定值 —— 与编辑器画布 `DEFAULT_CANVAS_SETTINGS.gridMajorAlpha`
 * 同档（0.14），色相则完全走同一个 `--color-canvas-grid-line`。 */
const LIBRARY_GRID_LINE_ALPHA = 0.14;

export interface WorkflowLibraryCanvasProps {
  io: WorkflowIOMap | null;
  paramCards: LibraryParamCards;
  outputCards: LibraryOutputCards;
  /** 契约条目表 —— 闸门（`isValidConnection`）按它判类型。 */
  entries: readonly ParamEntry[];
  /** 契约口清单（`modeContractEntries`）—— 卡片头按它取名，与「工坊封装」
   *  页签同一份（ISSUE #596）。缺省时卡片头退回条目自带的 label。 */
  contractEntries?: readonly { id: string; label: string }[];
  /** 是否允许连线（有模式 + 上层给了落库回调）。 */
  canWire: boolean;
  selectedEntryId: string | null;
  selectedOutputId: string | null;
  onSelectParam: (entryId: string | null) => void;
  onSelectOutput: (ioKey: string | null) => void;
  onResetParam: (entryId: string) => void;
  onResetOutput: (ioKey: string) => void;
  onConnect?: (entryId: string, ioKey: string) => void;
  onConnectOutput?: (outputIoKey: string, targetIoKey: string) => void;
  /** 删除一条映射线：点选某条线后按 Delete 或点「删除选中线」时调用。
   *  由父层落到 `disconnect`（断开该 entryId / 输出 ioKey 的映射），从而只删
   *  这一条线，而不用卡片头 ↺ 把整张卡（尺寸卡是六条形态线）一起清掉。 */
  onDeleteWire?: (namespace: "param" | "output", entryId: string) => void;
  /** 宿主运行卡片（含表单与生成按钮）。 */
  host: React.ReactNode;
}

/** 节点类型注册表：**模块级常量**（§2.11 —— 内联会在每次 render 重建整棵 DOM）。 */
const NODE_TYPES = {
  libBackdrop: LibraryBackdropNode,
  libParams: LibraryParamsNode,
  libHost: LibraryHostNode,
  libOutputs: LibraryOutputsNode,
};

/** 三列的布局位置（模块级常量：吸附目标不随渲染重建）。 */
const LAYOUT_NODES = buildLibraryNodes(LAYOUT_SIZING);

/** 边的渲染参数：线本身要能点选（选中后按 ⌫ / Delete 断开，或点「删除选中线」）。
 *  `deletable` 由派生时按 `canWire` 逐边设（只读预览不可删）；这里的默认值只作兜底。 */
const DEFAULT_EDGE_OPTIONS = {
  type: "default",
  selectable: true,
  deletable: false,
  reconnectable: false,
} as const;

/** 三列在布局里的位置（`resetNodePositions` 的吸附目标）。 */
function positionOf(nodeId: string): { x: number; y: number } | null {
  const node = LAYOUT_NODES.find((item) => item.id === nodeId);
  return node ? node.position : null;
}

/** 画布容器的可视尺寸 → 背景板尺寸（ISSUE #596）。
 *
 *  背景板要「铺满面板」，所以尺寸得从真实布局里量。量的是画布容器自己：
 *  React Flow 会把 `.react-flow__viewport` 拉伸到容器大小，容器尺寸即视口尺寸。
 *
 *  首帧（以及 SSR / jsdom 里量不到尺寸时）用 `LAYOUT_SIZING.fillHeight` 的兜底值
 *  —— 高度只会由「视口」与「内容」取大，兜底量级与卡片列一致，不会比真实需要的
 *  更小。尺寸变化时（窗口缩放、面板拖动）重新派生，同步进 React Flow 的节点表。
 */
function useCanvasBackdropSize(box: ElementBox | null): {
  width: number;
  height: number;
} {
  /* 量测收在 `~/components/ui/use-element-box`（规范 16 §16.2.4.41）：
   * 此前是本文件自持的 `ResizeObserver` + 手写等值判断 —— 与 `LogPanel`
   * 的视口量测各写一遍。**唯一保留在调用处的**是「量不到时用哪个兜底值」：
   * 那是本画布的域判据（下面那段注释解释为什么兜底量级不能更小）。 */
  const viewport = useMemo(
    () =>
      box && box.width > 0 && box.height > 0
        ? { width: box.width, height: box.height }
        : {
            width:
              LAYOUT_SIZING.paramsWidth +
              LAYOUT_SIZING.hostWidth +
              LAYOUT_SIZING.outputsWidth,
            height: LAYOUT_SIZING.fillHeight,
          },
    [box],
  );

  return useMemo(
    () => libraryBackdropSize(LAYOUT_SIZING, viewport),
    [viewport],
  );
}

/** 端点**清单**（哪个节点上有哪些口）—— 变了就主动重算落点。
 *
 *  React Flow 的落点几何（`handleBounds`）只在**节点元素尺寸变化**时重算（它给自己
 *  挂了 ResizeObserver，见 hooks 里 `contentNode` 的说明）。多数端点变化会连带改变列高
 *  （新增一行表单、多一张卡片），尺寸变化顺手就重算了；但**恰好等高**的替换不会
 *  （一个行换成另一个行、切模式换掉同高的候选口），那时新端点登记不上：拖不动、也
 *  落不下，而且是**静默**的（连 `onConnectEnd` 都不回调）。
 *
 *  所以这里把「清单变了」显式告诉 React Flow。清单是拼出来的**字符串**：只在口
 *  真的增减 / 换 id 时才变，纯重渲染（同一批口的新数组）不会发重算请求。 */
function useHandleInventoryRefresh(inventory: string) {
  const updateNodeInternals = useUpdateNodeInternals();
  const applied = useRef(inventory);
  useEffect(() => {
    if (applied.current === inventory) return;
    applied.current = inventory;
    updateNodeInternals([LIB_NODE_PARAMS, LIB_NODE_HOST, LIB_NODE_OUTPUTS]);
  }, [inventory, updateNodeInternals]);
}

export function WorkflowLibraryCanvas(props: WorkflowLibraryCanvasProps) {
  return (
    <ReactFlowProvider>
      <WorkflowLibraryCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function WorkflowLibraryCanvasInner({
  io,
  paramCards,
  outputCards,
  entries,
  contractEntries,
  canWire,
  selectedEntryId,
  selectedOutputId,
  onSelectParam,
  onSelectOutput,
  onResetParam,
  onResetOutput,
  onConnect,
  onConnectOutput,
  onDeleteWire,
  host,
}: WorkflowLibraryCanvasProps) {
  /* 画布容器：量它才知道「铺满」要铺到哪儿（ISSUE #596）。 */
  const containerRef = useRef<HTMLDivElement>(null);
  /* 「画布容器多大」交给唯一出口量（规范 16 §16.2.4.41）：`boxRef` 是它给的
   * 回调 ref，与 `containerRef` 一并挂在同一个节点上（前者给 hook 用、
   * 后者给本文件其余地方读）。 */
  const [boxRef, containerBox] = useElementBox();
  const backdropSize = useCanvasBackdropSize(containerBox);
  /* 端点清单变了就主动重算落点：等元素尺寸变化是等不到的（见
   * `useHandleInventoryRefresh` 的说明）。 */
  const handleInventory = useMemo(
    () => handleInventoryOf(paramCards, outputCards, io, canWire),
    [paramCards, outputCards, io, canWire],
  );
  useHandleInventoryRefresh(handleInventory);
  /* 当前在画布上点选中的映射线（用于「删除选中线」按钮与计数提示，并驱动选中
   *  高亮）。挂在 React Flow 之外：由 `onEdgeClick` 写入、点击空白由 `onPaneClick`
   *  清空；透传给 `useLibraryWireFlow`，在派生边时给命中的边注入高亮描边。 */
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const flow = useLibraryWireFlow({
    io,
    paramCards,
    outputWires: outputCards.wires,
    entries,
    paramsNode: {
      cards: paramCards,
      contractEntries: contractEntries ?? [],
      canWire,
      selectedEntryId,
      onSelect: onSelectParam,
      onReset: onResetParam,
    },
    hostNode: { host },
    outputsNode: {
      cards: outputCards,
      canWire,
      selectedOutputId,
      onSelect: onSelectOutput,
      onReset: onResetOutput,
    },
    connect: onConnect,
    connectOutput: onConnectOutput,
    backdropSize,
    canWire,
    selectedEdgeIds,
  });

  /* 点一条线：记为选中（React Flow 自己对它打 selected，驱动 Delete 删除；同时
   *  `selectedEdgeIds` 给命中的边注入高亮描边，见 `useLibraryWireFlow`）。 */
  const handleEdgeClick = useCallback(
    (_event: React.MouseEvent, edge: Edge) => {
      setSelectedEdgeIds(new Set([edge.id]));
    },
    [],
  );

  /* 首帧**定向 fitView**：只按三列内容节点缩放（见 `libraryFitViewOptions`）。
   *
   *  为什么不能用 `<ReactFlow fitView>` 的默认口径：它按**全部节点**的并集包围盒
   *  缩放，而背景板在宽高两个方向都严格大于视口 —— 三列会被缩成面板中间一小团。
   *
   *  为什么首帧要遮住（`fitted` 之前画布不可见）：React Flow 在**测量到容器尺寸
   *  之前**按默认视口（translate 0,0 scale 1）绘制一帧，量到之后才跑 fitView
   *  —— 用户看到的正是「切到这个页签，整块画布先按错误缩放闪一下、再跳到正确
   *  缩放」。fitView 的结果依赖测量值，无法在首帧前算出，所以**第一帧不画**，
   *  等 fit 落地再显形：宁可少一帧空画布，也不要一帧错缩放。
   *
   *  三条退出路径都置 `fitted`（fitView 完成 / 视口首次变化 / 兜底定时器），
   *  任一条都不会让画布停在「永远不显形」上。 */
  const [fitted, setFitted] = useState(false);
  const markFitted = useCallback(() => setFitted(true), []);
  const handleInit = useCallback(
    (instance: ReactFlowInstance) => {
      void instance
        .fitView(libraryFitViewOptions())
        .then(markFitted, markFitted);
    },
    [markFitted],
  );
  /* 兜底：`fitView()` 在极少数路径上可能不 resolve（没有 panZoom 实例等）。
   *  定时器只负责「别让画布卡在不可见」，不参与缩放口径。 */
  useEffect(() => {
    const timer = window.setTimeout(markFitted, 600);
    return () => window.clearTimeout(timer);
  }, [markFitted]);

  /* React Flow 通过 Delete / Backspace 删除选中线时回调：解析出每条线对应的
   * 对外参数（输入侧 entryId / 输出侧 ioKey），落到 `disconnect` 只断那一条。 */
  const handleEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      for (const edge of deleted) {
        const owner = libraryEdgeOwner(edge.id);
        if (owner && onDeleteWire) onDeleteWire(owner.namespace, owner.entryId);
      }
      setSelectedEdgeIds(new Set());
    },
    [onDeleteWire],
  );

  /* 「删除选中线」按钮：与 Delete 键同一条断开路径。 */
  const handleDeleteSelected = useCallback(() => {
    for (const id of selectedEdgeIds) {
      const owner = libraryEdgeOwner(id);
      if (owner && onDeleteWire) onDeleteWire(owner.namespace, owner.entryId);
    }
    setSelectedEdgeIds(new Set());
  }, [selectedEdgeIds, onDeleteWire]);

  /* 节点与边在挂载时取一次：React Flow 自己持有视口、位置与选中。
   *
   * 节点的**渲染内容**不放进 `node.data` —— 那会把「每帧都变的表单子树」塞进
   * React Flow 的状态里：要么把它冻在首帧（表单永远停在未播种的那一帧），要么
   * 每帧 setNodes 刷新它（setNodes → 重渲染 → setNodes 无限循环）。改由
   * `LibraryNodeContentContext` 下发，节点组件直接读最新那一份
   * （view 组件本来就在同一个渲染树里，引用天然是最新的）。 */
  const [nodes, setNodes, onNodesChange] = useNodesState(flow.defaultNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(flow.defaultEdges);

  /* 派生出来的边**同步进 React Flow**：`useEdgesState` 只在挂载时取初值，不同步
   *  的话，库内新拖出来的线（写入 → paramMap 生效 → wires 重新派生）永远进不了
   *  画布 —— 用户看到的就是「一松手线就消失」（写入本身是成功的，见
   *  `deriveLibraryParamCards` 的用例）。
   *
   *  依赖是 `flow.defaultEdges` 的**引用**：它由 wires 派生（useMemo），只在真的
   *  变化时换新数组，因此这条 effect 不会每帧触发。 */
  useEffect(() => {
    setEdges(flow.defaultEdges);
  }, [flow.defaultEdges, setEdges]);

  /* 背景板尺寸随容器变化（窗口缩放 / 左右分栏拖动），而 React Flow 只在挂载时
   * 读 `nodes`（不受控画布）—— 尺寸变了要把新尺寸同步进去，否则画布还停在旧
   * 尺寸上、下方又会露出来（ISSUE #596）。只更新**尺寸**，位置仍由 React Flow
   * 自己的拖动状态持有。 */
  const backdropKey = `${backdropSize.width}x${backdropSize.height}`;
  const lastBackdropKey = useRef(backdropKey);
  useEffect(() => {
    if (lastBackdropKey.current === backdropKey) return;
    lastBackdropKey.current = backdropKey;
    setNodes((current) =>
      current.map((node) => {
        const sized = flow.defaultNodes.find((item) => item.id === node.id);
        if (!sized || node.width === sized.width) return node;
        return { ...node, width: sized.width, height: sized.height };
      }),
    );
  }, [backdropKey, flow.defaultNodes, setNodes]);

  /* 节点被拖动后回到布局位置：三列是**固定布局**（左列说「要什么」、中间是宿主
   *  卡片、右列说「给什么」），拖散之后读者要自己重新认列 —— 而「可拖」这件事
   *  本身是 React Flow 打开节点命中与指针事件的必要条件（见 nodesDraggable）。
   *  所以手势照收、位置立即吸附回去：既保住了表单交互，也不让三列错位。 */
  const resetNodePositions = useCallback<OnNodeDrag<Node>>(
    (_event, dragged) => {
      const at = positionOf(dragged.id);
      if (!at) return;
      setNodes((current) =>
        current.map((node) =>
          node.id === dragged.id ? { ...node, position: at } : node,
        ),
      );
    },
    [setNodes],
  );

  return (
    <div
      ref={(el) => {
        containerRef.current = el;
        boxRef(el);
      }}
      /* `bg-canvas` 是画布自己的底色（与项目画布同一 token）—— 面板底色
       *  （`bg-panel-deep`）与画布底色深浅不同，画布但凡没铺到容器底边，那条
       *  缝就会以「下方一块空白却不是画布」的形式被看见（ISSUE #596）。 */
      className={`border-border-subtle bg-canvas relative h-full min-h-115 w-full overflow-hidden rounded-xl border ${fitted ? "" : "invisible"}`}
      data-testid="wflib-canvas"
      /* 首帧是否已按三列内容定好缩放（视图不可见期间为 false）。测试按它断言
       *  「画布不会带着未 fit 的视口显形」。 */
      data-fitted={fitted ? "true" : "false"}
    >
      <LibraryNodeContentContext.Provider value={flow.nodeContent}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={NODE_TYPES}
          defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
          onConnect={flow.onConnect}
          onConnectEnd={flow.onConnectEnd}
          isValidConnection={flow.isValidConnection}
          /* 点空白 = 取消选中（与「点一条线选中它对应的口」互补）。 */
          onPaneClick={() => {
            onSelectParam(null);
            onSelectOutput(null);
            setSelectedEdgeIds(new Set());
          }}
          /* 库里三个节点全是卡片与表单：裁剪省不下什么，却要接一份 error#008
           *  过滤（见文件头说明）—— 直接关掉。 */
          onlyRenderVisibleElements={false}
          minZoom={0.2}
          maxZoom={2}
          panOnDrag
          zoomOnScroll
          /* 首帧定向 fitView 由 `onInit` 发起（只按三列内容节点，见 `handleInit`）；
           *  这里**不开** `fitView` prop —— 它按全部节点（含背景板）缩放，与定向
           *  fitView 是两次口径不同的缩放，第一帧的错缩放就是这么来的。 */
          onInit={handleInit}
          onMoveStart={markFitted}
          proOptions={{ hideAttribution: true }}
          /* 节点**可拖**（React Flow 用它给 `.react-flow__node` 打开命中与指针事件
           *  —— 关掉它，卡片列与宿主卡片整块变成 `pointer-events: none`，表单输入、
           *  圆点、按钮全部点不动，Playwright / RTL 也会直接报「元素不可交互」）。
           *  `nodeDragThreshold` 把误拖阈值调到 6px：从输入框上按下再抬手的抖动
           *  不会被当成拖动。
           *
           *  三列是固定布局，拖散了看不出「哪一列是哪一列」—— 所以用「拖完吸附回
           *  布局位置」兜住（见 onNodeDragStop）：手势在、位置不回退。
           *
           *  节点**不可选中 / 不可删**：三列卡片是固定的布局列，选中会在卡片上挂蓝
           *  框、按 Delete 还可能误删整列；连线的选中 / 删除只针对 edge（边在
           *  `buildInputEdge` / `buildOutputEdge` 里按 `canWire` 单独开
           *  `selectable` / `deletable`）。 */
          nodesDraggable
          nodeDragThreshold={6}
          onNodeDragStop={resetNodePositions}
          nodesConnectable={canWire}
          /* 点一条线选中它（驱动高亮 + Delete 删除）；按 Delete / Backspace 删除
           *  选中线时经 `onEdgesDelete` 落到数据源断开那一条（只读时边不可删）。
           *  节点不在 `elementsSelectable` 范围里——它们各自 `selectable:false`，
           *  这里只负责让边可点选。 */
          onEdgeClick={handleEdgeClick}
          onEdgesDelete={handleEdgesDelete}
          deleteKeyCode={["Backspace", "Delete"]}
          className="wflib-canvas-flow"
          data-testid="wflib-canvas-flow"
        >
          {/* 网格背景与编辑器画布同一套（色相同一个 token，α 现取）——
              此前这里写的是 `var(--color-canvas-grid-line, rgba(148,163,184,0.14))`，
              而那颗 token 从未定义过：永远走兜底，读代码的人会以为它随主题，实际不随。 */}
          <Background
            variant={BackgroundVariant.Lines}
            gap={20}
            size={1}
            color={gridLineColor(LIBRARY_GRID_LINE_ALPHA)}
          />
        </ReactFlow>
      </LibraryNodeContentContext.Provider>
      {/* 落点失败的原因：贴在画布左下角，4 秒后自己消失（不只读，可直接重试）。
          上一版由自绘连线层给出，换 React Flow 后由 `onConnectEnd` 补回来 ——
          「拖了没反应」不许是静默的。 */}
      {flow.dropHint && (
        // p71-allow:start workshop 域 amber 装饰色 · 拖线未落定的临时提示、非状态色（对齐 §3.6.1 与「amber 是 workshop 域专有」）
        <div
          className="z-canvas-ui pointer-events-none absolute bottom-2 left-2 max-w-105 rounded-lg bg-amber-100 px-2.5 py-1.5 text-[11px] text-amber-800 shadow-sm"
          data-testid="wflib-wire-drop-hint"
        >
          没有连上：{flow.dropHint}
        </div>
        // p71-allow:end
      )}
      {/* 点选一条线后出现的删除条：只断那一条线（而不是卡片头 ↺ 整张清）。
       * 与 Delete / Backspace 删除同一路径（都落到 `disconnect`）。只读时
       * 边不可选、不显示此条。 */}
      {canWire && selectedEdgeIds.size > 0 && (
        <div
          className="border-primary-500/40 bg-primary-500/15 text-primary-strong z-canvas-ui absolute bottom-2 left-2 flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[11px] shadow-sm backdrop-blur-sm"
          data-testid="wflib-edge-delete-hint"
        >
          <span>已选中 {selectedEdgeIds.size} 条线</span>
          <Button
            type="button"
            size="xs"
            onClick={handleDeleteSelected}
            data-testid="wflib-delete-edge"
          >
            删除选中线
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={() => setSelectedEdgeIds(new Set())}
            className="text-primary-strong hover:bg-primary-500/20"
            aria-label="取消选中"
          >
            ×
          </Button>
        </div>
      )}
    </div>
  );
}
