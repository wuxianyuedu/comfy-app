"use client";

// ── API 直连通道设置弹层：逻辑层（规范 17 §17.2 第②层）────────────────────
// 承载页签、草稿、保存流程与结果提示；视图 ApiChannelSettings 只消费本 hook 返回的
// controller。保存请求经 lib/workshop/api-channel-client.ts，视图内不再出现 fetch。

import { useCallback, useState } from "react";

import { saveApiChannels } from "~/lib/workshop/api-channel-client";
import {
  type ApiChannelKind,
  type ApiChannelsView,
  type ApiChannelSaveInput,
} from "~/lib/workshop/api-channel-shared";

import {
  API_CHANNEL_DEFAULT_PATH,
  API_CHANNEL_KIND_META,
  API_CHANNEL_SAVE_FAIL,
  API_CHANNEL_SAVE_OK,
} from "../api-channel-settings-config";

export interface ApiChannelSettingsController {
  /** 当前选中的页签。 */
  tab: ApiChannelKind;
  setTab: (kind: ApiChannelKind) => void;
  /** 两个通道的编辑草稿，key 即通道类型。 */
  draft: Record<ApiChannelKind, ApiChannelSaveInput>;
  /** 单个通道的 apiKey 草稿：留空表示不修改服务端已存的值。 */
  apiKeyDraft: Record<ApiChannelKind, string>;
  patchChannel: (kind: ApiChannelKind, patch: Partial<ApiChannelSaveInput>) => void;
  patchApiKey: (kind: ApiChannelKind, value: string) => void;
  /** 当前页签的展示元数据（标题/说明/placeholder）。 */
  meta: (typeof API_CHANNEL_KIND_META)[ApiChannelKind];
  /** 保存中——按钮禁用态。 */
  saving: boolean;
  /** 结果提示：null 表示无提示。 */
  msg: { kind: "ok" | "err"; text: string } | null;
  /** 保存成功后的新脱敏视图（供父组件刷新状态），未保存过则为 null。 */
  saved: ApiChannelsView | null;
  save: () => Promise<void>;
}

export interface UseApiChannelSettingsOptions {
  /** 服务端下发的脱敏视图；为 null 时各字段按默认值起步。 */
  initial: ApiChannelsView | null;
  /** 保存成功后回调，把新的脱敏视图交给父组件。 */
  onSaved?: (channels: ApiChannelsView) => void;
}

function initialDraft(
  initial: ApiChannelsView | null,
): Record<ApiChannelKind, ApiChannelSaveInput> {
  return {
    image: {
      baseUrl: initial?.image.baseUrl ?? "",
      path: initial?.image.path ?? API_CHANNEL_DEFAULT_PATH.image,
      model: initial?.image.model ?? "",
    },
    video: {
      baseUrl: initial?.video.baseUrl ?? "",
      path: initial?.video.path ?? API_CHANNEL_DEFAULT_PATH.video,
      model: initial?.video.model ?? "",
    },
  };
}

export function useApiChannelSettings({
  initial,
  onSaved,
}: UseApiChannelSettingsOptions): ApiChannelSettingsController {
  const [tab, setTab] = useState<ApiChannelKind>("image");
  const [draft, setDraft] = useState<Record<ApiChannelKind, ApiChannelSaveInput>>(() =>
    initialDraft(initial),
  );
  const [apiKeyDraft, setApiKeyDraft] = useState<Record<ApiChannelKind, string>>({
    image: "",
    video: "",
  });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [saved, setSaved] = useState<ApiChannelsView | null>(null);

  const patchChannel = useCallback(
    (kind: ApiChannelKind, patch: Partial<ApiChannelSaveInput>) => {
      setDraft((prev) => ({ ...prev, [kind]: { ...prev[kind], ...patch } }));
    },
    [],
  );

  const patchApiKey = useCallback((kind: ApiChannelKind, value: string) => {
    setApiKeyDraft((prev) => ({ ...prev, [kind]: value }));
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    setMsg(null);
    try {
      // apiKey 留空 = 不修改服务端已存的值，故只在非空时并入 payload。
      const imageKey = apiKeyDraft.image.trim();
      const videoKey = apiKeyDraft.video.trim();
      const channels = await saveApiChannels({
        image: { ...draft.image, ...(imageKey ? { apiKey: imageKey } : {}) },
        video: { ...draft.video, ...(videoKey ? { apiKey: videoKey } : {}) },
      });
      setSaved(channels);
      onSaved?.(channels);
      setMsg({ kind: "ok", text: API_CHANNEL_SAVE_OK });
    } catch (e: unknown) {
      setMsg({
        kind: "err",
        text: e instanceof Error ? e.message : API_CHANNEL_SAVE_FAIL,
      });
    } finally {
      setSaving(false);
    }
  }, [apiKeyDraft, draft, onSaved]);

  return {
    tab,
    setTab,
    draft,
    apiKeyDraft,
    patchChannel,
    patchApiKey,
    meta: API_CHANNEL_KIND_META[tab],
    saving,
    msg,
    saved,
    save,
  };
}
