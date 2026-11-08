"use client";

// ── 「模式契约注册表」：逻辑层（规范 17 §17.2 第②层）────────────────────
// 每种模式的统一输入/输出契约（工坊全局）。读取返回「用户改过的模式」，未改过的
// 由调用方回落内置默认（`effectiveModeContract`）。给两个入口共用：工坊与工作流库
// 读写**同一份注册表**，各存一个 hook 会让「保存后另一处看不到」变成常态。

import { useCallback } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";

import { useBusyAction } from "~/components/ui/use-busy-action";

import { parseModeContracts, type ModeContract } from "~/lib/workshop/model-mode-contract";
import { useTRPC } from "~/trpc/react";

export function useModeContracts() {
  const trpc = useTRPC();
  const query = useQuery(trpc.llm.modeContractsGet.queryOptions());
  /* 忙碌位走唯一出口（规范 16 §16.2.4.71）。 */
  const saveBusy = useBusyAction();
  const saveDefaultsBusy = useBusyAction();
  const resetBusy = useBusyAction();

  const contracts: Array<ModeContract> = parseModeContracts(query.data?.contracts);

  const saveMutation = useMutation(trpc.llm.modeContractsSave.mutationOptions());
  const saveDefaultsMutation = useMutation(
    trpc.llm.modeContractsSaveProjectDefaults.mutationOptions(),
  );
  const resetMutation = useMutation(trpc.llm.modeContractReset.mutationOptions());

  /** 这份检出能不能「保存为项目默认」：只有开发检出有可写的目标文件
   *  （ISSUE #3396，服务端判据 `isDevCheckout`）。 */
  const projectDefaultEditable = query.data?.projectDefaultEditable === true;

  const save = useCallback(
    async (contracts: Array<ModeContract>) => {
      await saveBusy.run(async () => {
        await saveMutation.mutateAsync({ contracts });
        await query.refetch();
      });
    },
    [saveMutation, query, saveBusy],
  );

  /** 「保存为项目默认」（跟代码走）：与推导有差异的契约写进入库 JSON。
   *  返回写盘的绝对路径（界面转告「提交后生效」）；非开发检出服务端会拒。 */
  const saveAsProjectDefaults = useCallback(
    async (contracts: Array<ModeContract>): Promise<string | null> => {
      return saveDefaultsBusy.run(async () => {
        const res = await saveDefaultsMutation.mutateAsync({ contracts });
        return res.file;
      });
    },
    [saveDefaultsMutation, saveDefaultsBusy],
  );

  /** 「还原默认」：把一个模式从本机覆盖里移除（生效值回落成品配置）。
   *  返回该模式还原后的生效契约（界面拿它刷新草稿）。 */
  const resetToDefault = useCallback(
    async (mode: string): Promise<ModeContract | null> => {
      return resetBusy.run(async () => {
        const res = await resetMutation.mutateAsync({ mode });
        await query.refetch();
        return res.effective;
      });
    },
    [resetMutation, query, resetBusy],
  );

  return {
    /** 用户改过的契约（未改过的模式不在其中）。 */
    contracts,
    loading: query.isLoading,
    /** 这份检出能不能「保存为项目默认」（正式包为 false，界面隐藏该入口）。 */
    projectDefaultEditable,
    save,
    saveAsProjectDefaults,
    /** 还原一个模式到默认（从本机覆盖移除）。 */
    resetToDefault,
    saving: saveBusy.busy,
    /** 「保存为项目默认」进行中（与 `saving` 分开：两个按钮各自转圈）。 */
    savingProjectDefaults: saveDefaultsBusy.busy,
    /** 「还原默认」进行中。 */
    resetting: resetBusy.busy,
    refetch: query.refetch,
  };
}
