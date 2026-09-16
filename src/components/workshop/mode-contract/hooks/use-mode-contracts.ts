"use client";

// ── 「模式契约注册表」：逻辑层（规范 17 §17.2 第②层）────────────────────
// 每种模式的统一输入 / 输出契约（工坊全局）。读取返回「用户改过的模式」，
// 未改过的模式由调用方回落内置默认（`effectiveModeContract`）。
//
// 放在工坊之外、给两个入口共用：工坊（驱动生成）与工作流库（配落点）读写的
// 是**同一份注册表**，各存一个 hook 会让「保存后另一处看不到」变成常态。

import { useCallback, useState } from "react";

import {
  parseModeContracts,
  type ModeContract,
} from "@/lib/workshop/model-mode-contract";
import { api } from "~/trpc/react";

export function useModeContracts() {
  const query = api.llm.modeContractsGet.useQuery();
  const [saving, setSaving] = useState(false);

  const contracts: ModeContract[] = parseModeContracts(query.data?.contracts);

  const saveMutation = api.llm.modeContractsSave.useMutation();

  const save = useCallback(
    async (contracts: ModeContract[]) => {
      setSaving(true);
      try {
        await saveMutation.mutateAsync({ contracts });
        await query.refetch();
      } finally {
        setSaving(false);
      }
    },
    [saveMutation, query],
  );

  return {
    /** 用户改过的契约（未改过的模式不在其中）。 */
    contracts,
    loading: query.isLoading,
    save,
    saving,
    refetch: query.refetch,
  };
}
