"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authClient } from "~/server/better-auth/client";
import { Icon } from "@/components/ui/Icon";

type Mode = "signin" | "register";

function BoltIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
      <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" />
    </svg>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
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
          mode === "register" ? "注册成功，但自动登录失败，请重试" : "邮箱或密码错误",
        );
        setLoading(false);
        return;
      }

      const params = new URLSearchParams(window.location.search);
      const callback = params.get("callbackUrl") || "/workspace";
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
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#030014] px-4 py-10">
      {/* Aurora glows */}
      <div
        className="pointer-events-none absolute -right-32 -top-40 h-[640px] w-[640px] rounded-full opacity-70 blur-[120px]"
        style={{ background: "radial-gradient(circle, rgba(124,92,252,0.45), transparent 70%)" }}
      />
      <div
        className="pointer-events-none absolute -bottom-40 -left-32 h-[560px] w-[560px] rounded-full opacity-60 blur-[110px]"
        style={{ background: "radial-gradient(circle, rgba(46,167,255,0.25), transparent 70%)" }}
      />
      <div
        className="pointer-events-none absolute left-1/2 top-1/3 h-[360px] w-[360px] rounded-full opacity-40 blur-[90px]"
        style={{ background: "radial-gradient(circle, rgba(19,221,196,0.16), transparent 70%)" }}
      />

      <div className="relative w-full max-w-[440px] rounded-[20px] border border-white/10 bg-white/[0.03] p-9 shadow-[0_8px_40px_rgba(0,0,0,0.4)] backdrop-blur-xl">
        {/* Brand */}
        <Link href="/" className="mb-7 flex items-center justify-center gap-2 font-semibold">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-white">
            <BoltIcon />
          </span>
          <span className="text-xl tracking-tight text-white">
            Comfy<span className="text-primary">APP</span>
          </span>
        </Link>

        {/* Tab switcher */}
        <div className="mb-6 flex rounded-xl bg-white/5 p-1">
          <button
            type="button"
            onClick={() => switchMode("signin")}
            className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
              mode === "signin" ? "bg-primary/25 text-white" : "text-white/45"
            }`}
          >
            登录
          </button>
          <button
            type="button"
            onClick={() => switchMode("register")}
            className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
              mode === "register" ? "bg-primary/25 text-white" : "text-white/45"
            }`}
          >
            创建账号
          </button>
        </div>

        <p className="mb-6 text-center text-sm text-white/50">
          {mode === "signin"
            ? "登录以同步你的作品、工作流与训练任务"
            : "创建一个本地账号，开启你的 AI 创作"}
        </p>

        {notice && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-2.5 text-sm text-violet-200">
            <Icon name="info" size={15} className="mt-0.5 shrink-0 text-violet-300" />
            <span className="flex-1 leading-relaxed">{notice}</span>
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="text-violet-300/70 transition-colors hover:text-white"
              aria-label="关闭提示"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
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
            type="password"
            value={password}
            onChange={setPassword}
            placeholder={mode === "register" ? "至少 8 位" : "请输入密码"}
            autoComplete={mode === "register" ? "new-password" : "current-password"}
          />

          {error && (
            <p className="rounded-lg bg-[#FF4D6D]/10 px-3 py-2 text-center text-sm text-[#FF4D6D]">
              {error}
            </p>
          )}

          {mode === "signin" && (
            <div className="text-right">
              <button
                type="button"
                onClick={() => setNotice("本地账号密码重置功能即将上线，如需帮助请联系管理员")}
                className="text-sm text-primary/90 transition-colors hover:text-primary"
              >
                忘记密码?
              </button>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:opacity-60"
          >
            {loading ? "处理中…" : mode === "signin" ? "登录" : "创建并登录"}
          </button>
        </form>

        <div className="my-6 flex items-center gap-3 text-xs text-white/30">
          <span className="h-px flex-1 bg-white/10" />
          或使用
          <span className="h-px flex-1 bg-white/10" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setNotice("GitHub 第三方登录即将上线，当前请使用邮箱账号登录")}
            className="rounded-xl border border-white/10 bg-white/5 py-2.5 text-sm font-medium text-white/70 transition-colors hover:text-white"
          >
            GitHub
          </button>
          <button
            type="button"
            onClick={() => setNotice("Google 第三方登录即将上线，当前请使用邮箱账号登录")}
            className="rounded-xl border border-white/10 bg-white/5 py-2.5 text-sm font-medium text-white/70 transition-colors hover:text-white"
          >
            Google
          </button>
        </div>

        <p className="mt-6 text-center text-xs text-white/30">
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
}: {
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoComplete?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-white/65">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required
        className="w-full rounded-xl border border-white/10 bg-white/5 px-3.5 py-3 text-sm text-white placeholder:text-white/30 focus:border-primary/50 focus:outline-none"
      />
    </label>
  );
}
