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
} from "lucide-react";

/**
 * 共享的导航注册表 —— 侧栏 / 顶部标题 / 命令面板 / 项目内切换器的唯一事实来源。
 *
 * 四个分区（一处定义、多处消费，避免漂移）：
 *   · 全局项（`globalNavItems`）—— 主页侧栏顶部常驻：首页 / 模型 / 历史 / 队列 / 炼丹 / 流程；
 *   · 全局浮层（`OVERLAY_NAV_ITEMS`）—— 紧跟全局项之后，仍是**应用级**入口但点开的是
 *     弹窗而不是视图：模型适配 / 模式契约。这两件事是**项目无关**的（模式是工作流库定义的、
 *     适配器是每个远端模型 × 每个模式的字段映射，都不依赖某个具体项目），所以它们的入口
 *     不进工坊那个项目内视图；
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
  | "train"
  | "film"
  | "workflows"
  | "outputs";

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

/** 全局浮层入口的机器 id —— 不进 `WorkspaceView`：它不切视图，只开弹窗。 */
export type OverlayEntryId = "model-adapters" | "mode-contract";

/**
 * 应用级浮层入口（**项目无关**，故不进项目内的任何界面）。
 *
 * 与 `NavItem` 分开建模的原因：`NavItem.id` 是 `WorkspaceView`，它是「当前在哪个视图」
 * 的全集，被 `TopBar` 反查标题、被 `page.tsx` 的路由状态消费。这两项并不改变视图
 * （弹窗盖在哪个视图上都成立），塞进 `WorkspaceView` 会让「当前视图」多出两个
 * 永远到不了的值。它们只需要「标签 + 图标 + 开哪个弹窗」三件事。
 */
export interface OverlayNavItem {
  overlay: OverlayEntryId;
  label: string;
  icon: React.ReactNode;
}

/**
 * 侧栏里紧跟「流程」之后的两项：模型适配 / 模式契约。
 *
 * 为什么放这里而不是工坊顶栏：工坊是**项目内**视图（顶部标签栏那四个之一），
 * 而这两个入口读写的是全局注册表（模式契约 = 每种模式有哪些统一输入 / 输出；
 * 模型适配 = 每个远端模型 × 每个模式的字段映射），与当前项目无关。挂在项目内
 * 视图上会让人以为「换了项目就得重配一遍」。
 *
 * 「流程」是它们的近邻而非任意位置：契约口清单是工作流库配落点的依据、适配器是
 * 远端模型的字段映射，两者都服务工作流这条链路。
 */
export const OVERLAY_NAV_ITEMS: OverlayNavItem[] = [
  {
    overlay: "model-adapters",
    label: "模型适配",
    /* 与「模型」那项（`Box`）刻意不同：一个管模型库本身，一个管远端接口的字段映射。 */
    icon: <Cable size={22} strokeWidth={1.8} />,
  },
  {
    overlay: "mode-contract",
    label: "模式契约",
    /* 与工作流库页头那枚「模式契约」按钮同图标（同一件事在两处出现时认得出是同一件）。 */
    icon: <Puzzle size={22} strokeWidth={1.8} />,
  },
];

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
    id: "train",
    label: "炼丹",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M9 2v6l-4 7a4 4 0 003.6 6h6.8A4 4 0 0019 15l-4-7V2" />
        <path d="M9 2h6" />
        <path d="M8 22h8" />
        <path d="M12 9v6" />
      </svg>
    ),
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
