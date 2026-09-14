"use client";
import React from "react";
import { completeChat } from "@/lib/llm/browser";
import { Icon } from "@/components/ui/icon";
import type { LLMConfigView } from "@/lib/llm/types";
import { useLLMConfig, useLLMConfigSave } from "./hooks/use-llm-config";
import { overlayClass } from "~/lib/full-screen-layer";

/** catch 抛出值（unknown）→ 与旧 `e?.message ?? fallback` 逐值等价的消息提取：
 *  带 string message 的对象取 message（Error 实例即此路径），其余回退。 */
function errorMessage(e: unknown, fallback: string): string {
  if (typeof e === "object" && e !== null && "message" in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return fallback;
}

interface LLMContextValue {
  config: LLMConfigView | null;
  /** 静态配置下的本地候选模型名（工坊下拉「本地」组读它，不实时探测）。 */
  localModels: string[];
  /** 静态配置下的远端独立模型名（工坊下拉「远端」组读它，不实时探测）。 */
  remoteModels: string[];
  /** 静态配置下的远端生图模型名（kind=image，定妆照远端通道挑选用）。 */
  remoteImageModels: string[];
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
  const { config, localModels, remoteModels, remoteImageModels, loading, refresh } =
    useLLMConfig();
  const [settingsOpen, setSettingsOpen] = React.useState(false);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  const value: LLMContextValue = {
    config,
    localModels,
    remoteModels,
    remoteImageModels,
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
          onSaved={() => {
            refresh();
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
    return (
      <span className="bg-subtle text-muted-foreground rounded-full px-2 py-0.5 text-xs">
        LLM…
      </span>
    );
  }
  if (!config) {
    return (
      <button
        type="button"
        onClick={openSettings}
        className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:text-amber-300"
      >
        未配置 LLM
      </button>
    );
  }
  const label = config.provider === "local" ? "本地 LLM" : "远端 API";
  return (
    <span
      className="bg-primary-soft text-primary rounded-full px-2 py-0.5 text-xs"
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
      className="border-border text-muted-foreground hover:bg-subtle rounded-lg border px-3 py-2 text-sm transition-colors"
    >
      <Icon name="settings" size={14} className="mr-1.5 inline align-[-2px]" />
      LLM 设置
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
  /** 弹窗内的模型选择草稿：null = 未改动（保存时不动主配置） */
  const [draftModel, setDraftModel] = React.useState<string | null>(null);
  /** 提供方草稿：null = 未改动。本地 / 远程的切换从设置页挪到运行界面。 */
  const [draftProvider, setDraftProvider] = React.useState<
    "local" | "remote" | null
  >(null);
  const [testing, setTesting] = React.useState(false);
  const [msg, setMsg] = React.useState<{
    kind: "ok" | "err";
    text: string;
  } | null>(null);
  const { saving, save } = useLLMConfigSave();

  const provider = draftProvider ?? initial?.provider ?? "local";
  const baseUrl = initial?.baseUrl ?? "";
  const activeModel = draftModel ?? initial?.model ?? "";
  /* 候选列表 = 已配置的 extraModels + 当前生效模型（保证至少一项可选） */
  const candidates = React.useMemo(() => {
    const list = initial?.extraModels ?? [];
    return initial?.model && !list.includes(initial.model)
      ? [initial.model, ...list]
      : list;
  }, [initial]);

  async function handleSave() {
    if (draftModel == null && draftProvider == null) {
      onClose();
      return;
    }
    setMsg(null);
    try {
      const cfg = await save({
        model: draftModel ?? initial?.model ?? "",
        provider: draftProvider ?? undefined,
      });
      onSaved(cfg);
    } catch (e: unknown) {
      setMsg({ kind: "err", text: errorMessage(e, "保存失败") });
    }
  }

  async function handleTest() {
    if (!activeModel) {
      setMsg({ kind: "err", text: "请先选择一个模型" });
      return;
    }
    setTesting(true);
    setMsg(null);
    try {
      const out = await completeChat({
        messages: [
          { role: "system", content: "你是测试助手，只回复 OK。" },
          { role: "user", content: "ping" },
        ],
        opts: { provider, baseUrl, model: activeModel, temperature: 0.2, maxTokens: 16 },
      });
      setMsg({ kind: "ok", text: `连接成功：${out.slice(0, 60)}` });
    } catch (e: unknown) {
      setMsg({ kind: "err", text: errorMessage(e, "连接失败") });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div
      className={overlayClass(
        "modal",
        "z-50 grid place-items-center bg-black/20 p-4 backdrop-blur-sm dark:bg-black/50",
      )}
      onClick={onClose}
    >
      <div
        className="border-border bg-surface w-full max-w-md rounded-2xl border p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="u-title">模型选择</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-ink"
            aria-label="关闭"
          >
            ✕
          </button>
        </div>

        <p className="text-muted-foreground mb-3 text-xs leading-relaxed">
          工坊按当前生效的模型调用全链路（剧本 → 角色卡 → 分镜 →
          图片提示词）。需要增删模型、调温度等，请到
          <button
            type="button"
            onClick={onClose}
            className="text-primary mx-1 underline underline-offset-2"
          >
            设置
          </button>
          页配置。
        </p>

        {/* 提供方切换：本地 / 远程的启用从设置页挪到运行界面（与选模型同处） */}
        <div className="mb-3">
          <span className="text-ink/80 mb-1.5 block text-sm font-medium">
            提供方
          </span>
          <div className="grid grid-cols-2 gap-2">
            {(["local", "remote"] as const).map((p) => {
              const active = provider === p;
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => setDraftProvider(p)}
                  className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                    active
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-subtle hover:text-ink"
                  }`}
                >
                  {p === "local" ? "本地（Ollama）" : "远程（OpenAI 兼容）"}
                </button>
              );
            })}
          </div>
        </div>

        {candidates.length > 0 ? (
          <div className="space-y-1.5">
            {candidates.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => setDraftModel(name)}
                className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                  activeModel === name
                    ? "border-primary bg-primary-soft text-primary"
                    : "border-border text-muted-foreground hover:bg-subtle"
                }`}
              >
                <span
                  className={`inline-block size-2 shrink-0 rounded-full ${
                    activeModel === name ? "bg-primary" : "bg-surface-2"
                  }`}
                />
                <span className="flex-1 truncate">{name}</span>
                {provider === "local" && (
                  <span className="text-muted-foreground text-[10px]">本地</span>
                )}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground rounded-lg bg-amber-100 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
            暂无候选模型 —— 请到「设置」页添加（本地 Ollama 需已拉取模型）。
          </p>
        )}

        {msg && (
          <p
            className={`mt-3 rounded-lg px-3 py-2 text-xs ${
              msg.kind === "ok"
                ? "bg-emerald-100 text-emerald-800 dark:text-emerald-300"
                : "bg-red-100 text-red-800 dark:text-red-300"
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
            className="border-border text-muted-foreground hover:bg-subtle rounded-lg border px-3 py-2 text-sm disabled:opacity-40"
          >
            {testing ? "测试中…" : "测试连接"}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || (draftModel == null && draftProvider == null)}
            className="bg-primary flex-1 rounded-lg px-4 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-40"
          >
            {saving
              ? "保存中…"
              : draftModel == null && draftProvider == null
                ? "使用当前配置"
                : "保存并生效"}
          </button>
        </div>
      </div>
    </div>
  );
}
