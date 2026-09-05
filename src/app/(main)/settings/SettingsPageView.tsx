"use client";

/**
 * 设置页的纯展示视图（规范 17 §17.2 第③层）。
 *
 * 从 page.tsx 原样搬来的 JSX，唯一改动是把「直接读 tRPC 查询 / 直接 fetch」
 * 换成消费 controller 的字段与动作。视觉与文案零改动。
 */

import { useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";

import { DarkSelect } from "@/components/studio/ui/DarkSelect";
import type {
  LlmConfig,
  SettingsPageController,
  SettingsPageDrafts,
} from "./hooks/use-settings-page";
import {
  SETTINGS_SECTIONS,
  TEMPERATURE_TASKS,
} from "./hooks/use-settings-page";

/** `drafts` 非空由容器保证（`if (!c.drafts)` 早退），这里用交集类型表达，
 *  视图内不必逐处判空。 */
export type ReadySettingsPageController = SettingsPageController & {
  drafts: SettingsPageDrafts;
};

export function SettingsPageView({ c }: { c: ReadySettingsPageController }) {
  const router = useRouter();
  /* 「按任务温度」的展开态是纯视觉偏好（无副作用、不入库），按 §17.2 留在视图层。 */
  const [showTaskTemps, setShowTaskTemps] = useState(false);

  return (
    <div className="dark h-[calc(100vh-var(--toolbar-height,48px))] overflow-y-auto bg-(--color-canvas) pb-6">
      {/* Header bar */}
      <div className="border-border flex items-center gap-3 border-b px-6 py-4">
        <button
          onClick={() => router.back()}
          className="text-muted-foreground hover:bg-subtle hover:text-ink flex h-9 w-9 items-center justify-center rounded-lg transition-colors"
          title="返回"
        >
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-ink text-lg font-semibold">设置</h1>
      </div>

      <div className="mx-auto flex max-w-[1100px] gap-6 px-6 py-6">
        {/* Left sidebar */}
        <nav className="w-48 shrink-0 space-y-1">
          {SETTINGS_SECTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => c.setSection(item.id)}
              className={`w-full rounded-lg px-3 py-2 text-center text-sm font-medium transition-colors ${
                c.section === item.id
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-subtle hover:text-ink"
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>

        {/* Content area */}
        <div className="min-w-0 flex-1">
          {c.flash && (
            <div
              className={`mb-4 rounded-lg border px-4 py-2 text-sm ${
                c.flash.kind === "ok"
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                  : "border-rose-500/30 bg-rose-500/10 text-rose-300"
              }`}
            >
              {c.flash.text}
            </div>
          )}

          {/* ═══ LLM Section ═══ */}
          {c.section === "llm" && (
            <Card title="语言模型（LLM）">
              <div className="mb-4 flex gap-2">
                <DarkSelect
                  className="text-ink !bg-white/5 text-sm"
                  value={c.drafts.llm.provider}
                  onChange={(value) =>
                    c.patchLlm({ provider: value as LlmConfig["provider"] })
                  }
                  options={["local", "remote"]}
                  labels={{
                    local: "本地（Ollama）",
                    remote: "远程（OpenAI 兼容）",
                  }}
                />
              </div>

              <Field
                label="Base URL"
                value={c.drafts.llm.baseUrl}
                onChange={(value) => c.patchLlm({ baseUrl: value })}
                placeholder="http://localhost:11434/v1"
              />

              {/* Ollama status row */}
              {c.drafts.llm.provider === "local" && (
                <div className="border-border mb-4 flex items-center gap-3 rounded-lg border bg-white/3 px-3 py-2.5">
                  {c.ollamaStatus === "checking" && (
                    <>
                      <Loader2
                        size={14}
                        className="text-muted-foreground animate-spin"
                      />
                      <span className="text-muted-foreground text-sm">
                        检测 Ollama 服务…
                      </span>
                    </>
                  )}
                  {c.ollamaStatus === "starting" && (
                    <>
                      <Loader2
                        size={14}
                        className="text-muted-foreground animate-spin"
                      />
                      <span className="text-muted-foreground text-sm">
                        Ollama 启动中，正在等待服务就绪…
                      </span>
                    </>
                  )}
                  {c.ollamaStatus === "up" && (
                    <>
                      <span className="inline-block size-2 shrink-0 rounded-full bg-emerald-400" />
                      <span className="text-ink/80 text-sm">
                        Ollama 运行中（{c.ollamaModels.length} 个模型可用）
                      </span>
                      <Btn
                        onClick={() => void c.stopOllama()}
                        disabled={c.ollamaStopping}
                        className="ml-auto"
                      >
                        {c.ollamaStopping ? "关闭中…" : "关闭 Ollama"}
                      </Btn>
                    </>
                  )}
                  {c.ollamaStatus === "down" && (
                    <>
                      <span className="inline-block size-2 shrink-0 rounded-full bg-rose-400" />
                      <span className="text-ink/80 text-sm">Ollama 未运行</span>
                      <Btn
                        onClick={() => void c.startOllama()}
                        disabled={c.ollamaStarting}
                        className="ml-auto"
                      >
                        {c.ollamaStarting ? "启动中…" : "启动 Ollama"}
                      </Btn>
                    </>
                  )}
                </div>
              )}

              {/* Model selector — populated from Ollama when available */}
              {c.drafts.llm.provider === "local" &&
              c.ollamaStatus === "up" &&
              c.ollamaModels.length > 0 ? (
                <div className="mb-3">
                  <label className="text-ink/80 mb-1.5 block text-sm font-medium">
                    模型
                  </label>
                  <select
                    value={c.drafts.llm.model}
                    onChange={(event) =>
                      c.patchLlm({ model: event.target.value })
                    }
                    className="border-border text-ink focus:border-primary w-full rounded-lg border bg-white/5 px-3 py-2 text-sm outline-none"
                  >
                    {c.ollamaModels.map((model) => (
                      <option key={model.name} value={model.name}>
                        {model.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <Field
                  label="模型"
                  value={c.drafts.llm.model}
                  onChange={(value) => c.patchLlm({ model: value })}
                  placeholder="llama3.1 或 qwen3:14b"
                />
              )}

              {c.drafts.llm.provider === "remote" && (
                <Field
                  label="API Key"
                  value={
                    c.llmApiKey || (!!c.drafts.llm.apiKey ? "••••••••" : "")
                  }
                  onChange={c.setLlmApiKey}
                  type="password"
                  placeholder={
                    !!c.drafts.llm.apiKey
                      ? "已设置，留空不改"
                      : "远程提供商必填"
                  }
                />
              )}
              <div className="mb-4 grid grid-cols-2 gap-3">
                <Field
                  label="全局默认温度"
                  value={String(c.drafts.llm.temperature)}
                  onChange={(value) =>
                    c.patchLlm({ temperature: Number(value) || 0 })
                  }
                />
                <Field
                  label="最大 Token"
                  value={String(c.drafts.llm.maxTokens)}
                  onChange={(value) =>
                    c.patchLlm({ maxTokens: Number(value) || 0 })
                  }
                />
              </div>

              {/* 按任务类型配置温度 */}
              <div className="border-border mb-4 rounded-xl border bg-white/[0.02] p-4">
                <button
                  type="button"
                  onClick={() => setShowTaskTemps((v) => !v)}
                  className="text-ink/80 hover:text-ink mb-3 flex w-full items-center justify-between text-sm font-medium"
                >
                  <span>按任务类型配置温度（可选覆盖全局默认）</span>
                  <span className="text-muted-foreground">
                    {showTaskTemps ? "▾" : "▸"}
                  </span>
                </button>
                {showTaskTemps && (
                  <div className="space-y-3">
                    {TEMPERATURE_TASKS.map(([key, meta]) => {
                      const taskTemp = c.drafts.llm.temperatureByTask?.[key];
                      const isOverridden =
                        taskTemp !== undefined && taskTemp !== null;
                      return (
                        <div
                          key={key}
                          className="border-border/50 flex items-center gap-3 rounded-lg border bg-white/[0.02] px-3 py-2.5"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-ink text-sm font-medium">
                                {meta.label}
                              </span>
                              {isOverridden && (
                                <span className="bg-primary/15 text-primary rounded-full px-1.5 py-0.5 text-[10px] font-medium">
                                  已覆盖
                                </span>
                              )}
                            </div>
                            <p className="text-muted-foreground text-[11px]">
                              {meta.desc}（建议 {meta.hint}）
                            </p>
                          </div>
                          <input
                            type="number"
                            step={0.05}
                            min={0}
                            max={2}
                            value={isOverridden ? String(taskTemp) : ""}
                            placeholder={`默认 ${c.drafts.llm.temperature}`}
                            onChange={(event) =>
                              c.setTaskTemperature(key, event.target.value)
                            }
                            className="border-border text-ink focus:border-primary placeholder:text-muted-foreground/50 w-24 rounded-lg border bg-white/5 px-2 py-1.5 text-right text-sm outline-none"
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <Btn onClick={() => void c.saveLlm()} disabled={c.saving}>
                保存 LLM 配置
              </Btn>
            </Card>
          )}

          {/* ═══ ComfyUI Section ═══ */}
          {c.section === "comfyui" && (
            <Card title="创作后端（ComfyUI）">
              <Field
                label="ComfyUI 路径（安装根目录，含 main.py）"
                value={c.drafts.settings.comfyuiPath}
                onChange={(value) => c.patchSettings({ comfyuiPath: value })}
                placeholder="例如 D:\\ComfyUI 或 D:\\Comfy-Desktop\\ComfyUI-Installs\\ComfyUI"
              />
              <p className="text-muted-foreground -mt-2 mb-3 text-xs">
                支持：便携版（python_embeded\\python.exe +
                main.py）、桌面版（standalone-env +
                ComfyUI\\main.py）、venv（.venv + main.py）。
                {c.comfyStatus?.pathConfigured
                  ? "已配置——ComfyUI 未运行时提交任务会自动拉起。"
                  : "未配置——ComfyUI 未运行时任务会失败。"}
              </p>
              <Field
                label="ComfyUI 端口"
                value={
                  c.drafts.settings.comfyuiPort > 0
                    ? String(c.drafts.settings.comfyuiPort)
                    : ""
                }
                onChange={(value) =>
                  c.patchSettings({
                    comfyuiPort: Math.max(0, Number(value) || 0),
                  })
                }
                placeholder="留空使用默认 8188"
              />
              <p className="text-muted-foreground -mt-2 mb-3 text-xs">
                非 8188 端口会在启动时自动传 --port，实际运行端口以设置为准。
              </p>
              <Field
                label="ComfyUI 启动参数（可选）"
                value={c.drafts.settings.comfyuiExtraArgs}
                onChange={(value) =>
                  c.patchSettings({ comfyuiExtraArgs: value })
                }
                placeholder="例如 --input-directory D:\\ComfyUI-Shared\\input"
              />
              <div className="mb-4 flex items-center gap-2">
                <input
                  id="comfyui-autostart"
                  type="checkbox"
                  className="size-4 accent-[var(--primary,#7c5cff)]"
                  checked={c.drafts.settings.comfyuiAutoStart}
                  onChange={(event) =>
                    c.patchSettings({ comfyuiAutoStart: event.target.checked })
                  }
                />
                <label
                  htmlFor="comfyui-autostart"
                  className="text-ink/80 text-sm"
                >
                  提交任务时 ComfyUI 未运行则自动启动
                </label>
              </div>
              <div className="border-border mb-4 flex items-center gap-3 rounded-lg border bg-white/3 px-3 py-2">
                <span
                  className={`inline-block size-2 shrink-0 rounded-full ${
                    c.comfyStatus?.up
                      ? "bg-emerald-400"
                      : c.comfyStatus?.starting
                        ? "bg-amber-400"
                        : "bg-rose-400"
                  }`}
                />
                <span className="text-ink/80 text-sm">
                  {c.comfyStatus?.up
                    ? `ComfyUI 运行中${c.comfyStatus.base ? `（${c.comfyStatus.base}）` : ""}`
                    : c.comfyStarting || c.comfyStatus?.starting
                      ? "ComfyUI 正在启动…"
                      : "ComfyUI 未运行"}
                </span>
                <div className="ml-auto flex items-center gap-2">
                  <Btn
                    onClick={() => void c.startComfy()}
                    disabled={c.saving || c.comfyStarting || c.comfyStatus?.up}
                  >
                    {c.comfyStarting ? "启动中…" : "启动 ComfyUI"}
                  </Btn>
                  <Btn
                    onClick={() => void c.stopComfy()}
                    disabled={c.saving || c.comfyStopping || !c.comfyStatus?.up}
                  >
                    {c.comfyStopping ? "关闭中…" : "关闭 ComfyUI"}
                  </Btn>
                </div>
              </div>
              <Field
                label="训练后端 URL"
                value={c.drafts.settings.trainerUrl}
                onChange={(value) => c.patchSettings({ trainerUrl: value })}
                placeholder="留空则显示「未配置」横幅"
              />
              <Field
                label="LoRA 输出目录"
                value={c.drafts.settings.comfyLorasDir}
                onChange={(value) => c.patchSettings({ comfyLorasDir: value })}
                placeholder="留空使用默认 models/loras"
              />
              <Btn onClick={() => void c.savePrefs()} disabled={c.saving}>
                保存偏好
              </Btn>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Shared UI ───────────────────────────────────────────── */

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-border rounded-2xl border bg-white/3 p-5 backdrop-blur">
      <h2 className="text-ink mb-4 text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div className="mb-3">
      <label className="text-ink/80 mb-1.5 block text-sm font-medium">
        {label}
      </label>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="border-border text-ink placeholder:text-muted-foreground/60 focus:border-primary w-full rounded-lg border bg-white/5 px-3 py-2 text-sm outline-none"
      />
    </div>
  );
}

function Btn({
  onClick,
  disabled,
  children,
  className,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`bg-primary hover:bg-primary-hover rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors disabled:opacity-50 ${className ?? ""}`}
    >
      {children}
    </button>
  );
}
