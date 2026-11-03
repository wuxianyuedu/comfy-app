/* 画布置于相对定位容器内，该容器同时承载子图加载遮罩 / IO 编辑提示 / IO 预览
 *  面板（这些留在父层，以便通过 z-index 叠在画布之上）。
 *  `fitView` 有意不在此设置 —— 初始视口由父层在 useEffect 中驱动，以强制
 *  最小缩放 0.35。 */
"use client";

import React, { useCallback } from "react";
import {
  ReactFlow,
  Controls,
  MiniMap,
  useStoreApi,
  type Connection,
  type Node,
  type Edge,
  type OnNodesChange,
  type OnEdgesChange,
} from "@xyflow/react";
import { CanvasGrid, ZoomIndicator, CanvasRulers } from "../WorkflowCanvasDecorations";
import { CanvasSettingsButton } from "../canvas/CanvasSettingsButton";
import { CanvasRecenterButton } from "../canvas/CanvasRecenterButton";
import { isCustomCanvasSettings } from "../canvas/hooks/use-canvas-settings";
import type { CanvasSettings } from "../canvas/canvas-settings-types";
import { PORT_ROLES } from "../canvas/WorkflowNode";
import type { WorkflowNodeData } from "../workflow-types";
import { workflowNodeTypes, workflowEdgeTypes } from "./WorkflowEditorNodes";
import { useRelatedEdgesHighlight } from "../canvas/hooks/use-related-edges-highlight";

/** React Flow 的 error#008 文本前缀（见 @xyflow/system 的 errorMessages）。 */
const EDGE_HANDLE_ERROR = "Couldn't create edge for";

/** 过滤「视口裁剪」造成的 error#008 假告警，保留真正找不到 handle 的告警。
 *  ISSUE #374：`onlyRenderVisibleElements` 下节点按各自视口求交裁剪、边按两端并集
 *  包围盒求交；长边被判「可见」而两端节点均未挂载、`handleBounds` 为空，
 *  `getEdgePosition` 返回 null 并打 error#008 —— 裁剪的固有副作用，滚过去即好。
 *  判据是**两端节点是否已挂载**：都挂载仍报错 = 真 bug（id 不同名），否则 = 噪声。 */
export function isEdgeHandleCullingNoise(args: {
  message: string;
  /** 已挂载（进入 handleBounds 测量）的节点 id 集合。 */
  mountedNodeIds: ReadonlySet<string>;
  /** 该边引用的两端节点 id；节点不存在/已删除时传 null。 */
  sourceId: string | null;
  targetId: string | null;
}): boolean {
  const { message, mountedNodeIds, sourceId, targetId } = args;
  if (!message.startsWith(EDGE_HANDLE_ERROR)) {
    return false;
  }
  /* 端点信息缺失（边引用的节点已被删）→ 交给 React Flow 自己处理。 */
  if (sourceId === null || sourceId === "" || targetId === null || targetId === "") {
    return false;
  }
  /* 两端都挂载还报错 ⇒ 是真的找不到 handle，必须暴露。 */
  return !mountedNodeIds.has(sourceId) || !mountedNodeIds.has(targetId);
}

/* 角色 key → minimap 颜色。提到模块级 Map，好让 MiniMap
 *  的 `nodeColor` 回调保持引用稳定（useCallback 空
 *  deps）：MiniMap 只在绘制时调用它，不会因为回调换了
 *  引用而重新渲染。 */
const ROLE_COLOR_BY_KEY = new Map(PORT_ROLES.map((r) => [r.key, r.color]));

/* 默认连线选项（模块级常量，避免每次渲染重建对象 —— 见规范 §6.1）。
 * `deletable` / `reconnectable` 默认 false：React Flow 默认 true 会给每条边提前
 * 挂交互管线，130+ 节点图里即便绝大多数边从未被碰也是每帧开销；首次点击边
 * （父层 onEdgeClick）才翻成可交互，普通边保持惰性、把预算留给拖拽/平移/缩放。
 * stroke 用 `--color-edge-default` token（紫，与端口/类别色系一致），不写死 rgba。 */
