"use client";

/**
 * 设置页「创作后端（ComfyUI）」分区的 sub-hook（ISSUE #1900 起只剩只读派生）：安装形态（`comfyInstance`）
 * 与桌面实例存储目录（`comfyStorage`）都是「刚保存的 `comfyuiPath` 的函数」，保存后各重取一次。
 * 启动/关闭/日志整块在侧栏「ComfyUI」页（未复制实现）；运行态也不在此取，否则 30s 轮询会挂到每一屏。
 */
import { useQuery } from "@tanstack/react-query";

import { useTRPC } from "~/trpc/react";

export function useSettingsComfy(input: {
  /** 首屏两份配置就绪前不发这些查询（与主 hook 的同一门控）。 */
  statusQueriesEnabled: boolean;
}) {
  const { statusQueriesEnabled } = input;
  const trpc = useTRPC();
  const comfyInstanceQ = useQuery(trpc.setting.comfyInstance.queryOptions());
  /* 桌面实例的六个存储目录（只读展示）：不进轮询 —— 它只是配置路径与 yaml 的
   * 函数，秒级重取既没有新事实，又让这张卡片变成「一直在算」。 */
  const comfyStorageQ = useQuery(
    trpc.setting.comfyStorage.queryOptions(undefined, {
      enabled: statusQueriesEnabled,
    }),
  );

  return {
    /* 安装形态：**不 gate 在 statusQueriesEnabled 上**，与首屏的
     * get/configGet 同批发出 —— 它是 fs-only 的毫秒级判据。 */
    comfyInstance: comfyInstanceQ.data ?? null,
    /* 非桌面实例服务端返回 null（不拿别的形态凑数）。 */
    comfyStorage: comfyStorageQ.data ?? null,
    /** 「保存偏好」后重判安装形态用（形态依赖刚保存的路径）。 */
    refetchComfyInstance: async () => {
      await comfyInstanceQ.refetch();
    },
    /** 同上时机重取存储目录：它与形态同源（都取决于刚保存的 comfyuiPath）。 */
    refetchComfyStorage: async () => {
      await comfyStorageQ.refetch();
    },
  };
}
