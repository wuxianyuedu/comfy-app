"use client";

/* ── 日志行显示偏好（纯状态 + 持久化）──────────────────────────────
 * 「设置 → 日志」与日志面板共享两件显示偏好：行距密度、是否显示行头元信息列
 * （时刻 / 级别徽标 / 位置 / 来源）。隐藏元信息列时鼠标框选正文不再带上无用信息
 * （ISSUE #4567）；行距档控制日志项之间的间隔。
 * 状态用 zustand 单例（同 `log-category-store` 的理由：设置页写、面板读，避免
 * context 透传）；持久化走 `~/lib/browser-storage`（SSR 安全、写失败静默），
 * 默认「标准行距 + 显示元信息」＝「没设过」。 */

import { create } from "zustand";

import { readStorageJson, writeStorageJson } from "~/lib/browser-storage";

import { toLogDensity, type LogDensity } from "./log-virtual";

const DENSITY_KEY = "comfyapp.logDisplay.density";
const SHOW_META_KEY = "comfyapp.logDisplay.showMeta";

function readDensity(): LogDensity {
  /* 存的是字符串；坏值 / 没存过回落标准档（`toLogDensity` 的词表外兜底）。 */
  return toLogDensity(readStorageJson<unknown>(DENSITY_KEY, "default"));
}

function readShowMeta(): boolean {
  return readStorageJson<unknown>(SHOW_META_KEY, true) !== false;
}

export type LogDisplayState = {
  /** 行距密度档（日志项之间的间隔）。 */
  density: LogDensity;
  /** 切换行距档；副作用是把新状态写回 localStorage。 */
  setDensity: (density: LogDensity) => void;
  /** 切换元信息列显示；副作用是把新状态写回 localStorage。 */
  setShowMeta: (show: boolean) => void;
  /** 是否显示行头元信息列（时刻 / 级别徽标 / 位置 / 来源）。 */
  showMeta: boolean;
};

export const useLogDisplayStore = create<LogDisplayState>((set, get) => ({
  density: readDensity(),
  showMeta: readShowMeta(),
  setDensity: (density) => {
    set({ density });
    // 记忆是增强不是功能：写失败（隐私模式 / 配额满）仅内存态生效。
    writeStorageJson(DENSITY_KEY, get().density);
  },
  setShowMeta: (showMeta) => {
    set({ showMeta });
    writeStorageJson(SHOW_META_KEY, get().showMeta);
  },
}));
