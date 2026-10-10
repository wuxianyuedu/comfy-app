"use client";

import React from "react";
import {
  BookOpen,
  Box,
  Cable,
  Film,
  Folder,
  FolderOpen,
  History,
  Home,
  Image as ImageIcon,
  ListChecks,
  Puzzle,
  Settings,
  Terminal,
} from "lucide-react";

/**
 * 共享的导航注册表 —— 侧栏 / 顶部标题 / 命令面板 / 项目内切换器的唯一事实来源。
 *
 * 三个分区（一处定义、多处消费，避免漂移）：
 *   · 全局项（`globalNavItems`）—— 主页侧栏顶部常驻，共九件：首页 / 模型 / 历史 /
 *     队列 / 设置 / 流程 / 模型适配 / 模式契约 / 控制台。这九件事都是**项目无关**的，
 *     走视图页签能开能关 ——
 *     控制台也一样（它跑的是仓库级脚本命令 `pnpm test` / `drizzle-kit`，与「当前是
 *     哪个画布项目」无关，而同形的视图页签让「跑着长命令时切去别处看一眼」成立）；
 *     设置同理：它读写的是应用级配置（模型目录、Ollama、数据库、后端路径），
 *     换项目不该重配一遍；
 *     模型适配 / 模式契约此前是**全局浮层入口**（点开弹窗、不改视图），现在也是全局
 *     视图，排在「流程」之后、「控制台」之前 —— 理由与设置、控制台同一批：它们读写的
 *     是全局注册表（模式契约 =
 *     每种模式有哪些统一输入 / 输出；适配器 = 每个远端模型 × 每个模式的字段映射），
 *     与当前项目无关，而弹窗形态没有页签、不能一边配着别的一边对照工作流库；
 *   · 项目页签（`projectTabs`）—— 只在「项目界面」顶部的标签栏出现（主页 / 画布 / 工坊 / 资源库 / 产出 / 成片），
 *     不再进主页侧栏：它们是对「当前项目」的操作投影，脱离项目无意义；
 *   · 项目入口（`PROJECTS_ENTRY`）—— 侧栏最底部的「项目」分组（可展开列出已有项目）。
 *
 * 历史教训：此前用 `visibleNavItems(active)` 在「首页 vs 非首页」间切换项目页签的显隐，
 * 导致点「项目」等非首页视图时画布/工坊页签莫名复现、点首页又消失。改成「按分区归属」
 * 一次性决定每项出现在哪个界面，显隐不再随当前视图漂移。
 */
export type WorkspaceView =
  | "home"
  | "project"
  | "canvas"
  | "models"
  | "works"
  | "workshop"
  | "library"
  | "history"
  | "queue"
  | "film"
  | "workflows"
  | "outputs"
  | "console"
  | "settings"
  | "model-adapters"
  | "mode-contract";

export interface NavItem {
  id: WorkspaceView;
  label: string;
  /** 这个视图的工作是否已上线（驱动 cursor / opacity） */
  enabled?: boolean;
  /**
   * 属于「项目页签」：只在项目界面顶部的标签栏出现，不进主页侧栏顶部列表。
   * 主页 / 画布 / 工坊 / 资源库 / 产出 / 成片是对「当前项目」的操作投影。
   */
  projectScoped?: boolean;
  icon: React.ReactNode;
}

