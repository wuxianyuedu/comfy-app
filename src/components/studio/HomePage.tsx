"use client";

import React from "react";
import { Activity, Bell, BookOpen, Box, Image as ImageIcon, LayoutTemplate, Plus, Search, Video } from "lucide-react";
import { useToast } from "./ToastProvider";
import { type WorkspaceView } from "./NavItems";
import { WorkspaceNav } from "./WorkspaceNav";

/* ── Home Page — Updream-style Full-Screen Dashboard (Ardot-aligned) ─
  Dark-themed home page with left sidebar navigation + top bar + aurora bg.
  Matches Ardot design spec: dark-aurora (#0a0a0f) + violet #8B5CF6 accent.

  Layout:
  ┌────┬──────────────────────────────────────────┐
  │    │  ╔══ Top Bar (search · bell · avatar) ════╗ │
  │ L  │  ╚═══════════════════════════════════════╝ │
  │ e  │  Title: 灵感从这里开始!                  │
  │ f  │  Input box + toolbar                     │
  │ t  │  Quick action pills                      │
  │(72│  Recent projects grid                    │
  │px)│                                          │
  │    │  [aurora blobs behind everything]        │
  └────┴──────────────────────────────────────────┘
*/

export interface RecentProject {
  id: string;
  name: string;
  updatedAt: string;
  thumbnails?: string[];
  /** Project kind — determines the icon and visual treatment */
  kind?: "canvas" | "generation" | "workflow" | "video";
  /** Secondary line: e.g. "12 节点", "4 张图", "Wan I2V" */
  subtitle?: string;
}

/* Card type badge labels & icons */
const KIND_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  canvas: {
    label: "画布",
    color: "#22d3ee",
    icon: (
      <LayoutTemplate size={14} />
    ),
  },
  generation: {
    label: "生成",
    color: "#a78bfa",
    icon: (
      <ImageIcon size={14} />
    ),
  },
  workflow: {
    label: "工作流",
    color: "#34d399",
    icon: (
      <Activity size={14} />
    ),
  },
  video: {
    label: "视频",
    color: "#fbbf24",
    icon: (
      <Video size={14} />
    ),
  },
};

export interface HomePageProps {
  onNewProject?: () => void;
  recentProjects?: RecentProject[];
  onOpenProject?: (id: string) => void;
  /** Open a canvas project (jump to canvas view, not /create/{id}). */
  onOpenCanvasProject?: (id: string) => void;
  /** Current active nav item (WorkspaceView id) */
  activeNav?: WorkspaceView;
  /** Navigate to a workspace view (models / workflows / canvas etc.) */
  onNavigate?: (view: WorkspaceView) => void;
  /** Switch to the "项目" (works) tab to show all projects */
  onShowAllProjects?: () => void;
  /** Open the settings overlay (keep workspace tree alive). */
  onOpenSettings?: () => void;
}

