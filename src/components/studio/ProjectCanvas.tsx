"use client";

import { useCallback, useMemo, useState, type SetStateAction } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  useStore,
  useReactFlow,
  type Edge,
  type Node as FlowNode,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { downloadJson } from "~/lib/browser-io";
import { isPlainRecord } from "~/lib/is-record";
import { lastSegments } from "~/lib/path-display";
import { CanvasNode } from "./project-canvas/CanvasNode";
import { WorkflowNodeArdot } from "./project-canvas/WorkflowNodeArdot";
import {
  type CanvasNodeType,
  isCanvasNodeType,
  NODE_META,
  type NodeKind,
} from "~/lib/project-canvas/canvas-types";
import { makeFitViewScheduler } from "~/lib/project-canvas/canvas-helpers";
import type { ProductionProgress } from "~/lib/production/progress";
import { CanvasProgressIndicator } from "./project-canvas/CanvasProgressIndicator";
import { useCanvasMenu } from "./project-canvas/hooks/use-canvas-menu";
import { useCanvasHydration } from "./project-canvas/hooks/use-canvas-hydration";
import { useProjectPersistence } from "./project-canvas/hooks/use-project-persistence";
import { useCanvasConnections } from "./project-canvas/hooks/use-canvas-connections";
import { useCanvasDrop } from "./project-canvas/hooks/use-canvas-drop";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { useToast } from "./ToastProvider";
import { useMiniMapJump } from "./useMiniMapJump";
import { CanvasPanelToolbar, type CanvasPanelType } from "./project-canvas/CanvasPanelToolbar";
import { MaterialLibraryPanel } from "./project-canvas/MaterialLibraryPanel";
import { HistoryPanel } from "./project-canvas/HistoryPanel";
import { ProjectSettingsButton, ProjectSettingsDrawer } from "./ProjectCanvasSettings";
import { GlobalStepLogPanel } from "./project-canvas/GlobalStepLogPanel";
import { CanvasContextMenu } from "./project-canvas/CanvasContextMenu";
import { useRelatedEdgesHighlight } from "./canvas/hooks/use-related-edges-highlight";
import { ProjectEdge } from "./project-canvas/ProjectEdge";
import { CanvasToolbar } from "./project-canvas/CanvasToolbar";
import { EmptyCanvasHint } from "./project-canvas/EmptyCanvasHint";

/* nodeTypes 注册：
 *  - canvasNode       ：原有逻辑节点（kind=image/video/script/agent/workflow/...）
 *  - workflowArdot    ：纯视觉测试节点（无运行时，对齐 Ardot 稿 714503087315759），
 *                       由右键菜单的「测试自定义工作流」项创建
 */
/* SAFETY: 类型断言已复核 */
const nodeTypes = {
  canvasNode: CanvasNode,
  workflowArdot: WorkflowNodeArdot,
} as const;

/* 边渲染注册表：`default` 承接 `defaultEdgeOptions.type = "smoothstep"` 落到
 * 本画布的全部连线（React Flow 对未注册的类型走内置渲染，注册后交给组件，
 * 组件内部仍用 getSmoothStepPath 画出同一条曲线，只额外叠加选中态样式）。 */
/* SAFETY: 类型断言已复核 */
const edgeTypes = {
  default: ProjectEdge,
} as const;

/** 节点类别白名单：`NODE_META` 的键即全部合法档位。 */
function isNodeKind(value: unknown): value is NodeKind {
  return typeof value === "string" && Object.hasOwn(NODE_META, value);
}

/* MiniMap 颜色表提到模块级 Map —— 好让 `nodeColor` 回调保持引用稳定：
 * MiniMap 只在绘制时调用它，不会因为拖拽 / 状态抖动期间回调换了引用
 * 而重新渲染。 */
const MINIMAP_COLOR_BY_KIND = new Map(
  Object.keys(NODE_META)
    .filter(isNodeKind)
    .map((k) => [k, NODE_META[k].color]),
);

