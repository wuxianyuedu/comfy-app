"use client";

import React, { useState, useCallback } from "react";
import Link from "next/link";

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

export interface QuickStartItem {
  id: string;
  title: string;
  cover: string;
  category?: string;
}

export interface RecentProject {
  id: string;
  name: string;
  updatedAt: string;
  thumbnails?: string[];
  type?: "image" | "video" | "workflow";
}

const QUICK_START_ITEMS: QuickStartItem[] = [
  { id: "qs-1", title: "首尾帧风格化工作流", cover: "", category: "工作流" },
  { id: "qs-2", title: "直出美术资产", cover: "", category: "图像" },
  { id: "qs-3", title: "剧本策划助手", cover: "", category: "剧本" },
  { id: "qs-4", title: "人物多视角生成", cover: "", category: "角色" },
];

/* ── Left Navigation Items (home view: simplified set) ── */
const NAV_ITEMS = [
  {
    id: "home",
    label: "首页",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" /><polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    ),
    href: "/workspace",
  },
  {
    id: "projects",
    label: "项目",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
      </svg>
    ),
    href: "/me/works",
  },
  {
    id: "skills",
    label: "技能",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
    ),
    href: "/workspace?tab=skills",
  },
];

/* Card type badge labels */
const TYPE_LABELS: Record<string, string> = {
  image: "图像",
  video: "视频",
  workflow: "工作流",
};

export interface HomePageProps {
  onSearch?: (query: string) => void;
  onQuickStart?: (item: QuickStartItem) => void;
  onNewProject?: () => void;
  recentProjects?: RecentProject[];
  onOpenProject?: (id: string) => void;
  /** Current active nav item */
  activeNav?: string;
}

