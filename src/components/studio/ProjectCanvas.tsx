/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-floating-promises, @typescript-eslint/no-misused-promises, react-hooks/refs */
"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  useReactFlow,
  type Edge,
  type Connection,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { CanvasNode } from "./project-canvas/CanvasNode";
import { WorkflowNodeArdot } from "./project-canvas/WorkflowNodeArdot";
import {
  type CanvasNodeData,
  type CanvasNodeType,
  isCanvasNode,
  NODE_META,
  defaultData,
  type NodeKind,
} from "./project-canvas/canvas-types";
import {
  applyPropagationToNodes,
  importOutputAsInput,
  makeFitViewScheduler,
  makeNodeId,
} from "./project-canvas/canvas-helpers";
import {
  createDraftProject, // new: lands on a canvas w/o polluting the index until first real change
  hydrateFromServer,
  listProjects,
  getProject,
  reapAllEmptyDrafts,
  setActive,
  getActiveId,
  type CanvasProject,
} from "./project-canvas/canvas-store";
import { useProjectPersistence } from "./project-canvas/use-project-persistence";
import { useProjectManager } from "./project-canvas/use-project-manager";
import { ModalDialog } from "./ModalDialog";
import { useToast } from "./toast-provider";
import { useMiniMapJump } from "./shared/useMiniMapJump";
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
  (Object.keys(NODE_META) as NodeKind[]).map((k) => [k, NODE_META[k].color])
);

interface ProjectCanvasProps {
  seedNew?: boolean;
  onConsumeSeed?: () => void;
  /** When set (from the Workspace "workflow library → 使用" action) the canvas
   *  drops a `kind="workflow"` node for this workflow onto the open project. */
  pendingWorkflow?: { id: string; name: string; taskType: string } | null;
  onConsumePending?: () => void;
}

