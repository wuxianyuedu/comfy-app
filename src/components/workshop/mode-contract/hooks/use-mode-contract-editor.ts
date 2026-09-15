"use client";

// ── 「模式契约」编辑器：逻辑层（规范 17 §17.2 第②层）────────────────────
// 选模式 → 编辑该模式的统一输入 / 输出 → 保存注册表。
//
// 两个入口（工坊 / 工作流库）共用这一份逻辑：它们编辑的是同一份注册表，
// 状态机也完全一样，只有「弹窗从哪打开」不同。

import { useCallback, useState } from "react";

import {
  nextReferenceImageId,
  type ModeContract,
  type ModeContractInputId,
} from "@/lib/workshop/model-mode-contract";
import { effectiveModeContract } from "../mode-contract-config";
import { useModeContracts } from "./use-mode-contracts";

export interface ModeContractEditorController {
  /** 当前编辑的模式码（null = 未选）。 */
  mode: string | null;
  /** 当前编辑的契约草稿（null = 未选模式）。 */
  draft: ModeContract | null;
  /** 注册表里用户改过的模式。 */
  stored: ModeContract[];
  saving: boolean;
  /** 打开某模式的契约编辑（初值 = 已改过的用改过的，否则内置默认）。 */
  selectMode: (mode: string) => void;
  setDraft: (draft: ModeContract) => void;
  /** 追加一个输入口（参考图由调用方传 `nextReferenceImageId` 的结果）。 */
  appendInput: (id: ModeContractInputId) => void;
  /** 移除某个输入口（提示词口不可移除，由视图禁用按钮）。 */
  removeInput: (id: ModeContractInputId) => void;
  /** 下一个可追加的参考图口 id（没有选中模式时为 null）。 */
  nextReferenceImageId: ModeContractInputId | null;
  setOutput: (output: ModeContract["output"]) => void;
  /** 保存当前草稿（并入整份注册表）。 */
  save: () => Promise<void>;
  /** 本次打开期间是否已成功保存过（视图据此提示「另一处已生效」）。 */
  saved: boolean;
  /** 关闭弹窗。 */
  onClose: () => void;
}

export function useModeContractEditor({
  onClose,
}: {
  /** 关闭弹窗（视图层的关闭按钮与外层遮罩都走它）。 */
  onClose: () => void;
}): ModeContractEditorController {
  const registry = useModeContracts();
  const [mode, setMode] = useState<string | null>(null);
  const [draft, setDraft] = useState<ModeContract | null>(null);
  const [saved, setSaved] = useState(false);

  const selectMode = useCallback(
    (next: string) => {
      setMode(next);
      setDraft(effectiveModeContract(next, registry.contracts).contract);
      setSaved(false);
    },
    [registry.contracts],
  );

  const appendInput = useCallback((id: ModeContractInputId) => {
    setDraft((prev) =>
      prev && !prev.inputs.includes(id)
        ? { ...prev, inputs: [...prev.inputs, id] }
        : prev,
    );
  }, []);

  const removeInput = useCallback((id: ModeContractInputId) => {
    setDraft((prev) =>
      prev ? { ...prev, inputs: prev.inputs.filter((x) => x !== id) } : prev,
    );
  }, []);

  const setOutput = useCallback((output: ModeContract["output"]) => {
    setDraft((prev) => (prev ? { ...prev, output } : prev));
  }, []);

  const save = useCallback(async () => {
    if (!draft) return;
    const rest = registry.contracts.filter((c) => c.mode !== draft.mode);
    await registry.save([...rest, draft]);
    setSaved(true);
  }, [draft, registry]);

  return {
    mode,
    draft,
    stored: registry.contracts,
    saving: registry.saving,
    selectMode,
    setDraft: (next: ModeContract) => {
      setDraft(next);
      setSaved(false);
    },
    appendInput,
    removeInput,
    nextReferenceImageId: draft ? nextReferenceImageId(draft.inputs) : null,
    setOutput,
    save,
    saved,
    onClose,
  };
}
