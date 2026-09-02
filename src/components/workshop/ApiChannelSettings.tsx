"use client";
import React from "react";
import { Icon } from "@/components/ui/icon";
import type { ApiChannelKind, ApiChannelsView, ApiChannelSaveInput } from "@/lib/workshop/api-channel-shared";

/** catch 抛出值（unknown）→ 消息提取：带 string message 的对象取 message，其余回退。 */
function errorMessage(e: unknown, fallback: string): string {
  if (typeof e === "object" && e !== null && "message" in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return fallback;
}

interface Props {
  initial: ApiChannelsView | null;
  onClose: () => void;
  /** Receives the refreshed masked view after a successful save. */
  onSaved: (channels: ApiChannelsView) => void;
}

const KIND_META: Record<ApiChannelKind, { title: string; hint: string }> = {
  image: {
    title: "生图 API",
    hint: "OpenAI 兼容 images 接口（POST {baseUrl}{path}），如 https://api.openai.com/v1 + /images/generations。",
  },
  video: {
    title: "视频 API",
    hint: "视频生成端点：支持同步返回视频 URL，或提交后返回任务 ID（系统自动按 GET {baseUrl}/{taskId} 轮询）。",
  },
};

/**
 * Configure the workshop's API 直连 channels (image / video). Same interaction
 * model as the LLM settings modal: baseUrl/apiKey stored server-side, browser
 * only ever sees a masked view.
 */
export function ApiChannelSettings({ initial, onClose, onSaved }: Props) {
  const [tab, setTab] = React.useState<ApiChannelKind>("image");
  const [draft, setDraft] = React.useState<Record<ApiChannelKind, ApiChannelSaveInput>>({
    image: {
      baseUrl: initial?.image.baseUrl ?? "",
      path: initial?.image.path ?? "/images/generations",
      model: initial?.image.model ?? "",
    },
    video: {
      baseUrl: initial?.video.baseUrl ?? "",
      path: initial?.video.path ?? "/videos/generations",
      model: initial?.video.model ?? "",
    },
  });
  const [apiKeyDraft, setApiKeyDraft] = React.useState({ image: "", video: "" });
  const [saving, setSaving] = React.useState(false);
  const [msg, setMsg] = React.useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const current = draft[tab];
  const currentKey = apiKeyDraft[tab];
  const meta = KIND_META[tab];

  function updateTab(kind: ApiChannelKind, patch: Partial<ApiChannelSaveInput>) {
    setDraft((prev) => ({ ...prev, [kind]: { ...prev[kind], ...patch } }));
  }

  async function handleSave() {
    setSaving(true);
    setMsg(null);
    try {
      const payload: { image?: ApiChannelSaveInput; video?: ApiChannelSaveInput } = {};
      const imgKey = apiKeyDraft.image.trim();
      const vidKey = apiKeyDraft.video.trim();
      payload.image = { ...draft.image, ...(imgKey ? { apiKey: imgKey } : {}) };
      payload.video = { ...draft.video, ...(vidKey ? { apiKey: vidKey } : {}) };
      const res = await fetch("/api/workshop-api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data: unknown = await res.json();
      if (!res.ok) {
        const errMsg =
          typeof data === "object" && data !== null && "error" in data
            ? String((data).error)
            : "保存失败";
        throw new Error(errMsg);
      }
      const channels = (data as { channels?: ApiChannelsView }).channels;
      if (channels) {
        onSaved(channels);
        setMsg({ kind: "ok", text: "已保存。API 通道已可用。" });
      }
    } catch (e: unknown) {
      setMsg({ kind: "err", text: errorMessage(e, "保存失败") });
    } finally {
      setSaving(false);
    }
  }

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
          {(Object.keys(KIND_META) as ApiChannelKind[]).map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => setTab(kind)}
              className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                tab === kind
                  ? "border-primary bg-primary-soft text-primary"
                  : "border-border text-muted-foreground hover:bg-subtle"
              }`}
            >
              {KIND_META[kind].title}
              {initial?.[kind].configured ? " · 已配置" : " · 未配置"}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          <Field
            label="Base URL"
            value={current.baseUrl ?? ""}
            onChange={(v) => updateTab(tab, { baseUrl: v })}
            placeholder="https://api.openai.com/v1"
          />
          <Field
            label="请求路径"
            value={current.path ?? ""}
            onChange={(v) => updateTab(tab, { path: v })}
            placeholder={tab === "image" ? "/images/generations" : "/videos/generations"}
          />
          <Field
            label="模型名（可选）"
            value={current.model ?? ""}
            onChange={(v) => updateTab(tab, { model: v })}
            placeholder="gpt-image-1 / Provider 模型 ID"
          />
          <Field
            label={`API Key${initial?.[tab].hasApiKey ? "（已保存，留空则不修改）" : ""}`}
            value={currentKey}
            onChange={(v) => setApiKeyDraft((prev) => ({ ...prev, [tab]: v }))}
            placeholder="sk-..."
            password
          />
        </div>

        <p className="text-muted-foreground mt-3 text-[11px] leading-relaxed">{meta.hint}</p>
        {msg && (
          <p
            className={`mt-3 rounded-lg px-3 py-2 text-xs ${
              msg.kind === "ok" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
            }`}
          >
            {msg.text}
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="text-ink rounded-lg bg-white/4 px-4 py-2 text-sm hover:bg-white/8"
          >
            关闭
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="bg-primary rounded-lg px-4 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-40"
          >
            {saving ? "保存中…" : "保存"}
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
