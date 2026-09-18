"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Edge,
  type Node as FlowNode,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { CanvasNode } from "./project-canvas/CanvasNode";
import { WorkflowNodeArdot } from "./project-canvas/WorkflowNodeArdot";
import {
  type CanvasNodeData,
  type CanvasNodeType,
  NODE_META,
  defaultData,
  type NodeKind,
} from "~/lib/project-canvas/canvas-types";
import {
  makeFitViewScheduler,
  makeNodeId,
} from "~/lib/project-canvas/canvas-helpers";
import {
  createDraftProject, // new: lands on a canvas w/o polluting the index until first real change
  hydrateFromServer,
  listProjects,
  getProject,
  reapAllEmptyDrafts,
  setActive,
  getActiveId,
  type CanvasProject,
} from "~/lib/project-canvas/canvas-store";
import { useProjectPersistence } from "./project-canvas/hooks/use-project-persistence";
import { useProjectManager } from "./project-canvas/hooks/use-project-manager";
import { useCanvasConnections } from "./project-canvas/hooks/use-canvas-connections";
import { useCanvasDrop } from "./project-canvas/hooks/use-canvas-drop";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { useToast } from "./ToastProvider";
import { useMiniMapJump } from "./useMiniMapJump";
import {
  CanvasPanelToolbar,
  type CanvasPanelType,
} from "./project-canvas/CanvasPanelToolbar";
import { MaterialLibraryPanel } from "./project-canvas/MaterialLibraryPanel";
import { HistoryPanel } from "./project-canvas/HistoryPanel";
import {
  ProjectSettingsButton,
  ProjectSettingsDrawer,
} from "./ProjectCanvasSettings";
import { GlobalStepLogPanel } from "./project-canvas/GlobalStepLogPanel";
import { CanvasContextMenu } from "./project-canvas/CanvasContextMenu";
import { ProjectSwitcher } from "./project-canvas/ProjectSwitcher";
import { useRelatedEdgesHighlight } from "./canvas/hooks/use-related-edges-highlight";
import { ProjectEdge } from "./project-canvas/ProjectEdge";
import { CanvasToolbar } from "./project-canvas/CanvasToolbar";
import { EmptyCanvasHint } from "./project-canvas/EmptyCanvasHint";

/* nodeTypes 注册：
 *  - canvasNode       ：原有逻辑节点（kind=image/video/script/agent/workflow/...）
 *  - workflowArdot    ：纯视觉测试节点（无运行时，对齐 Ardot 稿 714503087315759），
 *                       由右键菜单的「测试自定义工作流」项创建
 */
const nodeTypes = {
  canvasNode: CanvasNode,
  workflowArdot: WorkflowNodeArdot,
} as const;

/* 边渲染注册表：`default` 承接 `defaultEdgeOptions.type = "smoothstep"` 落到
 * 本画布的全部连线（React Flow 对未注册的类型走内置渲染，注册后交给组件，
 * 组件内部仍用 getSmoothStepPath 画出同一条曲线，只额外叠加选中态样式）。 */
const edgeTypes = { default: ProjectEdge } as const;

/* MiniMap 颜色表提到模块级 Map —— 好让 `nodeColor` 回调保持引用稳定：
 * MiniMap 只在绘制时调用它，不会因为拖拽 / 状态抖动期间回调换了引用
 * 而重新渲染。 */
const MINIMAP_COLOR_BY_KIND = new Map(
  (Object.keys(NODE_META) as NodeKind[]).map((k) => [k, NODE_META[k].color]),
);

interface ProjectCanvasProps {
  seedNew?: boolean;
  onConsumeSeed?: () => void;
  /** 设置后（来自工作区「工作流库 → 使用」动作）画布会为这条工作流
   *  往当前打开的项目里放一个 `kind="workflow"` 节点。 */
  pendingWorkflow?: { id: string; name: string; taskType: string } | null;
  onConsumePending?: () => void;
}