/* 默认连线选项与 proOptions 提到模块级常量 —— 内联对象字面量每次渲染都重建，
 * 会让 ReactFlow 的 props 浅比较恒失效、把整棵画布子树拖进 reconcile（规范 §2.11）。
 * animated:false：此前本画布给**每一条边**永久开 CSS dash 动画，130+ 边的图即便
 * 不操作也在逐帧 paint（DevTools Paint flashing 可见满屏闪烁），与工作流编辑器
 * 画布（同为 animated:false）口径统一。type/stroke 维持原值，不改渲染形状。 */
const DEFAULT_EDGE_OPTIONS = {
  type: "smoothstep",
  animated: false,
  deletable: false,
  reconnectable: false,
  style: { stroke: "url(#canvas-edge-gradient)", strokeWidth: 2.5 },
};

const PRO_OPTIONS = { hideAttribution: true };

/* 非受控画布（#4541）的挂载初值：`defaultNodes` / `defaultEdges` 必须**在场**
 * （空数组也算）—— React Flow 的 `rf.setNodes` / `rf.setEdges` 只在
 * `hasDefaultNodes` / `hasDefaultEdges` 为真时才写 store，否则把更新丢进
 * 队列后只回调受控模式的 `onNodesChange`（本画布没有）⇒ 水合与建节点的
 * 写入全部落空。模块级常量保持引用稳定。 */
const INITIAL_NODES: Array<FlowNode> = [];
const INITIAL_EDGES: Array<Edge> = [];

type ProjectCanvasProps = {
  onConsumePending?: () => void;
  onConsumeSeed?: () => void;
  /** 设置后（来自工作区「工作流库 → 使用」动作）画布会为这条工作流
   *  往当前打开的项目里放一个 `kind="workflow"` 节点。 */
  pendingWorkflow?: { id: string; name: string; taskType: string } | null;
  seedNew?: boolean;
};

