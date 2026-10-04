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
import { MediaThumbnail } from "~/components/ui/media-thumbnail";
import { DocumentFrame } from "./ViewContainer";
import { LocalComputeCard } from "./LocalComputeCard";
import { HomeModelOverview } from "./HomeModelOverview";
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
  │(72│  本机算力卡（在线 / 显存 / 内存）      │
  │px)│  最近项目栅格                    │
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

/**
 * 「继续最近项目」大卡 —— 最近动过的那一个，给一整个位置。
 *
 * 为什么值得单独一块：小卡栅格回答的是「我有哪些项目」，而回到首页的人第一句
 * 通常是「我上次做到哪儿了」。前者要扫，后者要一键回去。
 *
 * 刻意留在本文件内：它要用 `KIND_CONFIG` / `kindConfigOf` / `kindTint` 这份类别
 * 色表（已按 §3.6.1 在 `check-theme-colors` 登记），搬出去要么把内部表导出、
 * 要么再抄一份色表 —— 两条都是 §12.12 的孪生对。
 */
function ResumeProjectCard({
  proj,
  onOpen,
}: {
  proj: RecentProject;
  onOpen: (proj: RecentProject) => void;
}) {
  const cfg = kindConfigOf(proj.kind);
  const thumbs = (proj.thumbnails ?? []).slice(0, 3);
  return (
    <Button
      variant="ghost"
      onClick={() => onOpen(proj)}
      aria-label={`继续编辑 ${proj.name}`}
      className="group border-border bg-surface-1 hover:border-border-strong hover:bg-surface-2 mt-6 flex h-auto w-full items-stretch gap-4 rounded-[18px] border p-4 text-left font-normal active:scale-[0.995]"
    >
      {/* 左：缩略图条；一张图都没有时落回类别图标块（不留空洞） */}
      <div className="flex w-42 shrink-0 gap-1.5 overflow-hidden rounded-xl">
        {thumbs.length > 0 ? (
          thumbs.map((thumb, i) => (
            <MediaThumbnail
              key={`${proj.id}-resume-thumb-${i}`}
              src={thumb}
              alt=""
              className="ring-border-strong size-full min-w-0 rounded-xl object-cover ring-1"
            />
          ))
        ) : (
          <div
            className="flex size-full items-center justify-center rounded-xl"
            style={{
              backgroundColor: kindTint(cfg.color, 15),
              color: cfg.color,
            }}
          >
            {cfg.icon}
          </div>
        )}
      </div>

      {/* 右：类别 + 名字 + 副信息 + 更新时间 */}
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1.5">
        <div className="flex items-center gap-2">
          <span
            className="text-3xs shrink-0 rounded-md px-1.5 py-0.5 font-medium ring-1 backdrop-blur-sm ring-inset"
            style={{
              color: cfg.color,
              backgroundColor: kindTint(cfg.color, 15),
              ["--tw-ring-color" as string]: kindTint(cfg.color, 30),
            }}
          >
            {cfg.label}
          </span>
          <span className="text-ink-bright group-hover:text-ink min-w-0 flex-1 truncate text-[15px] font-semibold transition-colors">
            {proj.name}
          </span>
        </div>
        <div className="text-ink-fainter flex items-center gap-2 text-[12px]">
          {proj.subtitle && (
            <span className="min-w-0 truncate">{proj.subtitle}</span>
          )}
          {/* 「最近动过」这个措辞是刻意的：`updatedAt` 由上层给成什么口径，
              这里不许再加工成一个更精确的假象。 */}
          <span className="shrink-0">最近动过 · {proj.updatedAt}</span>
        </div>
      </div>
    </Button>
  );
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
  /**
   * 打开一个最近项目 —— 画布项目要进画布视图，其余走 `/create/{id}`。
   *
   * 收成一处是因为现在有两个入口会用这条规则（「继续最近项目」大卡与下面的小卡
   * 栅格）：此前它内联在小卡的 onClick 里，大卡要复用就得再抄一遍 —— 而两个入口
   * 对同一个项目做出不同行为，是最难被发现的一类漂移。
   */
  const openRecent = (proj: RecentProject) =>
    proj.kind === "canvas"
      ? onOpenCanvasProject?.(proj.id)
      : onOpenProject?.(proj.id);

  /* 取一次交给渲染处：`recentProjects[0]` 在 noUncheckedIndexedAccess 下是
     `T | undefined`，与其在 JSX 里再判一遍，不如在这里落个名字。 */
  const resumeProject: RecentProject | undefined = recentProjects[0];

  return (
    <DocumentFrame
      width="narrow"
      className="px-10 py-16"
      backdrop={
        /* ── 顶部渐隐带（替代原先两团极光光斑）────────────────────
           换掉的理由不是审美偏好，是两条实测：
             · 那两团是 `mix-blend-screen` + 饱和色，**没有浅色回落** —— 浅色主题下
               右上角会糊成一块粉，而首页是浅色态最常落的屏；
             · 首页本来就有标题、四个入口与两张状态卡，装饰性光斑压低的是内容可读性。
           新做法不给颜色、只给纵深（surface → canvas 的单向渐隐），深浅两态同一份
           令牌，不需要各写一套。 */
        <div
          className="from-surface-1 pointer-events-none absolute inset-x-0 top-0 h-56 bg-linear-to-b to-transparent"
          aria-hidden
        />
      }
    >
      {/* ── 主内容区 ────────────────────────
          侧栏（`ui/sidebar`）与顶栏（`TopBar`）由 `AppShell` 统一提供 ——
          壳负责「导航 + 工具条 + 滚动容器」，首页只管自己的内容。
          此前这里的搜索框是个 `<div>` 假实现（连 input 都不是）、铃铛与头像
          只弹一句 toast 占位，三者本轮一并移除；消息入口改由顶栏复用状态栏
          那个 `MessageCenterButton`。 */}
      {/* ── Title ── */}
      <h1 className="u-title-hero mb-3 text-center">灵感从这里开始</h1>
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

      {/* ── 本机状态：后端在不在线（算力） + 库里有没有东西（模型概览） ──
                两张并一行：它们回答的是同一类问题的两半，上下堆会把注意力拆成两处，
                也白白拉长首页。窄屏自然回落单列。 */}
      <div className="mt-8 grid gap-3 lg:grid-cols-2">
        <LocalComputeCard />
        <HomeModelOverview />
      </div>

      {/* ── Recent Projects ── */}
      <section className="mt-14">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-ink-field text-[17px] font-semibold">最近项目</h2>
          <Button
            variant="link"
            onClick={() => onShowAllProjects?.()}
            className="text-ink-faint hover:text-ink-strong h-auto p-0 text-xs"
          >
            查看全部 →
          </Button>
        </div>

        {/* 第一个项目由大卡占位 —— 同一条项目不该在页面上出现两次，
                  所以下面的栅格从第二个开始取。 */}
        {resumeProject && (
          <ResumeProjectCard proj={resumeProject} onOpen={openRecent} />
        )}

        <div className="mt-3 grid grid-cols-2 gap-3">
          {/* 新建项目卡片 —— 画布风入口 */}
          <Button
            variant="ghost"

            onClick={onNewProject}
            className="group border-border bg-surface-1 hover:bg-info/5 flex h-auto flex-col items-center justify-center gap-2.5 rounded-lg border border-dashed py-7 font-normal active:scale-[0.98]"
          >
            <div className="text-info-strong/70 group-hover:text-info-strong flex size-7 items-center justify-center rounded-xl transition-colors">
              <Plus size={24} strokeWidth={1.6} />
            </div>
            <span className="text-ink-muted group-hover:text-info-strong text-[12.5px] font-medium transition-colors">
              新建画布项目
            </span>
          </Button>

          {/* 最近项目卡片 —— 画布 / 项目风 */}
          {recentProjects.length > 0
            ? recentProjects.slice(1, 4).map((proj) => {
                const cfg = kindConfigOf(proj.kind);
                return (
                  <Button
                    key={proj.id}
                    variant="ghost"
                    onClick={() => openRecent(proj)}
                    className="group border-border bg-surface-1 hover:border-border-strong hover:bg-surface-2 flex h-auto items-start gap-3 rounded-lg border p-3.5 text-left font-normal active:scale-[0.98]"
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
                          className="text-3xs shrink-0 rounded-md px-1.5 py-0.5 font-medium ring-1 backdrop-blur-sm ring-inset"
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
                          {proj.thumbnails.slice(0, 3).map((thumb, ti) => (
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
                const kinds = ["canvas", "generation", "workflow"] as const;
                const cfg = kindConfigOf(kinds[index - 1]);
                return (
                  <div
                    key={kinds[index - 1]}
                    className="border-border bg-surface-1 flex items-start gap-3 rounded-lg border p-3.5 opacity-60"
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
    </DocumentFrame>
  );
}
