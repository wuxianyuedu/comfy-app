"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { DarkSelect } from "@/components/studio/ui/DarkSelect";
import { api } from "~/trpc/react";

/* ── Helpers ──────────────────────────────────────────────── */

function errMsg(e: unknown, fallback: string): string {
  if (typeof e === "object" && e !== null && "message" in e) {
    const m: unknown = (e as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return fallback;
}

/* ── Types ────────────────────────────────────────────────── */

type Settings = {
  comfyuiUrl: string;
  trainerUrl: string;
  defaultVideoWorkflow: "auto" | "txt2video" | "img2video";
  comfyLorasDir: string;
  comfyuiPath: string;
  comfyuiExtraArgs: string;
  comfyuiAutoStart: boolean;
};

type LlmConfig = {
  provider: "local" | "remote";
  baseUrl: string;
  model: string;
  temperature: number;
  maxTokens: number;
  apiKey: string | null;
};

type Section = "llm" | "comfyui";

interface OllamaModel {
  name: string;
  size: number;
  modified_at: string;
}

/* ── Page ─────────────────────────────────────────────────── */

export default function SettingsPage() {
  const router = useRouter();
  const [section, setSection] = useState<Section>("llm");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // LLM
  const [saving, setSaving] = useState(false);
  const [llmApiKey, setLlmApiKey] = useState("");
  const [llmDraft, setLlmDraft] = useState<LlmConfig | null>(null);
  const [ollamaStatus, setOllamaStatus] = useState<"checking" | "up" | "down">("checking");
  const [ollamaModels, setOllamaModels] = useState<OllamaModel[]>([]);
  const [ollamaStarting, setOllamaStarting] = useState(false);

  // ComfyUI
  const [settingsDraft, setSettingsDraft] = useState<Settings | null>(null);

  const settingsQ = api.setting.get.useQuery();
  const llmQ = api.llm.configGet.useQuery();
  const saveSetting = api.setting.save.useMutation();
  const saveLlmCfg = api.llm.configSave.useMutation();
  const comfyStatusQ = api.setting.comfyStatus.useQuery(undefined, { refetchInterval: 15_000 });
  const comfyStartM = api.setting.comfyStart.useMutation();

  const settings = settingsQ.data?.settings ?? null;

  // Seed drafts from query results
  const llmConfig = llmQ.data?.config ?? null;
  const [prevLlmConfig, setPrevLlmConfig] = useState(llmConfig);
  if (llmConfig !== prevLlmConfig) {
    setPrevLlmConfig(llmConfig);
    if (llmConfig) setLlmDraft({ ...llmConfig, apiKey: llmConfig.apiKey ?? null });
  }
  const settingsData = settingsQ.data?.settings ?? null;
  const [prevSettingsData, setPrevSettingsData] = useState(settingsData);
  if (settingsData !== prevSettingsData) {
    setPrevSettingsData(settingsData);
    if (settingsData) setSettingsDraft(settingsData);
  }

  /* ── Ollama probe ───────────────────────────────────── */

  const probeOllama = useCallback(async (baseUrl: string) => {
    setOllamaStatus("checking");
    try {
      // Ollama exposes a lightweight /api/tags endpoint; any 2xx means it's alive.
      const base = baseUrl.replace(/\/v1\/?$/, "");
      const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const json = (await res.json()) as { models?: OllamaModel[] };
        setOllamaModels(json.models ?? []);
        setOllamaStatus("up");
      } else {
        setOllamaModels([]);
        setOllamaStatus("down");
      }
    } catch {
      setOllamaModels([]);
      setOllamaStatus("down");
    }
  }, []);

  // Re-probe when baseUrl changes or on mount
  useEffect(() => {
    if (llmDraft?.provider === "local" && llmDraft.baseUrl) {
      const id = setTimeout(() => void probeOllama(llmDraft.baseUrl), 0);
      return () => clearTimeout(id);
    }
  }, [llmDraft?.baseUrl, llmDraft?.provider, probeOllama]);

  async function startOllama() {
    setOllamaStarting(true);
    try {
      // Attempt to launch ollama serve (works when ollama is in PATH).
      await fetch("/api/llm/ollama-start", { method: "POST" });
      // Wait a moment then re-probe
      await new Promise((r) => setTimeout(r, 2000));
      if (llmDraft?.baseUrl) await probeOllama(llmDraft.baseUrl);
    } catch {
      flash("err", "启动 Ollama 失败，请确认已安装 Ollama 并在 PATH 中可用");
    } finally {
      setOllamaStarting(false);
    }
  }

  /* ── ComfyUI start ───────────────────────────────────── */

  const [comfyStarting, setComfyStarting] = useState(false);
  async function startComfy() {
    setSaving(true);
    setComfyStarting(true);
    try {
      await saveSetting.mutateAsync({
        comfyuiPath: settingsDraft?.comfyuiPath,
        comfyuiExtraArgs: settingsDraft?.comfyuiExtraArgs,
        comfyuiAutoStart: settingsDraft?.comfyuiAutoStart,
      });
      const r = await comfyStartM.mutateAsync({});
      flash(r.ok ? "ok" : "err", r.detail);
      await comfyStatusQ.refetch();
    } catch (e) {
      flash("err", errMsg(e, "启动 ComfyUI 失败"));
    } finally {
      setSaving(false);
      setComfyStarting(false);
    }
  }

  /* ── Flash message ────────────────────────────────────── */

  function flash(kind: "ok" | "err", text: string) {
    setMsg({ kind, text });
    setTimeout(() => setMsg(null), 3500);
  }

  /* ── Save handlers ────────────────────────────────────── */

  async function saveLlm() {
    if (!llmDraft) return;
    setSaving(true);
    try {
      await saveLlmCfg.mutateAsync({ ...llmDraft, apiKey: llmApiKey || undefined });
      flash("ok", "LLM 配置已保存");
      if (llmApiKey) setLlmApiKey("");
      await llmQ.refetch();
    } catch (e) {
      flash("err", errMsg(e, "保存失败"));
    } finally {
      setSaving(false);
    }
  }

  async function savePrefs() {
    if (!settings) return;
    setSaving(true);
    try {
      await saveSetting.mutateAsync(settings);
      await settingsQ.refetch();
      flash("ok", "偏好已保存");
    } catch (e) {
      flash("err", errMsg(e, "保存失败"));
    } finally {
      setSaving(false);
    }
  }

  /* ── Loading state ────────────────────────────────────── */

  if (settingsQ.isLoading || llmQ.isLoading || !settings || !settingsDraft || !llmDraft) {
    return (
      <div className="dark grid min-h-screen place-items-center bg-(--color-canvas) text-muted-foreground">
        加载中…
      </div>
    );
  }

  /* ── Sidebar items ────────────────────────────────────── */

  const SIDEBAR_ITEMS: { id: Section; label: string }[] = [
    { id: "llm", label: "语言模型" },
    { id: "comfyui", label: "创作后端" },
  ];

  /* ── Render ───────────────────────────────────────────── */

  return (
    <div className="dark min-h-screen bg-(--color-canvas)">
      {/* Header bar */}
      <div className="flex items-center gap-3 border-b border-border px-6 py-4">
        <button
          onClick={() => router.back()}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-subtle hover:text-ink"
          title="返回"
        >
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-lg font-semibold text-ink">设置</h1>
      </div>

      <div className="mx-auto flex max-w-[1100px] gap-6 px-6 py-6">
        {/* Left sidebar */}
        <nav className="w-48 shrink-0 space-y-1">
          {SIDEBAR_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSection(item.id)}
              className={`w-full rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${
                section === item.id
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
          {msg && (
            <div
              className={`mb-4 rounded-lg border px-4 py-2 text-sm ${
                msg.kind === "ok"
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                  : "border-rose-500/30 bg-rose-500/10 text-rose-300"
              }`}
            >
              {msg.text}
            </div>
          )}

          {/* ═══ LLM Section ═══ */}
          {section === "llm" && (
            <Card title="语言模型（LLM）">
              <div className="mb-4 flex gap-2">
                <DarkSelect
                  className="!bg-white/5 text-sm text-ink"
                  value={llmDraft.provider}
                  onChange={(value) => setLlmDraft({ ...llmDraft, provider: value as LlmConfig["provider"] })}
                  options={["local", "remote"]}
                  labels={{ local: "本地（Ollama）", remote: "远程（OpenAI 兼容）" }}
                />
              </div>

              <Field label="Base URL" value={llmDraft.baseUrl} onChange={(value) => setLlmDraft({ ...llmDraft, baseUrl: value })} placeholder="http://localhost:11434/v1" />

              {/* Ollama status row */}
              {llmDraft.provider === "local" && (
                <div className="mb-4 flex items-center gap-3 rounded-lg border border-border bg-white/3 px-3 py-2.5">
                  {ollamaStatus === "checking" && (
                    <>
                      <Loader2 size={14} className="animate-spin text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">检测 Ollama 服务…</span>
                    </>
                  )}
                  {ollamaStatus === "up" && (
                    <>
                      <span className="inline-block size-2 shrink-0 rounded-full bg-emerald-400" />
                      <span className="text-sm text-ink/80">
                        Ollama 运行中（{ollamaModels.length} 个模型可用）
                      </span>
                    </>
                  )}
                  {ollamaStatus === "down" && (
                    <>
                      <span className="inline-block size-2 shrink-0 rounded-full bg-rose-400" />
                      <span className="text-sm text-ink/80">Ollama 未运行</span>
                      <Btn onClick={startOllama} disabled={ollamaStarting} className="ml-auto">
                        {ollamaStarting ? "启动中…" : "启动 Ollama"}
                      </Btn>
                    </>
                  )}
                </div>
              )}

              {/* Model selector — populated from Ollama when available */}
              {llmDraft.provider === "local" && ollamaStatus === "up" && ollamaModels.length > 0 ? (
                <div className="mb-3">
                  <label className="mb-1.5 block text-sm font-medium text-ink/80">模型</label>
                  <select
                    value={llmDraft.model}
                    onChange={(e) => setLlmDraft({ ...llmDraft, model: e.target.value })}
                    className="w-full rounded-lg border border-border bg-white/5 px-3 py-2 text-sm text-ink outline-none focus:border-primary"
                  >
                    {ollamaModels.map((m) => (
                      <option key={m.name} value={m.name}>{m.name}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <Field label="模型" value={llmDraft.model} onChange={(value) => setLlmDraft({ ...llmDraft, model: value })} placeholder="llama3.1 或 qwen3:14b" />
              )}

              {llmDraft.provider === "remote" && (
                <Field
                  label="API Key"
                  value={llmApiKey || (!!llmDraft.apiKey ? "••••••••" : "")}
                  onChange={setLlmApiKey}
                  type="password"
                  placeholder={!!llmDraft.apiKey ? "已设置，留空不改" : "远程提供商必填"}
                />
              )}
              <div className="mb-4 grid grid-cols-2 gap-3">
                <Field label="温度" value={String(llmDraft.temperature)} onChange={(value) => setLlmDraft({ ...llmDraft, temperature: Number(value) || 0 })} />
                <Field label="最大 Token" value={String(llmDraft.maxTokens)} onChange={(value) => setLlmDraft({ ...llmDraft, maxTokens: Number(value) || 0 })} />
              </div>
              <Btn onClick={saveLlm} disabled={saving}>
                保存 LLM 配置
              </Btn>
            </Card>
          )}

          {/* ═══ ComfyUI Section ═══ */}
          {section === "comfyui" && (
            <Card title="创作后端（ComfyUI）">
              <Field
                label="ComfyUI 路径（安装根目录，含 main.py）"
                value={settingsDraft.comfyuiPath}
                onChange={(value) => setSettingsDraft({ ...settingsDraft, comfyuiPath: value })}
                placeholder="例如 D:\\ComfyUI 或 D:\\Comfy-Desktop\\ComfyUI-Installs\\ComfyUI"
              />
              <p className="-mt-2 mb-3 text-xs text-muted-foreground">
                支持：便携版（python_embeded\\python.exe + main.py）、桌面版（standalone-env + ComfyUI\\main.py）、venv（.venv + main.py）。
                {comfyStatusQ.data?.pathConfigured
                  ? "已配置——ComfyUI 未运行时提交任务会自动拉起。"
                  : "未配置——ComfyUI 未运行时任务会失败。"}
              </p>
              <Field
                label="ComfyUI 启动参数（可选）"
                value={settingsDraft.comfyuiExtraArgs}
                onChange={(value) => setSettingsDraft({ ...settingsDraft, comfyuiExtraArgs: value })}
                placeholder="例如 --input-directory D:\\ComfyUI-Shared\\input"
              />
              <div className="mb-4 flex items-center gap-2">
                <input
                  id="comfyui-autostart"
                  type="checkbox"
                  className="size-4 accent-[var(--primary,#7c5cff)]"
                  checked={settingsDraft.comfyuiAutoStart}
                  onChange={(e) => setSettingsDraft({ ...settingsDraft, comfyuiAutoStart: e.target.checked })}
                />
                <label htmlFor="comfyui-autostart" className="text-sm text-ink/80">
                  提交任务时 ComfyUI 未运行则自动启动
                </label>
              </div>
              <div className="mb-4 flex items-center gap-3 rounded-lg border border-border bg-white/3 px-3 py-2">
                <span
                  className={`inline-block size-2 shrink-0 rounded-full ${
                    comfyStatusQ.data?.up ? "bg-emerald-400" : comfyStatusQ.data?.starting ? "bg-amber-400" : "bg-rose-400"
                  }`}
                />
                <span className="text-sm text-ink/80">
                  {comfyStatusQ.data?.up
                    ? `ComfyUI 运行中${comfyStatusQ.data.base ? `（${comfyStatusQ.data.base}）` : ""}`
                    : comfyStarting || comfyStatusQ.data?.starting
                      ? "ComfyUI 正在启动…"
                      : "ComfyUI 未运行"}
                </span>
                <Btn
                  onClick={startComfy}
                  disabled={saving || comfyStarting || comfyStatusQ.data?.up}
                  className="ml-auto"
                >
                  {comfyStarting ? "启动中…" : "启动 ComfyUI"}
                </Btn>
              </div>
              <Field
                label="训练后端 URL"
                value={settingsDraft.trainerUrl}
                onChange={(value) => setSettingsDraft({ ...settingsDraft, trainerUrl: value })}
                placeholder="留空则显示「未配置」横幅"
              />
              <Field
                label="LoRA 输出目录"
                value={settingsDraft.comfyLorasDir}
                onChange={(value) => setSettingsDraft({ ...settingsDraft, comfyLorasDir: value })}
                placeholder="留空使用默认 models/loras"
              />
              <Btn onClick={savePrefs} disabled={saving}>
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

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-white/3 p-5 backdrop-blur">
      <h2 className="mb-4 text-base font-semibold text-ink">{title}</h2>
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
      <label className="mb-1.5 block text-sm font-medium text-ink/80">{label}</label>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-border bg-white/5 px-3 py-2 text-sm text-ink placeholder:text-muted-foreground/60 outline-none focus:border-primary"
      />
    </div>
  );
}

function Btn({ onClick, disabled, children, className }: { onClick: () => void; disabled?: boolean; children: React.ReactNode; className?: string }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:opacity-50 ${className ?? ""}`}
    >
      {children}
    </button>
  );
}