const DEFAULT_EDGE_OPTIONS = {
  type: "default",
  animated: false,
  deletable: false,
  reconnectable: false,
  style: {
    stroke: "var(--color-edge-default)",
    strokeWidth: 2.5,
  },
};

export type WorkflowEditorCanvasProps = {
  canvasSettings: CanvasSettings;
  canvasSettingsHydrated: boolean;
  edges: Array<Edge>;
  /** 连线合法性闸门：无模式 / 落点不是宿主节点端口一律拒绝。 */
  isValidConnection?: (connection: Connection | Edge) => boolean;
  nodes: Array<Node>;
  /** 画布上新增一条连线（对外参数卡片 → 宿主节点端口）。 */
  onConnect?: (connection: Connection) => void;
  /** 惰性激活被点击边的 deletable/reconnectable（见
   *  下面的 defaultEdgeOptions）。 */
  onEdgeClick?: (event: React.MouseEvent, edge: Edge) => void;
  onEdgesChange: OnEdgesChange;
  /** 删除连线（映射线 = 该对外参数在当前模式下断开）。 */
  onEdgesDelete?: (edges: Array<Edge>) => void;
  onMiniMapJump: (event: React.MouseEvent, position: { x: number; y: number }) => void;
  onNodeDragStop: (e: unknown, node: Node) => void;
  onNodesChange: OnNodesChange;
  onOpenSettings: () => void;
  /** 「重新居中」：把视口移回有节点的位置（纯视口动作，不改节点布局）。 */
  onRecenter: () => void;
  /** 写回连线表：选中节点后由本画布把「相关连线」标记写进 edges（见 hook 注释）。 */
  setEdges: (updater: (edges: Array<Edge>) => Array<Edge>) => void;
  /** 写回节点表：同一帧里把「相关端口行」标记写进节点 data（见 hook 注释）。 */
  setNodes: (updater: (nodes: Array<Node>) => Array<Node>) => void;
};

