"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { X, Zap } from "lucide-react";
import { authClient } from "~/server/better-auth/client";
import { Icon } from "~/components/ui/icon";
import { AuroraGlow } from "~/components/studio/ui/AuroraBackground";

type Mode = "signin" | "register";

function BoltIcon() {
  return <Zap size={22} />;
}

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === "register") {
        const { error: signUpError } = await authClient.signUp.email({
          email,
          password,
          name: name || "",
        });
        if (signUpError) {
          setError(signUpError.message ?? "注册失败，请稍后重试");
          setLoading(false);
          return;
        }
      }

      const { error: signInError } = await authClient.signIn.email({
        email,
        password,
      });

      if (signInError) {
        setError(
          mode === "register"
            ? "注册成功，但自动登录失败，请重试"
            : "邮箱或密码错误",
        );
        setLoading(false);
        return;
      }

      const params = new URLSearchParams(window.location.search);
      const callback = params.get("callbackUrl") ?? "/workspace";
      router.push(callback);
      router.refresh();
    } catch {
      setError("网络错误，请稍后重试");
      setLoading(false);
    }
  }

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setNotice(null);
  }

  return (
    <div className="bg-bg relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      {/* Aurora glows：复用 AuroraGlow 原语（同一个光晕在四处各抄一份，
          色值还各不相同 —— 见规范 03 §3.6.2）。浅色下 opacity 大幅调低、
          不用 `mix-blend-screen`（screen 在白底上什么也不显示）。 */}
      <AuroraGlow
        tone="violet"
        alpha={0.45}
        className="-top-40 -right-32 h-[640px] w-[640px] opacity-[0.14] blur-[120px] dark:opacity-70"
      />
      <AuroraGlow
        tone="cyan"
        alpha={0.25}
        className="-bottom-40 -left-32 h-[560px] w-[560px] opacity-10 blur-[110px] dark:opacity-60"
      />
      <AuroraGlow
        tone="cyan"
        alpha={0.16}
        className="top-1/3 left-1/2 h-[360px] w-[360px] opacity-[0.08] blur-[90px] dark:opacity-40"
      />

      <div className="border-border-subtle bg-surface/90 shadow-ink/5 dark:border-border-strong relative w-full max-w-[440px] rounded-[20px] border p-9 shadow-[0_8px_40px] backdrop-blur-xl">
        {/* Brand */}
        <Link
          href="/"
          className="mb-7 flex items-center justify-center gap-2 font-semibold"
        >
          <span className="bg-primary grid h-9 w-9 place-items-center rounded-lg text-white">
            <BoltIcon />
          </span>
          <span className="text-ink-bright text-xl tracking-tight">
            Comfy<span className="text-primary">APP</span>
          </span>
        </Link>

        {/* Tab switcher */}
        <div className="bg-subtle mb-6 flex rounded-xl p-1">
          <button
            type="button"
            onClick={() => switchMode("signin")}
            className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
              mode === "signin"
                ? "bg-primary/15 text-primary"
                : "text-ink-muted hover:text-ink"
            }`}
          >
            登录
          </button>
          <button
            type="button"
            onClick={() => switchMode("register")}
            className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
              mode === "register"
                ? "bg-primary/15 text-primary"
                : "text-ink-muted hover:text-ink"
            }`}
          >
            创建账号
          </button>
        </div>

        <p className="text-ink-muted mb-6 text-center text-sm">
          {mode === "signin"
            ? "登录以同步你的作品、工作流与训练任务"
            : "创建一个本地账号，开启你的 AI 创作"}
        </p>

        {notice && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-2.5 text-sm text-violet-800 dark:text-violet-200">
            <Icon
              name="info"
              size={15}
              className="mt-0.5 shrink-0 text-violet-700 dark:text-violet-300"
            />
            <span className="flex-1 leading-relaxed">{notice}</span>
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="text-violet-700/70 transition-colors hover:text-violet-900 dark:text-violet-300/70 dark:hover:text-white"
              aria-label="关闭提示"
            >
              <X size={13} />
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === "register" && (
            <Field
              label="昵称（可选）"
              type="text"
              value={name}
              onChange={setName}
              placeholder="体验创作者"
              autoComplete="name"
            />
          )}
          <Field
            label="邮箱"
            type="email"
            value={email}
            onChange={setEmail}
            placeholder="name@example.com"
            autoComplete="email"
          />
          <Field
            label="密码"
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={setPassword}
            placeholder={mode === "register" ? "至少 8 位" : "请输入密码"}
            autoComplete={
              mode === "register" ? "new-password" : "current-password"
            }
            right={
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                className="text-ink-fainter hover:bg-surface-2 hover:text-ink rounded-md p-1.5 transition-colors"
                aria-label={showPassword ? "隐藏密码" : "显示密码"}
                tabIndex={-1}
              >
                <Icon name={showPassword ? "eyeoff" : "eye"} size={18} />
              </button>
            }
          />

          {error && (
            <p className="rounded-lg bg-red-500/10 px-3 py-2 text-center text-sm text-red-700 dark:text-red-400">
              {error}
            </p>
          )}

          {mode === "signin" && (
            <div className="text-right">
              <button
                type="button"
                onClick={() =>
                  setNotice(
                    "本地账号密码重置功能即将上线，如需帮助请联系管理员",
                  )
                }
                className="text-primary/90 hover:text-primary text-sm transition-colors"
              >
                忘记密码?
              </button>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="bg-primary hover:bg-primary-hover w-full rounded-xl py-3 text-sm font-semibold text-white transition-colors disabled:opacity-60"
          >
            {loading ? "处理中…" : mode === "signin" ? "登录" : "创建并登录"}
          </button>
        </form>

        <div className="text-ink-fainter my-6 flex items-center gap-3 text-xs">
          <span className="bg-border h-px flex-1" />
          或使用
          <span className="bg-border h-px flex-1" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() =>
              setNotice("GitHub 第三方登录即将上线，当前请使用邮箱账号登录")
            }
            className="border-border-strong bg-subtle text-ink-soft hover:text-ink hover:border-ink-fainter rounded-xl border py-2.5 text-sm font-medium transition-colors"
          >
            GitHub
          </button>
          <button
            type="button"
            onClick={() =>
              setNotice("Google 第三方登录即将上线，当前请使用邮箱账号登录")
            }
            className="border-border-strong bg-subtle text-ink-soft hover:text-ink hover:border-ink-fainter rounded-xl border py-2.5 text-sm font-medium transition-colors"
          >
            Google
          </button>
        </div>

        <p className="text-ink-fainter mt-6 text-center text-xs">
          本地创作平台 · 模型与算力来自本机 ComfyUI
        </p>
      </div>
    </div>
  );
}

function Field({
  label,
  type,
  value,
  onChange,
  placeholder,
  autoComplete,
  right,
}: {
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoComplete?: string;
  right?: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-ink-soft mb-1.5 block text-sm font-medium">
        {label}
      </span>
      <div className="relative">
        <input
          type={type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          required
          className="border-border-strong bg-subtle text-ink placeholder:text-ink-fainter focus:border-primary/50 w-full rounded-xl border px-3.5 py-3 pr-11 text-sm focus:outline-none"
        />
        {right && (
          <div className="absolute top-1/2 right-1.5 -translate-y-1/2">
            {right}
          </div>
        )}
      </div>
    </label>
  );
}
