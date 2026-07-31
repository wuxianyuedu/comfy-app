"use client";

import React from "react";
import { completeChat } from "@/lib/llm/browser";
import type { LLMConfigView, LLMProviderType } from "@/lib/llm/types";

interface LLMContextValue {
  config: LLMConfigView | null;
  loading: boolean;
  settingsOpen: boolean;
  openSettings: () => void;
  closeSettings: () => void;
  refresh: () => void;
}

const LLMContext = React.createContext<LLMContextValue | null>(null);

export function useLLM(): LLMContextValue {
  const ctx = React.useContext(LLMContext);
  if (!ctx) throw new Error("useLLM 必须在 <LLMProvider> 内使用");
  return ctx;
}

export function LLMProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = React.useState<LLMConfigView | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [settingsOpen, setSettingsOpen] = React.useState(false);

  const refresh = React.useCallback(() => {
    setLoading(true);
    fetch("/api/llm/config")
      .then((r) => r.json())
      .then((d) => setConfig(d.config ?? null))
      .catch(() => setConfig(null))
      .finally(() => setLoading(false));
  }, []);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  const value: LLMContextValue = {
    config,
    loading,
    settingsOpen,
    openSettings: () => setSettingsOpen(true),
    closeSettings: () => setSettingsOpen(false),
    refresh,
  };

  return (
    <LLMContext.Provider value={value}>
      {children}
      {settingsOpen && (
        <LLMSettingsModal
          initial={config}
          onClose={() => setSettingsOpen(false)}
          onSaved={(c) => {
            setConfig(c);
            setSettingsOpen(false);
          }}
        />
      )}
    </LLMContext.Provider>
  );
}

/** Small status chip showing the active provider. */
export function LLMStatusChip() {
  const { config, loading, openSettings } = useLLM();
  if (loading) {
    return <span className="rounded-full bg-subtle px-2 py-0.5 text-xs text-muted">LLM…</span>;
  }
  if (!config) {
    return (
      <button
        type="button"
        onClick={openSettings}
        className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700"
      >
        未配置 LLM
      </button>
    );
  }
  const label = config.provider === "local" ? "本地 LLM" : "远端 API";
  return (
    <span
      className="rounded-full bg-primary-soft px-2 py-0.5 text-xs text-primary"
      title={`${label} · ${config.model}`}
    >
      {label} · {config.model}
    </span>
  );
}

/** Gear button that opens the LLM settings modal. */
export function LLMSettingsButton() {
  const { openSettings } = useLLM();
  return (
    <button
      type="button"
      onClick={openSettings}
      title="LLM 文本生成设置"
      className="rounded-lg border border-border px-3 py-2 text-sm text-muted transition-colors hover:bg-subtle"
    >
      ⚙️ LLM 设置
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
// Settings modal
// ─────────────────────────────────────────────────────────────
function LLMSettingsModal({
  initial,
  onClose,
  onSaved,
}: {
  initial: LLMConfigView | null;
  onClose: () => void;
  onSaved: (c: LLMConfigView) => void;
}) {
  const [provider, setProvider] = React.useState<LLMProviderType>(initial?.provider ?? "local");
  const [baseUrl, setBaseUrl] = React.useState(
    initial?.baseUrl ?? "http://localhost:11434/v1"
  );
  const [model, setModel] = React.useState(initial?.model ?? "llama3.1");
  const [apiKey, setApiKey] = React.useState("");
  const [temperature, setTemperature] = React.useState(initial?.temperature ?? 0.7);
  const [maxTokens, setMaxTokens] = React.useState(initial?.maxTokens ?? 2048);
  const [saving, setSaving] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [msg, setMsg] = React.useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const baseUrlPlaceholder =
    provider === "local" ? "http://localhost:11434/v1" : "https://api.openai.com/v1";

  function syncProviderDefaults(p: LLMProviderType) {
    setProvider(p);
    setBaseUrl(p === "local" ? "http://localhost:11434/v1" : "https://api.openai.com/v1");
  }

  async function handleSave() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/llm/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          baseUrl,
          model,
          apiKey: apiKey || undefined, // omit → keep existing
          temperature,
          maxTokens,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "保存失败");
      onSaved(data.config);
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.message || "保存失败" });
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setMsg(null);
    try {
      const out = await completeChat({
        messages: [
          { role: "system", content: "你是测试助手，只回复 OK。" },
          { role: "user", content: "ping" },
        ],
        opts: { provider, baseUrl, model, temperature: 0.2, maxTokens: 16 },
      });
      setMsg({ kind: "ok", text: `连接成功：${out.slice(0, 60)}` });
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.message || "连接失败" });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-border bg-surface p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-ink">LLM 文本生成设置</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-ink"
            aria-label="关闭"
          >
            ✕
          </button>
        </div>

        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs text-muted">提供方</span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => syncProviderDefaults("local")}
                className={`rounded-lg border px-3 py-2 text-sm ${
                  provider === "local"
                    ? "border-primary bg-primary-soft text-primary"
                    : "border-border text-muted hover:bg-subtle"
                }`}
              >
                本地 LLM（Ollama/LM Studio）
              </button>
              <button
                type="button"
                onClick={() => syncProviderDefaults("remote")}
                className={`rounded-lg border px-3 py-2 text-sm ${
                  provider === "remote"
                    ? "border-primary bg-primary-soft text-primary"
                    : "border-border text-muted hover:bg-subtle"
                }`}
              >
                远端 API（OpenAI 兼容）
              </button>
            </div>
          </label>

          <Field label="Base URL" value={baseUrl} onChange={setBaseUrl} placeholder={baseUrlPlaceholder} />
          <Field label="模型名" value={model} onChange={setModel} placeholder="llama3.1 / gpt-4o-mini" />
          <Field
            label={`API Key${provider === "remote" ? "（必填）" : "（本地一般留空）"}`}
            value={apiKey}
            onChange={setApiKey}
            placeholder={initial?.hasApiKey ? "已保存，留空则不修改" : "sk-..."}
            password
          />

          <label className="block">
            <span className="mb-1 flex items-center justify-between text-xs text-muted">
              <span>温度（Temperature）</span>
              <span className="text-ink">{temperature.toFixed(2)}</span>
            </span>
            <input
              type="range"
              min={0}
              max={2}
              step={0.05}
              value={temperature}
              onChange={(e) => setTemperature(Number(e.target.value))}
              className="w-full accent-primary"
            />
          </label>

          <Field label="最大 Token" value={String(maxTokens)} onChange={(v) => setMaxTokens(Number(v) || 2048)} placeholder="2048" />
        </div>

        {msg && (
          <p
            className={`mt-3 rounded-lg px-3 py-2 text-xs ${
              msg.kind === "ok" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
            }`}
          >
            {msg.text}
          </p>
        )}

        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={handleTest}
            disabled={testing}
            className="rounded-lg border border-border px-3 py-2 text-sm text-muted hover:bg-subtle disabled:opacity-40"
          >
            {testing ? "测试中…" : "测试连接"}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-40"
          >
            {saving ? "保存中…" : "保存"}
          </button>
        </div>

        <p className="mt-3 text-[11px] leading-relaxed text-muted">
          支持任何 OpenAI 兼容接口：本地可填 Ollama（http://localhost:11434/v1）或 LM Studio；
          远端可填 OpenAI / DeepSeek / 通义等。API Key 仅存储于服务端，不会下发到浏览器。
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
      <span className="mb-1 block text-xs text-muted">{label}</span>
      <input
        type={password ? "password" : "text"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-primary"
      />
    </label>
  );
}
