"use client";

import { useState } from "react";
import { DarkSelect } from "@/components/studio/ui/DarkSelect";
import { api } from "~/trpc/react";

/** Pull the `error` string out of a JSON response body (was `res.error ?? …`). */
function errorOfBody(d: unknown): string | undefined {
  if (typeof d === "object" && d !== null && "error" in d) {
    const err: unknown = (d as { error?: unknown }).error;
    if (typeof err === "string") return err;
  }
  return undefined;
}

/** Extract `e.message` from an unknown thrown value (was `(e as any)?.message`). */
function errMsg(e: unknown, fallback: string): string {
  if (typeof e === "object" && e !== null && "message" in e) {
    const m: unknown = (e as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return fallback;
}

type Settings = {
  comfyuiUrl: string;
  trainerUrl: string;
  defaultVideoWorkflow: "auto" | "txt2video" | "img2video";
  comfyLorasDir: string;
};

type LlmConfig = {
  provider: "local" | "remote";
  baseUrl: string;
  model: string;
  temperature: number;
  maxTokens: number;
  apiKey: string | null;
};

type Tab = "account" | "prefs";

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>("account");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // account
  const [curPwd, setCurPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [newEmail, setNewEmail] = useState("");

  // prefs
  const [saving, setSaving] = useState(false);
  const [llmApiKey, setLlmApiKey] = useState("");
  const [llmDraft, setLlmDraft] = useState<LlmConfig | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<Settings | null>(null);

  const settingsQ = api.setting.get.useQuery();
  const llmQ = api.llm.configGet.useQuery();
  const saveSetting = api.setting.save.useMutation();
  const saveLlmCfg = api.llm.configSave.useMutation();

  const settings = settingsQ.data?.settings ?? null;
  const llm = llmQ.data?.config ?? null;

  // Seed drafts from query results (adjusted during render, React 19 pattern:
  // no setState synchronously within an effect).
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

  function flash(kind: "ok" | "err", text: string) {
    setMsg({ kind, text });
    setTimeout(() => setMsg(null), 3500);
  }

  async function saveAccountPassword() {
    if (newPwd.length < 8) return flash("err", "新密码至少 8 位");
    if (newPwd !== confirmPwd) return flash("err", "两次输入的密码不一致");
    setSaving(true);
    try {
      const r = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword: curPwd, newPassword: newPwd }),
      });
      const res: unknown = await r.json();
      if (!r.ok) return flash("err", errorOfBody(res) ?? "修改失败");
      flash("ok", "密码已更新");
      setCurPwd("");
      setNewPwd("");
      setConfirmPwd("");
    } finally {
      setSaving(false);
    }
  }

  async function saveAccountEmail() {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) return flash("err", "邮箱格式不正确");
    setSaving(true);
    try {
      const r = await fetch("/api/auth/change-email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ newEmail }),
      });
      const res: unknown = await r.json();
      if (!r.ok) return flash("err", errorOfBody(res) ?? "修改失败");
      flash("ok", "邮箱已更新");
      setNewEmail("");
    } finally {
      setSaving(false);
    }
  }

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

  if (settingsQ.isLoading || llmQ.isLoading || !settings || !llm || !settingsDraft || !llmDraft) {
    return (
      <div className="dark grid min-h-screen place-items-center bg-(--color-canvas) text-muted">
        加载中…
      </div>
    );
  }

  return (
    <div className="dark min-h-screen bg-(--color-canvas) px-4 py-8 sm:px-8">
      <div className="mx-auto max-w-[1200px]">
        <div className="mb-6">
          <h1 className="u-title-page">设置</h1>
          <p className="mt-1 text-sm text-muted">管理你的账户安全与创作偏好。</p>
        </div>

      <div className="mb-6 flex gap-2">
        <TabBtn active={tab === "account"} onClick={() => setTab("account")}>
          账户
        </TabBtn>
        <TabBtn active={tab === "prefs"} onClick={() => setTab("prefs")}>
          偏好
        </TabBtn>
      </div>

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

      {tab === "account" && (
        <div className="grid gap-6 md:grid-cols-2">
          <Card title="修改密码">
            <Field label="当前密码" value={curPwd} onChange={setCurPwd} type="password" placeholder="本地单用户首次可留空" />
            <Field label="新密码" value={newPwd} onChange={setNewPwd} type="password" placeholder="至少 8 位" />
            <Field label="确认新密码" value={confirmPwd} onChange={setConfirmPwd} type="password" />
            <Btn onClick={saveAccountPassword} disabled={saving}>
              更新密码
            </Btn>
          </Card>

          <Card title="修改邮箱">
            <Field label="新邮箱" value={newEmail} onChange={setNewEmail} type="email" placeholder="you@example.com" />
            <p className="mb-4 text-xs text-muted">修改后下次登录请使用新邮箱。</p>
            <Btn onClick={saveAccountEmail} disabled={saving}>
              更新邮箱
            </Btn>
          </Card>
        </div>
      )}

      {tab === "prefs" && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="语言模型（LLM）">
            <div className="mb-3 flex gap-2">
              <DarkSelect
                className="!bg-white/5 text-sm text-ink"
                value={llmDraft.provider}
                onChange={(value) => setLlmDraft({ ...llmDraft, provider: value as LlmConfig["provider"] })}
                options={["local", "remote"]}
                labels={{ local: "本地（Ollama）", remote: "远程（OpenAI 兼容）" }}
                placeholder="选择提供商"
              />
            </div>
            <Field label="Base URL" value={llmDraft.baseUrl} onChange={(value) => setLlmDraft({ ...llmDraft, baseUrl: value })} placeholder="http://localhost:11434/v1" />
            <Field label="模型" value={llmDraft.model} onChange={(value) => setLlmDraft({ ...llmDraft, model: value })} placeholder="llama3.1" />
            <Field
              label="API Key"
              value={llmApiKey || (!!llmDraft.apiKey ? "••••••••" : "")}
              onChange={setLlmApiKey}
              type="password"
              placeholder={!!llmDraft.apiKey ? "已设置，留空不改" : "远程提供商必填"}
            />
            <div className="mb-4 grid grid-cols-2 gap-3">
              <Field label="温度" value={String(llmDraft.temperature)} onChange={(value) => setLlmDraft({ ...llmDraft, temperature: Number(value) || 0 })} />
              <Field label="最大 Token" value={String(llmDraft.maxTokens)} onChange={(value) => setLlmDraft({ ...llmDraft, maxTokens: Number(value) || 0 })} />
            </div>
            <Btn onClick={saveLlm} disabled={saving}>
              保存 LLM 配置
            </Btn>
          </Card>

          <Card title="创作后端">
            <Field
              label="ComfyUI 地址"
              value={settingsDraft.comfyuiUrl}
              onChange={(value) => setSettingsDraft({ ...settingsDraft, comfyuiUrl: value })}
              placeholder="http://localhost:8188"
            />
            <Field
              label="训练后端 URL"
              value={settingsDraft.trainerUrl}
              onChange={(value) => setSettingsDraft({ ...settingsDraft, trainerUrl: value })}
              placeholder="留空则显示「未配置」横幅"
            />
            <div className="mb-4">
              <label className="mb-1.5 block text-sm font-medium text-ink/80">默认视频工作流</label>
              <DarkSelect
                className="w-full !bg-white/5 text-sm text-ink"
                value={settingsDraft.defaultVideoWorkflow}
                onChange={(value) => setSettingsDraft({ ...settingsDraft, defaultVideoWorkflow: value as Settings["defaultVideoWorkflow"] })}
                options={["auto", "txt2video", "img2video"]}
                labels={{ auto: "自动（文生视频，本地合成首帧）", txt2video: "文生视频（本地合成首帧）", img2video: "图生视频（上传首帧）" }}
                placeholder="选择默认视频工作流"
              />
              <p className="mt-1.5 text-xs text-muted">本地 Wan 图生视频模型，无需联网或授权。</p>
            </div>
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
        </div>
      )}
      </div>
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
        active ? "bg-primary text-white" : "border border-border text-muted hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

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
        className="w-full rounded-lg border border-border bg-white/5 px-3 py-2 text-sm text-ink placeholder:text-muted/60 outline-none focus:border-primary"
      />
    </div>
  );
}

function Btn({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
    >
      {children}
    </button>
  );
}
