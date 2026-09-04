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
} from "@/lib/project-canvas/canvas-types";
import {
  makeFitViewScheduler,
  makeNodeId,
} from "@/lib/project-canvas/canvas-helpers";
import {
  createDraftProject, // new: lands on a canvas w/o polluting the index until first real change
  hydrateFromServer,
  listProjects,
  getProject,
  reapAllEmptyDrafts,
  setActive,
  getActiveId,
  type CanvasProject,
} from "@/lib/project-canvas/canvas-store";
import { useProjectPersistence } from "./project-canvas/hooks/use-project-persistence";
import { useProjectManager } from "./project-canvas/hooks/use-project-manager";
import { useCanvasConnections } from "./project-canvas/hooks/use-canvas-connections";
import { useCanvasDrop } from "./project-canvas/hooks/use-canvas-drop";
import { ModalDialog } from "./ui/ModalDialog";
import { useToast } from "./ToastProvider";
import { useMiniMapJump } from "./shared/useMiniMapJump";
import { FpsMeter } from "./FpsMeter";
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

/* 2026-08-25: MiniMap 颜色表 hoisted to a module-level Map so the
 * `nodeColor` callback can stay referentially stable — MiniMap only re-runs
 * it while painting and never re-renders because of a fresh callback
 * identity during drags / state churn. */
const MINIMAP_COLOR_BY_KIND = new Map(
  (Object.keys(NODE_META) as NodeKind[]).map((k) => [k, NODE_META[k].color]),
);

interface ProjectCanvasProps {
  seedNew?: boolean;
  onConsumeSeed?: () => void;
  /** When set (from the Workspace "workflow library → 使用" action) the canvas
   *  drops a `kind="workflow"` node for this workflow onto the open project. */
  pendingWorkflow?: { id: string; name: string; taskType: string } | null;
  onConsumePending?: () => void;
}

