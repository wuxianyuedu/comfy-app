"use client";

/* ── 本地更新检测的跨组件共享状态（纯状态，无副作用/无 IO）────
 * 轮询的「脏」结果、开关与手动触发入口要被多个非嵌套 chrome 消费（轮询
 * 挂载组件、顶部导航的手动检测按钮），用 zustand 单例收口，避免 React
 * context 层层透传。真正的轮询与 toast 由 UpdateCheckProvider 驱动，
 * 本文件不 import 任何 React 组件，可被纯逻辑单测。
 */

import { create } from "zustand";

import type { UpdateGroup } from "~/lib/update-check-client";

export interface UpdateCheckState {
  /** 运行期轮询检测开关（本地偏好，localStorage 持久化，默认开） */
  enabled: boolean;
  /** 是否有「需重启才生效」的本地文件在运行期被改过 */
  dirty: boolean;
  /** 最近一次检测结果里脏的分组（供主动检测展示明细） */
  groups: UpdateGroup[];
  /** 手动检测进行中标记（避免连点） */
  checking: boolean;
  setEnabled: (value: boolean) => void;
  applyResult: (groups: UpdateGroup[], dirty: boolean) => void;
  setChecking: (value: boolean) => void;
  clearDirty: () => void;
  /** 由挂载的轮询 Provider 注册的手动检测实现；未挂载时为 null */
  manualImpl: (() => Promise<boolean>) | null;
  registerManual: (impl: (() => Promise<boolean>) | null) => void;
}

export const useUpdateCheckStore = create<UpdateCheckState>((set) => ({
  enabled: true,
  dirty: false,
  groups: [],
  checking: false,
  manualImpl: null,
  setEnabled: (value) => set({ enabled: value }),
  applyResult: (groups, dirty) => set({ groups, dirty }),
  setChecking: (value) => set({ checking: value }),
  clearDirty: () => set({ dirty: false, groups: [] }),
  registerManual: (impl) => set({ manualImpl: impl }),
}));
