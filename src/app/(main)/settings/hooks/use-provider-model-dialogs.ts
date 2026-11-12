"use client";

/**
 * 设置页「远程模型」的弹窗交互层（规范 17 §17.2 第②层，#3501）。
 *
 * 只管**弹窗草稿与提交**：供应商 / 模型的读写、探测在 `use-settings-providers`，
 * 字段规则在 `~/lib/llm/provider-form`（纯函数）。视图拿到的是一组受控值 + 动作，
 * 不自己拼请求、也不自己判字段。
 */

import { useCallback, useState } from "react";

import {
  applySmartDefaults,
  emptyModelForm,
  emptyProviderForm,
  modelFormFromView,
  modelSaveDraft,
  providerSaveDraft,
  validateModelForm,
  validateProviderForm,
  type ModelFormErrors,
  type ModelFormValues,
  type ProviderFormErrors,
  type ProviderFormValues,
} from "~/lib/llm/provider-form";
import { isLlmApiFormat } from "~/lib/llm/provider-types";
import type { ModelOutputType } from "~/lib/llm/provider-types";

import type { ProviderModelView, SettingsProviders } from "./use-settings-providers";

/** 「新建供应商」弹窗（编辑既有供应商走详情页的内联表单，不另开弹窗）。 */
export type ProviderDialog = { mode: "add" } | null;

export type ModelDialog =
  | { mode: "add"; providerId: string }
  | { mode: "edit"; model: ProviderModelView }
  | null;

export type ProviderModelDialogs = {
  closeModelDialog: () => void;
  closeProviderDialog: () => void;
  modelDialog: ModelDialog;
  /** 弹窗内提交失败的横幅文案（字段错误不在这里）。 */
  modelError: string | null;
  modelErrors: ModelFormErrors;
  modelForm: ModelFormValues;
  openAddModel: (providerId: string) => void;
  openAddProvider: () => void;
  openEditModel: (model: ProviderModelView) => void;
  patchModelForm: (patch: Partial<ModelFormValues>) => void;
  providerDialog: ProviderDialog;
  providerError: string | null;
  providerErrors: ProviderFormErrors;
  providerForm: ProviderFormValues;
  /** 弹窗内「测试连接」（可带尚未保存的 Base URL / 密钥）。 */
  providerTesting: boolean;
  providerTestMsg: { kind: "ok" | "err"; text: string } | null;
  /** 「重置」：编辑态回到库里那份，新增态回到空白 + 智能默认。 */
  resetModelForm: () => void;
  setProviderForm: React.Dispatch<React.SetStateAction<ProviderFormValues>>;
  submitModel: () => Promise<void>;
  submitProvider: () => Promise<void>;
  testProviderDraft: () => Promise<void>;
  toggleCapability: (capability: ModelFormValues["capabilities"][number]) => void;
  toggleInputType: (type: ModelFormValues["inputTypes"][number]) => void;
  toggleOutputType: (type: ModelOutputType) => void;
};

