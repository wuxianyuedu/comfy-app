"use client";

// ── 「模式契约」编辑器：逻辑层（规范 17 §17.2 第②层）────────────────────
// 选模式 → 编辑该模式的统一输入 / 输出 → 保存注册表。
//
// 两个入口（工坊 / 工作流库）共用这一份逻辑：它们编辑的是同一份注册表，
// 状态机也完全一样，只有「弹窗从哪打开」不同。

import { useCallback, useMemo, useState } from "react";

import { errorMessage } from "~/lib/error-message";
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

export type ModeContractEditorController = {
  /** 新增一个自定义口（作者填名 + 选简单类型）。空名不生效。 */
  addCustomInput: (label: string, kind: ModeContractCustomKind) => void;
  /** 追加一个输入口（参考图由调用方传 `nextReferenceImageId` 的结果）。 */
  appendInput: (id: ModeContractInputId) => void;
  /** 确认弹窗 · 留在此模式（什么都不改）。 */
  cancelSwitch: () => void;
  /** 成品配置基准（项目默认）—— 判「已改」用它（服务端现读，写完即生效）。 */
  configured: Array<ModeContract>;
  /** 确认弹窗 · 保存并切换（先落当前草稿再切）。 */
  confirmSwitch: () => Promise<void>;
  /** 当前草稿相对生效值有没有未保存的修改（ISSUE #3762：左栏标「未保存」、切走前先问）。 */
  dirty: boolean;
  /** 确认弹窗 · 不保存，直接切换（草稿丢弃）。 */
  discardSwitch: () => void;
  /** 当前编辑的契约草稿（null = 未选模式）。 */
  draft: ModeContract | null;
  /** 曲线救国的兜底：契约里一个必备口都没勾时要不要提示（视图据此给提示）。 */
  hasAnyRequired: boolean;
  /** 该口当前是不是必备口（缺了它这条模式在工坊里驱动不起来）。 */
  isRequired: (id: ModeContractInputId) => boolean;
  /** 当前编辑的模式码（null = 未选）。 */
  mode: string | null;
  /** 上移 / 下移一个输入口（`delta` = -1 / +1）—— 顺序即工坊对外的参数顺序。 */
  moveInput: (id: ModeContractInputId, delta: number) => void;
  /** 下一个可追加的参考图口 id（没有选中模式时为 null）。 */
  nextReferenceImageId: ModeContractInputId | null;
  /** 确认弹窗开着时的目标模式码（null = 没有挂起的切换）。 */
  pendingMode: string | null;
  /** 这份检出能不能「保存为项目默认」（正式包 false，入口随之隐藏）。 */
  projectDefaultEditable: boolean;
  /** 移除某个输入口（自定义口连着它的定义一起移除）。 */
  removeInput: (id: ModeContractInputId) => void;
  /** 改一个自定义口的展示名（空名不生效，保持原名）。 */
  renameCustomInput: (id: ModeContractInputId, label: string) => void;
  /** 「还原默认」进行中。 */
  resetting: boolean;
  /** 还原当前模式到默认：从本机覆盖移除、草稿回到成品配置（ISSUE #3396 反馈 2）。 */
  resetToDefault: () => Promise<void>;
  /** 保存当前草稿（并入整份注册表）。 */
  save: () => Promise<void>;
  /** 把当前草稿并入整份注册表后写回**项目默认**（跟代码走；只有开发检出可用，
   *  正式包该入口不渲染、服务端也会拒）。解析为写盘的文件路径。 */
  saveAsProjectDefault: () => Promise<string | null>;
  /** 本次打开期间是否已成功保存过（视图据此提示「另一处已生效」）。 */
  saved: boolean;
  savedKind: "local" | "project" | null;
  /** 最近一次保存失败的**用户可读**原因（null = 没有挂起的失败）。
   *  失败路径必须有用户可见出口（#3637）：此前错误一路抛到无人接的
   *  `void controller.save()` 上，界面只转圈、不提示、改动也不生效。 */
  saveError: string | null;
  saving: boolean;
  /** 「保存为项目默认」进行中。 */
  savingProjectDefaults: boolean;
  /** 打开某模式的契约编辑（初值 = 已改过的用改过的，否则内置默认）。
   *  有未保存修改时先弹确认（ISSUE #3762），不直接切。 */
  selectMode: (mode: string) => void;
  setDraft: (draft: ModeContract) => void;
  setOutput: (output: ModeContract["output"]) => void;
  /** 生效注册表（成品配置 + 本机覆盖，逐模式合并）。 */
  stored: Array<ModeContract>;
  /** 切换某个口的「必备」状态。 */
  toggleRequired: (id: ModeContractInputId) => void;
};

