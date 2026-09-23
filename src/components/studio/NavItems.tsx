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
} from "lucide-react";

/**
 * 共享的左侧栏导航注册表。
 *
 * 两处的唯一事实来源：
 *   - <WorkspaceNav>   —— 用在非首页视图（画布 / 技能 / 模型等）
 *   - <HomePage>       —— 用在首页视图，那里侧栏是内联的
 *
 * 在这里新增 / 重排 / 重命名任何导航项，都会让两处界面
 * 保持一致，避免两份实现之间漂移。
 */
export type WorkspaceView =
  | "home"
  | "canvas"
  | "models"
  | "works"
  | "workshop"
  | "history"
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
   * 项目作用域工具：只有进入某个项目后才在侧栏出现（首页不显示其页签）。
   * 画布 / 工坊是对「当前项目」的操作投影，没打开项目时不该出现在主页导航里。
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

export const NAV_ITEMS: NavItem[] = [
  {
    id: "home",
    label: "首页",
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
    id: "works",
    label: "项目",
    enabled: true,
    icon: <Folder size={22} strokeWidth={1.8} />,
  },
  {
    id: "models",
    label: "模型",
    icon: <Box size={22} strokeWidth={1.8} />,
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
    id: "history",
    label: "历史",
    enabled: true,
    icon: <History size={22} strokeWidth={1.8} />,
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
    id: "film",
    label: "成片",
    projectScoped: true,
    icon: <Film size={22} strokeWidth={1.8} />,
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
];

/**
 * 某视图下侧栏应显示的导航项：首页隐藏项目作用域工具（画布 / 工坊），
 * 进入其它（项目）视图后恢复。侧栏与（未来）其它消费方共用这一条规则，避免漂移。
 */
export function visibleNavItems(active: WorkspaceView): NavItem[] {
  return NAV_ITEMS.filter((item) => !(item.projectScoped && active === "home"));
}
