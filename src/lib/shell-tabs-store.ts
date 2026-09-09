"use client";

/* ── shell-tabs-store.ts · 桌面壳应用级「页签」共享状态 ─────────────
 *
 * Why this exists
 * ────────────────
 * 用户需要「像文件资源管理器那样」的多页签：在同一个 Tauri 主窗口内，
 * 顶部一条页签栏，可切换「主应用」与内嵌的 ComfyUI 等内容，而不是
 * 另开独立窗口（此前 open_comfyui_window 会弹出一个空白且关不掉的
 * 第二个窗口）。
 *
 * 本 store 只管理「当前打开了哪些页签、当前激活哪个」，是纯前端状态、
 * 无任何 IO / 不 import React 组件，符合规范 17 的四层归属（状态层）。
 * 页签内容（iframe 渲染、主应用承载）在容器/视图层 ShellTabs 里接入。
 *
 * 关键约束：主应用页签（id="main"）恒存在且不可关闭；切换页签时主应用
 * 组件树始终挂载（用 CSS 显隐而非条件卸载），避免 workspace 的状态
 * （viewMode / 画布编辑内容）在切页签后丢失。
 */

import { create } from "zustand";

/** 页签 id 常量：主应用页签不可关闭。 */
export const MAIN_TAB_ID = "main";

export interface ShellTab {
  /** 唯一 id（主应用为 "main"；其余建议显式传稳定 id 如 "comfyui"，否则按 label+url 派生）。 */
  id: string;
  /** 页签标题（页签栏显示）。 */
  label: string;
  /** 页签内容地址：主应用为 null（由 children 渲染），其余为待内嵌 URL。 */
  url: string | null;
  /** 是否可关闭（主应用页签恒为 false）。 */
  closable: boolean;
}

export interface ShellTabsState {
  /** 已打开的页签；恒含主应用页签且排在最前。 */
  tabs: ShellTab[];
  /** 当前激活页签 id。 */
  activeTabId: string;
  /** 新增（或激活已存在的同名）页签并激活。 */
  openTab: (tab: Omit<ShellTab, "id"> & { id?: string }) => void;
  /** 激活指定页签。 */
  activateTab: (id: string) => void;
  /** 关闭指定页签；不可关闭主应用页签。 */
  closeTab: (id: string) => void;
  /** 更新指定页签标题 / 地址。 */
  updateTab: (
    id: string,
    patch: Partial<Pick<ShellTab, "label" | "url">>,
  ) => void;
}

const MAIN_TAB: ShellTab = {
  id: MAIN_TAB_ID,
  label: "主应用",
  url: null,
  closable: false,
};

function resolveTabId(tab: Omit<ShellTab, "id"> & { id?: string }): string {
  if (tab.id) return tab.id;
  // 无显式 id 时按 type + url 保证唯一（同 URL 不会叠出重复页签）。
  if (tab.url) return `${tab.label}:${tab.url}`;
  return `${tab.label}:${Date.now()}`;
}

export const useShellTabs = create<ShellTabsState>((set) => ({
  tabs: [MAIN_TAB],
  activeTabId: MAIN_TAB_ID,

  openTab: (tab) =>
    set((state) => {
      const id = resolveTabId(tab);
      const existing = state.tabs.find((t) => t.id === id);
      if (existing) {
        // 已存在：仅激活 + 必要时刷新标题/地址。
        return {
          tabs: state.tabs.map((t) =>
            t.id === id
              ? { ...t, label: tab.label ?? t.label, url: tab.url ?? t.url }
              : t,
          ),
          activeTabId: id,
        };
      }
      const next: ShellTab = {
        id,
        label: tab.label,
        url: tab.url,
        closable: tab.closable,
      };
      return { tabs: [...state.tabs, next], activeTabId: id };
    }),

  activateTab: (id) =>
    set((state) =>
      state.tabs.some((t) => t.id === id) ? { activeTabId: id } : state,
    ),

  closeTab: (id) =>
    set((state) => {
      if (id === MAIN_TAB_ID) return state;
      const idx = state.tabs.findIndex((t) => t.id === id);
      if (idx === -1) return state;
      const tabs = state.tabs.filter((t) => t.id !== id);
      // 关闭当前激活页签时，回退到相邻页签（或主应用）。
      const activeTabId =
        state.activeTabId === id
          ? (tabs[Math.max(0, idx - 1)]?.id ?? tabs[0]?.id ?? MAIN_TAB_ID)
          : state.activeTabId;
      return { tabs, activeTabId };
    }),

  updateTab: (id, patch) =>
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    })),
}));
