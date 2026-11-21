"use client";

/**
 * 日志面板的**显示偏好**：行密度（紧凑 / 标准 / 宽松）与精简列（隐藏时刻 / 级别 /
 * 来源等非正文列，ISSUE #4567）。两者都是跨会话偏好（同 `wide-panel`），走模块级
 * store + `useSyncExternalStore` + localStorage：同一面板可能同时挂多份实例
 * （按钮在标题栏、行在虚拟窗口），纯 useState 会各存一份真相。
 * 读取失败（SSR / 隐私模式）回默认值。改值即写 localStorage，重开面板仍记住。
 */
import { useSyncExternalStore } from "react";

import { readStorageItem, writeStorageItem } from "~/lib/browser-storage";
import { isRecord } from "~/lib/is-record";

/** 行密度档：影响每行的上下内边距与虚拟滚动的行高常量（见 `log-virtual` 的 `rowHeightFor`）。 */
export type LogDensity = "compact" | "standard" | "relaxed";

/** 是否隐藏「时刻 / 级别 / 位置 / 来源」等非正文列（只留日志正文与复制按钮）。 */
export type LogColumnVisibility = "full" | "message-only";

/** 日志正文的字号档：小 / 标准 / 大（行盒高度见 `log-virtual` 的 `LOG_LINE_BOX`）。 */
export type LogFontSize = "small" | "standard" | "large";

type LogDisplayPrefs = {
  columns: LogColumnVisibility;
  density: LogDensity;
  fontSize: LogFontSize;
};

const DEFAULT_PREFS: LogDisplayPrefs = {
  columns: "full",
  density: "standard",
  fontSize: "standard",
};

const STORAGE_KEY = "comfyapp:log-display-prefs";

let current: LogDisplayPrefs = readInitial();

function readInitial(): LogDisplayPrefs {
  const raw = readStorageItem(STORAGE_KEY);
  if (raw === null || raw === "") {
    return { ...DEFAULT_PREFS };
  }
  /* 存储里的脏值按缺省处理：偏好坏一格不至于把面板渲染搞挂。 */
  try {
    const parsed: unknown = JSON.parse(raw);
    const next: LogDisplayPrefs = { ...DEFAULT_PREFS };
    if (isRecord(parsed)) {
      if (
        parsed.density === "compact" ||
        parsed.density === "standard" ||
        parsed.density === "relaxed"
      ) {
        next.density = parsed.density;
      }
      if (parsed.columns === "message-only") {
        next.columns = "message-only";
      }
      if (
        parsed.fontSize === "small" ||
        parsed.fontSize === "standard" ||
        parsed.fontSize === "large"
      ) {
        next.fontSize = parsed.fontSize;
      }
    }
    return next;
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

const LISTENERS = new Set<() => void>();

function notify(): void {
  for (const listener of LISTENERS) {
    listener();
  }
}

function commit(next: LogDisplayPrefs): void {
  current = next;
  writeStorageItem(STORAGE_KEY, JSON.stringify(current));
  notify();
}

export function getLogDisplayPrefs(): LogDisplayPrefs {
  return current;
}

export function setLogDensity(density: LogDensity): void {
  if (current.density === density) {
    return;
  }
  commit({ ...current, density });
}

export function setLogFontSize(fontSize: LogFontSize): void {
  if (current.fontSize === fontSize) {
    return;
  }
  commit({ ...current, fontSize });
}

export function setLogColumns(columns: LogColumnVisibility): void {
  if (current.columns === columns) {
    return;
  }
  commit({ ...current, columns });
}

function subscribe(listener: () => void): () => void {
  LISTENERS.add(listener);
  return () => {
    LISTENERS.delete(listener);
  };
}

/** 面板消费的快照 hook（引用稳定：偏好不变时同一对象，memo 不被打穿）。 */
export function useLogDisplayPrefs(): LogDisplayPrefs {
  return useSyncExternalStore(subscribe, getLogDisplayPrefs, getLogDisplayPrefs);
}
