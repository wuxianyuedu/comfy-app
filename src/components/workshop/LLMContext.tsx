"use client";
import React from "react";
import { completeChat } from "~/lib/llm/browser";
import { Icon } from "~/components/ui/icon";
import type { LLMConfigView } from "~/lib/llm/types";
import { useLLMConfig, useLLMConfigSave } from "./hooks/use-llm-config";
import { runAsyncAction } from "~/lib/async-action";
import { Button } from "~/components/ui/button";
import { useBusyAction } from "~/components/ui/use-busy-action";
import { Dialog, DialogContent } from "~/components/ui/dialog";
import { FormField } from "~/components/ui/form-field";

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
  const {
    config,
    localModels,
    remoteModels,
    remoteImageModels,
    loading,
    refresh,
  } = useLLMConfig();
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

/** 显示当前提供方的小状态章。 */
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
      <Button
        variant="warning"
        size="xs"
        onClick={openSettings}
        className="h-auto rounded-full px-2 py-0.5 text-xs"
      >
        未配置 LLM
      </Button>
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

/** 打开 LLM 设置弹窗的齿轮按钮。 */
export function LLMSettingsButton() {
  const { openSettings } = useLLM();
  return (
    <Button
      variant="outline"
      onClick={openSettings}
      title="LLM 文本生成设置"
      className="border-border text-muted-foreground hover:bg-subtle h-auto rounded-lg px-3 py-2 text-sm transition-colors"
    >
      <Icon name="settings" size={14} className="mr-1.5 inline align-[-2px]" />
      LLM 设置
    </Button>
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
  /* 忙碌位走唯一出口（规范 16 §16.2.4.71）。 */
  const testBusy = useBusyAction();
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
    /* 反馈通道是这块的**两态提示行**（`setMsg`，成功与失败同一处）——
     * 出口报`kind`，通道自己决定长什么样（规范 16 §16.2.4.30）。 */
    await runAsyncAction(
      async () => {
        const cfg = await save({
          model: draftModel ?? initial?.model ?? "",
          provider: draftProvider ?? undefined,
        });
        onSaved(cfg);
      },
      {
        report: (kind, detail) =>
          setMsg({ kind: kind === "ok" ? "ok" : "err", text: detail }),
        failureText: "保存失败",
      },
    );
  }

  async function handleTest() {
    if (!activeModel) {
      setMsg({ kind: "err", text: "请先选择一个模型" });
      return;
    }
    setMsg(null);
    await testBusy.run(() =>
      runAsyncAction(
        async () => {
          const out = await completeChat({
            messages: [
              { role: "system", content: "你是测试助手，只回复 OK。" },
              { role: "user", content: "ping" },
            ],
            opts: {
              provider,
              baseUrl,
              model: activeModel,
              temperature: 0.2,
              maxTokens: 16,
            },
          });
          return out.slice(0, 60);
        },
        {
          /* 成功文案是**动作结果**的函数（回显模型的前 60 个字符）——
           *`successText` 支持函数形式正是为这类落点（同`use-external-action`
           * 的`detail` 由端点给）。 */
          report: (kind, detail) =>
            setMsg({ kind: kind === "ok" ? "ok" : "err", text: detail }),
          failureText: "连接失败",
          successText: (result) => `连接成功：${result.detail}`,
        },
      ),
    );
  }

  /* 关闭语义（Esc / 点遮罩 / 焦点锁与归还）交给`ui/dialog`：此前自绘遮罩 +
 手写`onClick` 关闭，Esc 没接、焦点不锁也不归还。 */
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="bg-transparent p-0 ring-0"
        popupClassName="max-w-md"
      >
        <div className="border-border bg-surface w-full max-w-md rounded-2xl border p-5 shadow-2xl">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="u-title">模型选择</h3>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              className="text-muted-foreground hover:text-ink"
              aria-label="关闭"
            >
              ✕
            </Button>
          </div>

          <p className="text-muted-foreground mb-3 text-xs leading-relaxed">
            工坊按当前生效的模型调用全链路（剧本 → 角色卡 → 分镜 →
            图片提示词）。需要增删模型、调温度等，请到
            <Button
              variant="link"
              onClick={onClose}
              className="mx-1 h-auto p-0 text-inherit underline underline-offset-2"
            >
              设置
            </Button>
            页配置。
          </p>

          {/* 提供方切换：本地 / 远程的启用从设置页挪到运行界面（与选模型同处） */}
          {/* 提供方是**二选一按钮组**而不是单个控件：标签行只作小标题。 */}
          <FormField label="提供方" className="mb-3">
            <div className="grid grid-cols-2 gap-2">
              {(["local", "remote"] as const).map((p) => {
                const active = provider === p;
                return (
                  <Button
                    key={p}
                    variant="outline"
                    onClick={() => setDraftProvider(p)}
                    className={`h-auto rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      active
                        ? "border-primary text-primary bg-primary/10"
                        : "border-border text-muted-foreground hover:bg-subtle hover:text-ink"
                    }`}
                  >
                    {p === "local" ? "本地（Ollama）" : "远程（OpenAI 兼容）"}
                  </Button>
                );
              })}
            </div>
          </FormField>

          {candidates.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              {candidates.map((name) => (
                <Button
                  key={name}
                  variant="outline"
                  onClick={() => setDraftModel(name)}
                  className={`flex h-auto w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-normal transition-colors ${
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
                    <span className="text-muted-foreground text-[10px]">
                      本地
                    </span>
                  )}
                </Button>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground bg-warning/10 text-warning-strong rounded-lg px-3 py-2 text-xs">
              暂无候选模型 —— 请到「设置」页添加（本地 Ollama 需已拉取模型）。
            </p>
          )}

          {msg && (
            <p
              className={`mt-3 rounded-lg px-3 py-2 text-xs ${
                msg.kind === "ok"
                  ? "bg-success/10 text-success-strong"
                  : "bg-destructive/10 text-destructive"
              }`}
            >
              {msg.text}
            </p>
          )}

          <div className="mt-4 flex items-center gap-2">
            <Button
              variant="outline"
              onClick={handleTest}
              disabled={testBusy.busy}
              className="border-border text-muted-foreground hover:bg-subtle h-auto rounded-lg px-3 py-2 text-sm"
            >
              {testBusy.busy ? "测试中…" : "测试连接"}
            </Button>
            <Button
              variant="primary-solid"
              onClick={handleSave}
              disabled={saving || (draftModel == null && draftProvider == null)}
              className="h-auto flex-1 rounded-lg px-4 py-2 text-sm"
            >
              {saving
                ? "保存中…"
                : draftModel == null && draftProvider == null
                  ? "使用当前配置"
                  : "保存并生效"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
