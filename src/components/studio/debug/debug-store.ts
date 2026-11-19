"use client";

/**
 * debug-store — 全局画布调试模式开关单例（Zustand）。三类画布共用同一开关：
 * workflow-* 工作流画布、project-canvas 项目画布、workflow-canvas 节点画布。
 * 打开后节点卡片底部叠加「渲染链路模块标签」，便于定位节点对应的代码模块。
 */

import { create } from "zustand";

export type DebugStoreState = {
  /** 全局调试模式是否开启 */
  debugMode: boolean;
  /** 显式设置调试模式 */
  setDebugMode: (v: boolean) => void;
  /** 切换调试模式 */
  toggleDebugMode: () => void;
};

export const useDebugStore = create<DebugStoreState>((set) => ({
  debugMode: false,
  toggleDebugMode: () => {
    set((state) => ({ debugMode: !state.debugMode }));
  },
  setDebugMode: (value) => {
    set({ debugMode: value });
  },
}));
