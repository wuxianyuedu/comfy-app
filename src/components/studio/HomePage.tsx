"use client";

import React from "react";
import {
  Activity,
  Bell,
  BookOpen,
  Box,
  Image as ImageIcon,
  LayoutTemplate,
  Plus,
  Search,
  Video,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { AuroraGlow } from "~/components/ui/aurora-background";
import { useToast } from "./ToastProvider";
import { type WorkspaceView } from "./NavItems";
import { WorkspaceNav } from "./WorkspaceNav";

/* ── 首页 —— Updream 风全屏仪表盘（对齐 Ardot） ─
  深色主题首页，左侧栏导航 + 顶栏 + 极光背景。
  对齐 Ardot 设计规范：深色极光（#0a0a0f）+ 紫 #8B5CF6 强调。

  布局：
  ┌────┬──────────────────────────────────────────┐
  │    │  ╔══ 顶栏（搜索 · 铃铛 · 头像） ════╗ │
  │ 左  │  ╚═══════════════════════════════════╝ │
  │ 侧  │  标题：灵感从这里开始!                  │
  │ 栏  │  输入框 + 工具栏                         │
  │    │  快捷动作药丸                      │
  │(72│  最近项目栅格                    │
  │px)│                                          │
  │    │  [极光光斑在所有内容之后]        │
  └────┴──────────────────────────────────────────┘
*/

export interface RecentProject {
  id: string;
  name: string;
  updatedAt: string;
  thumbnails?: string[];
  /** 项目种类 —— 决定图标与视觉处理 */
  kind?: "canvas" | "generation" | "workflow" | "video";
  /** Secondary line: e.g. "12 节点", "4 张图", "Wan I2V" */
  subtitle?: string;
}

/* 卡片类型徽标文案与图标 */
const KIND_CONFIG: Record<
  string,
  { label: string; color: string; icon: React.ReactNode }
> = {
  canvas: {
    label: "画布",
    color: "#22d3ee",
    icon: <LayoutTemplate size={14} />,
  },
  generation: {
    label: "生成",
    color: "#a78bfa",
    icon: <ImageIcon size={14} />,
  },
  workflow: {
    label: "工作流",
    color: "#34d399",
    icon: <Activity size={14} />,
  },
  video: {
    label: "视频",
    color: "#fbbf24",
    icon: <Video size={14} />,
  },
};

export interface HomePageProps {
  onNewProject?: () => void;
  recentProjects?: RecentProject[];
  onOpenProject?: (id: string) => void;
  /** 打开一个画布项目（跳到画布视图，而不是 /create/{id}）。 */
  onOpenCanvasProject?: (id: string) => void;
  /** 当前活跃的导航项（WorkspaceView id） */
  activeNav?: WorkspaceView;
  /** 跳到一个工作区视图（模型 / 工作流 / 画布等） */
  onNavigate?: (view: WorkspaceView) => void;
  /** Switch to the "项目" (works) tab to show all projects */
  onShowAllProjects?: () => void;
  /** 打开设置浮层（保持工作区树存活）。 */
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
    <div
      className="bg-canvas text-ink relative flex h-full w-full overflow-hidden"
      style={{ fontFamily: "var(--font-sans)" }}
    >
      {/* ── 极光背景光斑 ───────────────── */}
      <div
        className="pointer-events-none absolute inset-0 overflow-hidden"
        aria-hidden
      >
        <AuroraGlow
          tone="violet"
          alpha={0.42}
          className="top-[-20%] right-[-10%] h-[70%] w-[55%] opacity-50 mix-blend-screen"
        />
        <AuroraGlow
          tone="cyan"
          alpha={0.28}
          className="bottom-[15%] left-[-15%] h-[55%] w-[45%] opacity-50 mix-blend-screen"
        />
      </div>

      {/* ── 左侧栏导航 ───────────────── */}
      <WorkspaceNav
        active={activeNav}
        onSelect={(id) => onNavigate?.(id)}
        onOpenSettings={onOpenSettings}
      />

      {/* ── 右侧区：顶栏 + 主内容 ──────────── */}
      <div className="relative z-10 flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* ── Top Bar ── */}
        <header className="border-border-subtle bg-panel/88 flex shrink-0 items-center justify-between gap-3 border-b px-5 py-0 backdrop-blur-md">
          {/* Search */}
          <div className="border-border bg-subtle py-1.8 text-ink-fainter focus-within:border-border-strong focus-within:bg-surface-1 flex max-w-[280px] flex-1 items-center gap-2.5 rounded-lg border px-3 text-sm transition-colors">
            <Search size={16} />
            <span className="whitespace-nowrap">搜索项目、模板或技能...</span>
          </div>

          {/* Right side */}
          <div className="flex items-center gap-4">
            {/* Notification bell */}
            <Button
              variant="ghost"
              size="icon-lg"
              onClick={() => toast.info("通知", "暂无新消息")}
              className="text-ink-muted hover:bg-subtle hover:text-ink-strong rounded-lg"
              aria-label="通知"
            >
              <Bell size={18} strokeWidth={1.8} />
            </Button>

            {/* User avatar */}
            <Button
              variant="ghost"
              onClick={() => toast.info("账户", "点击头像可管理账号设置")}
              className="hover:bg-subtle h-auto gap-2 rounded-lg px-1 py-0.5"
              title="账户"
            >
              <div className="u-avatar h-8 w-8 overflow-hidden rounded-full" />
            </Button>
          </div>
        </header>

        {/* ── 主内容区 ──────────────────────── */}
        <main className="relative flex min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[960px] px-10 py-16">
            {/* ── Title ── */}
            <h1 className="text-ink mb-3 text-center text-[34px] font-bold tracking-tight">
              灵感从这里开始
            </h1>
            <p className="text-ink-faint mb-10 text-center text-sm">
              用本地 AI 模型，自由创作图像、视频与专属模型
            </p>

            {/* ── 快捷入口卡片 ── */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                {
                  id: "canvas",
                  label: "新建画布",
                  desc: "自由编排节点工作流",
                  icon: <LayoutTemplate size={22} strokeWidth={1.8} />,
                },
                {
                  id: "workshop",
                  label: "全链路工坊",
                  desc: "剧本 → 分镜 → 成片",
                  icon: <BookOpen size={22} strokeWidth={1.8} />,
                },
                {
                  id: "models",
                  label: "模型库",
                  desc: "管理 Checkpoint / LoRA",
                  icon: <Box size={22} strokeWidth={1.8} />,
                },
                {
                  id: "workflows",
                  label: "工作流库",
                  desc: "导入和复用工作流",
                  icon: (
                    <svg
                      width="22"
                      height="22"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="3" y="3" width="7" height="7" rx="1.5" />
                      <rect x="14" y="14" width="7" height="7" rx="1.5" />
                      <path d="M10 6.5h4a3 3 0 013 3v4.5" />
                    </svg>
                  ),
                },
              ].map((card) => (
                <Button
                  key={card.id}
                  variant="ghost"
                  onClick={() => onNavigate?.(card.id as WorkspaceView)}
                  className="group border-border bg-surface-1 hover:border-border-strong hover:bg-surface-2 flex h-auto flex-col items-start gap-2.5 rounded-2xl border p-4 text-left font-normal transition-all hover:shadow-lg hover:shadow-black/5 dark:shadow-black/10"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/10 text-violet-800 transition-colors group-hover:bg-violet-500/15 dark:text-violet-300">
                    {card.icon}
                  </span>
                  <div>
                    <p className="text-ink-bright text-sm font-medium">
                      {card.label}
                    </p>
                    <p className="text-ink-muted mt-0.5 text-xs">{card.desc}</p>
                  </div>
                </Button>
              ))}
            </div>

            {/* ── Recent Projects ── */}
            <section className="mt-14">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-ink-field text-[17px] font-semibold">
                  最近项目
                </h2>
                <Button
                  variant="link"
                  onClick={() => onShowAllProjects?.()}
                  className="text-ink-faint hover:text-ink-strong h-auto p-0 text-xs"
                >
                  查看全部 →
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {/* 新建项目卡片 —— 画布风入口 */}
                <Button
                  variant="ghost"

                  onClick={onNewProject}
                  className="group border-border bg-surface-1 hover:bg-info/5 flex h-auto flex-col items-center justify-center gap-2.5 rounded-[16px] border border-dashed py-7 font-normal active:scale-[0.98]"
                >
                  <div className="flex h-[28px] w-[28px] items-center justify-center rounded-xl text-cyan-700/70 transition-colors group-hover:text-cyan-700 dark:text-cyan-400/60 dark:group-hover:text-cyan-400">
                    <Plus size={24} strokeWidth={1.6} />
                  </div>
                  <span className="text-ink-muted text-[12.5px] font-medium transition-colors group-hover:text-cyan-700 dark:text-cyan-500">
                    新建画布项目
                  </span>
                </Button>

                {/* 最近项目卡片 —— 画布 / 项目风 */}
                {recentProjects.length > 0
                  ? recentProjects.slice(0, 3).map((proj) => {
                      const cfg =
                        KIND_CONFIG[proj.kind ?? "generation"] ??
                        KIND_CONFIG.generation;
                      return (
                        <Button
                          key={proj.id}
                          variant="ghost"
                          onClick={() =>
                            proj.kind === "canvas"
                              ? onOpenCanvasProject?.(proj.id)
                              : onOpenProject?.(proj.id)
                          }
                          className="group border-border bg-surface-1 hover:border-border-strong hover:bg-surface-2 flex h-auto items-start gap-3 rounded-[16px] border p-3.5 text-left font-normal active:scale-[0.98]"
                        >
                          {/* Kind icon */}
                          <div
                            className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors"
                            style={{
                              backgroundColor: `${cfg!.color}15`,
                              color: cfg!.color,
                            }}
                          >
                            {cfg!.icon}
                          </div>

                          {/* Info */}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="text-ink-bright group-hover:text-ink truncate text-[13px] font-medium transition-colors">
                                {proj.name}
                              </span>
                              <span
                                className="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium ring-1 backdrop-blur-sm ring-inset"
                                style={{
                                  color: cfg!.color,
                                  backgroundColor: `${cfg!.color}15`,
                                  ["--tw-ring-color" as string]: `${cfg!.color}30`,
                                }}
                              >
                                {cfg!.label}
                              </span>
                            </div>
                            <div className="text-ink-fainter mt-1 flex items-center gap-2 text-[11.5px]">
                              {proj.subtitle && <span>{proj.subtitle}</span>}
                              <span className="shrink-0">{proj.updatedAt}</span>
                            </div>

                            {/* 迷你缩略图条（如果有） */}
                            {proj.thumbnails && proj.thumbnails.length > 0 && (
                              <div className="mt-2.5 flex gap-1 overflow-hidden">
                                {proj.thumbnails
                                  .slice(0, 3)
                                  .map((thumb, ti) => (
                                    <img
                                      key={ti}
                                      src={thumb}
                                      alt=""
                                      className="ring-border-strong h-10 w-10 shrink-0 rounded-lg object-cover ring-1"
                                      onError={(event) => {
                                        (
                                          event.target as HTMLImageElement
                                        ).style.display = "none";
                                      }}
                                    />
                                  ))}
                              </div>
                            )}
                          </div>
                        </Button>
                      );
                    })
                  : /* Empty state — placeholder cards */
                    [1, 2, 3].map((index) => {
                      const kinds = [
                        "canvas",
                        "generation",
                        "workflow",
                      ] as const;
                      const cfg = KIND_CONFIG[kinds[index - 1]!]!;
                      return (
                        <div
                          key={kinds[index - 1]}
                          className="border-border bg-surface-1 flex items-start gap-3 rounded-[16px] border p-3.5 opacity-60"
                        >
                          <div
                            className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                            style={{
                              backgroundColor: `${cfg.color}12`,
                              color: cfg.color,
                            }}
                          >
                            {cfg.icon}
                          </div>
                          <div className="flex-1">
                            <div className="bg-border-strong h-3.5 w-3/4 rounded" />
                            <div className="bg-border mt-2 h-3 w-1/2 rounded" />
                            <div className="bg-border mt-2.5 h-10 w-10 rounded-lg" />
                          </div>
                        </div>
                      );
                    })}
              </div>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}
