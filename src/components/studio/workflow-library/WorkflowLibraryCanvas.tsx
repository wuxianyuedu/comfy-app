"use client";

/* 工作流库「画布节点」预览的 **React Flow 画布**（ISSUE #529）。
 *
 * 三列各一个节点（对外参数卡片列 / 宿主运行卡片 / 对外输出参数卡片列），连线是
 * 真正的 edge、端点是真正的 <Handle>：
 *   · 视口（拖动平移 / 滚轮缩放 / 适应）由 React Flow 承担 —— 自绘的
 *     `WorkflowCanvasViewportFrame` 与量 rect 的 SVG 连线层一并退场；
 *   · 「这一行收不收这个口子」是 `isValidConnection` 一个纯函数（与自动落点
 *     同一份判据 `pinAcceptsEntry`），不再由手势层各写一套；
 *   · 拖线没落上时的原因提示由 `onConnectEnd` 补回来（不许功能回退）。
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
  type Node,
  type OnNodeDrag,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import type { WorkflowIOMap } from "~/components/studio/shared/workflow-io";
import type { ParamEntry } from "~/lib/workflow-param-mapping";
import type {
  LibraryOutputCards,
  LibraryParamCards,
} from "./workflow-library-param-cards";
import {
  buildLibraryNodes,
  LAYOUT_SIZING,
  useLibraryWireFlow,
} from "./hooks/use-library-wire-flow";
import { libraryBackdropSize } from "./workflow-library-wire-graph";
import {
  LibraryBackdropNode,
  LibraryHostNode,
  LibraryNodeContentContext,
  LibraryOutputsNode,
  LibraryParamsNode,
} from "./WorkflowLibraryCanvasNodes";

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

/** 边的渲染参数：线本身要能点选（选中后按 ⌫ 断开）。 */
const DEFAULT_EDGE_OPTIONS = {
  type: "default",
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
function useCanvasBackdropSize(
  containerRef: React.RefObject<HTMLDivElement | null>,
): { width: number; height: number } {
  const [viewport, setViewport] = useState(() => ({
    width:
      LAYOUT_SIZING.paramsWidth +
      LAYOUT_SIZING.hostWidth +
      LAYOUT_SIZING.outputsWidth,
    height: LAYOUT_SIZING.fillHeight,
  }));

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const sync = () => {
      const rect = element.getBoundingClientRect();
      setViewport((prev) =>
        prev.width === rect.width && prev.height === rect.height
          ? prev
          : { width: rect.width, height: rect.height },
      );
    };
    sync();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(sync);
    observer.observe(element);
    return () => observer.disconnect();
  }, [containerRef]);

  return useMemo(
    () => libraryBackdropSize(LAYOUT_SIZING, viewport),
    [viewport],
  );
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
  host,
}: WorkflowLibraryCanvasProps) {
  /* 画布容器：量它才知道「铺满」要铺到哪儿（ISSUE #596）。 */
  const containerRef = useRef<HTMLDivElement>(null);
  const backdropSize = useCanvasBackdropSize(containerRef);
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
  });

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
      ref={containerRef}
      /* `bg-canvas` 是画布自己的底色（与项目画布同一 token）—— 面板底色
       *  （`bg-panel-deep`）与画布底色深浅不同，画布但凡没铺到容器底边，那条
       *  缝就会以「下方一块空白却不是画布」的形式被看见（ISSUE #596）。 */
      className="border-border-subtle bg-canvas relative h-full min-h-[460px] w-full overflow-hidden rounded-xl border"
      data-testid="wflib-canvas"
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
          }}
          /* 库里三个节点全是卡片与表单：裁剪省不下什么，却要接一份 error#008
           *  过滤（见文件头说明）—— 直接关掉。 */
          onlyRenderVisibleElements={false}
          minZoom={0.2}
          maxZoom={2}
          panOnDrag
          zoomOnScroll
          /* 站点默认 `fitView` 会把三列收进视野；用户随后可自由平移缩放。 */
          fitView
          fitViewOptions={{ padding: 0.12 }}
          proOptions={{ hideAttribution: true }}
          /* 节点**可拖**（React Flow 用它给 `.react-flow__node` 打开命中与指针事件
           *  —— 关掉它，卡片列与宿主卡片整块变成 `pointer-events: none`，表单输入、
           *  圆点、按钮全部点不动，Playwright / RTL 也会直接报「元素不可交互」）。
           *  `nodeDragThreshold` 把误拖阈值调到 6px：从输入框上按下再抬手的抖动
           *  不会被当成拖动。
           *
           *  三列是固定布局，拖散了看不出「哪一列是哪一列」—— 所以用「拖完吸附回
           *  布局位置」兜住（见 onNodeDragStop）：手势在、位置不回退。 */
          nodesDraggable
          nodeDragThreshold={6}
          onNodeDragStop={resetNodePositions}
          nodesConnectable={canWire}
          elementsSelectable={false}
          data-testid="wflib-canvas-flow"
        >
          {/* 网格背景与编辑器画布同一套（浅色细格），只给「这是一块画布」的观感 ——
            不做尺寸表与标尺，库里不需要。 */}
          <Background
            variant={BackgroundVariant.Lines}
            gap={20}
            size={1}
            color="var(--color-canvas-grid-line, rgba(148,163,184,0.14))"
          />
        </ReactFlow>
      </LibraryNodeContentContext.Provider>
      {/* 落点失败的原因：贴在画布左下角，4 秒后自己消失（不只读，可直接重试）。
          上一版由自绘连线层给出，换 React Flow 后由 `onConnectEnd` 补回来 ——
          「拖了没反应」不许是静默的。 */}
      {flow.dropHint && (
        <div
          className="pointer-events-none absolute bottom-2 left-2 z-20 max-w-[420px] rounded-lg bg-amber-100 px-2.5 py-1.5 text-[11px] text-amber-800 shadow-sm"
          data-testid="wflib-wire-drop-hint"
        >
          没有连上：{flow.dropHint}
        </div>
      )}
    </div>
  );
}
