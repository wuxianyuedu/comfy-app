"use client";

// ── 「一条工作流在工坊视角下的封装状态」取数收口（规范 17 §17.2 第②层）──────
// 契约口清单与必备口都读 `useModeContracts()` 的**生效注册表**（本机覆盖逐模式
// 压过项目默认），与模式契约编辑器、远端适配器、实际生成链路同一份口径。
// 此前列表行徽标自己调 `deriveEncapsulationStatus` 时没传契约口径，回落内置
// 默认 —— 用户改过的契约在列表行不生效，与详情页签各说各话（ISSUE #4113）。
// 列表行与「工坊封装」页签现在同用这一个 hook，别再各写一份取数。

import { useMemo } from "react";

import { upperToken } from "~/lib/upper-token";
import {
  modeContractEntries,
  requiredInputsFor,
  type ContractEntryDisplay,
} from "~/lib/workshop/model-mode-contract";
import {
  deriveEncapsulationStatus,
  type EncapsulationStatus,
} from "~/lib/workshop/workshop-encapsulation-status";
import type { WorkflowIOMap } from "~/components/studio/workflow-io";
import { useModeContracts } from "~/components/workshop/mode-contract/hooks/use-mode-contracts";

export type WorkflowEncapsulation = {
  /** 该模式生效的契约口清单（含作者自定义的口）。 */
  contractEntries: Array<ContractEntryDisplay>;
  /** 契约口 id 清单（流程测试组载荷用）。 */
  contractIds: Array<string>;
  /** 该模式的必备口（随模式契约配置）。 */
  requiredInputs: Array<string>;
  /** 封装状态派生（逐口落点 / 缺口 / ready）。 */
  status: EncapsulationStatus;
};

export function useWorkflowEncapsulation(args: {
  io: WorkflowIOMap | null | undefined;
  mode: string | null | undefined;
  paramMap: Record<string, unknown> | null | undefined;
}): WorkflowEncapsulation {
  const { mode, io, paramMap } = args;
  const { contracts } = useModeContracts();
  const contractEntries = useMemo(() => modeContractEntries(mode, contracts), [mode, contracts]);
  const contractIds = useMemo(() => contractEntries.map((entry) => entry.id), [contractEntries]);
  const requiredInputs = useMemo(
    () =>
      requiredInputsFor({
        inputs: contractIds,
        required: contracts.find((c) => c.mode === upperToken(mode))?.required,
      }),
    [contractIds, mode, contracts],
  );
  const status = useMemo(
    () =>
      deriveEncapsulationStatus({
        io,
        paramMap,
        mode,
        contractEntries,
        requiredInputs,
      }),
    [io, paramMap, mode, contractEntries, requiredInputs],
  );
  return { contractEntries, contractIds, requiredInputs, status };
}
