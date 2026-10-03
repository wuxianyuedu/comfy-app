"use client";
/* ── 画布偏好的状态与持久化（设置的字段声明见 `../canvas-settings-types.ts`，
 * 渲染出口是 <CanvasSettingsPanel> / <CanvasSettingsButton>）──
 *
 * 设置由 CanvasGrid / CanvasRulers / ZoomIndicator 经 props 读取
 * （工作流编辑器根组件调一次`useCanvasSettings()` 再分发）。
 * 这样就避免了任何 React Context 跨越`<ReactFlow>` 边界 ——
 * 那会干扰编辑器内部的选择器订阅。
 */
import { useCallback, useEffect, useSyncExternalStore } from "react";

import { readStorageJson, writeStorageJson } from "~/lib/browser-storage";

import {
  DEFAULT_CANVAS_SETTINGS,
  type CanvasSettings,
} from "../canvas-settings-types";

/* 存储键带版本（`v1`），将来改结构时可以迁移，
 * 不会与旧载荷相撞。 */
const STORAGE_KEY = "comfyapp:canvas-settings:v1";

function readSettings(): CanvasSettings {
  /* SSR / 隐私模式 / 坏数据一律回落默认值 —— 三条判据收在
   *`~/lib/browser-storage`（§16.2.4.28）。 */
  return readStorageJson(STORAGE_KEY, DEFAULT_CANVAS_SETTINGS, (raw) => {
    const parsed = JSON.parse(raw) as Partial<CanvasSettings>;
    /* 向前兼容：存储里的未知键忽略，默认值补齐旧载荷留下的空洞。 */
    return { ...DEFAULT_CANVAS_SETTINGS, ...parsed };
  });
}

function writeSettings(settings: CanvasSettings): void {
  /* 写失败（配额满 / 隐私模式 / 被禁用）静默：设置对本次会话仍然生效，
   * 只是丢掉了持久化。 */
  writeStorageJson(STORAGE_KEY, settings);
}

/* 画布偏好的唯一事实源。挂载时从 localStorage 读入；
 * 变更会自动落盘，并经模块级监听器集合（useSyncExternalStore）
 * 广播给**每一个**`useCanvasSettings()` 实例。
 * 这一点很要紧：设置抽屉与 GlobalStepLogPanel 是两个独立组件 ——
 * 在抽屉里切换「调试模式」必须立刻让面板重渲染，
 * 而不是靠 props 一路穿过 React Flow 边界传下去。 */
const SETTINGS_LISTENERS = new Set<() => void>();
let CURRENT_SETTINGS: CanvasSettings = DEFAULT_CANVAS_SETTINGS;

function notifySettings() {
  for (const listener of SETTINGS_LISTENERS) listener();
}

function applySettings(next: CanvasSettings) {
  CURRENT_SETTINGS = next;
  writeSettings(next);
  notifySettings();
}

export function useCanvasSettings() {
  /* 先用默认值起步，避免 SSR / 首屏闪一下已保存的状态。
   *`hydrated` 只在客户端翻转，且经 useSyncExternalStore 实现
   *（不在 effect 里 set-state）。 */
  const hydrated = useSyncExternalStore(
    useCallback(() => () => undefined, []),
    () => true,
    () => false,
  );

  useEffect(() => {
    CURRENT_SETTINGS = readSettings();
    notifySettings();
  }, []);

  const subscribe = useCallback((cb: () => void) => {
    SETTINGS_LISTENERS.add(cb);
    return () => {
      SETTINGS_LISTENERS.delete(cb);
    };
  }, []);

  const getSnapshot = useCallback(() => CURRENT_SETTINGS, []);

  const settings = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const update = useCallback((patch: Partial<CanvasSettings>) => {
    applySettings({ ...CURRENT_SETTINGS, ...patch });
  }, []);

  const reset = useCallback(() => {
    applySettings(DEFAULT_CANVAS_SETTINGS);
  }, []);

  return { settings, update, reset, hydrated };
}

/* 只取「调试模式」开关的便捷访问器。 */
export function useDebugMode() {
  const { settings, update } = useCanvasSettings();
  return {
    debugMode: settings.debugMode,
    setDebugMode: (value: boolean) => update({ debugMode: value }),
  };
}

/* 当且仅当用户改过任何一项、偏离了默认值时为真 ——
 * 用于点亮 ⚙ 按钮旁边那个紫色小点，让用户不必打开面板也知道自己的定制在生效。
 *`debugMode` 被排除在外：它是运行期调试手段，不是视觉定制，
 * 不该点亮「你改过设置」这个点。 */
export function isCustomCanvasSettings(settings: CanvasSettings): boolean {
  const keys = (
    Object.keys(DEFAULT_CANVAS_SETTINGS) as (keyof CanvasSettings)[]
  ).filter((key) => key !== "debugMode");
  for (const k of keys) {
    if (settings[k] !== DEFAULT_CANVAS_SETTINGS[k]) return true;
  }
  return false;
}
