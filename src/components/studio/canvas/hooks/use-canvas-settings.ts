"use client";
/* ── 画布偏好状态与持久化（字段声明见 ../canvas-settings-types.ts，
 * 渲染出口是 <CanvasSettingsPanel> / <CanvasSettingsButton>）──
 * CanvasGrid / CanvasRulers / ZoomIndicator 经 props 读取；根组件调一次 `useCanvasSettings()` 再分发，
 * 避免 React Context 跨越 <ReactFlow> 边界干扰内部选择器订阅。 */
import { useCallback, useEffect, useSyncExternalStore } from "react";

import { readStorageJson, writeStorageJson } from "~/lib/browser-storage";
import { isPlainRecord } from "~/lib/is-record";

import { DEFAULT_CANVAS_SETTINGS, type CanvasSettings } from "../canvas-settings-types";

/* 存储键带版本（`v1`），将来改结构时可以迁移，
 * 不会与旧载荷相撞。 */
const STORAGE_KEY = "comfyapp:canvas-settings:v1";

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" ? value : fallback;
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readSettings(): CanvasSettings {
  /* SSR / 隐私模式 / 坏数据一律回落默认值 —— 三条判据收在
   *`~/lib/browser-storage`（§16.2.4.28）。 */
  return readStorageJson(STORAGE_KEY, DEFAULT_CANVAS_SETTINGS, (raw) => {
    const parsed: unknown = JSON.parse(raw);
    /* 向前兼容：存储里的未知键忽略，逐字段按运行时类型采用，
     * 坏值由默认值补齐（旧载荷留下的空洞同理）。 */
    if (!isPlainRecord(parsed)) {
      return DEFAULT_CANVAS_SETTINGS;
    }
    return {
      debugMode: booleanOr(parsed.debugMode, DEFAULT_CANVAS_SETTINGS.debugMode),
      gridGap: numberOr(parsed.gridGap, DEFAULT_CANVAS_SETTINGS.gridGap),
      gridMajorAlpha: numberOr(parsed.gridMajorAlpha, DEFAULT_CANVAS_SETTINGS.gridMajorAlpha),
      gridMajorLineWidth: numberOr(
        parsed.gridMajorLineWidth,
        DEFAULT_CANVAS_SETTINGS.gridMajorLineWidth,
      ),
      gridMinorAlpha: numberOr(parsed.gridMinorAlpha, DEFAULT_CANVAS_SETTINGS.gridMinorAlpha),
      gridMinorLineWidth: numberOr(
        parsed.gridMinorLineWidth,
        DEFAULT_CANVAS_SETTINGS.gridMinorLineWidth,
      ),
      maxZoom: numberOr(parsed.maxZoom, DEFAULT_CANVAS_SETTINGS.maxZoom),
      minZoom: numberOr(parsed.minZoom, DEFAULT_CANVAS_SETTINGS.minZoom),
      showGrid: booleanOr(parsed.showGrid, DEFAULT_CANVAS_SETTINGS.showGrid),
      showMiniMap: booleanOr(parsed.showMiniMap, DEFAULT_CANVAS_SETTINGS.showMiniMap),
      showRulers: booleanOr(parsed.showRulers, DEFAULT_CANVAS_SETTINGS.showRulers),
    };
  });
}

function writeSettings(settings: CanvasSettings): void {
  /* 写失败（配额满 / 隐私模式 / 被禁用）静默：设置对本次会话仍然生效，
   * 只是丢掉了持久化。 */
  writeStorageJson(STORAGE_KEY, settings);
}

/* 画布偏好唯一事实源：挂载时从 localStorage 读入，变更自动落盘并经模块级监听器集合
 *（useSyncExternalStore）广播给每个 `useCanvasSettings()` 实例。
 * 设置抽屉与 GlobalStepLogPanel 是独立组件 —— 在抽屉切换「调试模式」必须立刻让面板重渲染，
 * 而不是靠 props 穿过 React Flow 边界。 */
const SETTINGS_LISTENERS = new Set<() => void>();
let CURRENT_SETTINGS: CanvasSettings = DEFAULT_CANVAS_SETTINGS;

function notifySettings() {
  for (const listener of SETTINGS_LISTENERS) {
    listener();
  }
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
    setDebugMode: (value: boolean) => {
      update({ debugMode: value });
    },
  };
}

/* `Object.keys` 的运行时结果是 `string[]`；只有默认表里列出的键才是设置字段，
 * 由类型谓词收窄（不接受断言）。 */
function isCanvasSettingsKey(value: string): value is keyof CanvasSettings {
  return value in DEFAULT_CANVAS_SETTINGS;
}

/* 当且仅当用户改过任何一项、偏离了默认值时为真 ——
 * 用于点亮 ⚙ 按钮旁边那个紫色小点，让用户不必打开面板也知道自己的定制在生效。
 *`debugMode` 被排除在外：它是运行期调试手段，不是视觉定制，
 * 不该点亮「你改过设置」这个点。 */
export function isCustomCanvasSettings(settings: CanvasSettings): boolean {
  const keys = Object.keys(DEFAULT_CANVAS_SETTINGS)
    .filter(isCanvasSettingsKey)
    .filter((key) => key !== "debugMode");
  for (const k of keys) {
    if (settings[k] !== DEFAULT_CANVAS_SETTINGS[k]) {
      return true;
    }
  }
  return false;
}
