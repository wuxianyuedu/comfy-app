"use client";

// ── 界面页签的行为：配置面（读 / 写）──────────────────────────────────────
//
// 「工作区的全局视图点开后是独立标签页还是共享标签页」（ISSUE #3623 / #3798）是应用级
// 配置：工作区读它决定「这一屏切走时关不关」，设置页写它。清单含非侧栏界面。
//
// 读取只有一份出口：服务端把「项目默认 + 本机覆盖」合成**生效配置**下发，客户端
// 只拿这一份（自己再合一次就会与磁盘上的那份漂移）。
//
// 两种保存方式与「模式契约」同一条口径：
//   · 「保存」 —— 落本机（`data/`），开发版与正式包都能用；
//   · 「保存为项目默认（跟代码走）」 —— 落项目默认那份入库 JSON，只有开发检出可用。

import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useBusyAction } from "~/components/ui/use-busy-action";
import type { SidebarTabConfig } from "~/lib/shell/sidebar-tab-behavior";
import { useTRPC } from "~/trpc/react";

/** 服务端下发的配置面读数：生效配置 + 项目默认 + 能不能写项目默认。 */
export type SidebarTabConfigQuery = {
  /** 生效配置（项目默认 + 本机覆盖）。 */
  config: SidebarTabConfig;
  /** 这份检出能不能「保存为项目默认」（正式包为 false，界面隐藏该入口）。 */
  projectDefaultEditable: boolean;
  /** 项目默认那份（跟代码走的那份）：「还原默认」的基准。 */
  projectDefaults: SidebarTabConfig;
};

/** 读配置面（工作区与设置页共用同一份 React Query 缓存 —— 保存后自动回读）。 */
export function useSidebarTabConfigQuery() {
  const trpc = useTRPC();
  return useQuery(trpc.sidebar.tabConfigGet.queryOptions());
}

/**
 * 写配置面的三个动作（本机保存 / 写项目默认 / 还原默认）。
 *
 * 忙碌位各走各的：三个按钮可能同时在等（用户在慢网下连点），共用一个指示器就会
 * 出现「转圈的按钮不是自己那一个」。
 */
export function useSidebarTabConfigActions() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const saveBusy = useBusyAction();
  const saveDefaultsBusy = useBusyAction();
  const resetBusy = useBusyAction();

  const saveMutation = useMutation(trpc.sidebar.tabConfigSave.mutationOptions());
  const saveDefaultsMutation = useMutation(
    trpc.sidebar.tabConfigSaveProjectDefaults.mutationOptions(),
  );
  const resetMutation = useMutation(trpc.sidebar.tabConfigReset.mutationOptions());

  /** 「保存」：落本机。返回落盘后的生效配置。 */
  const save = useCallback(
    async (config: SidebarTabConfig): Promise<SidebarTabConfig> => {
      return saveBusy.run(async () => {
        const res = await saveMutation.mutateAsync({ config });
        await queryClient.invalidateQueries({ queryKey: trpc.sidebar.tabConfigGet.queryKey() });
        return res.config;
      });
    },
    [saveBusy, saveMutation, queryClient, trpc.sidebar.tabConfigGet],
  );

  /** 「保存为项目默认（跟代码走）」：全量写进入库 JSON。返回写盘的绝对路径
   *  （界面转告「提交后生效」）；非开发检出服务端会拒。 */
  const saveAsProjectDefaults = useCallback(
    async (config: SidebarTabConfig): Promise<string | null> => {
      return saveDefaultsBusy.run(async () => {
        const res = await saveDefaultsMutation.mutateAsync({ config });
        await queryClient.invalidateQueries({ queryKey: trpc.sidebar.tabConfigGet.queryKey() });
        return res.file;
      });
    },
    [saveDefaultsBusy, saveDefaultsMutation, queryClient, trpc.sidebar.tabConfigGet],
  );

  /** 「还原默认」：删掉本机覆盖，生效值回落项目默认。 */
  const resetToDefault = useCallback(async (): Promise<SidebarTabConfig | null> => {
    return resetBusy.run(async () => {
      const res = await resetMutation.mutateAsync();
      await queryClient.invalidateQueries({ queryKey: trpc.sidebar.tabConfigGet.queryKey() });
      return res.config;
    });
  }, [resetBusy, resetMutation, queryClient, trpc.sidebar.tabConfigGet]);

  return {
    resetToDefault,
    resetBusy: resetBusy.busy,
    save,
    saveAsProjectDefaults,
    saving: saveBusy.busy,
    savingProjectDefaults: saveDefaultsBusy.busy,
  };
}