export function WorkflowEditorCanvas({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  onNodeDragStop,
  canvasSettings,
  canvasSettingsHydrated,
  onMiniMapJump,
  onOpenSettings,
  onRecenter,
  onEdgeClick,
  onConnect,
  isValidConnection,
  onEdgesDelete,
  setEdges,
  setNodes,
}: WorkflowEditorCanvasProps) {
  /* MiniMap 用的「稳定身份 → 颜色」查表。不依赖任何东西
   *（角色色是静态的），所以拖节点时 MiniMap 不会因为回调
   * 换了引用而重新渲染。 */
  const miniMapNodeColor = useCallback((node: Node) => {
    /* SAFETY: 类型断言已复核 */
    const d = node.data as WorkflowNodeData | undefined;
    const role = d?.assignedRole;
    return (
      (role !== null && role !== undefined && role !== ""
        ? ROLE_COLOR_BY_KEY.get(role)
        : undefined) ?? "var(--color-ink-faint)"
    );
  }, []);

  /* 选中节点 → 相关连线高亮（上下游加粗）。标记写在 edges 的 data 上，
   *  由 <WorkflowEdge> 统一加样式；这里只负责在选中变化时重算。 */
  useRelatedEdgesHighlight(setEdges, { setNodes });

  /* ── error#008 假告警过滤器（ISSUE #374）──
   *  「已挂载」取 React Flow 内部事实源：`nodeLookup[id].internals.handleBounds`，
   *  它只在节点 DOM 真正挂载并被测量后才有值。用 `useStoreApi` 在回调里按需读，
   *  不订阅整张表，避免拖拽期间频繁重渲染。 */
  const store = useStoreApi();
  const handleError = useCallback(
    (id: string, message: string) => {
      if (!message.startsWith(EDGE_HANDLE_ERROR)) {
        console.warn(`[React Flow] ${message}`);
        return;
      }
      const { nodeLookup, edgeLookup } = store.getState();
      const edge = edgeLookup.get(id);
      const mounted = new Set<string>();
      nodeLookup.forEach((internal, nodeId) => {
        if (internal.internals.handleBounds) {
          mounted.add(nodeId);
        }
      });
      if (
        isEdgeHandleCullingNoise({
          message,
          mountedNodeIds: mounted,
          sourceId: edge?.source ?? null,
          targetId: edge?.target ?? null,
        })
      ) {
        return;
      }
      console.warn(`[React Flow] ${message}`);
    },
    [store],
  );

  return (
    <ReactFlow
      defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
      edges={edges}
      edgeTypes={workflowEdgeTypes}
      isValidConnection={isValidConnection}
      maxZoom={canvasSettingsHydrated ? canvasSettings.maxZoom : 2}
      /* 这里**故意不设** `fitView`：初始视口由下面的 useEffect 自己驱动，才能强制
       *  最小缩放 0.35。没有这个下限，DaSiWa Wan 2.2 模板（130 节点，包围盒约
       *  7000px 宽）会 fitView 到约 0.15x，每个备注都读不清。padding 0.3 与紧凑
       *  的 0.10 + 0.35 下限见上面的 useEffect。 */
      minZoom={canvasSettingsHydrated ? canvasSettings.minZoom : 0.15}
      nodes={nodes}
      nodeTypes={workflowNodeTypes}
      onConnect={onConnect}
      onEdgeClick={onEdgeClick}
      onEdgesChange={onEdgesChange}
      onEdgesDelete={onEdgesDelete}
      /* 过滤视口裁剪造成的 error#008 假告警（ISSUE #374）—— 见 handleError。 */
      onError={handleError}
      /* 商业级性能 —— 只挂载与视口相交的节点 / 边。DaSiWa Wan 2.2 模板有 130 个
       *  节点、包围盒约 7000px；此前整张图与每条轨道 IO 端口全挂上，浏览器每帧都
       *  绘制屏幕外 DOM。裁剪后 DOM 与可见内容成正比，拖拽/平移/缩放降为小常数。
       *  初始 fitToContent 仍由父级驱动（最小缩放 0.35）：裁剪用各节点首次绘制后
       *  的实测尺寸，故初始 fit 不受影响。 */
      onlyRenderVisibleElements
      onNodeDragStop={onNodeDragStop}
      onNodesChange={onNodesChange}
      proOptions={{ hideAttribution: true }}
    >
      {/* 网格底纹 —— 20px 小格，每 10 格一条更重的线。
       *  见上面的 <CanvasGrid>。 */}
      <CanvasGrid settings={canvasSettings} />
      {/* 四条边上的坐标标尺 —— 显示每条可见主线对应的世界
       *  坐标 X / Y。见 <CanvasRulers>。 */}
      <CanvasRulers settings={canvasSettings} />
      <ZoomIndicator
        maxZoom={canvasSettingsHydrated ? canvasSettings.maxZoom : 2}
        minZoom={canvasSettingsHydrated ? canvasSettings.minZoom : 0.15}
      />
      {/* 齿轮按钮打开右侧画布设置面板
       *  （网格透明度、标尺开关等）。它与缩放指示器
       *  错开竖向位置，免得两者争同一个槽位；
       *  用户把任何一项从默认值改掉时，
       *  会亮起一颗紫色圆点。 */}
      <CanvasSettingsButton
        hasOverrides={canvasSettingsHydrated && isCustomCanvasSettings(canvasSettings)}
        onClick={onOpenSettings}
      />
      <CanvasRecenterButton onClick={onRecenter} />
      {/* Controls / MiniMap 的配色由 globals.css 的 `.react-flow__controls*`
          / `.react-flow__minimap*` token 规则统一负责（画布与项目画布共用），
          组件侧不再叠加写死的暗色覆盖类。 */}
      <Controls showInteractive={false} />
      {canvasSettings.showMiniMap && (
        <MiniMap
          ariaLabel="小地图：拖动或点击切换主画布焦点"
          /* maskColor 是「小地图里非视口区域」的遮罩：必须跟随主题。
             写死 rgba(0,0,0,0.78) 时 Light 下整张缩略图被压成一块黑，
             与浅色画布割裂。改为引用 token——浅色用浅遮罩、深色保持近黑。 */
          maskColor="var(--color-canvas-minimap-mask)"
          nodeColor={miniMapNodeColor}
          onClick={onMiniMapJump}
          pannable
          zoomable
        />
      )}
    </ReactFlow>
  );
}