/* ── Right-click context menu ── */
function ContextMenu({
  x,
  y,
  onPick,
  onPickTest,
  onClose,
}: {
  x: number;
  y: number;
  onPick: (kind: NodeKind) => void;
  /** Spawn a pure-visual Ardot-style test node (no runtime). */
  onPickTest: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        onContextMenu={(event) => {
          event.preventDefault();
          onClose();
        }}
      />
      <div
        className="fixed z-50 w-52 overflow-hidden rounded-xl border border-white/[0.1] bg-[#14121f]/95 p-1.5 shadow-2xl shadow-black/60 backdrop-blur"
        style={{ left: x, top: y }}
      >
        {/* ── 测试节点（纯视觉，对齐 Ardot 稿）── */}
        <button
          type="button"
          data-canvas-node-kind="workflow-ardot"
          onClick={onPickTest}
          className="flex w-full items-center gap-2 rounded-lg border border-violet-400/30 bg-gradient-to-r from-[var(--color-primary)]/15 to-[var(--color-accent)]/10 px-2 py-1.5 text-left text-[12px] text-gray-200 transition-colors hover:from-[var(--color-primary)]/25 hover:to-[var(--color-accent)]/15"
        >
          <span
            className="flex h-5 w-5 items-center justify-center rounded-md text-[10px] font-bold text-white"
            style={{ background: "linear-gradient(135deg, #7C5CFC 0%, #FF5CA8 100%)" }}
          >
            W
          </span>
          <span className="flex flex-col">
            <span className="font-medium">测试自定义工作流</span>
            <span className="text-[10px] text-gray-500">纯视觉 · 对齐 Ardot 稿（无运行时）</span>
          </span>
        </button>

        <div className="my-1 h-px bg-white/[0.06]" />
        <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-gray-500">创建节点</div>
        {(Object.keys(NODE_META) as NodeKind[]).map((kind) => {
          const meta = NODE_META[kind];
          return (
            <button
              key={kind}
              type="button"
              data-canvas-node-kind={kind}
              onClick={() => onPick(kind)}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] text-gray-200 transition-colors hover:bg-white/[0.06]"
            >
              <Icon name={meta.icon} size={15} className="text-violet-300" />
              <span className="flex flex-col">
                <span className="font-medium">{meta.label}</span>
                <span className="text-[10px] text-gray-500">{meta.desc}</span>
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

/* ── Inner canvas (must be inside ReactFlowProvider) ── */
function CanvasInner({ seedNew, onConsumeSeed, pendingWorkflow, onConsumePending }: ProjectCanvasProps) {
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
  edgesRef.current = edges;
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;
  const projectNameRef = useRef(projectName);
  projectNameRef.current = projectName;
  const loadedRef = useRef(false);
  // True until the initial project has been hydrated from storage.
  // Prevents the empty-canvas hint from flashing while content loads.
  const [hydrating, setHydrating] = useState(true);
  // Tracks which pending workflow we've already dropped, so navigating to the
  // canvas / re-rendering doesn't place the same node twice.
  const placedPendingRef = useRef<string | null>(null);

  /* ── 拆分（2026-08-26）：持久化三件套 → useProjectPersistence；
   *  项目 CRUD + 下拉 UI 状态 → useProjectManager；CanvasInner 只留编排与 JSX。 */
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
    fitView,
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

  /* 双 rAF fitView：等 ReactFlow 完成本轮布局后再 fit，
   * 替代 setTimeout(80ms) 魔法数字（慢机器上可能布局未完成）。 */
  const requestFitView = useMemo(
    () => makeFitViewScheduler(fitView),
    [fitView]
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
    (async () => {
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
      setNodes((proj.nodes) ?? []);
      setEdges(proj.edges ?? []);
      setActive(proj.id);
      // fit after nodes are applied（双 rAF，等 ReactFlow 完成布局）
      requestFitView();
      setHydrating(false);
      onConsumeSeed?.();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Drop a workflow node when one is handed in from the Workspace library ──
   *  (the "使用" action on a workflow card).  Placed at the current viewport
   *  center; the user can then pick parameters / run it on the canvas. */
  useEffect(() => {
    if (!pendingWorkflow) return;
    if (placedPendingRef.current === pendingWorkflow.id) return;
    placedPendingRef.current = pendingWorkflow.id;

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
    setNodes((nds) => [...nds, node]);
    requestFitView();
    onConsumePending?.();
  }, [pendingWorkflow, screenToFlowPosition, setNodes, onConsumePending, requestFitView]);

  /* ── Connection chaining (routes by which port/handle is connected) ── */
  const propagateFrom = useCallback(
    async (sourceId: string, resultPathOverride?: string, edgesOverride?: Edge[]) => {
      const srcNode = nodesRef.current.find((current) => current.id === sourceId);
      if (!srcNode || !isCanvasNode(srcNode)) return;
      const src = srcNode.data;
      const rPath = resultPathOverride ?? src.resultPath;
      const rType = src.resultMediaType;
      const es = edgesOverride ?? edgesRef.current;
      const outEdges = es.filter((edge) => edge.source === sourceId);
      if (outEdges.length === 0) return;

      // Only import the generated image if at least one downstream port needs it.
      // A workflow target also needs the imported file when a wire input is an
      // IMAGE-type pin (the import happens once and is reused below).
      const needsImage = outEdges.some((outEdge) =>
{
        const t = nodesRef.current.find((current) => current.id === outEdge.target);
        return !outEdge.targetHandle || outEdge.targetHandle === "inputImage" || t?.data?.kind === "workflow";
      });
      let importedFile: string | null = null;
      if (needsImage && rPath && rType !== "video") {
        try {
          importedFile = await importOutputAsInput(rPath);
        } catch {
          importedFile = null;
        }
      }

      // targetHandle 分派与数据写入抽到 canvas-helpers（纯函数，可独立测试）。
      setNodes((nds) =>
        applyPropagationToNodes(nds, sourceId, { srcData: src, outEdges, importedFile })
      );
    },
    [setNodes]
  );

  /* When any node finishes a generation, feed its output downstream. */
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        id: string;
        resultPath: string;
        resultMediaType?: string;
      };
      void propagateFrom(detail.id, detail.resultPath);
    };
    window.addEventListener("canvas:produce", handler);
    return () => window.removeEventListener("canvas:produce", handler);
  }, [propagateFrom]);

  const onConnect = useCallback(
    (c: Connection) => {
      setEdges((eds) =>
        addEdge(
          {
            ...c,
            type: "smoothstep",
            animated: true,
            style: { stroke: "url(#canvas-edge-gradient)", strokeWidth: 2.5 },
          },
          eds
        )
      );
      if (c.source) {
        const withNew: Edge[] = [
          ...edgesRef.current,
          { id: `e_${c.source}-${c.target}-${Date.now()}`, source: c.source, target: c.target },
        ];
        void propagateFrom(c.source, undefined, withNew);
      }
    },
    [setEdges, propagateFrom]
  );

  /* 2026-08-25: lazy edge interactivity (same treatment as the workflow
   *  canvas).  defaultEdgeOptions sets deletable/reconnectable=false so
   *  untouched edges stay inert; the first click flips both flags on, after
   *  which delete-key / drag-reconnect behave exactly as before. */
  const onEdgeClick = useCallback(
    (_event: React.MouseEvent, edge: Edge) => {
      if (edge.deletable === true && edge.reconnectable === true) return;
      setEdges((eds) =>
        eds.map((e) =>
          e.id === edge.id ? { ...e, deletable: true, reconnectable: true } : e
        )
      );
    },
    [setEdges]
  );

  /* Stable identity → colour lookup for the MiniMap.  Depends on nothing
   * (kind colours are static), so MiniMap never re-renders due to a fresh
   * callback reference while nodes are dragged. */
  const miniMapNodeColor = useCallback(
    (node: { data?: unknown }) => {
      const kind = (node.data as CanvasNodeData | undefined)?.kind;
      return (kind ? MINIMAP_COLOR_BY_KIND.get(kind) : undefined) ?? "#6B7280";
    },
    []
  );

  /* ── Auto-persist on every meaningful mutation（已抽入 useProjectPersistence）── */

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
    [menu, screenToFlowPosition, setNodes]
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

  /* ── 面板 →「加入画布」：把素材/历史产出落成内容载体节点 ──
   *
   *  素材库与历史记录里的文件都住在 public/generated（经 /api/generated 读盘），
   *  但 picture / movie 节点的 mediaPath 必须是 ComfyUI **input 目录**里的文件名，
   *  才能被下游 LoadImage / LoadVideo 直接消费。所以先走 importOutputAsInput
   *  把字节回灌到 ComfyUI input（该函数按源路径缓存，重复投放不会重复上传），
   *  再用返回的文件名建节点。
   *
   *  音频暂无对应节点类型，明确告知而不是静默失败。 */
  const placeMediaNode = useCallback(
    async (opts: {
      url: string;
      displayName: string;
      /** image / video 才有对应节点；audio 与 doc 目前无载体。 */
      mediaType: "image" | "video" | "audio" | "doc";
      /** 拖拽落地时传入落点的 flow 坐标；缺省则落在视口中心。 */
      position?: { x: number; y: number };
    }) => {
      const { url, displayName, mediaType, position } = opts;
      if (mediaType !== "image" && mediaType !== "video") {
        toast.info(
          mediaType === "audio" ? "音频暂不支持落地画布" : "该文件类型暂不支持落地画布",
          "画布目前只有图片 / 视频两种内容载体节点"
        );
        return;
      }
      try {
        const name = await importOutputAsInput(url);
        const kind: NodeKind = mediaType === "video" ? "movie" : "picture";
        const center = position ?? screenToFlowPosition({
          x: window.innerWidth / 2,
          y: window.innerHeight / 2,
        });
        const node: CanvasNodeType = {
          id: makeNodeId(),
          type: "canvasNode",
          position: center,
          data: {
            ...defaultData(kind),
            mediaPath: name,
            mediaName: displayName,
            mediaKind: mediaType,
          },
        };
        setNodes((nds) => [...nds, node]);
        toast.success("已加入画布", displayName);
      } catch (e: any) {
        toast.error("加入画布失败", e?.message ?? undefined);
      }
    },
    [screenToFlowPosition, setNodes, toast]
  );

  /* ── 拖拽落地：素材库 / 历史记录面板拖拽到画布，按落点坐标建内容载体节点 ──
   *  payload 经 dataTransfer 传递（image / video 才有载体；audio / doc 落地时 toast 提示不支持）。 */
  const onCanvasDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (e.dataTransfer.types.includes("application/x-comfyapp-media")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  }, []);

  const onCanvasDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      const raw = e.dataTransfer.getData("application/x-comfyapp-media");
      if (!raw) return; // 非本应用拖拽（如外部文件），忽略
      e.preventDefault();
      let payload: { url: string; displayName: string; mediaType: "image" | "video" | "audio" | "doc" };
      try {
        payload = JSON.parse(raw);
      } catch {
        return;
      }
      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      placeMediaNode({ ...payload, position });
    },
    [screenToFlowPosition, placeMediaNode]
  );

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
      className="relative h-full w-full bg-[var(--color-canvas)]"
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
            <linearGradient id="canvas-edge-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#B584FF" />
              <stop offset="35%" stopColor="#5BC6FF" />
              <stop offset="70%" stopColor="#5BE3C4" />
              <stop offset="100%" stopColor="#FFD571" />
            </linearGradient>
          </defs>
        </svg>
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="rgba(255,255,255,0.08)" />
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

      {/* Project switcher (top-left) */}
      <div className="absolute left-3 top-3 z-20">
        <div className="relative">
          <button
            className="flex items-center gap-2 rounded-full border border-white/[0.1] bg-gradient-to-br from-[#1a1530]/85 to-[#16121f]/85 px-3.5 py-1.5 text-[12px] font-medium text-gray-100 shadow-lg shadow-black/30 backdrop-blur-md transition-all hover:border-violet-400/40 hover:shadow-violet-500/15"
            onClick={openProjMenu}
            title="项目列表"
          >
            <span className="text-violet-300">▦</span>
            <span className="max-w-[160px] truncate">{projectName}</span>
            <span className="text-gray-500">▾</span>
          </button>
          {projMenu && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setProjMenu(false)} />
              <div className="absolute left-0 top-10 z-40 w-60 overflow-hidden rounded-xl border border-white/[0.1] bg-[#14121f]/95 p-1.5 shadow-2xl shadow-black/60 backdrop-blur">
                <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-gray-500">我的画布项目</div>
                <div className="max-h-56 overflow-auto">
                  {projects.map((project) =>
(
                    <button
                      key={project.id}
                      type="button"
                      onClick={() => switchProject(project.id)}
                      className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-[12px] transition-colors hover:bg-white/[0.06] ${
                        project.id === projectId ? "text-violet-300" : "text-gray-200"
                      }`}
                    >
                      <span className="truncate">{project.name}</span>
                      {project.id === projectId && <span className="text-[10px] text-violet-400">当前</span>}
                    </button>
                  ))}
                  {projects.length === 0 && (
                    <p className="px-2 py-1.5 text-[11px] text-gray-500">暂无其他项目</p>
                  )}
                </div>
                <div className="my-1 h-px bg-white/[0.06]" />
                {renaming ? (
                  <div className="space-y-1 p-1">
                    <input
                      autoFocus
                      value={renameVal}
                      onChange={(event) => setRenameVal(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") commitRename();
                        if (event.key === "Escape") setRenaming(false);
                      }}
                      className="w-full rounded-md border border-white/[0.08] bg-black/30 px-2 py-1 text-[12px] text-gray-200 outline-none focus:border-violet-400/60"
                      placeholder="项目名称"
                    />
                    <div className="flex gap-1">
                      <button
                        type="button"
                        className="flex-1 rounded-md bg-violet-500/90 px-2 py-1 text-[11px] text-white hover:bg-violet-500"
                        onClick={commitRename}
                      >
                        保存
                      </button>
                      <button
                        type="button"
                        className="flex-1 rounded-md border border-white/[0.08] px-2 py-1 text-[11px] text-gray-300 hover:bg-white/[0.06]"
                        onClick={() => setRenaming(false)}
                      >
                        取消
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col">
                    <button
                      type="button"
                      onClick={newProject}
                      className="rounded-lg px-2 py-1.5 text-left text-[12px] text-gray-200 transition-colors hover:bg-white/[0.06]"
                    >
                      <Icon name="plus" size={13} className="mr-1.5 inline align-[-2px]" />新建项目
                    </button>
                    <button
                      type="button"
                      onClick={startRename}
                      className="rounded-lg px-2 py-1.5 text-left text-[12px] text-gray-200 transition-colors hover:bg-white/[0.06]"
                    >
                      <Icon name="pen" size={13} className="mr-1.5 inline align-[-2px]" />重命名当前
                    </button>
                    <button
                      type="button"
                      onClick={deleteCurrent}
                      className="rounded-lg px-2 py-1.5 text-left text-[12px] text-red-400 transition-colors hover:bg-red-400/[0.08]"
                    >
                      <Icon name="trash" size={13} className="mr-1.5 inline align-[-2px]" />删除当前
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Floating toolbar (center) */}
      <div className="absolute left-1/2 top-3 z-20 flex -translate-x-1/2 items-center gap-1 rounded-full border border-white/[0.1] bg-gradient-to-br from-[#1a1530]/85 to-[#16121f]/85 px-2 py-1.5 shadow-lg shadow-black/30 backdrop-blur-md">
        <span className="flex items-center px-2 text-[11px] font-medium text-violet-200">
          <Icon name="sparkles" size={13} className="mr-1.5" />无限画布
        </span>
        <span className="h-4 w-px bg-white/10" />
        <button className={ghostTool} onClick={() => fitView({ padding: 0.2, duration: 400 })}>
          适应视图
        </button>
        <button className={ghostTool} onClick={exportJson}>
          导出 JSON
        </button>
        <button className={ghostTool + " hover:text-red-300"} onClick={clearCanvas}>
          清空画布
        </button>
      </div>

      {/* R-ardot119: project-canvas settings (top-right gear). Opens a
       *  right-edge drawer with the 调试模式 toggle. State is shared
       *  with the workflow editor via useDebugMode. */}
      <ProjectSettingsButton onClick={() => setProjectSettingsOpen(true)} />
      {projectSettingsOpen && (
        <ProjectSettingsDrawer onClose={() => setProjectSettingsOpen(false)} />
      )}

      {/* R-ardot119-fix (2026-08-18): also mount the global step-log panel
       *  here on the project canvas. It self-gates by 调试模式 and uses
       *  useActiveTaskId() so it picks up whichever task is running/just
       *  ran anywhere in the workspace. Without this mount the panel only
       *  existed in the workflow-canvas drill-in view (wf-editor-inner),
       *  so toggling 调试模式 on the project canvas appeared to do nothing. */}
      <GlobalStepLogPanel />

      {/* Empty hint — 友好引导卡片（仅当项目确实无内容且已加载完成时展示） */}
      {hydrating && nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <div className="flex flex-col items-center gap-3 rounded-3xl border border-white/[0.08] bg-gradient-to-br from-[#1a1530]/60 to-[#0f0b1c]/60 px-12 py-10 shadow-2xl shadow-black/40 backdrop-blur-md">
            <Icon name="loader" size={40} className="animate-spin text-cyan-300/90" />
            <p className="text-sm text-gray-400">加载中…</p>
          </div>
        </div>
      )}

      {/* Empty hint — 友好引导卡片 */}
      {nodes.length === 0 && !hydrating && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <div className="rounded-3xl border border-white/[0.08] bg-gradient-to-br from-[#1a1530]/60 to-[#0f0b1c]/60 px-12 py-10 shadow-2xl shadow-black/40 backdrop-blur-md">
            <div className="mb-3 flex justify-center gap-2">
              <span
                className="inline-block h-10 w-10 rounded-xl shadow-lg"
                style={{ background: "linear-gradient(135deg, #B584FF 0%, #FF9DCD 100%)", boxShadow: "0 4px 18px rgba(181,132,255,0.45)" }}
              />
              <span
                className="inline-block h-10 w-10 rounded-xl shadow-lg"
                style={{ background: "linear-gradient(135deg, #5BC6FF 0%, #6BEBEB 100%)", boxShadow: "0 4px 18px rgba(91,198,255,0.45)" }}
              />
              <span
                className="inline-block h-10 w-10 rounded-xl shadow-lg"
                style={{ background: "linear-gradient(135deg, #5BE3C4 0%, #67E89D 100%)", boxShadow: "0 4px 18px rgba(91,227,196,0.45)" }}
              />
              <span
                className="inline-block h-10 w-10 rounded-xl shadow-lg"
                style={{ background: "linear-gradient(135deg, #FFD571 0%, #FF9C5B 100%)", boxShadow: "0 4px 18px rgba(255,213,113,0.45)" }}
              />
            </div>
            <p className="mt-4 text-[15px] font-semibold text-gray-100">
              右键画布任意位置，开始创建节点
            </p>
            <p className="mt-2 text-[12px] leading-relaxed text-gray-400">
              支持：生图 · 生视频 · 生成剧本 · Agent 模式 · 自定义工作流
            </p>
            <p className="mt-1 text-[12px] leading-relaxed text-gray-500">
              自定义工作流可下拉选用你上传的 ComfyUI 工作流
            </p>
            <p className="mt-1 text-[12px] leading-relaxed text-violet-300">
              <Icon name="sparkles" size={12} className="mr-1 inline align-[-2px]" />连线节点可把上游输出自动喂给下游
            </p>
          </div>
        </div>
      )}

      {menu && (
        <ContextMenu
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
        description={`项目「${projectNameRef.current}」将被永久删除，连同画布上的所有节点和连线。\n\n此操作不可撤销。`}
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
          <CanvasPanelToolbar active={activePanel} onSelect={setActivePanel} floating={false} />
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
                  displayName: template.cover.split("/").pop() ?? template.id.slice(0, 12),
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

const ghostTool =
  "rounded-full px-3 py-1 text-[12px] text-gray-300 transition-colors hover:bg-white/[0.06]";

/* ── Public component ── */
export function ProjectCanvas(props: ProjectCanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
