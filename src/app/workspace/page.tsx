"use client";

import React, { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import {
  VideoQueueModal,
  HomePage,
  WorkspaceNav,
  ToastProvider,
  AuroraBackground,
} from "@/components/studio";
import type {
  QuickStartItem,
  RecentProject,
  WorkspaceView,
  SkillShort,
} from "@/components/studio";
import type { AgentSpec } from "@/lib/agent/agentic";
import { listProjects, setActive, reapAllEmptyDrafts } from "@/components/studio/project-canvas/canvas-store";

/* ── Lazy-load view components so the initial bundle stays small ── */
/* Only HomePage / WorkspaceNav / ToastProvider / VideoQueueModal are loaded eagerly. */
const WorksGallery = dynamic(
  () => import("@/components/studio").then((mod) => mod.WorksGallery),
  { ssr: false }
);
const ProjectOutputs = dynamic(
  () => import("@/components/studio").then((mod) => mod.ProjectOutputs),
  { ssr: false }
);
const SkillsGrid = dynamic(
  () => import("@/components/studio").then((mod) => mod.SkillsGrid),
  { ssr: false }
);
const CreatePanel = dynamic(
  () => import("@/components/studio").then((mod) => mod.CreatePanel),
  { ssr: false }
);
const ModelLibrary = dynamic(
  () => import("@/components/studio").then((mod) => mod.ModelLibrary),
  { ssr: false }
);
const HistoryList = dynamic(
  () => import("@/components/studio").then((mod) => mod.HistoryList),
  { ssr: false }
);
const TrainingStudio = dynamic(
  () => import("@/components/studio").then((mod) => mod.TrainingStudio),
  { ssr: false }
);
const WorkflowLibrary = dynamic(
  () => import("@/components/studio").then((mod) => mod.WorkflowLibrary),
  { ssr: false }
);
const WorkshopStudio = dynamic(
  () => import("@/components/studio").then((mod) => mod.WorkshopStudio),
  { ssr: false }
);
const AgentChat = dynamic(
  () => import("@/components/studio").then((mod) => mod.AgentChat),
  { ssr: false }
);

/* Lazy-load the heavier canvas/film editors (ReactFlow etc.) on the client. */
const FilmStudio = dynamic(
  () => import("@/components/studio/FilmStudio").then((mod) => mod.FilmStudio),
  { ssr: false }
);
const ProjectCanvas = dynamic(
  () => import("@/components/studio/ProjectCanvas").then((mod) => mod.ProjectCanvas),
  { ssr: false }
);

/* ── Workspace Page — Updream-style full-screen editor ── */

function ago(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "刚刚修改";
  if (m < 60) return `${m} 分钟前修改`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前修改`;
  return `${Math.floor(h / 24)} 天前修改`;
}

export default function WorkspacePage() {
  const router = useRouter();

  // ── Layout state ──
  const [viewMode, setViewMode] = useState<WorkspaceView>("home");
  // View history stack for smart back-navigation (avoids jumping straight to home)
  const [viewHistory, setViewHistory] = useState<WorkspaceView[]>(["home"]);

  /** Navigate to a new view while recording history for back-button support. */
  const navigateTo = useCallback((view: WorkspaceView) => {
    setViewHistory((prev) => {
      const last = prev[prev.length - 1];
      if (last === view) return prev; // dedup
      return [...prev, view];
    });
    setViewMode(view);
  }, []);

  /** Go back to the previous view (or home if no history). */
  const goBack = useCallback(() => {
    setViewHistory((prev) => {
      if (prev.length <= 1) return prev; // already at root
      const sliced = prev.slice(0, -1);
      setViewMode(sliced[sliced.length - 1]!);
      return sliced;
    });
  }, []);
  const [projectTitle, setProjectTitle] = useState("未命名项目");
  const [pendingSkill, setPendingSkill] = useState<SkillShort | null>(null);
  const [pendingAgent, setPendingAgent] = useState<{
    prompt: string;
    negative?: string;
    params?: Partial<{ steps: number; cfg: number; sampler: string; scheduler: string; size: string }>;
    kind?: "image" | "video";
    autoStart: boolean;
  } | null>(null);
  // Bump to force CreatePanel remount with a fresh agent spec.
  const [agentSeq, setAgentSeq] = useState(0);

  // ── Agent chat overlay ──
  const [agentOpen, setAgentOpen] = useState(false);
  // R-ardot120 (2026-08-18): 控制「✦ AI 引导」FAB 是否渲染 —
  // 默认 false, 详见下方 JSX 注释。要重新启用 = 改 true。
  const SHOW_AI_FAB = false;

  // ── Video queue modal ──
  const [videoQueueOpen, setVideoQueueOpen] = useState(false);

  // ── Canvas: when true, the canvas opens a brand-new named project
  const [canvasSeedNew, setCanvasSeedNew] = useState(false);

  // ── Bump to re-read canvas-store (recent projects) ──
  const [recentsKey, setRecentsKey] = useState(0);

  // ── When set, the create panel opens directly in "custom" mode with this
  //    imported workflow pre-selected (from the Workflow Library "使用" action).
  const [pendingWorkflowId, setPendingWorkflowId] = useState<string | null>(null);

  // ── When set, the infinite canvas receives this workflow and drops a
  //    `kind="workflow"` node for it (from the Workflow Library "使用" action).
  const [pendingCanvasWorkflow, setPendingCanvasWorkflow] = useState<{
    id: string;
    name: string;
    taskType: string;
  } | null>(null);

  // ── When set, the create panel opens in "edit" mode with this uploaded
  //    image pre-filled as the reference image (from HomePage "上传素材").
  const [pendingImage, setPendingImage] = useState<string | null>(null);

  // ── Recent projects: sourced from canvas-store (localStorage), not Task table.
  //    Task.type only accepts TXT2IMG|IMG2IMG|INPAINT|HIRERES|VIDEO, so canvas
  //    projects never appear there. Reading from listProjects() guarantees the
  //    "最近项目" section reflects the user's actual canvas work.
  // ── Read ?tab= query param to set initial view (avoids useSearchParams Suspense) ──
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab");
    if (tab === "works" || tab === "skills" || tab === "create" || tab === "canvas" || tab === "models" || tab === "workshop" || tab === "history" || tab === "train" || tab === "film" || tab === "workflows" || tab === "outputs") {
      setViewMode(tab);
    }
  }, []);

  // ── Load real recent canvas projects on mount + on store-change events ──
  //    Stored in localStorage (canvas-store), so SSR returns []; we hydrate
  //    after mount. The "comfyapp:canvas-store-changed" event lets the home
  //    view stay in sync with edits made inside ProjectCanvas (upsert / delete
  //    / rename) without requiring a full reload.
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  useEffect(() => {
    // One-shot sweep on home mount: remove any stale empty default-named
    // drafts that earlier code versions (R58 + prior) left in the index.
    // Triggers `comfyapp:canvas-store-changed` if anything was reaped, so
    // the refresh callback below will re-read `listProjects()` and the
    // home recent-projects list stays clean without a hard reload.
    reapAllEmptyDrafts();
    const compute = () => {
      setRecentProjects(
        listProjects()
          .slice(0, 8) // 给 HomePage 内部 recentsExpanded ? 7 : 3 切片留余量
          .map((project) => {
            const nodeCount = project.nodes?.length ?? 0;
            const edgeCount = project.edges?.length ?? 0;
            return {
              id: project.id,
              name: (project.name || "未命名项目").slice(0, 28),
              updatedAt: project.updatedAt
                ? ago(new Date(project.updatedAt).toISOString())
                : "刚刚",
              kind: "canvas" as const,
              subtitle:
                nodeCount > 0
                  ? `${nodeCount} 节点 · ${edgeCount} 连线`
                  : "空画布",
              thumbnails: [],
            };
          })
      );
    };
    compute();
    const refresh = () => compute();
    window.addEventListener("comfyapp:canvas-store-changed", refresh);
    return () =>
      window.removeEventListener("comfyapp:canvas-store-changed", refresh);
  }, [recentsKey]);

  // ── Handlers ──
  const handleNavSelect = useCallback((id: WorkspaceView) => {
    if (id !== "create") setPendingSkill(null);
    navigateTo(id);
  }, [navigateTo]);

  // Apply a spec produced by the multi-turn Agent conversation: prefill the
  // creation panel (image → txt2img, video → video) and let the user review
  // before generating (guidance, not blind auto-start).
  const handleApplySpec = useCallback((spec: AgentSpec) => {
    setPendingSkill(null);
    setPendingAgent({
      prompt: spec.prompt,
      negative: spec.negative,
      params: spec.params,
      kind: spec.kind,
      autoStart: false,
    });
    setAgentSeq((state) => state + 1);
    navigateTo("create");
  }, []);

  // ── Home page handlers ──
  const handleHomeSearch = useCallback((query: string) => {
    navigateTo("create");
    setPendingSkill(null);
  }, []);

  const handleQuickStart = useCallback((item: QuickStartItem) => {
    navigateTo("create");
    setProjectTitle(item.title);
    setPendingSkill(null);
  }, []);

  const handleNewProject = useCallback(() => {
    // Opening "新建项目" drops the user into a fresh, named canvas project
    // (the previous project is preserved in the project store).
    setCanvasSeedNew(true);
    navigateTo("canvas");
    setPendingSkill(null);
  }, []);

  // Open a canvas project — set it as active and jump to the canvas view.
  const handleOpenCanvasProject = useCallback(
    (id: string) => {
      setActive(id);
      navigateTo("canvas");
    },
    [navigateTo]
  );

  const handleHomeNavigate = useCallback(
    (view: WorkspaceView) => {
      // Accept any registered WorkspaceView id; "home" is the current view,
      // so clicking it again is a no-op.
      if (view === "home") return;
      navigateTo(view);
    },
    [navigateTo]
  );

  // HomePage "查看全部" → switch to the "项目" (works) tab.
  const handleShowAllProjects = useCallback(() => {
    navigateTo("works");
  }, [navigateTo]);

  // Upload a material from HomePage "上传素材" → open the Create panel in
  // "edit" mode with the uploaded image pre-filled as the reference image.
  const handleUploadImage = useCallback(async (file: File) => {
    const fd = new FormData();
    fd.append("image", file);
    try {
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const d = await res.json().catch(() => ({}));
      if (d.name) {
        setPendingSkill(null);
        setPendingAgent(null);
        setPendingWorkflowId(null);
        setPendingImage(d.name);
        navigateTo("create");
      } else {
        const hint = d.hint === "comfyui-unreachable"
          ? "\n\n请先启动 ComfyUI（默认 localhost:8188），再重新上传素材。"
          : "";
        alert("素材上传失败：" + (d.error ?? "未知错误") + hint);
      }
    } catch {
      alert("素材上传失败：网络错误或 ComfyUI 未启动。\n\n请确认 ComfyUI 已在运行（默认 localhost:8188）。");
    }
  }, []);

  const handleOpenProject = useCallback(
    (id: string) => {
      if (id === "new") {
        navigateTo("create");
        setProjectTitle("新项目");
        setPendingSkill(null);
      } else {
        // 真实作品：跳转作品详情页（溯源 + 执行日志），而非落到空白创作台
        router.push(`/create/${id}`);
      }
    },
    [router]
  );

  const handleUseSkill = useCallback((skill: SkillShort) => {
    setPendingSkill(skill);
    navigateTo("create");
  }, []);

  // "使用" a workflow from the Workflow Library → jump to the infinite canvas
  // and drop the workflow as a node on the currently-open project.  (Legacy
  // behaviour opened the Create panel in "custom" mode; that path is no longer
  // used for the library's "使用" — we keep `pendingWorkflowId` only so a
  // pre-selected custom workflow can still be reached if needed.)
  const handleUseWorkflow = useCallback(
    (id: string, meta?: { name: string; taskType: string }) => {
      setPendingSkill(null);
      setPendingAgent(null);
      setPendingWorkflowId(null);
      setPendingCanvasWorkflow({
        id,
        name: meta?.name ?? "",
        taskType: meta?.taskType ?? "",
      });
      navigateTo("canvas");
    },
    [navigateTo]
  );

  // ── Home mode = full-page standalone ──
  if (viewMode === "home") {
    return (
      <ToastProvider>
        <HomePage
          onSearch={handleHomeSearch}
          onQuickStart={handleQuickStart}
          onNewProject={handleNewProject}
          recentProjects={recentProjects}
          onOpenProject={handleOpenProject}
          onOpenCanvasProject={handleOpenCanvasProject}
          activeNav="home"
          onNavigate={handleHomeNavigate}
          onUploadImage={handleUploadImage}
          onShowAllProjects={handleShowAllProjects}
        />
        <VideoQueueModal open={videoQueueOpen} onClose={() => setVideoQueueOpen(false)} />
      </ToastProvider>
    );
  }

  // ── Non-home modes: shared left nav + center content ──
  const renderCenter = () => {
    switch (viewMode) {
      case "create":
        return (
          <CreatePanel
            key={(pendingSkill?.id ?? "blank") + (pendingAgent ? `-agent-${agentSeq}` : "") + (pendingWorkflowId ? `-wf-${pendingWorkflowId}` : "") + (pendingImage ? `-img-${pendingImage}` : "")}
            initialSkill={pendingSkill}
            initialMode={pendingImage ? "edit" : pendingWorkflowId ? "custom" : pendingAgent?.kind === "video" ? "video" : "txt2img"}
            initialWorkflowId={pendingWorkflowId ?? undefined}
            initialPrompt={pendingAgent?.prompt}
            initialNegative={pendingAgent?.negative}
            initialParams={pendingAgent?.params}
            initialImage={pendingImage ?? undefined}
            autoStart={pendingAgent?.autoStart ?? false}
            onBack={goBack}
            onNavigate={handleNavSelect}
          />
        );

      case "works":
        return <WorksGallery onOpenTask={handleOpenProject} onOpenCanvasProject={handleOpenCanvasProject} />;

      case "skills":
        return <SkillsGrid onUseSkill={handleUseSkill} />;

      case "models":
        return <ModelLibrary />;

      case "history":
        return <HistoryList onOpenTask={handleOpenProject} />;

      case "train":
        return <TrainingStudio />;

      case "canvas":
        return (
          <ProjectCanvas
            seedNew={canvasSeedNew}
            onConsumeSeed={() => setCanvasSeedNew(false)}
            pendingWorkflow={pendingCanvasWorkflow}
            onConsumePending={() => setPendingCanvasWorkflow(null)}
          />
        );

      case "film":
        return <FilmStudio />;

      case "workflows":
        return <WorkflowLibrary onUse={handleUseWorkflow} />;

      case "outputs":
        return <ProjectOutputs />;

      case "workshop":
        return (
          <div className="h-full overflow-y-auto">
            <WorkshopStudio />
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <ToastProvider>
      <div className="flex h-screen w-screen overflow-hidden bg-[#0a0a0f] text-gray-200" style={{ fontFamily: 'Inter, "Noto Sans SC", system-ui, -apple-system, sans-serif' }}>
        {/* 极光背景：暗色基底上浮动的紫/青/品红发光，给非 home 视图加空间纵深感 */}
        <AuroraBackground />

        <WorkspaceNav active={viewMode} onSelect={handleNavSelect} />

        <div className="flex min-w-0 flex-1 flex-col">
          {renderCenter()}
        </div>

        <VideoQueueModal
          open={videoQueueOpen}
          onClose={() => setVideoQueueOpen(false)}
          onOpenTask={(id) => {
            setVideoQueueOpen(false);
            // 直接跳转到作品详情页（溯源 + 执行日志）
            router.push(`/create/${id}`);
          }}
        />

        {/* R-ardot120 (2026-08-18): 临时隐藏「✦ AI 引导」浮动入口。
         *  原因：调试模式下日志面板浮在画布底部,缩小后恰好遮住右下 FAB,
         *  两块视觉冲突。保留 `agentOpen` state 与 <AgentChat /> 节点,
         *  仅折叠按钮入口。要恢复 = 把 SHOW_AI_FAB 改回 true。 */}
        {SHOW_AI_FAB && !agentOpen && (
          <button
            type="button"
            onClick={() => setAgentOpen(true)}
            className="fixed bottom-4 right-4 z-30 flex items-center gap-2 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-500/20 transition-transform hover:scale-105"
          >
            <span className="text-[15px]">✦</span>
            AI 引导
          </button>
        )}
        {SHOW_AI_FAB && agentOpen && (
          <AgentChat open={agentOpen} onClose={() => setAgentOpen(false)} onApply={handleApplySpec} />
        )}
      </div>
    </ToastProvider>
  );
}
