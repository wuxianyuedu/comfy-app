"use client";

import React from "react";
import { BookOpen, Box, Film, Folder, History, Home, Image as ImageIcon } from "lucide-react";

/**
 * Shared left-sidebar navigation registry.
 *
 * One source of truth for both:
 *   - <WorkspaceNav>   — used in non-home views (canvas / skills / models / etc.)
 *   - <HomePage>       — used in the home view, where the sidebar is inlined
 *
 * Adding / reordering / renaming any nav item here keeps both surfaces
 * consistent and avoids drift between the two implementations.
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
  /** Whether the work for this view has shipped (drives cursor / opacity) */
  enabled?: boolean;
  icon: React.ReactNode;
}

/** Standard icon stroke + size for sidebar items. */
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
    icon: (
      <Home size={22} strokeWidth={1.8} />
    ),
  },
  {
    id: "canvas",
    label: "画布",
    enabled: true,
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
    icon: (
      <Folder size={22} strokeWidth={1.8} />
    ),
  },
  {
    id: "models",
    label: "模型",
    icon: (
      <Box size={22} strokeWidth={1.8} />
    ),
  },
  {
    id: "workshop",
    label: "工坊",
    icon: (
      <BookOpen size={22} strokeWidth={1.8} />
    ),
  },
  {
    id: "outputs",
    label: "产出",
    enabled: true,
    icon: (
      <ImageIcon size={22} strokeWidth={1.8} />
    ),
  },
  {
    id: "history",
    label: "历史",
    enabled: true,
    icon: (
      <History size={22} strokeWidth={1.8} />
    ),
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
    icon: (
      <Film size={22} strokeWidth={1.8} />
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
];
