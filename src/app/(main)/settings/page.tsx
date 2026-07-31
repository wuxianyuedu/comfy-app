"use client";

import { useEffect, useState } from "react";

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
  hasApiKey: boolean;
};

type Tab = "account" | "prefs";

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>("account");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [llm, setLlm] = useState<LlmConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // account
  const [curPwd, setCurPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [newEmail, setNewEmail] = useState("");

  // prefs
  const [saving, setSaving] = useState(false);
  const [llmApiKey, setLlmApiKey] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const [s, l] = await Promise.all([
          fetch("/api/settings").then((r) => r.json()),
          fetch("/api/llm/config").then((r) => r.json()),
        ]);
        setSettings(s.settings);
        setLlm(l.config);
      } catch {
        setMsg({ kind: "err", text: "加载设置失败" });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

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
      const d = await r.json();
      if (!r.ok) return flash("err", d.error ?? "修改失败");
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
      const d = await r.json();
      if (!r.ok) return flash("err", d.error ?? "修改失败");
      flash("ok", "邮箱已更新");
      setNewEmail("");
    } finally {
      setSaving(false);
    }
  }

  async function saveLlm() {
    if (!llm) return;
    setSaving(true);
    try {
      const r = await fetch("/api/llm/config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...llm, ...(llmApiKey ? { apiKey: llmApiKey } : {}) }),
      });
      const d = await r.json();
      if (!r.ok) return flash("err", d.error ?? "保存失败");
      flash("ok", "LLM 配置已保存");
    } finally {
      setSaving(false);
    }
  }

  async function savePrefs() {
    if (!settings) return;
    setSaving(true);
    try {
      const r = await fetch("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(settings),
      });
      const d = await r.json();
      if (!r.ok) return flash("err", d.error ?? "保存失败");
      setSettings(d.settings);
      flash("ok", "偏好已保存");
    } finally {
      setSaving(false);
    }
  }

  if (loading || !settings || !llm) {
    return <div className="py-20 text-center text-muted">加载中…</div>;
  }

  return (
    <div className="py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">设置</h1>
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
              <select
                value={llm.provider}
                onChange={(e) => setLlm({ ...llm, provider: e.target.value as LlmConfig["provider"] })}
                className="rounded-lg border border-border bg-white/5 px-3 py-2 text-sm text-ink"
              >
                <option value="local">本地（Ollama）</option>
                <option value="remote">远程（OpenAI 兼容）</option>
              </select>
            </div>
            <Field label="Base URL" value={llm.baseUrl} onChange={(v) => setLlm({ ...llm, baseUrl: v })} placeholder="http://localhost:11434/v1" />
            <Field label="模型" value={llm.model} onChange={(v) => setLlm({ ...llm, model: v })} placeholder="llama3.1" />
            <Field
              label="API Key"
              value={llmApiKey || (llm.hasApiKey ? "••••••••" : "")}
              onChange={setLlmApiKey}
              type="password"
              placeholder={llm.hasApiKey ? "已设置，留空不改" : "远程提供商必填"}
            />
            <div className="mb-4 grid grid-cols-2 gap-3">
              <Field label="温度" value={String(llm.temperature)} onChange={(v) => setLlm({ ...llm, temperature: Number(v) || 0 })} />
              <Field label="最大 Token" value={String(llm.maxTokens)} onChange={(v) => setLlm({ ...llm, maxTokens: Number(v) || 0 })} />
            </div>
            <Btn onClick={saveLlm} disabled={saving}>
              保存 LLM 配置
            </Btn>
          </Card>

          <Card title="创作后端">
            <Field
              label="ComfyUI 地址"
              value={settings.comfyuiUrl}
              onChange={(v) => setSettings({ ...settings, comfyuiUrl: v })}
              placeholder="http://localhost:8188"
            />
            <Field
              label="训练后端 URL"
              value={settings.trainerUrl}
              onChange={(v) => setSettings({ ...settings, trainerUrl: v })}
              placeholder="留空则显示「未配置」横幅"
            />
            <div className="mb-4">
              <label className="mb-1.5 block text-sm font-medium text-ink/80">默认视频工作流</label>
              <select
                value={settings.defaultVideoWorkflow}
                onChange={(e) => setSettings({ ...settings, defaultVideoWorkflow: e.target.value as Settings["defaultVideoWorkflow"] })}
                className="w-full rounded-lg border border-border bg-white/5 px-3 py-2 text-sm text-ink"
              >
                <option value="auto">自动（文生视频，本地合成首帧）</option>
                <option value="txt2video">文生视频（本地合成首帧）</option>
                <option value="img2video">图生视频（上传首帧）</option>
              </select>
              <p className="mt-1.5 text-xs text-muted">本地 Wan 图生视频模型，无需联网或授权。</p>
            </div>
            <Field
              label="LoRA 输出目录"
              value={settings.comfyLorasDir}
              onChange={(v) => setSettings({ ...settings, comfyLorasDir: v })}
              placeholder="留空使用默认 models/loras"
            />
            <Btn onClick={savePrefs} disabled={saving}>
              保存偏好
            </Btn>
          </Card>
        </div>
      )}
    </div>
  );
}

let llmApiKey = "";

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
    <section className="rounded-2xl border border-border bg-white/[0.03] p-5 backdrop-blur">
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
        onChange={(e) => onChange(e.target.value)}
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