export function HomePage({
  onSearch,
  onQuickStart,
  onNewProject,
  recentProjects = [],
  onOpenProject,
  activeNav = "home",
}: HomePageProps) {
  const [inputValue, setInputValue] = useState("");

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && inputValue.trim()) {
        onSearch?.(inputValue.trim());
      }
    },
    [inputValue, onSearch]
  );

  const handleSend = useCallback(() => {
    if (inputValue.trim()) {
      onSearch?.(inputValue.trim());
    }
  }, [inputValue, onSearch]);

  return (
    <div className="relative flex h-screen w-screen overflow-hidden bg-[#0a0a0f] text-gray-200" style={{ fontFamily: 'Inter, "Noto Sans SC", system-ui, -apple-system, sans-serif' }}>
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
      <nav className="relative z-10 flex w-[72px] shrink-0 flex-col items-center gap-2.5 border-r border-white/[0.06] bg-[#0c0c14]/95 py-5 backdrop-blur-sm">
        {/* Logo / Brand mark */}
        <Link
          href="/workspace"
          className="mb-7 flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/12 text-violet-400 ring-1 ring-violet-500/40"
          title="Comfy-APP"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
          </svg>
        </Link>

        {NAV_ITEMS.map((item) => {
          const isActive = activeNav === item.id;
          return (
            <Link
              key={item.id}
              href={item.href}
              className={`group flex h-12 w-12 flex-col items-center justify-center rounded-xl transition-all ${
                isActive
                  ? "bg-white/[0.08] text-white shadow-sm shadow-black/20 ring-1 ring-violet-500/20"
                  : "text-gray-500 hover:bg-white/[0.04] hover:text-gray-300"
              }`}
              title={item.label}
            >
              {item.icon}
              <span className={`mt-0.5 text-[10px] leading-none ${isActive ? "text-violet-300" : "text-gray-600 group-hover:text-gray-400"}`}>
                {item.label}
              </span>
            </Link>
          );
        })}

        {/* Bottom spacer */}
        <div className="mt-auto" />

        {/* Settings */}
        <button
          type="button"
          className="flex h-11 w-11 items-center justify-center rounded-xl text-gray-600 transition-colors hover:bg-white/[0.04] hover:text-gray-400"
          title="设置"
        >
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
          </svg>
        </button>
      </nav>

      {/* ── Right Area: Top Bar + Main Content ──────────── */}
      <div className="relative z-10 flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* ── Top Bar ── */}
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/[0.05] bg-[#14141a]/88 px-5 py-0 backdrop-blur-md">
          {/* Search */}
          <div className="flex max-w-[280px] flex-1 items-center gap-2.5 rounded-lg border border-white/[0.07] bg-white/[0.03] px-3 py-1.8 text-sm text-gray-500 transition-colors focus-within:border-white/[0.13] focus-within:bg-white/[0.05]">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
            <span className="whitespace-nowrap">搜索项目、模板或技能...</span>
          </div>

          {/* Right side */}
          <div className="flex items-center gap-4">
            {/* Notification bell */}
            <button type="button" className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-white/[0.05] hover:text-gray-300" aria-label="通知">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>
            </button>

            {/* User avatar */}
            <button type="button" className="flex items-center gap-2 rounded-lg px-1 py-0.5 transition-colors hover:bg-white/[0.05]">
              <div className="h-8 w-8 overflow-hidden rounded-full bg-gradient-to-br from-violet-500 to-indigo-400 ring-2 ring-white/20" />
            </button>
          </div>
        </header>

        {/* ── Main Content Area ──────────────────────── */}
        <main className="relative flex min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[960px] px-10 py-16">
            {/* ── Title ── */}
            <h1 className="mb-3 text-center text-[34px] font-bold tracking-tight" style={{
              backgroundImage: "linear-gradient(to right, #67e8f9, #93c5fd, #c4b5fd)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}>
              灵感从这里开始
            </h1>
            <p className="mb-10 text-center text-sm text-[#8b90a8]">
              用本地 AI 模型，自由创作图像、视频与专属模型
            </p>

            {/* ── Input Box (glassmorphic with violet glow) ── */}
            <div className="group relative overflow-hidden rounded-[22px] border border-white/[0.12] bg-white/[0.045] shadow-lg shadow-black/30 backdrop-blur-lg transition-all focus-within:border-white/[0.18] focus-within:bg-white/[0.06] focus-within:shadow-cyan-500/10 focus-within:shadow-violet-500/20"
              style={{
                boxShadow: "0 0 0 1px rgba(139,92,246,0.18), 0 0 26px rgba(139,92,246,0.12), inset 0 0 0 1px rgba(255,255,255,0.08), 0 12px 32px rgba(0,0,0,0.35)",
              }}>
              <div className="flex items-start gap-3.5 p-5.5 pb-3">
                {/* Upload button */}
                <button
                  type="button"
                  className="mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-dashed border-cyan-400/50 bg-cyan-400/6 text-cyan-400 transition-all hover:border-cyan-400 hover:bg-cyan-400/12"
                  title="上传素材"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </button>

                {/* Textarea */}
                <textarea
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  rows={2}
                  placeholder="输入创意想法，按 / 调用技能开始创作!"
                  className="min-h-[54px] flex-1 resize-none border-0 bg-transparent text-[15px] leading-relaxed text-gray-200 placeholder:text-[#6b7088] outline-none"
                />
              </div>

              {/* Bottom toolbar */}
              <div className="flex items-center justify-between border-t border-white/[0.05] px-5.5 py-2.5">
                <div className="flex items-center gap-2">
                  {[
                    { icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>, label: "技能" },
                    { icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>, label: "图库" },
                    { icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>, label: "音乐" },
                    { icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>, label: "模板" },
                  ].map(({ icon, label }) => (
                    <button
                      key={label}
                      type="button"
                      className="flex items-center gap-1.5 rounded-lg border border-white/[0.06] bg-white/[0.025] px-3 py-1.5 text-xs font-medium text-[#9aa0b5] transition-colors hover:border-white/[0.12] hover:bg-white/[0.04] hover:text-gray-300"
                    >
                      {icon}
                      {label}
                    </button>
                  ))}
                </div>

                {/* Send */}
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={!inputValue.trim()}
                  className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/[0.09] text-gray-300 shadow-sm transition-all disabled:opacity-30 hover:bg-white/[0.13] active:scale-95"
                  title="发送"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
                  </svg>
                </button>
              </div>

              {/* Connection status */}
              <div className="flex items-center gap-2 border-t border-white/[0.03] px-5.5 pt-1.5 pb-3">
                <span className="inline-block h-[7px] w-[7px] rounded-full bg-emerald-400 shadow-sm shadow-emerald-400/40" />
                <span className="text-[11.5px] text-[#6b788f]">
                  ComfyUI 本地已连接 · GPU 就绪
                </span>
              </div>
            </div>

            {/* ── Quick Action Pills ── */}
            <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
              {QUICK_START_ITEMS.map((pill) => (
                <button
                  key={pill.id}
                  type="button"
                  onClick={() => onQuickStart?.({ id: pill.id, title: pill.title, cover: "", category: "" })}
                  className="group flex items-center gap-1.5 rounded-full border border-white/[0.07] bg-white/[0.02] px-3.5 py-2 text-[12.5px] text-[#b6bccf] transition-all hover:border-white/[0.14] hover:bg-white/[0.05] hover:text-gray-200"
                >
                  {pill.title}
                </button>
              ))}
            </div>

            {/* ── Recent Projects ── */}
            <section className="mt-14">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-[17px] font-semibold text-[#e5e7eb]">最近项目</h2>
                <Link
                  href="/me/works"
                  className="text-xs text-[#8b90a8] transition-colors hover:text-gray-300"
                >
                  查看全部 →
                </Link>
              </div>

              <div className="grid grid-cols-4 gap-4">
                {/* New Project Card */}
                <button
                  type="button"
                  onClick={onNewProject}
                  className="group aspect-[4/3] min-h-[171px] flex flex-col items-center justify-center rounded-[18px] border-2 border-dashed border-white/[0.08] bg-white/[0.02] transition-all hover:border-cyan-400/30 hover:bg-cyan-400/[0.03] hover:shadow-md hover:shadow-cyan-400/5 active:scale-[0.98]"
                >
                  <div className="flex h-[26px] w-[26px] items-center justify-center rounded-xl text-cyan-400/70 transition-colors group-hover:text-cyan-400">
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                  </div>
                  <span className="mt-3 text-[12.5px] font-medium text-[#8b90a8] group-hover:text-cyan-400 transition-colors">
                    新建项目
                  </span>
                </button>

                {/* Recent project cards */}
                {recentProjects.length > 0 ? (
                  recentProjects.slice(0, 3).map((proj) => (
                    <button
                      key={proj.id}
                      type="button"
                      onClick={() => onOpenProject?.(proj.id)}
                      className="group relative aspect-[4/3] min-h-[171px] overflow-hidden rounded-[18px] transition-all hover:-translate-y-0.5 hover:shadow-xl hover:shadow-black/30 active:scale-[0.98]"
                      style={{
                        background: proj.type === "video"
                          ? "linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)"
                          : proj.type === "workflow"
                            ? "linear-gradient(135deg, #10b981 0%, #06b6d4 100%)"
                            : "linear-gradient(135deg, #7c3aed 0%, #2563eb 100%)",
                      }}
                    >
                      {/* Type badge */}
                      {proj.type && (
                        <span className="absolute right-2 top-2 rounded-md bg-black/55 px-2 py-0.5 text-[10px] font-medium text-white/90 ring-1 ring-white/12 backdrop-blur-sm">
                          {TYPE_LABELS[proj.type] ?? proj.type}
                        </span>
                      )}
                      {/* Info overlay */}
                      <div className="absolute inset-x-0 bottom-0 bg-black/50 backdrop-blur-sm px-3 py-2">
                        <p className="truncate text-[12px] font-medium text-[#f1f3f8]">{proj.name}</p>
                        <p className="mt-0.5 text-[11px] text-[#aab0c0]">{proj.updatedAt}</p>
                      </div>
                    </button>
                  ))
                ) : (
                  /* Empty state placeholders */
                  [1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="aspect-[4/3] min-h-[171px] rounded-[18px] bg-white/[0.02] ring-1 ring-inset ring-white/[0.04]"
                      style={{
                        background: i === 1
                          ? "linear-gradient(135deg, #7c3aed 0%, #2563eb 100%)"
                          : i === 2
                            ? "linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)"
                            : "linear-gradient(135deg, #10b981 0%, #06b6d4 100%)",
                        opacity: 0.6,
                      }}
                    />
                  ))
                )}
              </div>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}