/* ── Inner canvas (must be inside ReactFlowProvider) ── */
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
  /* Confirmation dialogs (R65: replaced window.confirm with custom dialog) */
  const [confirmClear, setConfirmClear] = useState(false);
  /* Canvas panel system: 素材库 / 历史记录 slide-out panels */
  const [activePanel, setActivePanel] = useState<CanvasPanelType>(null);
  /* R-ardot119 (2026-08-18): top-right settings drawer (调试模式). The
   * workflow editor already has its own drawer for grid/ruler/zoom; the
   * project canvas only needs the debug toggle so the user can flip it
   * without first drill-in'ing. State is shared with the workflow
   * editor via useDebugMode (same localStorage key). */
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false);
  const rf = useReactFlow();
  const { screenToFlowPosition, fitView } = rf;
  /* R-ardot106 (2026-08-17): MiniMap → main-viewport single-click jump.
   *  Pairs with <MiniMap pannable zoomable onClick={onMiniMapJump} /> below. */
  const onMiniMapJump = useMiniMapJump(rf);

  /* refs holding the latest values for event handlers / flush */
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
  // True until the initial project has been hydrated from storage.
  // Prevents the empty-canvas hint from flashing while content loads.
  const [hydrating, setHydrating] = useState(true);
  /* ── 拆分（2026-08-26）：持久化三件套 → useProjectPersistence；
   *  项目 CRUD + 下拉 UI 状态 → useProjectManager；CanvasInner 只留编排与 JSX。
   *  T12-3（2026-08-29）：连线分派 → useCanvasConnections；媒体落地 →
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
      fitView(...fitViewArgs).catch(() => { /* noop */ });
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

  /* 连线分派 / 媒体拖拽落地（T12-3 抽离，行为与之前完全一致）。 */
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

  /* 双 rAF fitView：等 ReactFlow 完成本轮布局后再 fit，
   * 替代 setTimeout(80ms) 魔法数字（慢机器上可能布局未完成）。 */
  const requestFitView = useMemo(
    () =>
      makeFitViewScheduler((...fitViewArgs: Parameters<typeof fitView>) => {
        fitView(...fitViewArgs).catch(() => { /* noop */ });
      }),
    [fitView],
  );

  /* ── Load (or create) the active project on mount ──
   *
   *  Draft-aware: when the user clicks "新建项目" we DO NOT immediately
   *  persist an empty row to the project index.  Instead, `seedNew`
   *  allocates a fresh id via `createDraftProject`, which only writes the
   *  active-id.  The project row only enters the index the moment the
   *  user produces real content (auto-persist effect below), or via the
   *  manual upsert in `commitRename` / `newProject`.
   *
   *  Before mounting, we sweep any legacy empty-default rows left over
   *  from earlier sessions so the recent-projects list stays clean. */
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    void (async () => {
      // Reconcile server-side projects into localStorage BEFORE we read the
      // active project, so a port-switch (3000↔3002) / device never loses
      // canvas data that was persisted to the DB.
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

      /* 2026-08-30: 从工作流库「使用」跳转回来时，pendingWorkflow 在挂载时就
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
    })().catch(() => { /* noop */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Stable identity → colour lookup for the MiniMap.  Depends on nothing
   * (kind colours are static), so MiniMap never re-renders due to a fresh
   * callback reference while nodes are dragged. */
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

  /** Drops a pure-visual Ardot-style workflow node at the right-click position.
   *  No data, no handlers — just renders the design reference component.
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

  /** Actual clearCanvas action — invoked from the ModalDialog confirm. */
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

  /* ── Project switcher actions（已抽入 useProjectManager：openProjMenu /
   *  switchProject / newProject / deleteCurrent / applyDeleteCurrent /
   *  loadProject / startRename / commitRename）── */

  const onNodeClick: NodeMouseHandler = useCallback(() => setMenu(null), []);

  return (
    <div
      className="relative h-full w-full bg-(--color-canvas)"
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
        /* 2026-08-25: commercial-grade perf — only mount nodes/edges that
         *  intersect the viewport (same treatment as the workflow canvas).
         *  Project graphs with many workflow/material nodes previously
         *  mounted the ENTIRE graph DOM every frame; viewport culling keeps
         *  DOM proportional to what's visible so drag/pan/zoom costs stay a
         *  small constant. */
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
          /* 2026-08-25: lazy edge interactivity — untouched edges stay
           *  inert (no delete/reconnect plumbing); onEdgeClick activates
           *  them on first use. */
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
        <Background
          variant={BackgroundVariant.Dots}
          gap={22}
          size={1}
          color="rgba(255,255,255,0.08)"
        />
        <Controls
          style={{
            background: "#0D0818",
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        />
        <MiniMap
          pannable
          zoomable
          ariaLabel="小地图：拖动或点击切换主画布焦点"
          nodeColor={miniMapNodeColor}
          maskColor="rgba(5,5,7,0.78)"
          onClick={onMiniMapJump}
          style={{
            background: "#0B0712",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 8,
            width: 200,
            height: 140,
          }}
        />
      </ReactFlow>

      {/* 2026-08-29：帧率指示器（右上角，与工作流画布一致）——节点多了之后
       *  拖拽会掉帧，有个实时读数就能区分「卡」和「死」。 */}
      <FpsMeter className="right-3 top-3" />

      {/* Project switcher (top-left) */}
      <div className="absolute top-3 left-3 z-20">
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

      {/* Floating toolbar (center) */}
      <CanvasToolbar
        onFitView={() => fitView({ padding: 0.2, duration: 400 })}
        onExport={exportJson}
        onClear={clearCanvas}
      />

      {/* R-ardot119: project-canvas settings (top-right gear). Opens a
       *  right-edge drawer with the 调试模式 toggle. State is shared
       *  with the workflow editor via useDebugMode. */}
      <ProjectSettingsButton onClick={() => setProjectSettingsOpen(true)} />
      {projectSettingsOpen && (
        <ProjectSettingsDrawer onClose={() => setProjectSettingsOpen(false)} />
      )}

      {/* 项目画布也需要挂载执行日志入口：面板内部靠 useActiveTaskId()
       *  自动跟随全工作区正在跑 / 刚跑完的任务。缺了这处挂载，在项目画布
       *  里打开「日志面板」开关会毫无反应。 */}
      <GlobalStepLogPanel />

      {/* Empty hints — 加载中 / 右键引导（仅当项目确实无内容且已加载完成时展示） */}
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

      {/* ── R65: replace window.confirm with custom dark-themed dialogs ── */}
      <ModalDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="删除此项目？"
        description={`项目「${projectName}」将被永久删除，连同画布上的所有节点和连线。\n\n此操作不可撤销。`}
        confirmLabel="删除"
        cancelLabel="取消"
        danger
        onConfirm={applyDeleteCurrent}
      />
      <ModalDialog
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        title="清空当前画布？"
        description="画布上的所有节点和连线将被移除，但项目本身会保留。"
        confirmLabel="清空"
        cancelLabel="取消"
        danger
        onConfirm={applyClearCanvas}
      />

      {/* ── Canvas panel system: toolbar + slide-out panels ── */}
      {activePanel ? (
        /* 面板打开时：工具栏紧贴面板左侧，同一 flex 容器内 */
        <div className="absolute inset-y-0 left-0 z-20 flex">
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