/* ── 内层画布（必须在 ReactFlowProvider 里） ── */
function CanvasInner({
  seedNew,
  onConsumeSeed,
  pendingWorkflow,
  onConsumePending,
}: ProjectCanvasProps) {
  const toast = useToast();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState("未命名");
  /* 统一生产模型的完成状态（与工坊共读 production 行的 progress 一份，Phase 4b / §7）。 */
  const [progress, setProgress] = useState<ProductionProgress | null>(null);
  /* 确认对话框（用自定义弹窗替换了 window.confirm） */
  const [confirmClear, setConfirmClear] = useState(false);
  /* Canvas panel system: 素材库 / 历史记录 slide-out panels */
  const [activePanel, setActivePanel] = useState<CanvasPanelType>(null);
  /* 右上角设置抽屉（调试模式）。工作流编辑器已经自带
   * 网格 / 标尺 / 缩放的抽屉；项目画布只需要这一个调试开关，
   * 免得用户还得先钻进去才能切。状态经 useDebugMode 与工作流
   * 编辑器共享（同一个 localStorage key）。 */
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false);
  const rf = useReactFlow();
  const { screenToFlowPosition, fitView } = rf;
  /* ── 非受控画布（#4541，同 #4536 的编辑器画布）── 节点 / 连线状态住 React Flow
   *  自身 store：拖拽的逐帧位置更新只发生在 store 里（按节点订阅，仅被拖节点
   *  重渲染），不再经 setState 把整棵宿主树（工具栏 / 面板 / ReactFlow）逐帧
   *  重渲染。各 hook 的写回走下面两个适配器（入参形状与原 setState 一致：
   *  值或 updater）；响应式读数（空态提示）用 useStore 选择器，回读用
   *  rf.getNodes() / rf.getEdges()。 */
  const setCanvasNodes = useCallback(
    (value: SetStateAction<Array<CanvasNodeType>>) => {
      /* 类型守卫收回画布节点类型（禁新增字面断言）：本画布只创建 canvasNode /
       * workflowArdot 两种节点，守卫在实践中是恒等过滤。 */
      const current = rf.getNodes().filter(isCanvasNodeType);
      rf.setNodes(typeof value === "function" ? value(current) : value);
    },
    [rf],
  );
  const setEdges = useCallback(
    (value: SetStateAction<Array<Edge>>) => {
      const current = rf.getEdges();
      rf.setEdges(typeof value === "function" ? value(current) : value);
    },
    [rf],
  );
  /* 回调里读「最新节点 / 连线」的活引用：直接透传 React Flow store 的当前值，
   * 不再镜像 React state（非受控后没有 state 可镜像）。getter 只读 ——
   * 消费方（连线串联）只读不写。 */
  const nodesRef = useMemo(
    () => ({
      get current() {
        return rf.getNodes().filter(isCanvasNodeType);
      },
    }),
    [rf],
  );
  const edgesRef = useMemo(
    () => ({
      get current() {
        return rf.getEdges();
      },
    }),
    [rf],
  );
  /* 空态提示的响应式读数：只在「空 ↔ 非空」翻转时重渲染。 */
  const canvasEmpty = useStore((state) => state.nodes.length === 0);
  /* MiniMap → 主视口单击跳转。
   *  与下面 <MiniMap pannable zoomable onClick={onMiniMapJump} /> 配对。 */
  const onMiniMapJump = useMiniMapJump(rf);

  /* 双 rAF fitView：等 ReactFlow 完成本轮布局后再 fit，
   * 替代 setTimeout(80ms) 魔法数字（慢机器上可能布局未完成）。 */
  const requestFitView = useMemo(
    () =>
      makeFitViewScheduler((...fitViewArgs: Parameters<typeof fitView>) => {
        fitView(...fitViewArgs).catch(() => {
          /* noop */
        });
      }),
    [fitView],
  );

  // 初始项目从存储水合完成前一直是 true。
  // 避免内容加载时闪一下「空画布」提示。
  /* 挂载水合抽到 use-canvas-hydration（#4235）：编排 + 失败收口 + 卸载守卫在那边
   * 一处内聚，这里只留接线。 */
  const hydrating = useCanvasHydration({
    onConsumePending,
    onConsumeSeed,
    pendingWorkflow,
    requestFitView,
    screenToFlowPosition,
    seedNew,
    setEdges,
    setNodes: setCanvasNodes,
    setProgress,
    setProjectId,
    setProjectName,
  });

  /* ── 持久化三件套 → useProjectPersistence（CanvasInner 只留编排与 JSX）。
   *  连线分派 → useCanvasConnections；媒体落地 → useCanvasDrop；右键菜单 /
   *  工具栏 / 空状态 → 独立组件。
   *  Phase 2b：画布不再有自建项目管理（切换 / 新建 / 重命名 / 删除统一在首页），
   *  故 useProjectManager 与项目切换器一并移除，这里只保留自动持久化。
   *  非受控画布（#4541）起，持久化 hook 自己订阅 React Flow store。 ── */
  useProjectPersistence({
    projectId,
    projectName,
    loaded: !hydrating,
  });

  /* 连线分派 / 媒体拖拽落地（抽离，行为与之前完全一致）。 */
  const { onConnect, onEdgeClick } = useCanvasConnections({
    nodesRef,
    edgesRef,
    setNodes: setCanvasNodes,
    setEdges,
  });
  const { placeMediaNode, onCanvasDragOver, onCanvasDrop } = useCanvasDrop({
    screenToFlowPosition,
    setNodes: setCanvasNodes,
  });

  /* 选中节点 → 相关连线高亮：把「上下游」标记写回 edges，由画布的
   * `smoothstep` 边渲染层加成不同样式。 */
  useRelatedEdgesHighlight(setEdges, {
    /* 写回器只声明 Node（不绑 data 形状），本画布的表恒为 CanvasNodeType ——
     *  回写结果经守卫收回画布节点类型，写入内容不变。 */
    setNodes: (updater) => {
      setCanvasNodes((nodes) => updater(nodes).filter(isCanvasNodeType));
    },
  });

  /* MiniMap 用的「稳定身份 → 颜色」查表。不依赖任何东西
   *（类别色是静态的），所以拖节点时 MiniMap 不会因为回调
   * 换了引用而重新渲染。 */
  const miniMapNodeColor = useCallback((node: { data?: unknown }) => {
    const data = node.data;
    if (!isPlainRecord(data)) {
      return "#6B7280";
    }
    const kind = data.kind;
    if (!isNodeKind(kind)) {
      return "#6B7280";
    }
    return MINIMAP_COLOR_BY_KIND.get(kind) ?? "#6B7280";
  }, []);

  /* 右键菜单 + 落子的一簇回调（抽到 useCanvasMenu，CanvasInner 只留编排，§12.13）。 */
  const { onPaneContextMenu, createNode, createTestWorkflowNode, onNodeClick } = useCanvasMenu({
    menu,
    setMenu,
    setNodes: setCanvasNodes,
    screenToFlowPosition,
  });

  const clearCanvas = useCallback(() => {
    if (rf.getNodes().length === 0 && rf.getEdges().length === 0) {
      toast.info("画布已是空的", undefined);
      return;
    }
    setConfirmClear(true);
  }, [rf, toast]);

  /** 真正的 clearCanvas 动作 —— 由 ConfirmDialog 的确认按钮调用。 */
  const applyClearCanvas = useCallback(() => {
    rf.setNodes([]);
    rf.setEdges([]);
    setConfirmClear(false);
  }, [rf]);

  const exportJson = useCallback(() => {
    downloadJson(
      { nodes: rf.getNodes(), edges: rf.getEdges() },
      `${projectName || "comfy-canvas"}.json`,
    );
  }, [rf, projectName]);

  return (
    <div
      className="bg-canvas relative h-full w-full"
      onDragOver={onCanvasDragOver}
      onDrop={onCanvasDrop}
    >
      <ReactFlow
        defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
        defaultEdges={INITIAL_EDGES}
        defaultNodes={INITIAL_NODES}
        /* 选中节点后按 Backspace / Delete 删除（⌫ 工具栏按钮走 deleteSelf）。
         * React Flow 会自动忽略输入框 / textarea 聚焦时的按键，不会误删。 */
        deleteKeyCode={["Backspace", "Delete"]}
        edgeTypes={edgeTypes}
        fitView
        maxZoom={2}
        minZoom={0.2}
        nodeTypes={nodeTypes}
        onConnect={onConnect}
        onEdgeClick={onEdgeClick}
        /* 商业级性能 —— 只挂载与视口相交的节点 / 边（与工作流画布同一处理）：此前含大量工作流 / 素材节点的项目图
         *  每帧都把**整张图**的 DOM 挂上；视口裁剪让 DOM 与可见内容成正比，拖拽 / 平移 / 缩放的开销保持一个小常数。 */
        onlyRenderVisibleElements
        onNodeClick={onNodeClick}
        onPaneClick={() => {
          setMenu(null);
        }}
        onPaneContextMenu={onPaneContextMenu}
        /* 惰性边交互 —— 未碰过的边保持
         *  惰性（不接删除 / 重连管线）；onEdgeClick 在首次使用时
         *  激活它们。 */
        proOptions={PRO_OPTIONS}
      >
        {/* 渐变描边定义（粉彩 6 色 → 端口/连线渐变） */}
        <svg aria-hidden style={{ position: "absolute", width: 0, height: 0 }}>
          <defs>
            <linearGradient id="canvas-edge-gradient" x1="0%" x2="100%" y1="0%" y2="0%">
              {/* 四档色相取自 `--color-edge-flow-*`（与工作流编辑器同一套
                  连线渐变观感，规范 03 §3.6.1 的类型色例外）。 */}
              <stop offset="0%" stopColor="var(--color-edge-flow-1)" />
              <stop offset="35%" stopColor="var(--color-edge-flow-2)" />
              <stop offset="70%" stopColor="var(--color-edge-flow-3)" />
              <stop offset="100%" stopColor="var(--color-edge-flow-4)" />
            </linearGradient>
          </defs>
        </svg>
        {/* 点阵底纹的颜色必须随主题 —— 写死 rgba(255,255,255,0.08) 时
            Light 下是「白点压白底」，网格整片消失。 */}
        <Background
          color="var(--color-canvas-grid-dot)"
          gap={22}
          size={1}
          variant={BackgroundVariant.Dots}
        />
        {/* Controls / MiniMap 的配色由 globals.css 的 `.react-flow__controls*`
            / `.react-flow__minimap*` token 规则统一负责（工作流画布与项目
            画布共用），组件侧不再叠加写死的暗色覆盖 —— 此前这里写死
            `#0D0818` / `#0B0712`，Light 下两条浮层仍是黑块。 */}
        <Controls />
        <MiniMap
          ariaLabel="小地图：拖动或点击切换主画布焦点"
          maskColor="var(--color-canvas-minimap-mask)"
          nodeColor={miniMapNodeColor}
          onClick={onMiniMapJump}
          pannable
          style={{
            width: 200,
            height: 140,
          }}
          zoomable
        />
      </ReactFlow>

      {/* 浮动工具栏（居中） */}
      <CanvasToolbar
        onClear={clearCanvas}
        onExport={exportJson}
        onFitView={() => fitView({ padding: 0.2, duration: 400 })}
      />

      {/* 生产进度（与工坊共读 production 行的 progress 一份，Phase 4b / §7）——
          仅当该项目已有生产数据时展示；定位与 pointer-events 收在指示器内部。 */}
      {progress && <CanvasProgressIndicator progress={progress} />}

      {/* 项目画布设置（右上角齿轮）。从右边缘滑出抽屉，内含
       *  「调试模式」开关。状态经 useDebugMode 与
       *  工作流编辑器共享。 */}
      <ProjectSettingsButton
        onClick={() => {
          setProjectSettingsOpen(true);
        }}
      />
      {projectSettingsOpen && (
        <ProjectSettingsDrawer
          onClose={() => {
            setProjectSettingsOpen(false);
          }}
        />
      )}

      {/* 项目画布也需要挂载执行日志入口：面板内部靠 useActiveTaskId()
       *  自动跟随全工作区正在跑 / 刚跑完的任务。缺了这处挂载，在项目画布
       *  里打开「日志面板」开关会毫无反应。 */}
      <GlobalStepLogPanel />

      {/* 空态提示 —— 加载中 / 右键引导（仅当项目确实无内容且已加载完成时展示） */}
      {hydrating && canvasEmpty && <EmptyCanvasHint loading />}
      {canvasEmpty && !hydrating && <EmptyCanvasHint loading={false} />}

      {menu && (
        <CanvasContextMenu
          onClose={() => {
            setMenu(null);
          }}
          onPick={createNode}
          onPickTest={createTestWorkflowNode}
          x={menu.x}
          y={menu.y}
        />
      )}

      {/* ── 用自定义深色弹窗替换 window.confirm ── */}
      <ConfirmDialog
        cancelLabel="取消"
        confirmLabel="清空"
        danger
        description="画布上的所有节点和连线将被移除，但项目本身会保留。"
        onClose={() => {
          setConfirmClear(false);
        }}
        onConfirm={applyClearCanvas}
        open={confirmClear}
        title="清空当前画布？"
      />

      {/* ── 画布面板系统：工具栏 + 滑出面板 ── */}
      {activePanel ? (
        /* 面板打开时：工具栏紧贴面板左侧，同一 flex 容器内 */
        <div className="z-canvas-ui absolute inset-y-0 left-0 flex">
          <CanvasPanelToolbar active={activePanel} floating={false} onSelect={setActivePanel} />
          {activePanel === "materials" && (
            <MaterialLibraryPanel
              onClose={() => {
                setActivePanel(null);
              }}
              onUse={(item) =>
                placeMediaNode({
                  url: item.url,
                  displayName: item.name,
                  mediaType: item.kind,
                })
              }
              projectId={projectId}
            />
          )}
          {activePanel === "history" && (
            <HistoryPanel
              onClose={() => {
                setActivePanel(null);
              }}
              onUse={(template) =>
                placeMediaNode({
                  url: template.cover,
                  displayName: lastSegments(template.cover, 1) || template.id.slice(0, 12),
                  mediaType: template.mediaType,
                })
              }
              projectId={projectId}
            />
          )}
        </div>
      ) : (
        /* 面板关闭时：工具栏独立浮动在画布左侧 */
        <CanvasPanelToolbar active={null} onSelect={setActivePanel} />
      )}
    </div>
  );
}

/* ── Public component ── */
export function ProjectCanvas(props: ProjectCanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
