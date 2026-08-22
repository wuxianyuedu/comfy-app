"use client";

import React, { useState, useCallback, useRef } from "react";
import Link from "next/link";
import { useToast } from "./Toast";
import { NAV_ITEMS, type WorkspaceView } from "./nav-config";

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
  /** Project kind — determines the icon and visual treatment */
  kind?: "canvas" | "generation" | "workflow" | "video";
  /** Secondary line: e.g. "12 节点", "4 张图", "Wan I2V" */
  subtitle?: string;
}

const QUICK_START_ITEMS: QuickStartItem[] = [
  { id: "qs-1", title: "首尾帧风格化工作流", cover: "", category: "工作流" },
  { id: "qs-2", title: "直出美术资产", cover: "", category: "图像" },
  { id: "qs-3", title: "剧本策划助手", cover: "", category: "剧本" },
  { id: "qs-4", title: "人物多视角生成", cover: "", category: "角色" },
];

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
  onSearch?: (query: string) => void;
  onQuickStart?: (item: QuickStartItem) => void;
  onNewProject?: () => void;
  recentProjects?: RecentProject[];
  onOpenProject?: (id: string) => void;
  /** Open a canvas project (jump to canvas view, not /create/{id}). */
  onOpenCanvasProject?: (id: string) => void;
  /** Current active nav item (WorkspaceView id) */
  activeNav?: WorkspaceView;
  /** Navigate to a workspace view (skills / models / workflows / create etc.) */
  onNavigate?: (view: WorkspaceView) => void;
  /** Upload a material file → opens the create panel in "edit" mode pre-filled */
  onUploadImage?: (file: File) => void;
  /** Switch to the "项目" (works) tab to show all projects */
  onShowAllProjects?: () => void;
}

