"use client";

/* ── 日志分类开关的跨组件共享状态（纯状态 + 持久化，无副作用）────
 * 「设置 → 日志」里每个分类一个开关；关掉的分类在日志面板里不再显示
 * （仅隐藏显示，不删除 log/ 下的真实文件）。多个非嵌套 chrome 都要读它：
 * 设置页写、日志面板读，用 zustand 单例收口，避免 React context 层层透传。
 *
 * 持久化走 `~/lib/browser-storage`（localStorage，SSR 安全：无浏览器时返回兜底、
 * 写失败静默）。默认值全部开启——「没设过」与「全开」同义。 */

import { create } from "zustand";

import { readStorageJson, writeStorageJson } from "~/lib/browser-storage";

import { LOG_CATEGORY_FILTERS, type LogCategoryFilter } from "./log-types";

const STORAGE_KEY = "comfyapp.logCategories.enabled";

export type CategoryEnabled = Record<LogCategoryFilter, boolean>;

/** 全部分类默认开启。 */
function defaultEnabled(): CategoryEnabled {
  return LOG_CATEGORY_FILTERS.reduce<CategoryEnabled>((acc, category) => {
    acc[category] = true;
    return acc;
  }, {} as CategoryEnabled);
}

/**
 * 从 localStorage 水合开关；坏数据 / 没存过 / 缺字段一律回落默认（不抛）。
 *
 * 用「合并」而非「整体替换」：日后新增分类时，旧存储里没有的键自动取默认开启，
 * 不会因为读到的对象缺字段而把新分类卡在 `undefined`（那样 `!enabled[c]` 会误判成关闭）。
 */
function readEnabled(): CategoryEnabled {
  const stored = readStorageJson<Partial<CategoryEnabled>>(STORAGE_KEY, {});
  const base = defaultEnabled();
  for (const category of LOG_CATEGORY_FILTERS) {
    if (typeof stored[category] === "boolean")
      base[category] = stored[category];
  }
  return base;
}

export interface LogCategoryState {
  /** 每个分类的开关状态（true = 在面板显示）。 */
  enabled: CategoryEnabled;
  /** 切换某个分类的显示开关；副作用是把新状态写回 localStorage。 */
  setEnabled: (category: LogCategoryFilter, value: boolean) => void;
  /** 某分类当前是否开启（避免调用方直接读 `enabled[c]` 再判 undefined）。 */
  isEnabled: (category: LogCategoryFilter) => boolean;
}

export const useLogCategoryStore = create<LogCategoryState>((set, get) => ({
  enabled: readEnabled(),
  setEnabled: (category, value) => {
    set((state) => ({ enabled: { ...state.enabled, [category]: value } }));
    // 记忆是增强不是功能：写失败（隐私模式 / 配额满）仅内存态生效。
    writeStorageJson(STORAGE_KEY, get().enabled);
  },
  isEnabled: (category) => get().enabled[category] !== false,
}));

/**
 * 当前被关闭（需从面板隐藏）的分类列表。供 `log-store` 的 `computeFiltered` 直接消费
 * （`bucketOf(entry)` 与 `LogCategoryFilter` 同域）。SSR / 无浏览器时返回空数组。
 */
export function disabledCategories(): LogCategoryFilter[] {
  const enabled = useLogCategoryStore.getState().enabled;
  return LOG_CATEGORY_FILTERS.filter((category) => !enabled[category]);
}