export function HomePage({
  onNewProject,
  recentProjects = [],
  onOpenProject,
  onOpenCanvasProject,
  activeNav = "home",
  onNavigate,
  onShowAllProjects,
  onOpenSettings,
}: HomePageProps) {
  const toast = useToast();
  return (
    <div className="relative flex h-screen w-screen overflow-hidden bg-(--color-canvas) text-(--color-ink) pb-6" style={{ fontFamily: "var(--font-sans)" }}>
      {/* ── Aurora Background Blobs ───────────────── */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <div
          className="absolute right-[-10%] top-[-20%] h-[70%] w-[55%] rounded-full opacity-50 mix-blend-screen"
          style={{
            background: "radial-gradient(circle, rgba(139,92,246,0.42) 0%, rgba(139,92,246,0) 70%)",
          }}
        />
        <div
          className="absolute left-[-15%] bottom-[15%] h-[55%] w-[45%] rounded-full opacity-50 mix-blend-screen"
          style={{
            background: "radial-gradient(circle, rgba(34,211,238,0.28) 0%, rgba(34,211,238,0) 70%)",
          }}
        />
      </div>

      {/* ── Left Sidebar Navigation ───────────────── */}
      <WorkspaceNav
        active={activeNav}
        onSelect={(id) => onNavigate?.(id)}
        onOpenSettings={onOpenSettings}
      />

      {/* ── Right Area: Top Bar + Main Content ──────────── */}
      <div className="relative z-10 flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* ── Top Bar ── */}
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-(--color-border-subtle) bg-(--color-panel)/88 px-5 py-0 backdrop-blur-md">
          {/* Search */}
          <div className="flex max-w-[280px] flex-1 items-center gap-2.5 rounded-lg border border-(--color-border) bg-(--color-subtle) px-3 py-1.8 text-sm text-(--color-ink-fainter) transition-colors focus-within:border-(--color-border-strong) focus-within:bg-(--color-surface-1)">
            <Search size={16} />
            <span className="whitespace-nowrap">搜索项目、模板或技能...</span>
          </div>

          {/* Right side */}
          <div className="flex items-center gap-4">
            {/* Notification bell */}
            <button
              type="button"
              onClick={() => toast.info("通知", "暂无新消息")}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-(--color-ink-muted) transition-colors hover:bg-(--color-subtle) hover:text-(--color-ink-strong)"
              aria-label="通知"
            >
              <Bell size={18} strokeWidth={1.8} />
            </button>

            {/* User avatar */}
            <button
              type="button"
              onClick={() => toast.info("账户", "点击头像可管理账号设置")}
              className="flex items-center gap-2 rounded-lg px-1 py-0.5 transition-colors hover:bg-(--color-subtle)"
              title="账户"
            >
              <div className="u-avatar h-8 w-8 overflow-hidden rounded-full" />
            </button>
          </div>
        </header>

        {/* ── Main Content Area ──────────────────────── */}
        <main className="relative flex min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[960px] px-10 py-16">
            {/* ── Title ── */}
            <h1 className="mb-3 text-center text-[34px] font-bold tracking-tight text-(--color-ink)">
              灵感从这里开始
            </h1>
            <p className="mb-10 text-center text-sm text-(--color-ink-faint)">
              用本地 AI 模型，自由创作图像、视频与专属模型
            </p>

            {/* ── Quick Entry Cards ── */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                {
                  id: "canvas",
                  label: "新建画布",
                  desc: "自由编排节点工作流",
                  icon: (
                    <LayoutTemplate size={22} strokeWidth={1.8} />
                  ),
                },
                {
                  id: "workshop",
                  label: "全链路工坊",
                  desc: "剧本 → 分镜 → 成片",
                  icon: (
                    <BookOpen size={22} strokeWidth={1.8} />
                  ),
                },
                {
                  id: "models",
                  label: "模型库",
                  desc: "管理 Checkpoint / LoRA",
                  icon: (
                    <Box size={22} strokeWidth={1.8} />
                  ),
                },
                {
                  id: "workflows",
                  label: "工作流库",
                  desc: "导入和复用工作流",
                  icon: (
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /><path d="M10 6.5h4a3 3 0 013 3v4.5" />
                    </svg>
                  ),
                },
              ].map((card) => (
                <button
                  key={card.id}
                  type="button"
                  onClick={() => onNavigate?.(card.id as WorkspaceView)}
                  className="group flex flex-col items-start gap-2.5 rounded-2xl border border-(--color-border) bg-(--color-surface-1) p-4 text-left transition-all hover:border-(--color-border-strong) hover:bg-(--color-surface-2) hover:shadow-lg hover:shadow-black/10"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/10 text-violet-500 transition-colors group-hover:bg-violet-500/15">
                    {card.icon}
                  </span>
                  <div>
                    <p className="text-sm font-medium text-(--color-ink-bright)">{card.label}</p>
                    <p className="mt-0.5 text-xs text-(--color-ink-muted)">{card.desc}</p>
                  </div>
                </button>
              ))}
            </div>

            {/* ── Recent Projects ── */}
            <section className="mt-14">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-[17px] font-semibold text-(--color-ink-field)">最近项目</h2>
                <button
                  type="button"
                  onClick={() => onShowAllProjects?.()}
                  className="text-xs text-(--color-ink-faint) transition-colors hover:text-(--color-ink-strong)"
                >
                  查看全部 →
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {/* New Project Card — canvas-style entry point */}
                <button
                  type="button"
                  onClick={onNewProject}
                  className="group flex flex-col items-center justify-center gap-2.5 rounded-[16px] border border-dashed border-(--color-border) bg-(--color-surface-1) py-7 transition-all hover:border-cyan-400/40 hover:bg-cyan-400/5 active:scale-[0.98]"
                >
                  <div className="flex h-[28px] w-[28px] items-center justify-center rounded-xl text-cyan-400/60 transition-colors group-hover:text-cyan-400">
                    <Plus size={24} strokeWidth={1.6} />
                  </div>
                  <span className="text-[12.5px] font-medium text-(--color-ink-muted) group-hover:text-cyan-500 transition-colors">
                    新建画布项目
                  </span>
                </button>

                {/* Recent project cards — canvas / project style */}
                {recentProjects.length > 0 ? (
                  recentProjects.slice(0, 3).map((proj) => {
                    const cfg = KIND_CONFIG[proj.kind ?? "generation"] ?? KIND_CONFIG.generation;
                    return (
                      <button
                        key={proj.id}
                        type="button"
                        onClick={() =>
                          proj.kind === "canvas"
                            ? onOpenCanvasProject?.(proj.id)
                            : onOpenProject?.(proj.id)
                        }
                        className="group flex items-start gap-3 rounded-[16px] border border-(--color-border) bg-(--color-surface-1) p-3.5 text-left transition-all hover:border-(--color-border-strong) hover:bg-(--color-surface-2) active:scale-[0.98]"
                      >
                        {/* Kind icon */}
                        <div
                          className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors"
                          style={{ backgroundColor: `${cfg!.color}15`, color: cfg!.color }}
                        >
                          {cfg!.icon}
                        </div>

                        {/* Info */}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate text-[13px] font-medium text-(--color-ink-bright) group-hover:text-(--color-ink) transition-colors">
                              {proj.name}
                            </span>
                            <span
                              className="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset backdrop-blur-sm"
                              style={{
                                color: cfg!.color,
                                backgroundColor: `${cfg!.color}15`,
                                ["--tw-ring-color" as string]: `${cfg!.color}30`,
                              }}
                            >
                              {cfg!.label}
                            </span>
                          </div>
                          <div className="mt-1 flex items-center gap-2 text-[11.5px] text-(--color-ink-fainter)">
                            {proj.subtitle && <span>{proj.subtitle}</span>}
                            <span className="shrink-0">{proj.updatedAt}</span>
                          </div>

                          {/* Mini thumbnail strip (if available) */}
                          {proj.thumbnails && proj.thumbnails.length > 0 && (
                            <div className="mt-2.5 flex gap-1 overflow-hidden">
                              {proj.thumbnails.slice(0, 3).map((thumb, ti) => (
                                <img
                                  key={ti}
                                  src={thumb}
                                  alt=""
                                  className="h-10 w-10 shrink-0 rounded-lg object-cover ring-1 ring-(--color-border-strong)"
                                  onError={(event) => { (event.target as HTMLImageElement).style.display = "none"; }}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  })
                ) : (
                  /* Empty state — placeholder cards */
                  [1, 2, 3].map((index) => {
                    const kinds = ["canvas", "generation", "workflow"] as const;
                    const cfg = KIND_CONFIG[kinds[index - 1]!]!;
                    return (
                      <div
                        key={kinds[index - 1]}
                        className="flex items-start gap-3 rounded-[16px] border border-(--color-border) bg-(--color-surface-1) p-3.5 opacity-60"
                      >
                        <div
                          className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                          style={{ backgroundColor: `${cfg.color}12`, color: cfg.color }}
                        >
                          {cfg.icon}
                        </div>
                        <div className="flex-1">
                          <div className="h-3.5 w-3/4 rounded bg-(--color-border-strong)" />
                          <div className="mt-2 h-3 w-1/2 rounded bg-(--color-border)" />
                          <div className="mt-2.5 h-10 w-10 rounded-lg bg-(--color-border)" />
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}
