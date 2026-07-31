"use client";

import React, { useState, useCallback } from "react";
import Link from "next/link";

/* ── Home Page — Updream-style Full-Screen Dashboard ─────────
  Dark-themed home page with left sidebar navigation.
  This IS the page itself — not embedded in any shell.

  Layout:
  ┌────┬──────────────────────────────────────────┐
  │    │  Title: 灵感从这里开始!                  │
  │ 左 │  Input box + toolbar                     │
  │ 侧 │  Quick action pills                      │
  │ 导 │  Recent projects grid                    │
  │ 航 │                                          │
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
}

const QUICK_START_ITEMS: QuickStartItem[] = [
  { id: "qs-1", title: "中式极简品牌VI设计", cover: "linear-gradient(135deg,#2d3748 0%,#1a202c 100%)", category: "设计" },
  { id: "qs-2", title: "印潮机器人3D动漫角色", cover: "linear-gradient(135deg,#2563eb 0%,#7c3aed 100%)", category: "角色" },
  { id: "qs-3", title: "宇宙星际科幻片分镜", cover: "linear-gradient(135deg,#0c1929 0%,#1e3a5f 50%,#0c1929 100%)", category: "分镜" },
  { id: "qs-4", title: "古水产品系列海报", cover: "linear-gradient(135deg,#7f1d1d 0%,#991b1b 40%,#1e293b 100%)", category: "海报" },
  { id: "qs-5", title: "治愈系插画故事绘本", cover: "linear-gradient(135deg,#92400e 0%,#78350f 50%,#451a03 100%)", category: "插画" },
];

/* ── Left Navigation Items ── */
const NAV_ITEMS = [
  {
    id: "home",
    label: "首页",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" /><polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    ),
    href: "/workspace",
  },
  {
    id: "projects",
    label: "项目",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
      </svg>
    ),
    href: "/me/works",
  },
  {
    id: "skills",
    label: "技能",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
    ),
    href: "/workspace?tab=skills",
  },
];

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
    <div className="flex h-screen w-screen overflow-hidden bg-[#0a0a0f] text-gray-200" style={{ fontFamily: 'Inter, "Noto Sans SC", system-ui, -apple-system, sans-serif' }}>
      {/* ── Left Sidebar Navigation ───────────────── */}
      <nav className="flex w-[60px] shrink-0 flex-col items-center gap-1 border-r border-white/[0.06] bg-[#0a0a0f]/80 py-4 backdrop-blur-sm">
        {/* Logo / Brand mark */}
        <Link
          href="/workspace"
          className="mb-6 flex h-9 w-9 items-center justify-center rounded-xl bg-violet-500/10 text-violet-400"
          title="Comfy-APP"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
          </svg>
        </Link>

        {NAV_ITEMS.map((item) => {
          const isActive = activeNav === item.id;
          return (
            <Link
              key={item.id}
              href={item.href}
              className={`group flex h-11 w-11 flex-col items-center justify-center rounded-xl transition-all ${
                isActive
                  ? "bg-white/[0.08] text-white shadow-sm shadow-black/20"
                  : "text-gray-500 hover:bg-white/[0.04] hover:text-gray-300"
              }`}
              title={item.label}
            >
              {item.icon}
              <span className={`mt-0.5 text-[10px] leading-none ${isActive ? "text-gray-300" : "text-gray-600 group-hover:text-gray-400"}`}>
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
          className="flex h-10 w-10 items-center justify-center rounded-xl text-gray-600 transition-colors hover:bg-white/[0.04] hover:text-gray-400"
          title="设置"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
          </svg>
        </button>
      </nav>

      {/* ── Main Content Area ──────────────────────── */}
      <main className="relative flex min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[900px] px-10 py-16">
          {/* ── Title ── */}
          <h1 className="mb-8 bg-gradient-to-r from-cyan-300 via-blue-300 to-violet-300 bg-clip-text text-center text-3xl font-semibold tracking-tight text-transparent">
            灵感从这里开始!
          </h1>

          {/* ── Input Box ── */}
          <div className="group relative overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-sm transition-all focus-within:border-white/[0.15] focus-within:bg-white/[0.05] focus-within:shadow-lg focus-within:shadow-cyan-500/5">
            <div className="flex items-start gap-3 p-5 pb-3">
              {/* Upload button */}
              <button
                type="button"
                className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-dashed border-white/[0.12] text-gray-500 transition-colors hover:border-cyan-400/50 hover:text-cyan-400"
                title="上传素材"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
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
                className="min-h-[52px] flex-1 resize-none border-0 bg-transparent text-sm leading-relaxed text-gray-200 placeholder:text-gray-600 outline-none"
              />
            </div>

            {/* Bottom toolbar */}
            <div className="flex items-center justify-between border-t border-white/[0.05] px-5 py-2.5">
              <div className="flex items-center gap-1.5">
                {/* Skill trigger */}
                <button
                  type="button"
                  className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:bg-white/[0.04] hover:text-gray-300"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></svg>
                  技能
                </button>

                {/* Gallery */}
                <button
                  type="button"
                  className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:bg-white/[0.04] hover:text-gray-300"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>
                  图库
                </button>

                {/* Music */}
                <button
                  type="button"
                  className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:bg-white/[0.04] hover:text-gray-300"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
                  音乐
                </button>

                {/* Template */}
                <button
                  type="button"
                  className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:bg-white/[0.04] hover:text-gray-300"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
                  模板
                </button>
              </div>

              {/* Right side: send */}
              <button
                type="button"
                onClick={handleSend}
                disabled={!inputValue.trim()}
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.08] text-gray-300 shadow-sm transition-all disabled:opacity-30 hover:bg-white/[0.12] active:scale-95"
                title="发送"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
                </svg>
              </button>
            </div>
          </div>

          {/* ── Quick Action Pills ── */}
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
            {[
              { label: "首尾风格格宽屏 · 副本处理工作流", icon: "📐" },
              { label: "副本直出美术资产", icon: "🎨" },
              { label: "剧本策划助手", icon: "✍️" },
              { label: "人物多视角生成", icon: "👤" },
            ].map((pill, i) => (
              <button
                key={i}
                type="button"
                onClick={() => onQuickStart?.({ id: `pill-${i}`, title: pill.label, cover: "", category: "" })}
                className="group flex items-center gap-1.5 rounded-full border border-white/[0.07] bg-white/[0.02] px-3.5 py-1.5 text-xs text-gray-400 transition-all hover:border-white/[0.14] hover:bg-white/[0.05] hover:text-gray-200"
              >
                <span className="text-[13px]">{pill.icon}</span>
                {pill.label}
              </button>
            ))}
          </div>

          {/* ── Recent Projects ── */}
          <section className="mt-14">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-300">最近项目</h2>
              <Link
                href="/me/works"
                className="text-xs text-gray-500 transition-colors hover:text-gray-300"
              >
                查看全部 →
              </Link>
            </div>

            <div className="grid grid-cols-4 gap-4">
              {/* New Project Card */}
              <button
                type="button"
                onClick={onNewProject}
                className="group flex aspect-[4/3] min-h-[160px] flex-col items-center justify-center rounded-2xl border-2 border-dashed border-white/[0.08] bg-white/[0.02] transition-all hover:border-cyan-400/30 hover:bg-cyan-400/[0.03] hover:shadow-md hover:shadow-cyan-400/5 active:scale-[0.98]"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-xl text-gray-600 transition-colors group-hover:text-cyan-400">
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </div>
                <span className="mt-3 text-xs font-medium text-gray-500 group-hover:text-cyan-400 transition-colors">
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
                    className="group relative aspect-[4/3] min-h-[160px] overflow-hidden rounded-2xl bg-white/[0.03] ring-1 ring-inset ring-white/[0.04] transition-all hover:ring-white/[0.08] hover:shadow-lg hover:shadow-black/20 hover:-translate-y-0.5 active:scale-[0.98]"
                  >
                    {/* Thumbnail grid */}
                    <div className="grid h-full grid-cols-2 grid-rows-2 gap-0.5 p-1.5">
                      {[...Array(4)].map((_, i) => (
                        <div key={i} className="overflow-hidden rounded-md bg-gradient-to-br from-violet-900/40 to-blue-900/40">
                          <div className="h-full w-full bg-gradient-to-br from-white/[0.03] to-white/[0.06]" />
                        </div>
                      ))}
                    </div>
                    {/* Info overlay */}
                    <div className="absolute inset-x-0 bottom-0 bg-black/60 backdrop-blur-sm px-3 py-2">
                      <p className="truncate text-xs font-medium text-gray-200">{proj.name}</p>
                      <p className="mt-0.5 text-[11px] text-gray-500">{proj.updatedAt}</p>
                    </div>
                  </button>
                ))
              ) : (
                /* Empty state placeholders matching reference style */
                <>
                  {[1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="aspect-[4/3] min-h-[160px] rounded-2xl bg-white/[0.02] ring-1 ring-inset ring-white/[0.04]"
                    />
                  ))}
                </>
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