/** 侧栏项统一使用的图标描边 + 尺寸。 */
const ICON_PROPS = {
  width: 22,
  height: 22,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/** 侧栏底部「项目」分组入口（不作为顶部项，也不作为项目页签）。 */
export const PROJECTS_ENTRY: NavItem = {
  id: "works",
  label: "项目",
  enabled: true,
  icon: <Folder size={22} strokeWidth={1.8} />,
};

/**
 * 全量注册表：顶部标题（`TopBar`）按 id 反查标签、命令面板取全局项 + 项目页签都读它。
 * 顺序 = 全局项在前、项目页签居中、项目入口（works）在后；分区由下方 helper 按标记切出。
 */
export const NAV_ITEMS: NavItem[] = [
  {
    id: "home",
    label: "首页",
    icon: <Home size={22} strokeWidth={1.8} />,
  },
  {
    id: "models",
    label: "模型",
    icon: <Box size={22} strokeWidth={1.8} />,
  },
  {
    id: "history",
    label: "历史",
    enabled: true,
    icon: <History size={22} strokeWidth={1.8} />,
  },
  {
    id: "queue",
    label: "队列",
    enabled: true,
    icon: <ListChecks size={22} strokeWidth={1.8} />,
  },
  {
    /* 设置：与历史 / 队列 / 控制台同形的**视图**，不是浮层。
     * 原先它是 workspace 里的一层全屏浮层（`SettingsOverlay`）—— 那层会盖住页签条，
     * 且「当前在设置里」这件事只活在一个布尔值里：既没有页签可关，也不能一边开着
     * 设置一边看别处。改成视图后，入口、高亮、可关性都和别的视图同一套契约。
     * 仍归**全局项**而不是项目页签：它读写的是应用级配置（模型目录、Ollama、
     * 数据库、后端路径），与「当前是哪个画布项目」无关。 */
    id: "settings",
    label: "设置",
    enabled: true,
    icon: <Settings size={22} strokeWidth={1.8} />,
  },
  {
    id: "workflows",
    label: "流程",
    enabled: true,
    icon: (
      <svg {...ICON_PROPS}>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
        <path d="M10 6.5h4a3 3 0 013 3v4.5" />
      </svg>
    ),
  },
  {
    /* 模型适配：与「流程」相邻而不是与「模型」相邻 —— 契约口清单是工作流库配落点的
       依据、适配器是远端模型的字段映射，两件事都服务工作流这条链路。图标仍与「模型」
       那项（`Box`）刻意不同：一个管模型库本身，一个管远端接口的字段映射。
       它此前是侧栏的「全局浮层入口」（点开弹窗、不改视图），现在是视图页签。 */
    id: "model-adapters",
    label: "模型适配",
    enabled: true,
    icon: <Cable size={22} strokeWidth={1.8} />,
  },
  {
    /* 模式契约：与工作流库页头那枚「模式契约」按钮同图标 —— 同一件事在两处出现时
       认得出是同一件。那枚按钮现在也切到这一页，不再开弹窗。 */
    id: "mode-contract",
    label: "模式契约",
    enabled: true,
    icon: <Puzzle size={22} strokeWidth={1.8} />,
  },
  {
    /* 控制台（ISSUE #1327）：跑质量门禁 / db:push / git 查询这类「本来要另开一个
     * 终端窗口」的操作。它是**视图**（与历史 / 队列同形，页签能开能关），不是浮层 ——
     * 跑一条 `pnpm test` 是分钟级的事，用户在等待时还要能切去画布看一眼、回来接着看输出；
     * 弹窗一关就断连回收命令，那正是「不敢长时间跑」的来源。
     * 仍放**全局项**而不是项目页签：它跑的是仓库级脚本，与「当前是哪个画布项目」无关。 */
    id: "console",
    label: "控制台",
    enabled: true,
    icon: <Terminal size={22} strokeWidth={1.8} />,
  },
  {
    /* 项目主页放在页签第一位：它是进入项目后的落点（此前直接落画布，
     * 而画布承载不了「这个项目做到哪了」这类项目级问题）。图标用 `Home`
     * 与全局「首页」同形 —— 两个 home 语义层级不同（应用级 / 项目级），
     * 靠所在分组区分，换一个陌生图标反而更难认。 */
    id: "project",
    label: "主页",
    enabled: true,
    projectScoped: true,
    icon: <Home size={22} strokeWidth={1.8} />,
  },
  {
    id: "canvas",
    label: "画布",
    enabled: true,
    projectScoped: true,
    icon: (
      <svg {...ICON_PROPS}>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M3 9h18M9 21V9" />
        <circle cx="15" cy="15" r="2" />
      </svg>
    ),
  },
  {
    id: "workshop",
    label: "工坊",
    projectScoped: true,
    icon: <BookOpen size={22} strokeWidth={1.8} />,
  },
  {
    id: "library",
    label: "资源库",
    projectScoped: true,
    icon: <FolderOpen size={22} strokeWidth={1.8} />,
  },
  {
    id: "outputs",
    label: "产出",
    enabled: true,
    projectScoped: true,
    icon: <ImageIcon size={22} strokeWidth={1.8} />,
  },
  {
    id: "film",
    label: "成片",
    projectScoped: true,
    icon: <Film size={22} strokeWidth={1.8} />,
  },
  PROJECTS_ENTRY,
];

/** 主页侧栏顶部常驻的全局项（排除项目页签与项目入口）。 */
export function globalNavItems(): NavItem[] {
  return NAV_ITEMS.filter(
    (item) => !item.projectScoped && item.id !== PROJECTS_ENTRY.id,
  );
}

/** 项目界面顶部的切换页签（主页 / 画布 / 工坊 / 资源库 / 产出 / 成片）。 */
export function projectTabs(): NavItem[] {
  return NAV_ITEMS.filter((item) => item.projectScoped);
}

/** 某视图是否属于项目页签（决定要不要渲染项目内顶部标签栏）。 */
export function isProjectTab(view: WorkspaceView): boolean {
  return projectTabs().some((item) => item.id === view);
}
