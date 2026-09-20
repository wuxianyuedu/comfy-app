"use client";

// ── 「模式契约」编辑器：逻辑层（规范 17 §17.2 第②层）────────────────────
// 选模式 → 编辑该模式的统一输入 / 输出 → 保存注册表。
//
// 两个入口（工坊 / 工作流库）共用这一份逻辑：它们编辑的是同一份注册表，
// 状态机也完全一样，只有「弹窗从哪打开」不同。

import { useCallback, useMemo, useState } from "react";

import {
  moveContractInput,
  nextCustomInputId,
  nextReferenceImageId,
  requiredInputsFor,
  type ModeContract,
  type ModeContractCustomKind,
  type ModeContractInputId,
} from "~/lib/workshop/model-mode-contract";
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
  /** 移除某个输入口（自定义口连着它的定义一起移除）。 */
  removeInput: (id: ModeContractInputId) => void;
  /** 上移 / 下移一个输入口（`delta` = -1 / +1）—— 顺序即工坊对外的参数顺序。 */
  moveInput: (id: ModeContractInputId, delta: number) => void;
  /** 新增一个自定义口（作者填名 + 选简单类型）。空名不生效。 */
  addCustomInput: (label: string, kind: ModeContractCustomKind) => void;
  /** 改一个自定义口的展示名（空名不生效，保持原名）。 */
  renameCustomInput: (id: ModeContractInputId, label: string) => void;
  /** 该口当前是不是必备口（缺了它这条模式在工坊里驱动不起来）。 */
  isRequired: (id: ModeContractInputId) => boolean;
  /** 切换某个口的「必备」状态。 */
  toggleRequired: (id: ModeContractInputId) => void;
  /** 曲线救国的兜底：契约里一个必备口都没勾时要不要提示（视图据此给提示）。 */
  hasAnyRequired: boolean;
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
    setSaved(false);
  }, []);

  const removeInput = useCallback((id: ModeContractInputId) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const inputs = prev.inputs.filter((x) => x !== id);
      return {
        ...prev,
        inputs,
        /* 自定义口没删定义的话，「全部参数」里会留下一个不在清单里的幽灵口 ——
         *  它已经没有任何入口能再加回来。 */
        ...(prev.customInputs
          ? { customInputs: prev.customInputs.filter((def) => def.id !== id) }
          : {}),
        /* 口都没了，它的「必备」也跟着消失 —— 留一个指向不存在口的必备项，
         *  会让「缺了必备口」的判据永远为真。 */
        required: requiredInputsFor({ inputs, required: prev.required }),
      };
    });
    setSaved(false);
  }, []);

  /* 调序只动 `inputs` 的顺序：顺序就是工坊对外的参数顺序（数组下标即界面上的
   * 序号），另存一份顺序必然与它走散。越界时纯函数返回原数组，这里不再判一次。 */
  const moveInput = useCallback((id: ModeContractInputId, delta: number) => {
    setDraft((prev) =>
      prev
        ? { ...prev, inputs: moveContractInput(prev.inputs, id, delta) }
        : prev,
    );
    setSaved(false);
  }, []);

  /* 自定义口：id 由系统生成（把类型编进去，见 `nextCustomInputId`），作者只填
   *  名字 —— 名字单独存在 `customInputs` 里，落点/封装/适配器一律按 id 走。 */
  const addCustomInput = useCallback(
    (label: string, kind: ModeContractCustomKind) => {
      const trimmed = label.trim();
      if (!trimmed) return;
      setDraft((prev) => {
        if (!prev) return prev;
        const id = nextCustomInputId(prev.inputs, kind);
        return {
          ...prev,
          inputs: [...prev.inputs, id],
          customInputs: [
            ...(prev.customInputs ?? []),
            { id, label: trimmed, kind },
          ],
        };
      });
      setSaved(false);
    },
    [],
  );

  const renameCustomInput = useCallback(
    (id: ModeContractInputId, label: string) => {
      const trimmed = label.trim();
      if (!trimmed) return;
      setDraft((prev) =>
        prev?.customInputs
          ? {
              ...prev,
              customInputs: prev.customInputs.map((def) =>
                def.id === id ? { ...def, label: trimmed } : def,
              ),
            }
          : prev,
      );
      setSaved(false);
    },
    [],
  );

  /** 该模式下生效的必备口（配过用配过的，没配过回落内置默认）。 */
  const effectiveRequired = useMemo(
    () =>
      draft
        ? requiredInputsFor({
            inputs: draft.inputs,
            required: draft.required,
          })
        : [],
    [draft],
  );

  const isRequired = useCallback(
    (id: ModeContractInputId) => effectiveRequired.includes(id),
    [effectiveRequired],
  );
  const toggleRequired = useCallback((id: ModeContractInputId) => {
    setDraft((prev) => {
      if (!prev) return prev;
      /* 第一次改动就先把生效值固化下来（`required` 从 undefined 变实数组）——
       * 不固化的话每次读回落内置默认，「取消勾选提示词」这个操作会被默认值
       * 立刻复活，勾选框点不掉。 */
      const current = requiredInputsFor({
        inputs: prev.inputs,
        required: prev.required,
      });
      const next = current.includes(id)
        ? current.filter((x) => x !== id)
        : [...current, id];
      return {
        ...prev,
        required: prev.inputs.filter((x) => next.includes(x)),
      };
    });
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
    isRequired,
    toggleRequired,
    hasAnyRequired: effectiveRequired.length > 0,
    selectMode,
    setDraft: (next: ModeContract) => {
      setDraft(next);
      setSaved(false);
    },
    appendInput,
    removeInput,
    moveInput,
    addCustomInput,
    renameCustomInput,
    nextReferenceImageId: draft ? nextReferenceImageId(draft.inputs) : null,
    setOutput,
    save,
    saved,
    onClose,
  };
}
