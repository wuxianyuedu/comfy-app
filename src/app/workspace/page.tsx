"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import {
  VideoQueueModal,
  HomePage,
  WorkspaceNav,
  ToastProvider,
  AuroraBackground,
  BrowserStatusBar,
  LogProvider,
  LogPanel,
} from "@/components/studio";
import type {
  RecentProject,
  WorkspaceView,
} from "@/components/studio";
import { WorkshopPipeline } from "@/components/workshop/WorkshopPipeline";
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
  const [, setViewHistory] = useState<WorkspaceView[]>(["home"]);

  /** Navigate to a new view while recording history for back-button support. */
  const navigateTo = useCallback((view: WorkspaceView) => {
    setViewHistory((prev) => {
      const last = prev[prev.length - 1];
      if (last === view) return prev; // dedup
      return [...prev, view];
    });
    setViewMode(view);
  }, []);

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
  const [recentsKey] = useState(0);

  // ── When set, the infinite canvas receives this workflow and drops a
  //    `kind="workflow"` node for it (from the Workflow Library "使用" action).
  const [pendingCanvasWorkflow, setPendingCanvasWorkflow] = useState<{
    id: string;
    name: string;
    taskType: string;
  } | null>(null);

  // ── Recent projects: sourced from canvas-store (localStorage), not Task table.
  //    Task.type only accepts TXT2IMG|IMG2IMG|INPAINT|HIRERES|VIDEO, so canvas
  //    projects never appear there. Reading from listProjects() guarantees the
  //    "最近项目" section reflects the user's actual canvas work.
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
    navigateTo(id);
  }, [navigateTo]);

  // AI 引导入口已隐藏，保留 onApply 兼容占位。
  const handleApplySpec = useCallback(() => {
    // no-op: 创作台移除后，AI 引导暂未接入新流程。
  }, []);

  const handleNewProject = useCallback(() => {
    // Opening "新建项目" drops the user into a fresh, named canvas project
    // (the previous project is preserved in the project store).
    setCanvasSeedNew(true);
    navigateTo("canvas");
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

  const handleOpenProject = useCallback(
    (id: string) => {
      if (id === "new") {
        // 原 "新建项目" 创作台已移除，改为直接进入画布
        setCanvasSeedNew(true);
        navigateTo("canvas");
      } else {
        // 真实作品：跳转作品详情页（溯源 + 执行日志）
        router.push(`/create/${id}`);
      }
    },
    [navigateTo, router]
  );

  // "使用" a workflow from the Workflow Library → jump to the infinite canvas
  // and drop the workflow as a node on the currently-open project.
  const handleUseWorkflow = useCallback(
    (id: string, meta?: { name: string; taskType: string }) => {
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
      <LogProvider>
        <ToastProvider>
          <HomePage
            onNewProject={handleNewProject}
            recentProjects={recentProjects}
            onOpenProject={handleOpenProject}
            onOpenCanvasProject={handleOpenCanvasProject}
            activeNav="home"
            onNavigate={handleHomeNavigate}
            onShowAllProjects={handleShowAllProjects}
          />
          <VideoQueueModal open={videoQueueOpen} onClose={() => setVideoQueueOpen(false)} />
          <BrowserStatusBar />
          <LogPanel />
        </ToastProvider>
      </LogProvider>
    );
  }

  // ── Non-home modes: shared left nav + center content ──
  const renderCenter = () => {
    switch (viewMode) {
      case "works":
        return <WorksGallery onOpenTask={handleOpenProject} onOpenCanvasProject={handleOpenCanvasProject} />;

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
            <WorkshopPipeline />
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <LogProvider>
      <ToastProvider>
        <div className="flex h-screen w-screen overflow-hidden bg-[var(--color-canvas)] text-gray-200" style={{ fontFamily: "var(--font-sans)" }}>
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
              className="fixed bottom-9 right-4 z-30 flex items-center gap-2 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-500/20 transition-transform hover:scale-105"
            >
              <span className="text-[15px]">✦</span>
              AI 引导
            </button>
          )}
          {SHOW_AI_FAB && agentOpen && (
            <AgentChat open={agentOpen} onClose={() => setAgentOpen(false)} onApply={handleApplySpec} />
          )}
        </div>
        <BrowserStatusBar />
        <LogPanel />
      </ToastProvider>
    </LogProvider>
  );
}
