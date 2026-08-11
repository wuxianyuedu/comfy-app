"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
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

import { CanvasNode } from "./canvas/CanvasNode";
import {
  CanvasNodeData,
  CanvasNodeType,
  NODE_META,
  defaultData,
  type NodeKind,
} from "./canvas/canvas-types";
import { importOutputAsInput } from "./canvas/canvas-helpers";
import {
  listProjects,
  getProject,
  upsertProject,
  deleteProject,
  createProject,
  setActive,
  getActiveId,
  type CanvasProject,
} from "./canvas/canvas-store";

const nodeTypes = { canvasNode: CanvasNode };

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
  onClose,
}: {
  x: number;
  y: number;
  onPick: (kind: NodeKind) => void;
  onClose: () => void;
}) {
  return (
    <>
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        className="fixed z-50 w-44 overflow-hidden rounded-xl border border-white/[0.1] bg-[#14121f]/95 p-1.5 shadow-2xl shadow-black/60 backdrop-blur"
        style={{ left: x, top: y }}
      >
        <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-gray-500">创建节点</div>
        {(Object.keys(NODE_META) as NodeKind[]).map((k) => {
          const m = NODE_META[k];
          return (
            <button
              key={k}
              type="button"
              data-canvas-node-kind={k}
              onClick={() => onPick(k)}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] text-gray-200 transition-colors hover:bg-white/[0.06]"
            >
              <Icon name={m.icon} size={15} className="text-violet-300" />
              <span className="flex flex-col">
                <span className="font-medium">{m.label}</span>
                <span className="text-[10px] text-gray-500">{m.desc}</span>
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
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNodeType>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [projMenu, setProjMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameVal, setRenameVal] = useState("");
  const [projects, setProjects] = useState<CanvasProject[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState("未命名项目");
  const { screenToFlowPosition, fitView } = useReactFlow();

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
  // Tracks which pending workflow we've already dropped, so navigating to the
  // canvas / re-rendering doesn't place the same node twice.
  const placedPendingRef = useRef<string | null>(null);
  // Set true once the project's initial nodes have been hydrated into
  // local state.  We skip the first mutation persistence flush (right
  // after load) so the effect doesn't redundantly re-write the same
  // state we just read from the store.
  const firstMutationRef = useRef(true);

  /* ── Load (or create) the active project on mount ── */
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    let proj: CanvasProject | null = null;
    if (seedNew) {
      proj = createProject();
    } else {
      const activeId = getActiveId();
      if (activeId) proj = getProject(activeId);
      if (!proj) proj = listProjects()[0] ?? null;
      if (!proj) proj = createProject();
    }
    setProjectId(proj.id);
    setProjectName(proj.name);
    setNodes((proj.nodes as CanvasNodeType[]) ?? []);
    setEdges(proj.edges ?? []);
    setActive(proj.id);
    // fit after nodes are applied
    setTimeout(() => fitView({ padding: 0.25, duration: 300 }), 80);
    onConsumeSeed?.();
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
    const id = `n_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const node: CanvasNodeType = {
      id,
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
    setTimeout(() => fitView({ padding: 0.25, duration: 300 }), 80);
    onConsumePending?.();
  }, [pendingWorkflow, screenToFlowPosition, setNodes, fitView, onConsumePending]);

  /* ── Persist current project (debounced) ── */
  useEffect(() => {
    if (!projectId) return;
    const t = setTimeout(() => {
      upsertProject({
        id: projectId,
        name: projectName,
        updatedAt: Date.now(),
        nodes,
        edges,
      });
    }, 500);
    return () => clearTimeout(t);
  }, [nodes, edges, projectId, projectName]);

  /* ── Flush on unmount / tab close (no data loss) ── */
  useEffect(() => {
    const flush = () => {
      const pid = projectIdRef.current;
      if (!pid) return;
      upsertProject({
        id: pid,
        name: projectNameRef.current,
        updatedAt: Date.now(),
        nodes: nodesRef.current,
        edges: edgesRef.current,
      });
    };
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Connection chaining (routes by which port/handle is connected) ── */
  const propagateFrom = useCallback(
    async (sourceId: string, resultPathOverride?: string, edgesOverride?: Edge[]) => {
      const srcNode = nodesRef.current.find((n) => n.id === sourceId);
      const src = srcNode?.data as CanvasNodeData | undefined;
      if (!src) return;
      const rPath = resultPathOverride ?? src.resultPath;
      const rType = src.resultMediaType;
      const es = edgesOverride ?? edgesRef.current;
      const outEdges = es.filter((e) => e.source === sourceId);
      if (outEdges.length === 0) return;

      // Only import the generated image if at least one downstream port needs it.
      const needsImage = outEdges.some(
        (e) => !e.targetHandle || e.targetHandle === "inputImage"
      );
      let importedFile: string | null = null;
      if (needsImage && rPath && rType !== "video") {
        try {
          importedFile = await importOutputAsInput(rPath);
        } catch {
          importedFile = null;
        }
      }

      setNodes((nds) =>
        nds.map((n) => {
          if (n.id === sourceId) return n;
          const edge = outEdges.find((e) => e.target === n.id);
          if (!edge) return n;
          const td = n.data as CanvasNodeData;
          const next: CanvasNodeData = { ...td };
          switch (edge.targetHandle) {
            case "prompt":
              if (src.prompt?.trim()) next.prompt = src.prompt;
              break;
            case "negative":
              if (src.negative?.trim()) next.negative = src.negative;
              break;
            case "steps":
              if (src.steps != null) next.steps = src.steps;
              break;
            case "cfg":
              if (src.cfg != null) next.cfg = src.cfg;
              break;
            case "seed":
              if (src.seed?.trim()) next.seed = src.seed;
              break;
            case "inputImage":
            default:
              if (importedFile) {
                next.inputImage = importedFile;
                next.upstreamId = sourceId;
                // auto-switch the consumer mode so the fed input is actually used
                if (next.kind === "image" && next.mode === "txt2img") next.mode = "img2img";
                if (next.kind === "video" && next.mode === "t2v") next.mode = "i2v";
              }
              break;
          }
          return { ...n, data: next };
        })
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

  /* ── Auto-persist on every meaningful mutation ──
   *  Without this, drag/add/connect all sit in memory only and vanish on
   *  reload.  Manual `upsertProject` calls in switchProject/newProject/
   *  commitRename cover the corner cases; this effect catches every
   *  other change with a 600 ms idle debounce so we don't spam
   *  localStorage during a drag.
   *
   *  `firstMutationRef` guards against the post-load setter flush that
   *  setNodes(proj.nodes) / setEdges(proj.edges) triggers — that round-trip
   *  is a no-op rewrite, so we let it pass through without bumping the
   *  `updatedAt` stamp.  Subsequent runs are real user mutations and
   *  need to be persisted. */
  useEffect(() => {
    if (!loadedRef.current) return;
    if (!projectIdRef.current) return;
    if (firstMutationRef.current) {
      firstMutationRef.current = false;
      return;
    }
    const handle = setTimeout(() => {
      const id = projectIdRef.current;
      if (!id) return;
      upsertProject({
        id,
        name: projectNameRef.current,
        updatedAt: Date.now(),
        nodes: nodesRef.current,
        edges: edgesRef.current,
      });
    }, 600);
    return () => clearTimeout(handle);
  }, [nodes, edges]);

  const onPaneContextMenu = useCallback((e: React.MouseEvent | MouseEvent) => {
    e.preventDefault();
    setMenu({ x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY });
  }, []);

  const createNode = useCallback(
    (kind: NodeKind) => {
      if (!menu) return;
      const position = screenToFlowPosition({ x: menu.x, y: menu.y });
      const id = `n_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const node: CanvasNodeType = {
        id,
        type: "canvasNode",
        position,
        data: defaultData(kind),
      };
      setNodes((nds) => [...nds, node]);
      setMenu(null);
    },
    [menu, screenToFlowPosition, setNodes]
  );

  const clearCanvas = useCallback(() => {
    if (!confirm("清空当前画布？此操作不可撤销（项目本身会保留）。")) return;
    setNodes([]);
    setEdges([]);
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

  /* ── Project switcher actions ── */
  const openProjMenu = useCallback(() => {
    setProjects(listProjects());
    setRenaming(false);
    setProjMenu((v) => !v);
  }, []);

  const switchProject = useCallback(
    (id: string) => {
      const pid = projectIdRef.current;
      if (pid)
        upsertProject({
          id: pid,
          name: projectNameRef.current,
          updatedAt: Date.now(),
          nodes: nodesRef.current,
          edges: edgesRef.current,
        });
      const proj = getProject(id);
      if (!proj) return;
      setActive(id);
      setProjectId(proj.id);
      setProjectName(proj.name);
      setNodes((proj.nodes as CanvasNodeType[]) ?? []);
      setEdges(proj.edges ?? []);
      setProjMenu(false);
      setRenaming(false);
      setTimeout(() => fitView({ padding: 0.25, duration: 300 }), 80);
    },
    [setNodes, setEdges, fitView]
  );

  const newProject = useCallback(() => {
    const pid = projectIdRef.current;
    if (pid)
      upsertProject({
        id: pid,
        name: projectNameRef.current,
        updatedAt: Date.now(),
        nodes: nodesRef.current,
        edges: edgesRef.current,
      });
    const p = createProject();
    setProjectId(p.id);
    setProjectName(p.name);
    setNodes([]);
    setEdges([]);
    setProjects(listProjects());
    setProjMenu(false);
  }, [setNodes, setEdges]);

  const deleteCurrent = useCallback(() => {
    const pid = projectIdRef.current;
    if (!pid) return;
    if (!confirm(`删除项目「${projectNameRef.current}」？此操作不可撤销。`)) return;
    deleteProject(pid);
    const remaining = listProjects();
    if (remaining.length) {
      switchProject(remaining[0].id);
    } else {
      const p = createProject();
      setProjectId(p.id);
      setProjectName(p.name);
      setNodes([]);
      setEdges([]);
    }
    setProjects(listProjects());
    setProjMenu(false);
  }, [switchProject, setNodes, setEdges]);

  const startRename = useCallback(() => {
    setRenameVal(projectNameRef.current);
    setRenaming(true);
  }, []);

  const commitRename = useCallback(() => {
    const name = renameVal.trim() || "未命名项目";
    setProjectName(name);
    const pid = projectIdRef.current;
    if (pid)
      upsertProject({
        id: pid,
        name,
        updatedAt: Date.now(),
        nodes: nodesRef.current,
        edges: edgesRef.current,
      });
    setRenaming(false);
    setProjMenu(false);
    setProjects(listProjects());
  }, [renameVal, setNodes, setEdges]);

  const onNodeClick: NodeMouseHandler = useCallback(() => setMenu(null), []);

  return (
    <div className="relative h-full w-full bg-[#0a0a0f]">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onPaneContextMenu={onPaneContextMenu}
        onPaneClick={() => setMenu(null)}
        onNodeClick={onNodeClick}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.2}
        maxZoom={2}
        defaultEdgeOptions={{
          type: "smoothstep",
          animated: true,
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
          nodeColor={(n) => NODE_META[(n.data as CanvasNodeData)?.kind]?.color ?? "#6B7280"}
          maskColor="#050507CC"
          style={{
            background: "#0B0712",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 8,
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
                  {projects.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => switchProject(p.id)}
                      className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-[12px] transition-colors hover:bg-white/[0.06] ${
                        p.id === projectId ? "text-violet-300" : "text-gray-200"
                      }`}
                    >
                      <span className="truncate">{p.name}</span>
                      {p.id === projectId && <span className="text-[10px] text-violet-400">当前</span>}
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
                      onChange={(e) => setRenameVal(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename();
                        if (e.key === "Escape") setRenaming(false);
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

      {/* Empty hint — 友好引导卡片 */}
      {nodes.length === 0 && (
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
        <ContextMenu x={menu.x} y={menu.y} onPick={createNode} onClose={() => setMenu(null)} />
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
