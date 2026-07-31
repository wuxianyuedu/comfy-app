"use client";

import React, { useState, useCallback, useEffect } from "react";
import dynamic from "next/dynamic";
import {
  VideoQueueModal,
  HomePage,
  WorkspaceNav,
  WorksGallery,
  SkillsGrid,
  CreatePanel,
  ModelLibrary,
  HistoryList,
  TrainingStudio,
  ToastProvider,
  AgentChat,
} from "@/components/updream";
import type {
  QuickStartItem,
  RecentProject,
  WorkspaceView,
  SkillShort,
} from "@/components/updream";
import type { AgentSpec } from "@/lib/agent/agentic";

/* Lazy-load the heavier canvas/film editors (ReactFlow etc.) on the client. */
const FilmStudio = dynamic(
  () => import("@/components/updream/FilmStudio").then((m) => m.FilmStudio),
  { ssr: false }
);
const ProjectCanvas = dynamic(
  () => import("@/components/updream/ProjectCanvas").then((m) => m.ProjectCanvas),
  { ssr: false }
);

/* ── Workspace Page — Updream-style full-screen editor ── */

export default function WorkspacePage() {
  // ── Layout state ──
  const [viewMode, setViewMode] = useState<WorkspaceView>("home");
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

  // ── Video queue modal ──
  const [videoQueueOpen, setVideoQueueOpen] = useState(false);

  // ── Canvas: when true, the canvas opens a brand-new named project
  const [canvasSeedNew, setCanvasSeedNew] = useState(false);

  // ── Recent projects mock data ──
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);

  // ── Read ?tab= query param to set initial view (avoids useSearchParams Suspense) ──
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab");
    if (tab === "works" || tab === "skills" || tab === "create" || tab === "canvas" || tab === "models" || tab === "workshop" || tab === "history" || tab === "train" || tab === "film") {
      setViewMode(tab);
    }
  }, []);

  // ── Load recent projects on mount ──
  useEffect(() => {
    setRecentProjects([
      { id: "proj-1", name: "超速相关提案", updatedAt: "更新于 · 3分钟前修改" },
    ]);
  }, []);

  // ── Handlers ──
  const handleNavSelect = useCallback((id: WorkspaceView) => {
    if (id !== "create") setPendingSkill(null);
    setViewMode(id);
  }, []);

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
    setAgentSeq((s) => s + 1);
    setViewMode("create");
  }, []);

  // ── Home page handlers ──
  const handleHomeSearch = useCallback((query: string) => {
    setViewMode("create");
    setPendingSkill(null);
  }, []);

  const handleQuickStart = useCallback((item: QuickStartItem) => {
    setViewMode("create");
    setProjectTitle(item.title);
    setPendingSkill(null);
  }, []);

  const handleNewProject = useCallback(() => {
    // Opening "新建项目" drops the user into a fresh, named canvas project
    // (the previous project is preserved in the project store).
    setCanvasSeedNew(true);
    setViewMode("canvas");
    setPendingSkill(null);
  }, []);

  const handleOpenProject = useCallback((id: string) => {
    if (id === "new") {
      setViewMode("create");
      setProjectTitle("新项目");
      setPendingSkill(null);
    } else {
      setViewMode("create");
      setPendingSkill(null);
    }
  }, []);

  const handleUseSkill = useCallback((skill: SkillShort) => {
    setPendingSkill(skill);
    setViewMode("create");
  }, []);

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
          activeNav="home"
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
            key={(pendingSkill?.id ?? "blank") + (pendingAgent ? `-agent-${agentSeq}` : "")}
            initialSkill={pendingSkill}
            initialMode={pendingAgent?.kind === "video" ? "video" : "txt2img"}
            initialPrompt={pendingAgent?.prompt}
            initialNegative={pendingAgent?.negative}
            initialParams={pendingAgent?.params}
            autoStart={pendingAgent?.autoStart ?? false}
            onBack={() => setViewMode("home")}
            onNavigate={handleNavSelect}
          />
        );

      case "works":
        return <WorksGallery onOpenTask={handleOpenProject} />;

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
          />
        );

      case "film":
        return <FilmStudio />;

      case "workshop":
        return (
          <div className="flex h-full items-center justify-center bg-[#0a0a0f]">
            <div className="max-w-md text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-500/10 text-2xl">
                🎬
              </div>
              <p className="mb-2 text-lg font-medium text-gray-200">创作工坊</p>
              <p className="mb-4 text-sm text-gray-500">剧本 / 角色 / 分镜 全链路管线工具</p>
              <a
                href="/workshop"
                className="inline-block rounded-lg bg-violet-500/90 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-violet-500"
              >
                打开创作工坊 →
              </a>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <ToastProvider>
      <div className="flex h-screen w-screen overflow-hidden bg-[#0a0a0f] text-gray-200" style={{ fontFamily: 'Inter, "Noto Sans SC", system-ui, -apple-system, sans-serif' }}>
        <WorkspaceNav active={viewMode} onSelect={handleNavSelect} />

        <div className="flex min-w-0 flex-1 flex-col">
          {renderCenter()}
        </div>

        <VideoQueueModal
          open={videoQueueOpen}
          onClose={() => setVideoQueueOpen(false)}
          onOpenTask={(id) => {
            setVideoQueueOpen(false);
            setViewMode("history");
            // HistoryList opens the task detail via its own state; route through a
            // custom event so the user lands on the right task.
            window.dispatchEvent(new CustomEvent("open-task", { detail: id }));
          }}
        />

        {/* AI 创作引导 — 浮动入口 + 多轮对话浮层 */}
        {!agentOpen && (
          <button
            type="button"
            onClick={() => setAgentOpen(true)}
            className="fixed bottom-4 right-4 z-30 flex items-center gap-2 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-500/20 transition-transform hover:scale-105"
          >
            <span className="text-[15px]">✦</span>
            AI 引导
          </button>
        )}
        <AgentChat open={agentOpen} onClose={() => setAgentOpen(false)} onApply={handleApplySpec} />
      </div>
    </ToastProvider>
  );
}
