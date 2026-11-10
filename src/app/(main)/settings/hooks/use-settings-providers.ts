"use client";

/**
 * 设置页「远程模型」的供应商 / 模型数据层（规范 17 §17.2 第②层，#3501）。
 *
 * 供应商与模型**独立于 llmConfig 草稿**：它们各自落 `llmProvider` / `remoteModel`
 * 两张表，读写的唯一出口是 `llm.providersGet` 一族 procedure。每次写操作都回
 * 「供应商 + 模型全量视图」，所以前端不做乐观拼接 —— 状态只有服务端那一份，
 * 少一个「本地列表与服务端不一致」的中间态。
 *
 * 这一层不持弹窗草稿（那是 `use-provider-model-dialogs`），也不碰视图。
 */

import { useCallback, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";

import { errorMessage } from "~/lib/error-message";
import { probeRemoteApi, type RemoteProbeInput, type RemoteProbeResult } from "~/lib/llm/browser";
import { useBusyAction } from "~/components/ui/use-busy-action";
import { useTRPC, type RouterInputs, type RouterOutputs } from "~/trpc/react";

/** 一条供应商（服务端下发的视图：密钥只报「有没有配」）。 */
export type ProviderView = RouterOutputs["llm"]["providersGet"]["providers"][number];
/** 一条供应商下的模型（同上）。 */
export type ProviderModelView = RouterOutputs["llm"]["providersGet"]["models"][number];

export type ProviderSaveInput = RouterInputs["llm"]["providerSave"];
export type ModelSaveInput = RouterInputs["llm"]["modelSave"];

/** 写操作结果：弹窗据此决定「关掉」还是「留在原地报错」。 */
export type ProviderActionResult = { error?: string; ok: boolean };

export type SettingsProviders = {
  /** 一次写操作进行中（按钮禁用 / 文案）。 */
  busy: boolean;
  deleteModel: (id: string) => Promise<ProviderActionResult>;
  deleteProvider: (id: string) => Promise<ProviderActionResult>;
  /** 读供应商清单失败的可读原因（空 = 没失败）。 */
  errorText: string | null;
  loading: boolean;
  /** 全部模型（按供应商分组由视图自己筛）。 */
  models: Array<ProviderModelView>;
  /** 连通性探测：给 `providerId` 时服务端代查已保存的 Base URL / 格式 / 密钥。 */
  probe: (input: RemoteProbeInput) => Promise<RemoteProbeResult>;
  providers: Array<ProviderView>;
  /** 重新读取清单（写操作后由本 hook 自动调用，视图一般不用手调）。 */
  refetch: () => void;
  saveModel: (input: ModelSaveInput) => Promise<ProviderActionResult>;
  saveProvider: (input: ProviderSaveInput) => Promise<ProviderActionResult>;
  /** 当前选中的供应商；清单为空时为 null。 */
  selected: ProviderView | null;
  /** 切换左侧选中的供应商。 */
  selectProvider: (id: string) => void;
  toggleModel: (id: string, enabled: boolean) => Promise<ProviderActionResult>;
};

export function useSettingsProviders(): SettingsProviders {
  const trpc = useTRPC();
  const query = useQuery(trpc.llm.providersGet.queryOptions());
  const saveProviderM = useMutation(trpc.llm.providerSave.mutationOptions());
  const deleteProviderM = useMutation(trpc.llm.providerDelete.mutationOptions());
  const saveModelM = useMutation(trpc.llm.modelSave.mutationOptions());
  const deleteModelM = useMutation(trpc.llm.modelDelete.mutationOptions());
  const toggleModelM = useMutation(trpc.llm.modelToggle.mutationOptions());
  const busy = useBusyAction();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const providers = query.data?.providers ?? [];
  const models = query.data?.models ?? [];
  /* 选中的供应商**在渲染期派生**而不是用 effect 同步：清单刷新后原选中项被删，
   * 这里自然回落到第一个；不写 effect 就不会闪一帧「空详情」。 */
  const selected = providers.find((p) => p.id === selectedId) ?? providers[0] ?? null;

  const refetch = query.refetch;

  /** 写操作统一出口：失败 → 可读文案（弹窗留在原地），成功 → 重取全量视图。 */
  const runAction = useCallback(
    async (action: () => Promise<unknown>): Promise<ProviderActionResult> => {
      busy.set(true);
      try {
        await action();
        await refetch();
        return { ok: true };
      } catch (error) {
        return { ok: false, error: errorMessage(error, "操作失败") };
      } finally {
        busy.set(false);
      }
    },
    [busy, refetch],
  );

  const saveProvider = useCallback(
    (input: ProviderSaveInput) => runAction(() => saveProviderM.mutateAsync(input)),
    [runAction, saveProviderM],
  );

  const deleteProvider = useCallback(
    (id: string) => runAction(() => deleteProviderM.mutateAsync({ id })),
    [deleteProviderM, runAction],
  );

  const saveModel = useCallback(
    (input: ModelSaveInput) => runAction(() => saveModelM.mutateAsync(input)),
    [runAction, saveModelM],
  );

  const deleteModel = useCallback(
    (id: string) => runAction(() => deleteModelM.mutateAsync({ id })),
    [deleteModelM, runAction],
  );

  const toggleModel = useCallback(
    (id: string, enabled: boolean) => runAction(() => toggleModelM.mutateAsync({ id, enabled })),
    [runAction, toggleModelM],
  );

  const selectProvider = useCallback((id: string) => {
    setSelectedId(id);
  }, []);

  return {
    busy: busy.busy,
    deleteModel,
    deleteProvider,
    errorText: query.isError ? errorMessage(query.error, "读取供应商失败") : null,
    loading: query.isPending,
    models,
    probe: probeRemoteApi,
    providers,
    refetch: () => {
      void refetch();
    },
    saveModel,
    saveProvider,
    selected,
    selectProvider,
    toggleModel,
  };
}
