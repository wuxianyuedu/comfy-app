"use client";
import { Icon } from "@/components/ui/icon";

import {
  API_CHANNEL_KIND_META,
  API_CHANNEL_KINDS,
  API_CHANNEL_MSG_STYLE,
} from "./api-channel-settings-config";
import { useApiChannelSettings } from "./hooks/use-api-channel-settings";
import type { ApiChannelsView } from "~/lib/workshop/api-channel-shared";

interface Props {
  initial: ApiChannelsView | null;
  onClose: () => void;
  /** Receives the refreshed masked view after a successful save. */
  onSaved: (channels: ApiChannelsView) => void;
}

/**
 * 工坊 API 直连通道设置（生图 / 视频）——纯展示层（规范 17 §17.2 第③层）。
 * 状态与保存流程在 hooks/use-api-channel-settings.ts，网络请求在
 * lib/workshop/api-channel-client.ts，本文件只渲染 + 上抛事件。
 *
 * 与 LLM 设置弹层同款交互模型：baseUrl/apiKey 存服务端，浏览器只见脱敏视图。
 */
export function ApiChannelSettings({ initial, onClose, onSaved }: Props) {
  const controller = useApiChannelSettings({ initial, onSaved });
  const { tab, draft, apiKeyDraft, meta } = controller;
  const current = draft[tab];

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="border-border bg-surface w-full max-w-md rounded-2xl border p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="u-title">API 直连通道设置</h3>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-ink" aria-label="关闭">
            ✕
          </button>
        </div>

        <div className="mb-3 grid grid-cols-2 gap-2">
          {API_CHANNEL_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => controller.setTab(kind)}
              className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                tab === kind
                  ? "border-primary bg-primary-soft text-primary"
                  : "border-border text-muted-foreground hover:bg-subtle"
              }`}
            >
              <ChannelTabLabel
                title={API_CHANNEL_KIND_META[kind].title}
                configured={initial?.[kind].configured ?? false}
              />
            </button>
          ))}
        </div>

        <div className="space-y-3">
          <Field
            label="Base URL"
            value={current.baseUrl ?? ""}
            onChange={(v) => controller.patchChannel(tab, { baseUrl: v })}
            placeholder="https://api.openai.com/v1"
          />
          <Field
            label="请求路径"
            value={current.path ?? ""}
            onChange={(v) => controller.patchChannel(tab, { path: v })}
            placeholder={meta.pathPlaceholder}
          />
          <Field
            label="模型名（可选）"
            value={current.model ?? ""}
            onChange={(v) => controller.patchChannel(tab, { model: v })}
            placeholder={meta.modelPlaceholder}
          />
          <Field
            label={`API Key${initial?.[tab].hasApiKey ? "（已保存，留空则不修改）" : ""}`}
            value={apiKeyDraft[tab]}
            onChange={(v) => controller.patchApiKey(tab, v)}
            placeholder="sk-..."
            password
          />
        </div>

        <p className="text-muted-foreground mt-3 text-[11px] leading-relaxed">{meta.hint}</p>
        {controller.msg && (
          <p
            className={`mt-3 rounded-lg px-3 py-2 text-xs ${API_CHANNEL_MSG_STYLE[controller.msg.kind]}`}
          >
            {controller.msg.text}
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="text-ink rounded-lg bg-(--color-subtle) px-4 py-2 text-sm hover:bg-(--color-surface-2)"
          >
            关闭
          </button>
          <button
            type="button"
            onClick={() => void controller.save()}
            disabled={controller.saving}
            className="bg-primary rounded-lg px-4 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-40"
          >
            {controller.saving ? "保存中…" : "保存"}
          </button>
        </div>

        <p className="text-muted-foreground mt-3 flex items-center gap-1 text-[11px]">
          <Icon name="info" size={12} />
          API Key 仅存储于服务端（data/workshop-api-settings.json），不会下发到浏览器。
        </p>
      </div>
    </div>
  );
}

/** 页签文案：已配置的通道追加「· 已配置」，未配置追加「· 未配置」。 */
function ChannelTabLabel({ title, configured }: { title: string; configured: boolean }) {
  return (
    <>
      {title}
      {configured ? " · 已配置" : " · 未配置"}
    </>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  password,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  password?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-muted-foreground mb-1 block text-xs">{label}</span>
      <input
        type={password ? "password" : "text"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="border-border bg-bg text-ink focus:border-primary w-full rounded-lg border px-3 py-2 text-sm outline-none"
      />
    </label>
  );
}
