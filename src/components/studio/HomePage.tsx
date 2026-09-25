"use client";

import React from "react";
import {
  Activity,
  BookOpen,
  Box,
  Image as ImageIcon,
  LayoutTemplate,
  Plus,
  Video,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { AuroraGlow } from "~/components/ui/aurora-background";
import { MediaThumbnail } from "~/components/ui/media-thumbnail";
import { type WorkspaceView } from "./NavItems";

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
/* 项目类别色 + 图标。
 *
 * 色值仍是 hex，但**只作为内联 style，不再走 Tailwind 任意值类**：Tailwind
 * 的 JIT 扫不到 `bg-[${cfg.color}/15]` 这种运行时模板，此前那条写法从来就没
 * 生效过（图标方块一直是无底色）。`bg()` 给它配上当前色 15%/18% 的透明度 ——
 * 「同一个色相、不同的透明度档」用 `color-mix` 表达，不必再手写一份透明色。
 *
 * 色值本身属规范 03 §3.6.1 的**类型色例外**（项目类别色与
 * `lib/project-canvas/canvas-types.ts` 的 `NODE_META.color` 同构），
 * 已在 `scripts/check-theme-colors.cjs` 的 `EXEMPT_TABLES` 登记。 */
type KindConfig = { label: string; color: string; icon: React.ReactNode };

const KIND_CONFIG: Record<
  "canvas" | "generation" | "workflow" | "video",
  KindConfig
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

/** 按项目 kind 取展示配置。`proj.kind` 是宽字符串（旧行可能为空 / 未知），
 *  故此处收口「未知 / 缺省 → 生成」这一条判据，返回**非空**配置——调用点不再
 *  各自 `KIND_CONFIG[... ]!`（`Record<string,T>` 的查表在 noUncheckedIndexedAccess
 *  下恒为 `T|undefined`，逼出一串 `!`）。 */
function kindConfigOf(kind: string | null | undefined): KindConfig {
  const key = kind ?? "generation";
  return key in KIND_CONFIG
    ? KIND_CONFIG[key as keyof typeof KIND_CONFIG]
    : KIND_CONFIG.generation;
}

/** 把类别色按给定透明度档降为背景（`color-mix` 现取，不硬编码透明色）。 */
function kindTint(color: string, percent: number): string {
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`;
}

export interface HomePageProps {
  onNewProject?: () => void;
  recentProjects?: RecentProject[];
  onOpenProject?: (id: string) => void;
  /** 打开一个画布项目（跳到画布视图，而不是 /create/{id}）。 */
  onOpenCanvasProject?: (id: string) => void;
  /** 跳到一个工作区视图（模型 / 工作流 / 画布等） */
  onNavigate?: (view: WorkspaceView) => void;
  /** 切到「项目」（works）视图，看全部项目 */
  onShowAllProjects?: () => void;
}

export function HomePage({
  onNewProject,
  recentProjects = [],
  onOpenProject,
  onOpenCanvasProject,
  onNavigate,
  onShowAllProjects,
}: HomePageProps) {
  return (
    <div
      className="bg-canvas text-ink relative flex h-full min-h-0 w-full flex-col overflow-hidden"
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

      {/* ── 主内容区 ────────────────────────
          侧栏（`ui/sidebar`）与顶栏（`TopBar`）由 `AppShell` 统一提供 ——
          壳负责「导航 + 工具条 + 滚动容器」，首页只管自己的内容。
          此前这里的搜索框是个 `<div>` 假实现（连 input 都不是）、铃铛与头像
          只弹一句 toast 占位，三者本轮一并移除；消息入口改由顶栏复用状态栏
          那个 `MessageCenterButton`。

          flex 链上每一处都加 `min-h-0`：在 flex 列里，子项默认
          `min-height: auto`，不会缩到比内容还小，导致内容溢出父容器被
          `overflow-hidden` 裁掉（首页上下部分内容因此看不到）。显式声明
          `min-h-0` 后，滚动容器才能按 `flex-1` 正确收缩并出现滚动条。 */}
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {/* 内容容器用 `<div>` 而不是 `<main>`：外壳的 `SidebarInset` 才是
            本页唯一的 `<main>`（规范 06 §语义标签），嵌套两个会破坏地标导航。 */}
        <div className="relative flex min-h-0 min-w-0 flex-1 overflow-y-auto">
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
                  <span className="bg-primary/10 text-primary-strong group-hover:bg-primary/15 flex size-10 items-center justify-center rounded-xl transition-colors">
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
                  <div className="text-info-strong/70 group-hover:text-info-strong flex h-[28px] w-[28px] items-center justify-center rounded-xl transition-colors">
                    <Plus size={24} strokeWidth={1.6} />
                  </div>
                  <span className="text-ink-muted group-hover:text-info-strong text-[12.5px] font-medium transition-colors">
                    新建画布项目
                  </span>
                </Button>

                {/* 最近项目卡片 —— 画布 / 项目风 */}
                {recentProjects.length > 0
                  ? recentProjects.slice(0, 3).map((proj) => {
                      const cfg = kindConfigOf(proj.kind);
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
                            className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl transition-colors"
                            style={{
                              backgroundColor: kindTint(cfg.color, 15),
                              color: cfg.color,
                            }}
                          >
                            {cfg.icon}
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
                                  color: cfg.color,
                                  backgroundColor: kindTint(cfg.color, 15),
                                  ["--tw-ring-color" as string]: kindTint(
                                    cfg.color,
                                    30,
                                  ),
                                }}
                              >
                                {cfg.label}
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
                                    <MediaThumbnail
                                      key={ti}
                                      src={thumb}
                                      alt=""
                                      className="ring-border-strong size-10 shrink-0 rounded-lg object-cover ring-1"
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
                      const cfg = kindConfigOf(kinds[index - 1]);
                      return (
                        <div
                          key={kinds[index - 1]}
                          className="border-border bg-surface-1 flex items-start gap-3 rounded-[16px] border p-3.5 opacity-60"
                        >
                          <div
                            className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl"
                            style={{
                              backgroundColor: kindTint(cfg.color, 12),
                              color: cfg.color,
                            }}
                          >
                            {cfg.icon}
                          </div>
                          <div className="flex-1">
                            <div className="bg-border-strong h-3.5 w-3/4 rounded" />
                            <div className="bg-border mt-2 h-3 w-1/2 rounded" />
                            <div className="bg-border mt-2.5 size-10 rounded-lg" />
                          </div>
                        </div>
                      );
                    })}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
