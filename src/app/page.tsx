import Link from "next/link";
import { Navbar } from "@/components/layout/navbar";

function BoltIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
      <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" />
    </svg>
  );
}

const FEATURES = [
  {
    title: "文生图 / 图生图",
    desc: "对接本机 ComfyUI，输入提示词即可生成高质量图像，支持局部重绘与高清放大。",
    icon: "🎨",
    href: "/workspace?tab=create",
  },
  {
    title: "一键成片",
    desc: "从剧本到成片：自动分镜、逐镜生视频、烧录字幕与 BGM 合成，一条龙产出。",
    icon: "🎬",
    href: "/workspace?tab=film",
  },
  {
    title: "工作流编辑器",
    desc: "可视化拖拽编排 ComfyUI 节点，导入你自己的 API 工作流，串联多节点创作。",
    icon: "🧩",
    href: "/workspace?tab=canvas",
  },
  {
    title: "LoRA 训练",
    desc: "上传数据集与触发词，本地训练专属风格 LoRA，训练产物可直接用于生图。",
    icon: "🔥",
    href: "/workspace?tab=train",
  },
  {
    title: "创作工坊",
    desc: "剧本 → 角色 → 分镜 三步走，配合本地 LLM 智能扩写与拆镜，灵感即刻落地。",
    icon: "✍️",
    href: "/workshop",
  },
  {
    title: "本地模型自由",
    desc: "统一管理 Checkpoint / LoRA / ControlNet，一键切换底模，发挥本机算力。",
    icon: "🗂️",
    href: "/workspace?tab=models",
  },
];

const WHY = [
  { title: "隐私安全", desc: "所有生成与训练都在本机完成，数据不出门。", icon: "🔒" },
  { title: "完全免费", desc: "无积分、无订阅，用你自己的显卡随意创作。", icon: "💸" },
  { title: "无限创作", desc: "不受云端额度限制，想生成多少就生成多少。", icon: "♾️" },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-bg text-ink">
      <Navbar />

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div
          className="pointer-events-none absolute -right-40 -top-40 h-[680px] w-[680px] rounded-full opacity-60 blur-[130px]"
          style={{ background: "radial-gradient(circle, rgba(124,92,252,0.40), transparent 70%)" }}
        />
        <div
          className="pointer-events-none absolute -left-32 top-40 h-[520px] w-[520px] rounded-full opacity-50 blur-[110px]"
          style={{ background: "radial-gradient(circle, rgba(255,92,168,0.18), transparent 70%)" }}
        />

        <div className="relative mx-auto grid max-w-[1200px] items-center gap-12 px-4 py-20 sm:px-6 lg:grid-cols-2 lg:py-28 lg:px-8">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
              <BoltIcon /> 基于 ComfyUI 的本地 AI 创作平台
            </span>
            <h1 className="mt-5 text-4xl font-bold leading-tight tracking-tight sm:text-5xl lg:text-6xl">
              在本地，用 <span className="text-primary">ComfyUI</span>
              <br /> 释放你的创作力
            </h1>
            <p className="mt-5 max-w-xl text-lg text-muted">
              文生图、图生图、视频成片、工作流编排与 LoRA 训练，全部跑在你自己的显卡上。
              免费、私密、无限创作。
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/workspace"
                className="rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
              >
                进入工作台
              </Link>
              <Link
                href="/workshop"
                className="rounded-xl border border-border bg-surface px-6 py-3 text-sm font-semibold transition-colors hover:bg-subtle"
              >
                体验创作工坊
              </Link>
            </div>

            <dl className="mt-12 grid max-w-md grid-cols-3 gap-6">
              {[
                ["6+", "创作能力"],
                ["100%", "本地运行"],
                ["0", "云端费用"],
              ].map(([k, v]) => (
                <div key={v}>
                  <dt className="text-2xl font-bold text-primary">{k}</dt>
                  <dd className="text-sm text-muted">{v}</dd>
                </div>
              ))}
            </dl>
          </div>

          {/* Preview card */}
          <div className="relative">
            <div className="rounded-2xl border border-border bg-surface/80 p-4 shadow-xl backdrop-blur">
              <div className="mb-3 flex items-center gap-2">
                <span className="h-3 w-3 rounded-full bg-[#FF5F57]" />
                <span className="h-3 w-3 rounded-full bg-[#FEBC2E]" />
                <span className="h-3 w-3 rounded-full bg-[#28C840]" />
                <span className="ml-2 text-xs text-muted">ComfyAPP · 工作台</span>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {[
                  "from-violet-500/70 to-fuchsia-500/40",
                  "from-sky-500/70 to-cyan-400/40",
                  "from-amber-400/70 to-rose-400/40",
                  "from-emerald-400/70 to-teal-400/40",
                  "from-indigo-500/70 to-purple-400/40",
                  "from-pink-500/70 to-orange-400/40",
                ].map((g, i) => (
                  <div
                    key={i}
                    className={`aspect-square rounded-xl bg-gradient-to-br ${g} flex items-end p-2`}
                  >
                    <span className="text-[10px] font-medium text-white/80">作品 {i + 1}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="absolute -bottom-6 -left-6 hidden rounded-xl border border-border bg-surface px-4 py-3 text-sm shadow-lg sm:block">
              ⚡ GPU 采样 · 实时进度
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-[1200px] px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight">一个平台，覆盖全部创作链路</h2>
          <p className="mt-3 text-muted">从灵感草图到成片与专属模型，无需离开浏览器。</p>
        </div>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <Link
              key={f.title}
              href={f.href}
              className="group block rounded-2xl border border-border bg-surface p-6 transition-colors hover:border-primary/40"
            >
              <div className="mb-4 grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-xl">
                {f.icon}
              </div>
              <h3 className="text-lg font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{f.desc}</p>
              <span className="mt-3 inline-block text-xs font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
                打开 →
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* Why local */}
      <section className="border-y border-border bg-subtle">
        <div className="mx-auto max-w-[1200px] px-4 py-16 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight">为什么选择本地创作</h2>
          </div>
          <div className="mt-12 grid gap-6 sm:grid-cols-3">
            {WHY.map((w) => (
              <div key={w.title} className="text-center">
                <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-primary/10 text-2xl">
                  {w.icon}
                </div>
                <h3 className="text-lg font-semibold">{w.title}</h3>
                <p className="mt-2 text-sm text-muted">{w.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6 lg:px-8">
        <div className="relative overflow-hidden rounded-3xl border border-primary/30 bg-gradient-to-br from-primary/15 to-accent/10 px-8 py-14 text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            现在就开始你的本地创作
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-muted">
            无需注册即可体验，登录后可同步你的作品、工作流与训练任务。
          </p>
          <div className="mt-8 flex justify-center gap-3">
            <Link
              href="/workspace"
              className="rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
            >
              进入工作台
            </Link>
            <Link
              href="/login"
              className="rounded-xl border border-border bg-surface px-6 py-3 text-sm font-semibold transition-colors hover:bg-subtle"
            >
              登录 / 注册
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-[1200px] flex-col items-start justify-between gap-4 px-4 py-10 text-sm text-muted sm:flex-row sm:items-center sm:px-6 lg:px-8">
          <p>Comfy-APP · 基于 ComfyUI 的本地 AI 创作平台</p>
          <p>仅供本地创作使用 · 模型与算力来自本机 ComfyUI</p>
        </div>
      </footer>
    </div>
  );
}
