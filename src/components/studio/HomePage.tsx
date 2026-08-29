"use client";

import React from "react";
import { useToast } from "./toast-provider";
import { type WorkspaceView } from "./nav-items";
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
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/>
      </svg>
    ),
  },
  generation: {
    label: "生成",
    color: "#a78bfa",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
      </svg>
    ),
  },
  workflow: {
    label: "工作流",
    color: "#34d399",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 12h4l3-9 4 18 3-9h4"/>
      </svg>
    ),
  },
  video: {
    label: "视频",
    color: "#fbbf24",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/>
      </svg>
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
}

export function HomePage({
  onNewProject,
  recentProjects = [],
  onOpenProject,
  onOpenCanvasProject,
  activeNav = "home",
  onNavigate,
  onShowAllProjects,
}: HomePageProps) {
  const toast = useToast();
  return (
    <div className="relative flex h-screen w-screen overflow-hidden bg-[var(--color-canvas)] text-gray-200" style={{ fontFamily: "var(--font-sans)" }}>
      {/* ── Aurora Background Blobs ───────────────── */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <div
          className="absolute -right-[10%] -top-[20%] h-[70%] w-[55%] rounded-full opacity-50 mix-blend-screen"
          style={{
            background: "radial-gradient(circle, rgba(139,92,246,0.42) 0%, rgba(139,92,246,0) 70%)",
          }}
        />
        <div
          className="absolute -left-[15%] bottom-[15%] h-[55%] w-[45%] rounded-full opacity-50 mix-blend-screen"
          style={{
            background: "radial-gradient(circle, rgba(34,211,238,0.28) 0%, rgba(34,211,238,0) 70%)",
          }}
        />
      </div>

      {/* ── Left Sidebar Navigation ───────────────── */}
      <WorkspaceNav active={activeNav} onSelect={(id) => onNavigate?.(id)} />

      {/* ── Right Area: Top Bar + Main Content ──────────── */}
      <div className="relative z-10 flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* ── Top Bar ── */}
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/[0.05] bg-[var(--color-panel)]/88 px-5 py-0 backdrop-blur-md">
          {/* Search */}
          <div className="flex max-w-[280px] flex-1 items-center gap-2.5 rounded-lg border border-white/[0.07] bg-white/[0.03] px-3 py-1.8 text-sm text-gray-500 transition-colors focus-within:border-white/[0.13] focus-within:bg-white/[0.05]">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
            <span className="whitespace-nowrap">搜索项目、模板或技能...</span>
          </div>

          {/* Right side */}
          <div className="flex items-center gap-4">
            {/* Notification bell */}
            <button
              type="button"
              onClick={() => toast.info("通知", "暂无新消息")}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-white/[0.05] hover:text-gray-300"
              aria-label="通知"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>
            </button>

            {/* User avatar */}
            <button
              type="button"
              onClick={() => toast.info("账户", "点击头像可管理账号设置")}
              className="flex items-center gap-2 rounded-lg px-1 py-0.5 transition-colors hover:bg-white/[0.05]"
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
            <h1 className="mb-3 text-center text-[34px] font-bold tracking-tight text-[var(--color-ink)]">
              灵感从这里开始
            </h1>
            <p className="mb-10 text-center text-sm text-[var(--color-ink-faint)]">
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
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" />
                    </svg>
                  ),
                },
                {
                  id: "workshop",
                  label: "全链路工坊",
                  desc: "剧本 → 分镜 → 成片",
                  icon: (
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" /><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" />
                    </svg>
                  ),
                },
                {
                  id: "models",
                  label: "模型库",
                  desc: "管理 Checkpoint / LoRA",
                  icon: (
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" />
                    </svg>
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
                  className="group flex flex-col items-start gap-2.5 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 text-left transition-all hover:border-white/[0.14] hover:bg-white/[0.05] hover:shadow-lg hover:shadow-black/20"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/10 text-violet-300 transition-colors group-hover:bg-violet-500/15">
                    {card.icon}
                  </span>
                  <div>
                    <p className="text-sm font-medium text-gray-200">{card.label}</p>
                    <p className="mt-0.5 text-xs text-gray-500">{card.desc}</p>
                  </div>
                </button>
              ))}
            </div>

            {/* ── Recent Projects ── */}
            <section className="mt-14">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-[17px] font-semibold text-[var(--color-ink-field)]">最近项目</h2>
                <button
                  type="button"
                  onClick={() => onShowAllProjects?.()}
                  className="text-xs text-[var(--color-ink-faint)] transition-colors hover:text-gray-300"
                >
                  查看全部 →
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {/* New Project Card — canvas-style entry point */}
                <button
                  type="button"
                  onClick={onNewProject}
                  className="group flex flex-col items-center justify-center gap-2.5 rounded-[16px] border border-dashed border-white/[0.08] bg-white/[0.015] py-7 transition-all hover:border-cyan-400/25 hover:bg-cyan-400/[0.02] active:scale-[0.98]"
                >
                  <div className="flex h-[28px] w-[28px] items-center justify-center rounded-xl text-cyan-400/60 transition-colors group-hover:text-cyan-400">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                  </div>
                  <span className="text-[12.5px] font-medium text-[#7a8094] group-hover:text-cyan-400 transition-colors">
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
                        className="group flex items-start gap-3 rounded-[16px] border border-white/[0.06] bg-white/[0.02] p-3.5 text-left transition-all hover:border-white/[0.12] hover:bg-white/[0.04] active:scale-[0.98]"
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
                            <span className="truncate text-[13px] font-medium text-[var(--color-ink-field)] group-hover:text-white transition-colors">
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
                          <div className="mt-1 flex items-center gap-2 text-[11.5px] text-[var(--color-ink-fainter)]">
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
                                  className="h-10 w-10 shrink-0 rounded-lg object-cover ring-1 ring-white/[0.06]"
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
                        className="flex items-start gap-3 rounded-[16px] border border-white/[0.05] bg-white/[0.015] p-3.5 opacity-50"
                      >
                        <div
                          className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                          style={{ backgroundColor: `${cfg.color}12`, color: cfg.color }}
                        >
                          {cfg.icon}
                        </div>
                        <div className="flex-1">
                          <div className="h-3.5 w-3/4 rounded bg-white/[0.06]" />
                          <div className="mt-2 h-3 w-1/2 rounded bg-white/[0.04]" />
                          <div className="mt-2.5 h-10 w-10 rounded-lg bg-white/[0.04]" />
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
