"use client";

/* ── 本地更新检测的跨组件共享状态（纯状态，无副作用/无 IO）────
 * 脏结果/开关/手动触发入口被多个非嵌套 chrome 消费，用 zustand 单例收口。
 * 轮询与 toast 由 UpdateCheckProvider 驱动；本文件不 import React 组件。
 */

import { create } from "zustand";

import type { UpdateGroup } from "~/lib/update-check-client";

export type UpdateCheckState = {
  applyResult: (groups: Array<UpdateGroup>, dirty: boolean) => void;
  /** 手动检测进行中标记（避免连点） */
  checking: boolean;
  clearDirty: () => void;
  /** 是否有「需重启才生效」的本地文件在运行期被改过 */
  dirty: boolean;
  /** 运行期轮询检测开关（本地偏好，localStorage 持久化，默认开） */
  enabled: boolean;
  /** 最近一次检测结果里脏的分组（供主动检测展示明细） */
  groups: Array<UpdateGroup>;
  /** 由挂载的轮询 Provider 注册的手动检测实现；未挂载时为 null */
  manualImpl: (() => Promise<boolean>) | null;
  registerManual: (impl: (() => Promise<boolean>) | null) => void;
  /**
   * 跑一次手动检测：置忙 → 跑 → **无论如何**复位（规范 16 §16.2.4.71）。
   * 忙碌位住在 store 里（多组件读），不能走组件级 use-busy-action；
   * 「复位绑在 finally」判据相同——漏掉则「检测中」永远卡在按钮上。
   */
  runChecking: <T>(action: () => Promise<T>) => Promise<T>;
  setChecking: (value: boolean) => void;
  setEnabled: (value: boolean) => void;
};

export const useUpdateCheckStore = create<UpdateCheckState>((set) => ({
  enabled: true,
  dirty: false,
  groups: [],
  checking: false,
  manualImpl: null,
  setEnabled: (value) => {
    set({ enabled: value });
  },
  applyResult: (groups, dirty) => {
    set({ groups, dirty });
  },
  setChecking: (value) => {
    set({ checking: value });
  },
  runChecking: async (action) => {
    set({ checking: true });
    try {
      return await action();
    } finally {
      set({ checking: false });
    }
  },
  clearDirty: () => {
    set({ dirty: false, groups: [] });
  },
  registerManual: (impl) => {
    set({ manualImpl: impl });
  },
}));
