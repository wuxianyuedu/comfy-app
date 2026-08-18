"use client";

import React from "react";

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
  | "create"
  | "canvas"
  | "models"
  | "works"
  | "skills"
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
      <svg {...ICON_PROPS}>
        <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    ),
  },
  {
    id: "create",
    label: "创作",
    enabled: true,
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M12 19l7-7 3 3-7 7-3-3z" />
        <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
        <path d="M2 2l7.586 7.586" />
        <circle cx="11" cy="11" r="2" />
      </svg>
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
      <svg {...ICON_PROPS}>
        <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
      </svg>
    ),
  },
  {
    id: "skills",
    label: "技能",
    enabled: true,
    icon: (
      <svg {...ICON_PROPS}>
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
    ),
  },
  {
    id: "models",
    label: "模型",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
        <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
        <line x1="12" y1="22.08" x2="12" y2="12" />
      </svg>
    ),
  },
  {
    id: "workshop",
    label: "工坊",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" />
        <path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" />
      </svg>
    ),
  },
  {
    id: "outputs",
    label: "产出",
    enabled: true,
    icon: (
      <svg {...ICON_PROPS}>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <path d="M21 15l-5-5L5 21" />
      </svg>
    ),
  },
  {
    id: "history",
    label: "历史",
    enabled: true,
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M3 3v5h5" />
        <path d="M3.05 13A9 9 0 106 5.3L3 8" />
        <path d="M12 7v5l4 2" />
      </svg>
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
      <svg {...ICON_PROPS}>
        <rect x="2" y="4" width="20" height="16" rx="2" />
        <path d="M7 4v16M17 4v16M2 9h5M2 15h5M17 9h5M17 15h5" />
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
];
