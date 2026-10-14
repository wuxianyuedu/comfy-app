"use client";

/**
 * 设置页「创作后端（ComfyUI）」分区的 sub-hook（`use-settings-page` 的拆分件）。
 *
 * 自 ISSUE #1900 起这里**只剩配置侧的两份只读派生**：
 *   · 安装形态（`comfyInstance`）—— 桌面版 / 便携版 / venv，以及路径配没配；
 *   · 桌面实例的六个存储目录（`comfyStorage`）—— 只读展示。
 * 两者都是「刚保存的 `comfyuiPath` 的函数」，所以「保存偏好」之后要各重取一次
 * （经 `refetchComfyInstance` / `refetchComfyStorage` 注入 `useSettingsSave`）。
 *
 * **启动 / 关闭 / 打开 / 启动日志整块搬去了侧栏「ComfyUI」页**
 *（`~/components/studio/comfyui/hooks/use-comfyui-control`）：那一分区的用户诉求
 * 是「改路径」，而运行态每次进来都要重付一遍秒级探测 —— 两件事挤在同一屏上，
 * 想改路径的人要先等运行态探测，想看日志的人要滚过一屏输入框。
 *
 * 搬走时**没有复制实现**：设置页这一侧不再持任何运行态，新页那一侧接住全部，
 * 所以不存在两份状态各自漂移的可能。运行态也不在这里取一次「顺手展示」——
 * 一旦取，30s 兜底轮询与事件订阅就会跟着挂到每一屏上（即使没人打开 ComfyUI 页）。
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
