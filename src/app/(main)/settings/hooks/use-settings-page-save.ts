"use client";

/**
 * 设置页「保存」分区 sub-hook（`use-settings-page` 的拆分件）：LLM 配置与偏好落库，并在同一次保存里
 * 连带重取安装形态与六个存储目录 —— 两者都是刚保存的 `comfyuiPath` 的函数，不重取会留着改路径前的旧结论。
 * 对外形状（`persistLlmDraft` / `saveLlm` / `savePrefs`）原样透出不变。
 */
import { useCallback } from "react";

import { runAsyncAction } from "~/lib/async-action";
import type { RemoteModelEntry } from "~/lib/llm/types";
import type { RouterInputs } from "~/trpc/react";
import type { LlmConfig, Settings } from "./use-settings-page-types";

/** tRPC 实例只用到「refetch / mutateAsync」这两个面，用窄接口注入；入参类型取自
 *  router 本身（`RouterInputs`），server 端改了 schema 这里会跟着红，而不是
 *  在 sub-hook 里抄一份会漂的字段表。 */
type QueryLike = {
  refetch: () => Promise<unknown>;
};
type MutationLike<TInput> = {
  mutateAsync: (input: TInput) => Promise<unknown>;
};

type LlmCfgInput = RouterInputs["llm"]["configSave"];
type SettingsInput = RouterInputs["setting"]["save"];

export function useSettingsSave(input: {
  /** 「留空不改」语义的 apiKey 输入框值（保存成功后清空）。 */
  llmApiKey: string;
  llmDraft: LlmConfig | null;
  llmQ: QueryLike;
  /** 装安装形态（依赖 comfyuiPath），偏好保存后必须重判一次。 */
  refetchComfyInstance: () => Promise<void>;
  /** 装桌面实例的六个存储目录（与形态同源，同一时机重取）。 */
  refetchComfyStorage: () => Promise<void>;
  saveLlmCfgM: MutationLike<LlmCfgInput>;
  saveSettingM: MutationLike<SettingsInput>;
  setLlmApiKey: (value: string) => void;
  setSaving: (value: boolean) => void;
  settingsDraft: Settings | null;
  settingsQ: QueryLike;
  showFlash: (kind: "ok" | "err", text: string) => void;
}) {
  const {
    settingsDraft,
    llmDraft,
    llmApiKey,
    setSaving,
    setLlmApiKey,
    showFlash,
    saveSettingM,
    settingsQ,
    saveLlmCfgM,
    llmQ,
    refetchComfyInstance,
    refetchComfyStorage,
  } = input;

  /** 把给定草稿落库。远程模型的添加 / 编辑 / 移除即时保存也走这里；
   *  apiKey 是「留空不改」语义：llmApiKey 为空就不传。 */
  const persistLlmDraft = useCallback(
    async (draft: LlmConfig): Promise<{ error?: string; ok: boolean }> => {
      setSaving(true);
      /* 这一处**同时**要「反馈通道」与「返回值给调用方继续用」：
       * 出口的返回值正是为此给的（收口前这里是 `catch` 里再拼一次
       * `errorMessage` 并return 一个 `{ok,error}`）。 */
      try {
        const result = await runAsyncAction(
          async () => {
            // option C：把「本地候选(字符串) + 远端独立模型(对象)」合并成一整份清单
            // 发给 configSave，由服务端按「字符串 vs 对象」各自写回 llmConfig / remoteModel 表。
            const payloadExtra: Array<string | RemoteModelEntry> = [
              ...draft.localCandidates,
              ...draft.extraModels,
            ];
            await saveLlmCfgM.mutateAsync({
              provider: draft.provider,
              apiKey: llmApiKey || undefined,
              baseUrl: draft.baseUrl,
              model: draft.model,
              extraModels: payloadExtra,
              temperature: draft.temperature,
              temperatureByTask: draft.temperatureByTask,
              maxTokens: draft.maxTokens,
            });
            if (llmApiKey) {
              setLlmApiKey("");
            }
            await llmQ.refetch();
          },
          {
            report: showFlash,
            failureText: "保存失败",
            successText: "LLM 配置已保存",
          },
        );
        /* SAFETY: 类型断言已复核 */
        return result.ok
          ? { ok: true as const }
          : {
              /* SAFETY: 类型断言已复核 */
              ok: false as const,
              error: result.detail,
            };
      } finally {
        setSaving(false);
      }
    },
    [llmApiKey, saveLlmCfgM, llmQ, setLlmApiKey, setSaving, showFlash],
  );

  const saveLlm = useCallback(async () => {
    if (!llmDraft) {
      return;
    }
    await persistLlmDraft(llmDraft);
  }, [llmDraft, persistLlmDraft]);

  const savePrefs = useCallback(async () => {
    if (!settingsDraft) {
      return;
    }
    setSaving(true);
    try {
      await runAsyncAction(
        async () => {
          await saveSettingM.mutateAsync(settingsDraft);
          await settingsQ.refetch();
          // 形态是「配置路径的目录形态」的函数：路径可能刚被改过，立即重判定一次
          // （不必等 5s 轮询，也不该再走一次秒级运行态探测）。
          await refetchComfyInstance();
          // 存储目录与形态同源（同一份 comfyuiPath + yaml），同一时机一起重取。
          await refetchComfyStorage();
        },
        {
          report: showFlash,
          failureText: "保存失败",
          successText: "偏好已保存",
        },
      );
    } finally {
      setSaving(false);
    }
  }, [
    settingsDraft,
    saveSettingM,
    settingsQ,
    refetchComfyInstance,
    refetchComfyStorage,
    setSaving,
    showFlash,
  ]);

  return { persistLlmDraft, saveLlm, savePrefs };
}