export function useModeContractEditor(): ModeContractEditorController {
  const registry = useModeContracts();
  const [mode, setMode] = useState<string | null>(null);
  const [draft, setDraft] = useState<ModeContract | null>(null);
  const [saved, setSaved] = useState(false);
  const [savedKind, setSavedKind] = useState<"local" | "project" | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  /* 未保存就点切走的那一格（ISSUE #3762）：非 null = 确认弹窗开着。 */
  const [pendingMode, setPendingMode] = useState<string | null>(null);

  /* 草稿相对生效值有没有改动（ISSUE #3762）：左栏「未保存」标记与切换确认
   * 共用这一份判据。保存 / 还原默认之后草稿回到生效值，自动归为不脏。 */
  const dirty = useMemo(() => {
    if (!draft || !mode) {
      return false;
    }
    const effective = effectiveModeContract(mode, registry.contracts, registry.configured).contract;
    return JSON.stringify(draft) !== JSON.stringify(effective);
  }, [draft, mode, registry.contracts, registry.configured]);

  const doSelect = useCallback(
    (next: string) => {
      setMode(next);
      setDraft(effectiveModeContract(next, registry.contracts, registry.configured).contract);
      setSaved(false);
      setSavedKind(null);
      setSaveError(null);
    },
    [registry.configured, registry.contracts],
  );

  const selectMode = useCallback(
    (next: string) => {
      if (next === mode) {
        return;
      }
      /* 有未保存修改先问「要不要保存」（ISSUE #3762），不直接丢弃草稿。
         确认弹窗的三向出口（保存并切换 / 丢弃 / 留下）在下方 —— 它们要用到
         `save`，所以挂在保存定义之后。 */
      if (dirty) {
        setPendingMode(next);
        return;
      }
      doSelect(next);
    },
    [dirty, mode, doSelect],
  );

  const appendInput = useCallback((id: ModeContractInputId) => {
    setDraft((prev) =>
      prev && !prev.inputs.includes(id) ? { ...prev, inputs: [...prev.inputs, id] } : prev,
    );
    setSaved(false);
  }, []);

  const removeInput = useCallback((id: ModeContractInputId) => {
    setDraft((prev) => {
      if (!prev) {
        return prev;
      }
      /* 至少保留一个输入口（#3637）：服务端 `modeContractsInputSchema` 对
       * `inputs` 有 `min(1)`，空清单的保存必被打回；归一化侧也把空条目丢弃。
       * 界面若放行「删到空」，用户会进一个怎么都存不下来的死状态 —— 在源头
       * 拦住（视图同步禁用最后一口的移除按钮并给提示）。 */
      if (prev.inputs.length <= 1) {
        return prev;
      }
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
      prev ? { ...prev, inputs: moveContractInput(prev.inputs, id, delta) } : prev,
    );
    setSaved(false);
  }, []);

  /* 自定义口：id 由系统生成（把类型编进去，见 `nextCustomInputId`），作者只填
   *  名字 —— 名字单独存在 `customInputs` 里，落点/封装/适配器一律按 id 走。 */
  const addCustomInput = useCallback((label: string, kind: ModeContractCustomKind) => {
    const trimmed = label.trim();
    if (!trimmed) {
      return;
    }
    setDraft((prev) => {
      if (!prev) {
        return prev;
      }
      const id = nextCustomInputId(prev.inputs, kind);
      return {
        ...prev,
        inputs: [...prev.inputs, id],
        customInputs: [...(prev.customInputs ?? []), { id, label: trimmed, kind }],
      };
    });
    setSaved(false);
  }, []);

  const renameCustomInput = useCallback((id: ModeContractInputId, label: string) => {
    const trimmed = label.trim();
    if (!trimmed) {
      return;
    }
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
  }, []);

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
      if (!prev) {
        return prev;
      }
      /* 第一次改动就先把生效值固化下来（`required` 从 undefined 变实数组）——
       * 不固化的话每次读回落内置默认，「取消勾选提示词」这个操作会被默认值
       * 立刻复活，勾选框点不掉。 */
      const current = requiredInputsFor({
        inputs: prev.inputs,
        required: prev.required,
      });
      const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
      return {
        ...prev,
        required: prev.inputs.filter((x) => next.includes(x)),
      };
    });
  }, []);

  const setOutput = useCallback((output: ModeContract["output"]) => {
    setDraft((prev) => (prev ? { ...prev, output } : prev));
  }, []);

  /** 整份注册表 = 其余模式（生效值）+ 当前草稿。两种保存共用这一步：
   *  服务端都是「整份收下、各自归一」，这里不重复归一。
   *
   *  这里是**全量**（生效注册表覆盖到全部生成类模式），不是「用户改过的那几条」
   *  —— 「保存为项目默认」写的是完整基线，若这里只交「改过的几条」，文件里其余
   *  模式的内容会被抹掉（#3634 的现场：文件里只剩一项）。 */
  const mergedRegistry = useCallback((): Array<ModeContract> | null => {
    if (!draft) {
      return null;
    }
    const rest = registry.contracts.filter((c) => c.mode !== draft.mode);
    return [...rest, draft];
  }, [draft, registry.contracts]);

  const resetToDefault = useCallback(async () => {
    if (!mode) {
      return;
    }
    const effective = await registry.resetToDefault(mode);
    if (effective) {
      setDraft(effective);
    }
    setSaved(false);
    setSavedKind(null);
    setSaveError(null);
  }, [mode, registry]);

  const save = useCallback(async () => {
    const all = mergedRegistry();
    if (!all) {
      return;
    }
    /* 失败要有用户可见出口（#3637）：错误在这里接住、落到 `saveError`，
     * 视图据此给失败文案 —— 不再抛给无人接的 `void` promise。 */
    setSaveError(null);
    try {
      await registry.save(all);
      setSaved(true);
      setSavedKind("local");
    } catch (error) {
      setSaveError(errorMessage(error, "保存失败，请稍后重试"));
    }
  }, [mergedRegistry, registry]);

  const saveAsProjectDefault = useCallback(async (): Promise<string | null> => {
    const all = mergedRegistry();
    if (!all) {
      return null;
    }
    setSaveError(null);
    try {
      const file = await registry.saveAsProjectDefaults(all);
      setSaved(true);
      setSavedKind("project");
      return file;
    } catch (error) {
      setSaveError(errorMessage(error, "写入项目默认失败，请稍后重试"));
      return null;
    }
  }, [mergedRegistry, registry]);

  /** 确认弹窗的「保存并切换」：先落盘再切（落的是当前草稿）。 */
  const confirmSwitch = useCallback(async () => {
    if (pendingMode === null) {
      return;
    }
    await save();
    doSelect(pendingMode);
    setPendingMode(null);
  }, [pendingMode, save, doSelect]);

  /** 确认弹窗的「不保存，直接切换」：草稿就地丢弃。 */
  const discardSwitch = useCallback(() => {
    if (pendingMode === null) {
      return;
    }
    doSelect(pendingMode);
    setPendingMode(null);
  }, [pendingMode, doSelect]);

  /** 确认弹窗的「留在此模式」：什么都不改。 */
  const cancelSwitch = useCallback(() => {
    setPendingMode(null);
  }, []);

  return {
    mode,
    draft,
    configured: registry.configured,
    stored: registry.contracts,
    resetting: registry.resetting,
    saving: registry.saving,
    savingProjectDefaults: registry.savingProjectDefaults,
    projectDefaultEditable: registry.projectDefaultEditable,
    isRequired,
    toggleRequired,
    hasAnyRequired: effectiveRequired.length > 0,
    selectMode,
    setDraft: (next: ModeContract) => {
      setDraft(next);
      setSaved(false);
      setSavedKind(null);
      setSaveError(null);
    },
    appendInput,
    removeInput,
    resetToDefault,
    moveInput,
    addCustomInput,
    renameCustomInput,
    nextReferenceImageId: draft ? nextReferenceImageId(draft.inputs) : null,
    setOutput,
    save,
    saveAsProjectDefault,
    saveError,
    saved,
    savedKind,
    dirty,
    pendingMode,
    confirmSwitch,
    discardSwitch,
    cancelSwitch,
  };
}