export function useProviderModelDialogs(p: SettingsProviders): ProviderModelDialogs {
  const [providerDialog, setProviderDialog] = useState<ProviderDialog>(null);
  const [providerForm, setProviderForm] = useState<ProviderFormValues>(emptyProviderForm);
  const [providerErrors, setProviderErrors] = useState<ProviderFormErrors>({});
  const [providerError, setProviderError] = useState<string | null>(null);
  const [providerTesting, setProviderTesting] = useState(false);
  const [providerTestMsg, setProviderTestMsg] = useState<{
    kind: "ok" | "err";
    text: string;
  } | null>(null);

  const [modelDialog, setModelDialog] = useState<ModelDialog>(null);
  const [modelForm, setModelFormState] = useState<ModelFormValues>(emptyModelForm);
  const [modelErrors, setModelErrors] = useState<ModelFormErrors>({});
  const [modelError, setModelError] = useState<string | null>(null);

  /* ── 供应商弹窗 ─────────────────────────────────────────────── */

  function openAddProvider() {
    setProviderDialog({ mode: "add" });
    setProviderForm(emptyProviderForm());
    setProviderErrors({});
    setProviderError(null);
    setProviderTestMsg(null);
  }

  function closeProviderDialog() {
    setProviderDialog(null);
  }

  async function testProviderDraft() {
    setProviderTesting(true);
    setProviderTestMsg(null);
    try {
      const typedKey = providerForm.apiKey.trim();
      const out = await p.probe({
        baseUrl: providerForm.baseUrl.trim() || undefined,
        apiKey: typedKey === "" ? undefined : typedKey,
      });
      setProviderTestMsg({ kind: out.ok ? "ok" : "err", text: out.detail });
    } finally {
      setProviderTesting(false);
    }
  }

  async function submitProvider() {
    setProviderError(null);
    const errors = validateProviderForm(providerForm);
    if (Object.keys(errors).length > 0) {
      setProviderErrors(errors);
      return;
    }
    setProviderErrors({});
    const result = await p.saveProvider(providerSaveDraft(providerForm));
    if (!result.ok) {
      setProviderError(result.error ?? "保存失败");
      return;
    }
    setProviderDialog(null);
  }

  /* ── 模型弹窗 ───────────────────────────────────────────────── */

  function openAddModel(providerId: string) {
    setModelDialog({ mode: "add", providerId });
    /* 新模型的格式默认继承所属供应商那一格（历史行的默认值）：用户加第二条
     * 同协议的模型时不必每次重选，不同协议再改。 */
    const provider = p.providers.find((candidate) => candidate.id === providerId);
    setModelFormState(
      emptyModelForm(
        "chat",
        isLlmApiFormat(provider?.apiFormat) ? provider.apiFormat : "chat-completions",
      ),
    );
    setModelErrors({});
    setModelError(null);
  }

  function openEditModel(model: ProviderModelView) {
    setModelDialog({ mode: "edit", model });
    setModelFormState(modelFormFromView(model));
    setModelErrors({});
    setModelError(null);
  }

  function closeModelDialog() {
    setModelDialog(null);
  }

  /** 表单更新：智能配置打开时，模型 id 变化 / 刚打开开关 → 按名推断预填。 */
  const setModelForm = useCallback(
    (next: ModelFormValues | ((prev: ModelFormValues) => ModelFormValues)) => {
      setModelFormState((prev) => {
        const draft = typeof next === "function" ? next(prev) : next;
        const smartJustOpened = draft.smartConfig && !prev.smartConfig;
        return smartJustOpened || (draft.smartConfig && draft.name !== prev.name)
          ? applySmartDefaults(draft)
          : draft;
      });
    },
    [],
  );

  function patchModelForm(patch: Partial<ModelFormValues>) {
    setModelForm((prev) => ({ ...prev, ...patch }));
  }

  function toggleInputType(type: ModelFormValues["inputTypes"][number]) {
    setModelForm((prev) => ({
      ...prev,
      inputTypes: prev.inputTypes.includes(type)
        ? prev.inputTypes.filter((t) => t !== type)
        : [...prev.inputTypes, type],
    }));
  }

  function toggleOutputType(type: ModelOutputType) {
    setModelForm((prev) => ({
      ...prev,
      outputTypes: prev.outputTypes.includes(type)
        ? prev.outputTypes.filter((t) => t !== type)
        : [...prev.outputTypes, type],
    }));
  }

  function toggleCapability(capability: ModelFormValues["capabilities"][number]) {
    setModelForm((prev) => ({
      ...prev,
      capabilities: prev.capabilities.includes(capability)
        ? prev.capabilities.filter((c) => c !== capability)
        : [...prev.capabilities, capability],
    }));
  }

  function resetModelForm() {
    if (modelDialog?.mode === "edit") {
      setModelFormState(modelFormFromView(modelDialog.model));
    } else {
      const provider =
        modelDialog === null ? undefined : p.providers.find((c) => c.id === modelDialog.providerId);
      setModelFormState(
        emptyModelForm(
          "chat",
          isLlmApiFormat(provider?.apiFormat) ? provider.apiFormat : "chat-completions",
        ),
      );
    }
    setModelErrors({});
    setModelError(null);
  }

  async function submitModel() {
    if (modelDialog === null) {
      return;
    }
    setModelError(null);
    const errors = validateModelForm(modelForm);
    if (Object.keys(errors).length > 0) {
      setModelErrors(errors);
      return;
    }
    setModelErrors({});
    const providerId =
      modelDialog.mode === "edit" ? (modelDialog.model.providerId ?? "") : modelDialog.providerId;
    if (providerId === "") {
      setModelError("该模型没有所属供应商，请先把它归入一个供应商");
      return;
    }
    const result = await p.saveModel(
      modelSaveDraft(modelForm, {
        providerId,
        ...(modelDialog.mode === "edit"
          ? { id: modelDialog.model.id, existingBaseUrl: modelDialog.model.baseUrl }
          : {}),
      }),
    );
    if (!result.ok) {
      setModelError(result.error ?? "保存失败");
      return;
    }
    setModelDialog(null);
  }

  return {
    providerDialog,
    openAddProvider,
    closeProviderDialog,
    providerForm,
    setProviderForm,
    providerErrors,
    providerError,
    submitProvider,
    providerTesting,
    providerTestMsg,
    testProviderDraft,
    modelDialog,
    openAddModel,
    openEditModel,
    closeModelDialog,
    modelForm,
    patchModelForm,
    modelErrors,
    modelError,
    submitModel,
    resetModelForm,
    toggleInputType,
    toggleOutputType,
    toggleCapability,
  };
}