export function HomePage({
  onSearch,
  onQuickStart,
  onNewProject,
  recentProjects = [],
  onOpenProject,
  onOpenCanvasProject,
  activeNav = "home",
  onNavigate,
  onUploadImage,
  onShowAllProjects,
}: HomePageProps) {
  const toast = useToast();
  const [inputValue, setInputValue] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeChip, setActiveChip] = useState<string | null>(null);

  const handlePickImage = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      if (onUploadImage) {
        onUploadImage(file);
      } else {
        toast.info("上传素材", "创作台暂未就绪，请稍后再试");
      }
    },
    [onUploadImage, toast]
  );

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
      <nav className="relative z-10 flex w-[72px] shrink-0 flex-col items-center gap-2.5 border-r border-white/[0.06] bg-[#0f0f16]/95 py-5 backdrop-blur-sm">
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
          const isEnabled = item.enabled !== false;
          return (
            <button
              key={item.id}
              type="button"
              disabled={!isEnabled}
              onClick={() => {
                if (!isEnabled) return;
                if (item.id === "home") {
                  // Already on home — no-op, but allow toast for click feedback
                  return;
                }
                onNavigate?.(item.id);
              }}
              className={`group flex h-[42px] w-[42px] flex-col items-center justify-center rounded-xl transition-all ${
                isActive
                  ? "bg-white/[0.08] text-white shadow-sm shadow-black/20 ring-1 ring-violet-500/25"
                  : isEnabled
                    ? "text-gray-500 hover:bg-white/[0.04] hover:text-gray-300"
                    : "cursor-not-allowed text-gray-700 opacity-50"
              }`}
              title={isEnabled ? item.label : `${item.label}（即将推出）`}
              aria-current={isActive ? "page" : undefined}
            >
              {item.icon}
              <span
                className={`mt-0.5 text-[10px] leading-none ${
                  isActive ? "text-violet-300" : isEnabled ? "text-gray-600 group-hover:text-gray-400" : "text-gray-700"
                }`}
              >
                {item.label}
              </span>
            </button>
          );
        })}

        {/* Bottom spacer */}
        <div className="mt-auto" />

        {/* Settings */}
        <Link
          href="/settings"
          className="flex h-11 w-11 items-center justify-center rounded-xl text-gray-600 transition-colors hover:bg-white/[0.04] hover:text-gray-400"
          title="设置"
        >
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
          </svg>
        </Link>
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
            <p className="mb-10 text-center text-sm text-[#8b90a8]">
              用本地 AI 模型，自由创作图像、视频与专属模型
            </p>

            {/* ── Input Box (glassmorphic with violet glow) ── */}
            <div className="group relative overflow-hidden rounded-[22px] u-card u-card-hover transition-all focus-within:border-[var(--color-primary)]">
              <div className="flex items-start gap-3.5 p-5.5 pb-3">
                {/* Upload button */}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-dashed border-cyan-400/50 bg-cyan-400/6 text-cyan-400 transition-all hover:border-cyan-400 hover:bg-cyan-400/12"
                  title="上传素材"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handlePickImage}
                />

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
                    {
                      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>,
                      label: "技能",
                      key: "skills",
                      options: [
                        { label: "文生图", desc: "文字描述生成图像", action: "txt2img" },
                        { label: "图生图", desc: "参考图像风格转换", action: "img2img" },
                        { label: "文生视频", desc: "文字生成视频片段", action: "t2v" },
                        { label: "超分辨率", desc: "图像高清放大修复", action: "upscale" },
                        { label: "智能抠图", desc: "自动识别前景主体", action: "inpaint" },
                      ],
                    },
                    {
                      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>,
                      label: "图库",
                      key: "models",
                      options: [
                        { label: "浏览全部模型", desc: "查看已加载的 Checkpoint", action: "models" },
                        { label: "SDXL / SD1.5", desc: "Stable Diffusion 系列模型", action: "models?sdxl" },
                        { label: "Wan 视频", desc: "视频生成专用模型", action: "models?wan" },
                        { label: "Flux", desc: "最新 FLUX.1 系列模型", action: "models?flux" },
                      ],
                    },
                    {
                      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>,
                      label: "音乐",
                      key: "music",
                      options: [
                        { label: "即将上线", desc: "音频创作功能开发中 ♪", action: null },
                      ],
                    },
                    {
                      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>,
                      label: "模板",
                      key: "workflows",
                      options: [
                        { label: "工作流库", desc: "浏览和导入自定义工作流", action: "workflows" },
                        { label: "文生图工作流", desc: "T2I 标准流程模板", action: "workflows?t2i" },
                        { label: "图生视频", desc: "I2V Wan 视频模板", action: "workflows?i2v" },
                        { label: "训练工作流", desc: "模型微调/训练流程", action: "workflows?train" },
                      ],
                    },
                  ].map((chip) => (
                    <div key={chip.key} className="relative">
                      <button
                        type="button"
                        onClick={() => setActiveChip(activeChip === chip.key ? null : chip.key)}
                        className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                          activeChip === chip.key
                            ? "border-violet-400/50 bg-violet-500/12 text-violet-300"
                            : "border-white/[0.06] bg-white/[0.025] text-[#9aa0b5] hover:border-white/[0.12] hover:bg-white/[0.04] hover:text-gray-300"
                        }`}
                      >
                        {chip.icon}
                        {chip.label}
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className={`transition-transform ${activeChip === chip.key ? "rotate-180" : ""}`}>
                          <path d="M6 9l6 6 6-6" />
                        </svg>
                      </button>

                      {/* Popover */}
                      {activeChip === chip.key && (
                        <>
                          {/* Backdrop to close on click outside */}
                          <div className="fixed inset-0 z-30" onClick={() => setActiveChip(null)} />
                          <div className="absolute left-0 top-full z-40 mt-1.5 w-56 origin-top-left rounded-xl border border-white/[0.08] bg-[#16161C]/95 p-1.5 shadow-xl shadow-black/40 backdrop-blur-lg">
                            <p className="mb-1.5 px-2.5 text-[10px] font-semibold uppercase tracking-wider text-gray-600">
                              {chip.label}快捷入口
                            </p>
                            {chip.options.map((opt) => (
                              <button
                                key={opt.label}
                                type="button"
                                onClick={() => {
                                  setActiveChip(null);
                                  if (opt.action) {
                                    if (chip.key === "music") {
                                      toast.info("音乐创作", opt.desc);
                                    } else {
                                      // `opt.action` carries strings like "txt2img" / "t2v"
                                      // that are NOT WorkspaceView ids — those fall through
                                      // the white-list in `handleHomeNavigate` and become no-ops.
                                      // Accept here as `WorkspaceView | string` so the call type-checks.
                                      onNavigate?.(opt.action as WorkspaceView);
                                    }
                                  } else {
                                    toast.info(chip.label, opt.desc);
                                  }
                                }}
                                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-white/[0.06]"
                              >
                                <span className="text-[13px] font-medium text-gray-200">{opt.label}</span>
                                <span className="text-[11px] text-gray-500">{opt.desc}</span>
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
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
                <button
                  type="button"
                  onClick={() => onShowAllProjects?.()}
                  className="text-xs text-[#8b90a8] transition-colors hover:text-gray-300"
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
                            <span className="truncate text-[13px] font-medium text-[#e5e7eb] group-hover:text-white transition-colors">
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
                          <div className="mt-1 flex items-center gap-2 text-[11.5px] text-[#6b7088]">
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
                                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
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
                  [1, 2, 3].map((i) => {
                    const kinds = ["canvas", "generation", "workflow"] as const;
                    const cfg = KIND_CONFIG[kinds[i - 1]!]!;
                    return (
                      <div
                        key={i}
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
