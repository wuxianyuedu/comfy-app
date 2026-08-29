"use client";

/**
 * debug-store — 全局画布调试模式开关单例（Zustand）。
 *
 * 多个画布共用同一开关：
 *  - workflow-* 工作流画布（WorkflowNode，src/components/studio/workflow-*）
 *  - project-canvas/ 项目画布（CanvasNode，ProjectCanvas + project-canvas/*）
 *  - workflow-canvas 节点画布（ComfyNode）
 *
 * 打开后，各画布节点卡片底部叠加显示「渲染链路模块标签」，
 * 便于开发时快速定位某个节点卡片对应本项目哪些代码模块。
 */

import { create } from "zustand";

export interface DebugStoreState {
  /** 全局调试模式是否开启 */
  debugMode: boolean;
  /** 切换调试模式 */
  toggleDebugMode: () => void;
  /** 显式设置调试模式 */
  setDebugMode: (v: boolean) => void;
}

export const useDebugStore = create<DebugStoreState>((set) => ({
  debugMode: false,
  toggleDebugMode: () => set((state) => ({ debugMode: !state.debugMode })),
  setDebugMode: (value) => set({ debugMode: value }),
}));
