"use client";

/* ── 日志分类开关的跨组件共享状态（纯状态 + 持久化）────────────────
 * 「设置 → 日志」每类一个开关；关掉只隐藏面板显示，不删除 log/ 下的真实文件。
 * 设置页写、日志面板读，用 zustand 单例避免 context 透传；持久化走
 * `~/lib/browser-storage`（SSR 安全、写失败静默），默认全开＝「没设过」。 */

import { create } from "zustand";

import { readStorageJson, writeStorageJson } from "~/lib/browser-storage";

import { LOG_CATEGORY_FILTERS, type LogCategoryFilter } from "./log-types";

const STORAGE_KEY = "comfyapp.logCategories.enabled";

export type CategoryEnabled = Record<LogCategoryFilter, boolean>;

/** 分类常量自洽（每类都已写入 true）时不可达；保留兜底以免不完整的值被当成完整类型。 */
function isCategoryEnabled(value: Partial<CategoryEnabled>): value is CategoryEnabled {
  return LOG_CATEGORY_FILTERS.every((category) => typeof value[category] === "boolean");
}

/** 全部分类默认开启。 */
function defaultEnabled(): CategoryEnabled {
  const enabled = LOG_CATEGORY_FILTERS.reduce<Partial<CategoryEnabled>>((acc, category) => {
    acc[category] = true;
    return acc;
  }, {});
  if (isCategoryEnabled(enabled)) {
    return enabled;
  }
  throw new Error("日志分类开关默认值初始化不完整");
}

/**
 * 从 localStorage 水合开关；坏数据 / 没存过 / 缺字段一律回落默认（不抛）。
 * 用「合并」而非整体替换：新增分类时旧存储缺的键取默认开启，否则
 * `!enabled[c]` 会把 `undefined` 误判成关闭。
 */
function readEnabled(): CategoryEnabled {
  const stored = readStorageJson<Partial<CategoryEnabled>>(STORAGE_KEY, {});
  const base = defaultEnabled();
  for (const category of LOG_CATEGORY_FILTERS) {
    if (typeof stored[category] === "boolean") {
      base[category] = stored[category];
    }
  }
  return base;
}

export type LogCategoryState = {
  /** 每个分类的开关状态（true = 在面板显示）。 */
  enabled: CategoryEnabled;
  /** 某分类当前是否开启（避免调用方直接读 `enabled[c]` 再判 undefined）。 */
  isEnabled: (category: LogCategoryFilter) => boolean;
  /** 切换某个分类的显示开关；副作用是把新状态写回 localStorage。 */
  setEnabled: (category: LogCategoryFilter, value: boolean) => void;
};

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
export function disabledCategories(): Array<LogCategoryFilter> {
  const enabled = useLogCategoryStore.getState().enabled;
  return LOG_CATEGORY_FILTERS.filter((category) => !enabled[category]);
}