/* ── 内层画布（必须在 ReactFlowProvider 里） ── */
function CanvasInner({
  seedNew,
  onConsumeSeed,
  pendingWorkflow,
  onConsumePending,
}: ProjectCanvasProps) {
  const toast = useToast();
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNodeType>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState("未命名");
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
  /* MiniMap → 主视口单击跳转。
   *  与下面 <MiniMap pannable zoomable onClick={onMiniMapJump} /> 配对。 */
  const onMiniMapJump = useMiniMapJump(rf);

  /* 保存事件处理器 / flush 用的最新值的 ref */
  const edgesRef = useRef(edges);
  const nodesRef = useRef(nodes);
  const projectIdRef = useRef(projectId);
  const projectNameRef = useRef(projectName);
  const loadedRef = useRef(false);
  useEffect(() => {
    edgesRef.current = edges;
    nodesRef.current = nodes;
    projectIdRef.current = projectId;
    projectNameRef.current = projectName;
  }, [edges, nodes, projectId, projectName]);
  // 初始项目从存储水合完成前一直是 true。
  // 避免内容加载时闪一下「空画布」提示。
  const [hydrating, setHydrating] = useState(true);
  /* ── 拆分：持久化三件套 → useProjectPersistence；
   *  项目 CRUD + 下拉 UI 状态 → useProjectManager；CanvasInner 只留编排与 JSX。
   *  连线分派 → useCanvasConnections；媒体落地 →
   *  useCanvasDrop；右键菜单 / 项目切换器 / 工具栏 / 空状态 → 独立组件。 */
  const { persistNow } = useProjectPersistence({
    projectId,
    nodes,
    edges,
    projectName,
    loaded: !hydrating,
  });
  const projectManager = useProjectManager({
    getCurrent: () => ({
      pid: projectIdRef.current,
      name: projectNameRef.current,
      nodes: nodesRef.current,
      edges: edgesRef.current,
    }),
    persistNow,
    setProjectId,
    setProjectName,
    setNodes,
    setEdges,
    fitView: (...fitViewArgs: Parameters<typeof fitView>) => {
      fitView(...fitViewArgs).catch(() => {
        /* noop */
      });
    },
    toast,
  });
  const {
    projects,
    projMenu,
    renaming,
    renameVal,
    confirmDelete,
    setProjMenu,
    setRenaming,
    setRenameVal,
    setConfirmDelete,
    openProjMenu,
    switchProject,
    newProject,
    deleteCurrent,
    applyDeleteCurrent,
    startRename,
    commitRename,
  } = projectManager;

  /* 连线分派 / 媒体拖拽落地（抽离，行为与之前完全一致）。 */
  const { onConnect, onEdgeClick } = useCanvasConnections({
    nodesRef,
    edgesRef,
    setNodes,
    setEdges,
  });
  const { placeMediaNode, onCanvasDragOver, onCanvasDrop } = useCanvasDrop({
    screenToFlowPosition,
    setNodes,
  });

  /* 选中节点 → 相关连线高亮：把「上下游」标记写回 edges，由画布的
   * `smoothstep` 边渲染层加成不同样式。 */
  useRelatedEdgesHighlight(setEdges, {
    /* 节点表的 setter 声明的是 CanvasNodeType[]，而这里只改节点 data 上的端口
     *  关注字段（结构上仍是同一批节点）—— 收窄成 Node[] 会挡在类型门口。 */
    setNodes: setNodes as unknown as (
      updater: (nodes: FlowNode[]) => FlowNode[],
    ) => void,
  });

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

  /* ── 挂载时加载（或新建）当前项目 ──
   *
   *  草稿感知：用户点「新建项目」时我们**不**立刻往项目索引
   *  里落一行空记录。而是由 `seedNew` 经 `createDraftProject`
   *  分配新 id，只写 active-id。项目行只有在用户
   *  产出真实内容那一刻（下面的自动落盘 effect），或经
   *  `commitRename` / `newProject` 里的手动 upsert，才进索引。
   *
   *  挂载前先清掉历史会话遗留的「空默认」行，
   *  免得最近项目列表一直脏着。 */
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    void (async () => {
      // 在读取当前项目**之前**先把服务端项目对账进 localStorage，
      // 这样换端口（3100↔3102）/ 换设备都不会丢掉
      // 已落库的画布数据。
      await hydrateFromServer();
      reapAllEmptyDrafts(); // one-shot cleanup of pre-fix pollution
      let proj: CanvasProject | null = null;
      if (seedNew) {
        proj = createDraftProject();
      } else {
        const activeId = getActiveId();
        if (activeId) proj = getProject(activeId);
        proj ??= listProjects()[0] ?? null;
        proj ??= createDraftProject();
      }
      setProjectId(proj.id);
      setProjectName(proj.name);

      /* 从工作流库「使用」跳转回来时，pendingWorkflow 在挂载时就
       * 已传入。project 加载 effect 会覆盖 nodes，因此必须在这里把新节点合并进
       * baseNodes，否则原来的独立 effect 临时放置的节点会被 setNodes(baseNodes)
       * 覆盖掉，导致用户只看到已有节点被聚焦。 */
      const baseNodes = proj.nodes ?? [];
      let nextNodes = baseNodes;
      if (pendingWorkflow) {
        const center = screenToFlowPosition({
          x: window.innerWidth / 2,
          y: window.innerHeight / 2,
        });
        const node: CanvasNodeType = {
          id: makeNodeId(),
          type: "canvasNode",
          position: center,
          data: {
            ...defaultData("workflow"),
            workflowId: pendingWorkflow.id,
            workflowName: pendingWorkflow.name,
            workflowTaskType: pendingWorkflow.taskType,
          },
        };
        nextNodes = [...baseNodes, node];
        onConsumePending?.();
      }
      setNodes(nextNodes);

      setEdges(proj.edges ?? []);
      setActive(proj.id);
      // fit after nodes are applied（双 rAF，等 ReactFlow 完成布局）
      requestFitView();
      setHydrating(false);
      onConsumeSeed?.();
    })().catch(() => {
      /* noop */
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* MiniMap 用的「稳定身份 → 颜色」查表。不依赖任何东西
   *（类别色是静态的），所以拖节点时 MiniMap 不会因为回调
   * 换了引用而重新渲染。 */
  const miniMapNodeColor = useCallback((node: { data?: unknown }) => {
    const kind = (node.data as CanvasNodeData | undefined)?.kind;
    return (kind ? MINIMAP_COLOR_BY_KIND.get(kind) : undefined) ?? "#6B7280";
  }, []);

  const onPaneContextMenu = useCallback((e: React.MouseEvent | MouseEvent) => {
    e.preventDefault();
    setMenu({ x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY });
  }, []);

  const createNode = useCallback(
    (kind: NodeKind) => {
      if (!menu) return;
      const position = screenToFlowPosition({ x: menu.x, y: menu.y });
      const node: CanvasNodeType = {
        id: makeNodeId(),
        type: "canvasNode",
        position,
        data: defaultData(kind),
      };
      setNodes((nds) => [...nds, node]);
      setMenu(null);
    },
    [menu, screenToFlowPosition, setNodes],
  );

  /** 在右键位置放一个纯视觉的 Ardot 风工作流节点。
   *  无数据、无处理器 —— 只渲染设计参考组件。
   *  `workflowArdot` 已收进 CanvasNodeType 联合类型，无需强转。 */
  const createTestWorkflowNode = useCallback(() => {
    if (!menu) return;
    const position = screenToFlowPosition({ x: menu.x, y: menu.y });
    const node: CanvasNodeType = {
      id: makeNodeId(),
      type: "workflowArdot",
      position,
      data: {},
    };
    setNodes((nds) => [...nds, node]);
    setMenu(null);
  }, [menu, screenToFlowPosition, setNodes]);

  const clearCanvas = useCallback(() => {
    if (nodes.length === 0 && edges.length === 0) {
      toast.info("画布已是空的", undefined);
      return;
    }
    setConfirmClear(true);
  }, [nodes.length, edges.length, toast]);

  /** 真正的 clearCanvas 动作 —— 由 ConfirmDialog 的确认按钮调用。 */
  const applyClearCanvas = useCallback(() => {
    setNodes([]);
    setEdges([]);
    setConfirmClear(false);
  }, [setNodes, setEdges]);

  const exportJson = useCallback(() => {
    const blob = new Blob([JSON.stringify({ nodes, edges }, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${projectName || "comfy-canvas"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [nodes, edges, projectName]);

  /* ── 项目切换动作（已抽入 useProjectManager；含 switchProject、
   *  newProject、deleteCurrent、applyDeleteCurrent、loadProject、
   *  startRename、commitRename 等动作）。 ── */

  const onNodeClick: NodeMouseHandler = useCallback(() => setMenu(null), []);

  return (
    <div
      className="bg-canvas relative h-full w-full"
      onDragOver={onCanvasDragOver}
      onDrop={onCanvasDrop}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onPaneContextMenu={onPaneContextMenu}
        onPaneClick={() => setMenu(null)}
        onNodeClick={onNodeClick}
        onEdgeClick={onEdgeClick}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        /* 商业级性能 —— 只挂载与视口
         *  相交的节点 / 边（与工作流画布同一处理）。
         *  此前含大量工作流 / 素材节点的项目图每帧都把
         *  **整张图**的 DOM 挂上；视口裁剪让
         *  DOM 与可见内容成正比，拖拽 / 平移 / 缩放的开销因此保持
         *  一个小常数。 */
        onlyRenderVisibleElements
        fitView
        minZoom={0.2}
        maxZoom={2}
        /* 选中节点后按 Backspace / Delete 删除（⌫ 工具栏按钮走 deleteSelf）。
         * React Flow 会自动忽略输入框 / textarea 聚焦时的按键，不会误删。 */
        deleteKeyCode={["Backspace", "Delete"]}
        defaultEdgeOptions={{
          type: "smoothstep",
          animated: true,
          /* 惰性边交互 —— 未碰过的边保持
           *  惰性（不接删除 / 重连管线）；onEdgeClick 在首次使用时
           *  激活它们。 */
          deletable: false,
          reconnectable: false,
          style: { stroke: "url(#canvas-edge-gradient)", strokeWidth: 2.5 },
        }}
        proOptions={{ hideAttribution: true }}
      >
        {/* 渐变描边定义（粉彩 6 色 → 端口/连线渐变） */}
        <svg style={{ position: "absolute", width: 0, height: 0 }} aria-hidden>
          <defs>
            <linearGradient
              id="canvas-edge-gradient"
              x1="0%"
              y1="0%"
              x2="100%"
              y2="0%"
            >
              <stop offset="0%" stopColor="#B584FF" />
              <stop offset="35%" stopColor="#5BC6FF" />
              <stop offset="70%" stopColor="#5BE3C4" />
              <stop offset="100%" stopColor="#FFD571" />
            </linearGradient>
          </defs>
        </svg>
        {/* 点阵底纹的颜色必须随主题 —— 写死 rgba(255,255,255,0.08) 时
            Light 下是「白点压白底」，网格整片消失。 */}
        <Background
          variant={BackgroundVariant.Dots}
          gap={22}
          size={1}
          color="var(--color-canvas-grid-dot)"
        />
        {/* Controls / MiniMap 的配色由 globals.css 的 `.react-flow__controls*`
            / `.react-flow__minimap*` token 规则统一负责（工作流画布与项目
            画布共用），组件侧不再叠加写死的暗色覆盖 —— 此前这里写死
            `#0D0818` / `#0B0712`，Light 下两条浮层仍是黑块。 */}
        <Controls />
        <MiniMap
          pannable
          zoomable
          ariaLabel="小地图：拖动或点击切换主画布焦点"
          nodeColor={miniMapNodeColor}
          maskColor="var(--color-canvas-minimap-mask)"
          onClick={onMiniMapJump}
          style={{
            width: 200,
            height: 140,
          }}
        />
      </ReactFlow>

      {/* 项目切换器（左上角） */}
      <div className="z-canvas-ui absolute top-3 left-3">
        <ProjectSwitcher
          projectName={projectName}
          projectId={projectId}
          projects={projects}
          menuOpen={projMenu}
          renaming={renaming}
          renameVal={renameVal}
          onToggleMenu={openProjMenu}
          onCloseMenu={() => setProjMenu(false)}
          onSwitch={switchProject}
          onNew={newProject}
          onStartRename={startRename}
          onRenameValChange={setRenameVal}
          onCommitRename={commitRename}
          onCancelRename={() => setRenaming(false)}
          onDelete={deleteCurrent}
        />
      </div>

      {/* 浮动工具栏（居中） */}
      <CanvasToolbar
        onFitView={() => fitView({ padding: 0.2, duration: 400 })}
        onExport={exportJson}
        onClear={clearCanvas}
      />

      {/* 项目画布设置（右上角齿轮）。从右边缘滑出抽屉，内含
       *  「调试模式」开关。状态经 useDebugMode 与
       *  工作流编辑器共享。 */}
      <ProjectSettingsButton onClick={() => setProjectSettingsOpen(true)} />
      {projectSettingsOpen && (
        <ProjectSettingsDrawer onClose={() => setProjectSettingsOpen(false)} />
      )}

      {/* 项目画布也需要挂载执行日志入口：面板内部靠 useActiveTaskId()
       *  自动跟随全工作区正在跑 / 刚跑完的任务。缺了这处挂载，在项目画布
       *  里打开「日志面板」开关会毫无反应。 */}
      <GlobalStepLogPanel />

      {/* 空态提示 —— 加载中 / 右键引导（仅当项目确实无内容且已加载完成时展示） */}
      {hydrating && nodes.length === 0 && <EmptyCanvasHint loading />}
      {nodes.length === 0 && !hydrating && <EmptyCanvasHint loading={false} />}

      {menu && (
        <CanvasContextMenu
          x={menu.x}
          y={menu.y}
          onPick={createNode}
          onPickTest={createTestWorkflowNode}
          onClose={() => setMenu(null)}
        />
      )}

      {/* ── 用自定义深色弹窗替换 window.confirm ── */}
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="删除此项目？"
        description={`项目「${projectName}」将被永久删除，连同画布上的所有节点和连线。\n\n此操作不可撤销。`}
        confirmLabel="删除"
        cancelLabel="取消"
        danger
        onConfirm={applyDeleteCurrent}
      />
      <ConfirmDialog
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        title="清空当前画布？"
        description="画布上的所有节点和连线将被移除，但项目本身会保留。"
        confirmLabel="清空"
        cancelLabel="取消"
        danger
        onConfirm={applyClearCanvas}
      />

      {/* ── 画布面板系统：工具栏 + 滑出面板 ── */}
      {activePanel ? (
        /* 面板打开时：工具栏紧贴面板左侧，同一 flex 容器内 */
        <div className="z-canvas-ui absolute inset-y-0 left-0 flex">
          <CanvasPanelToolbar
            active={activePanel}
            onSelect={setActivePanel}
            floating={false}
          />
          {activePanel === "materials" && (
            <MaterialLibraryPanel
              projectId={projectId}
              onClose={() => setActivePanel(null)}
              onUse={(item) =>
                placeMediaNode({
                  url: item.url,
                  displayName: item.name,
                  mediaType: item.kind,
                })
              }
            />
          )}
          {activePanel === "history" && (
            <HistoryPanel
              projectId={projectId}
              onClose={() => setActivePanel(null)}
              onUse={(template) =>
                placeMediaNode({
                  url: template.cover,
                  displayName:
                    template.cover.split("/").pop() ?? template.id.slice(0, 12),
                  mediaType: template.mediaType,
                })
              }
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
