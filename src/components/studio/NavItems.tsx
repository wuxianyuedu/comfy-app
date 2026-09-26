"use client";

import React from "react";
import {
  BookOpen,
  Box,
  Film,
  Folder,
  History,
  Home,
  Image as ImageIcon,
  ListChecks,
} from "lucide-react";

/**
 * 共享的导航注册表 —— 侧栏 / 顶部标题 / 命令面板 / 项目内切换器的唯一事实来源。
 *
 * 三个分区（一处定义、多处消费，避免漂移）：
 *   · 全局项（`globalNavItems`）—— 主页侧栏顶部常驻：首页 / 模型 / 历史 / 队列 / 炼丹 / 流程；
 *   · 项目页签（`projectTabs`）—— 只在「项目界面」顶部的标签栏出现（画布 / 工坊 / 产出 / 成片），
 *     不再进主页侧栏：它们是对「当前项目」的操作投影，脱离项目无意义；
 *   · 项目入口（`PROJECTS_ENTRY`）—— 侧栏最底部的「项目」分组（可展开列出已有项目）。
 *
 * 历史教训：此前用 `visibleNavItems(active)` 在「首页 vs 非首页」间切换项目页签的显隐，
 * 导致点「项目」等非首页视图时画布/工坊页签莫名复现、点首页又消失。改成「按分区归属」
 * 一次性决定每项出现在哪个界面，显隐不再随当前视图漂移。
 */
export type WorkspaceView =
  | "home"
  | "canvas"
  | "models"
  | "works"
  | "workshop"
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
   * 画布 / 工坊 / 产出 / 成片是对「当前项目」的操作投影。
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

/** 项目界面顶部的切换页签（画布 / 工坊 / 产出 / 成片）。 */
export function projectTabs(): NavItem[] {
  return NAV_ITEMS.filter((item) => item.projectScoped);
}

/** 某视图是否属于项目页签（决定要不要渲染项目内顶部标签栏）。 */
export function isProjectTab(view: WorkspaceView): boolean {
  return projectTabs().some((item) => item.id === view);
}
