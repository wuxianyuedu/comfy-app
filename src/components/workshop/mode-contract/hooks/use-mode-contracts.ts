"use client";

// ── 「模式契约注册表」：逻辑层（规范 17 §17.2 第②层）────────────────────
// 每种模式的统一输入/输出契约（工坊全局）。读取返回**两层**：成品配置基准
// （项目默认）与生效注册表（本机覆盖逐模式压过它）——界面显示 / 编辑用生效值，
// 判「已改」用基准。给两个入口共用：工坊与工作流库读写**同一份注册表**，
// 各存一个 hook 会让「保存后另一处看不到」变成常态。

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

  /* 成品配置基准（判「已改」用）：服务端**现读**项目默认那份，读数没到时由
   * `effectiveModeContract` 回落编译进包的静态快照。 */
  const configured: Array<ModeContract> = parseModeContracts(query.data?.configured);
  /* 生效注册表（显示 / 编辑 / 工坊运行口径一致的那一份）。 */
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

  /** 「保存为项目默认（跟代码走）」：编辑器现状**全量**写进入库 JSON（#3603 起该
   *  文件是完整基线，不再是「与推导的差集」）。返回写盘的绝对路径（界面转告
   *  「提交后生效」）；非开发检出服务端会拒。
   *
   *  写完**立刻重读**：服务端现读那份文件 ⇒ 重读回来的就是新口径，界面这一跳
   *  就生效，不必重启应用（#3634）。 */
  const saveAsProjectDefaults = useCallback(
    async (contracts: Array<ModeContract>): Promise<string | null> => {
      return saveDefaultsBusy.run(async () => {
        const res = await saveDefaultsMutation.mutateAsync({ contracts });
        await query.refetch();
        return res.file;
      });
    },
    [saveDefaultsMutation, query, saveDefaultsBusy],
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
    /** 生效的契约注册表（成品配置 + 本机覆盖，逐模式合并）。 */
    contracts,
    /** 成品配置基准（项目默认；判「已改」用它）。 */
    configured,
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
