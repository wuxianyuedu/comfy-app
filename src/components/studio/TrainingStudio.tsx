"use client";

import React, { useCallback, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { DarkSelect } from "@/components/studio/ui/DarkSelect";
import { NumberField } from "@/components/studio/ui/NumberField";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { useTrainingStudio } from "./hooks/use-training-studio";
import {
  OPTIMIZERS,
  RESOLUTIONS,
  SCHEDULERS,
  buildLossGeometry,
  statusMeta,
} from "./training-studio-config";

/* ── Layout (within WorkspaceNav parent shell) ──
  ┌─────────────────────────────────────────────────────────────┐
  │ Top Toolbar: [LoRA 训练工作室] … [后端状态] … [开始训练]     │
  ├─────────────┬───────────────────────────────┬───────────────┤
  │ 数据集       │  训练监控                      │  超参数        │
  │ (300px)      │  · 进度环 + 指标              │  (320px)       │
  │ · 后端横幅    │  · 紫色进度条                 │  名称/底模/触发 │
  │ · 上传区      │  · Loss 曲线 SVG             │  类别词/分辨率  │
  │ · 逐图caption │  · 任务列表                  │  4 滑块 + lr    │
  │              │                               │  优化器/调度器  │
  │              │                               │  种子 + 开始    │
  ├─────────────────────────────────────────────────────────────┤
  │ Status Bar: ● ComfyUI·Kohya 就绪 · 本地算力 · 零授权          │
  └─────────────────────────────────────────────────────────────┘
*/

const fieldClass =
  "h-9 w-full rounded-lg border border-(--color-border) bg-(--color-subtle) px-3 text-[13px] text-(--color-ink-field) outline-none transition-colors focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/20";
const labelClass = "mb-1.5 block text-[11px] font-medium text-(--color-ink-faint)";

const RING_R = 36;
const RING_C = 2 * Math.PI * RING_R;

/**
 * LoRA 训练工作室 —— 视图层（规范 17 §17.2 第③层）。
 * 轮询、表单校验、数据集上传与任务创建在 hooks/use-training-studio.ts +
 * lib/dataset-upload-client.ts，类型与派生计算在 training-studio-config.ts。
 * 本文件只做渲染与上抛事件；对外导出名与组件签名保持不变，消费方零改动。
 */
export interface TrainingStudioProps {
  /** workspace 内触发设置 overlay；缺省时保留 Link 跳转行为。 */
  onOpenSettings?: () => void;
}

export function TrainingStudio({ onOpenSettings }: TrainingStudioProps = {}) {
  const router = useRouter();
  const c = useTrainingStudio();

  /* 日志展开态、隐藏 file input 的引用：纯视觉/平台状态，留在视图层 */
  const [expanded, setExpanded] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const onUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      await c.upload(e.target.files);
      // 无论成功与否都复位：否则连选同一个文件第二次不会触发 change
      if (fileRef.current) fileRef.current.value = "";
    },
    [c],
  );

  /* ── 监控卡派生（纯视觉计算）── */
  const activeJob = c.activeJob;
  const ringProgress = activeJob ? activeJob.progress : 0;
  const ringSteps = activeJob ? Math.round((activeJob.progress / 100) * activeJob.steps) : 0;
  const lossGeo = buildLossGeometry();

  return (
    <div
      className="flex h-full w-full flex-col overflow-hidden bg-(--color-canvas)"
      style={{ fontFamily: "var(--font-sans)" }}
    >
      {/* ── Aurora Background Blobs ───────────────── */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <div
          className="absolute right-[-10%] top-[-20%] h-[70%] w-[55%] rounded-full opacity-10 mix-blend-normal dark:opacity-50 dark:mix-blend-screen"
          style={{ background: "radial-gradient(circle, rgba(139,92,246,0.40) 0%, rgba(139,92,246,0) 70%)" }}
        />
        <div
          className="absolute left-[-15%] bottom-[15%] h-[55%] w-[45%] rounded-full opacity-10 mix-blend-normal dark:opacity-50 dark:mix-blend-screen"
          style={{ background: "radial-gradient(circle, rgba(34,211,238,0.26) 0%, rgba(34,211,238,0) 70%)" }}
        />
      </div>

      {/* ── Top Toolbar ───────────────────────────── */}
      <header className="relative z-10 flex h-12 shrink-0 items-center gap-3 border-b border-(--color-border-subtle) bg-(--color-panel)/88 px-4 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <span className="u-title">LoRA 训练工作室</span>
          <span className="text-xs text-(--color-ink-fainter)">· 炼丹</span>
        </div>

        {/* Backend status pill */}
        <div
          className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] ${
            c.backendConfigured ? "bg-emerald-500/12 text-emerald-600" : "bg-amber-500/12 text-amber-600"
          }`}
        >
          <span
            className={`inline-block h-[7px] w-[7px] rounded-full ${
              c.backendConfigured ? "bg-emerald-400 shadow-sm shadow-emerald-400/40" : "bg-amber-400 shadow-sm shadow-amber-400/40"
            }`}
          />
          {c.backendConfigured ? "训练后端已就绪" : "训练后端未配置"}
        </div>

        <div className="flex-1" />

        {/* Primary action (mirrors the form submit) */}
        <button
          type="button"
          onClick={() => void c.submit()}
          disabled={c.submitting || c.uploading}
          className="flex items-center gap-1.5 rounded-lg bg-violet-500 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-violet-400 disabled:opacity-50"
        >
          {c.submitting ? "提交中…" : "开始训练"}
        </button>
      </header>

      {/* ── Three-Column Body ─────────────────────── */}
      <div className="relative z-10 flex min-h-0 flex-1 overflow-hidden">

        {/* ═══ Left: Dataset Panel (300px) ═══ */}
        <aside className="flex w-[300px] shrink-0 flex-col border-r border-(--color-border-subtle) bg-(--color-panel-deep)/85 backdrop-blur-sm">
          <div className="flex h-11 items-center justify-between border-b border-(--color-border-subtle) px-4">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-semibold text-(--color-ink-field)">数据集</span>
              <span className="text-[11px] text-(--color-ink-fainter)">{c.dataset.length} 张</span>
            </div>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {/* Backend not configured banner */}
            {!c.backendConfigured && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-[11px] leading-relaxed text-amber-600">
                <p className="mb-1 font-semibold">未配置训练后端</p>
                {onOpenSettings ? (
                  <>在「<button type="button" onClick={onOpenSettings} className="underline hover:opacity-80">设置 → 偏好</button>」中填写训练后端 URL（如 Kohya / OneTrainer / ComfyUI 训练节点的 HTTP 地址）后，即可开始真实训练。当前提交的任务会保持「等待中」。</>
                ) : (
                  <>在「<Link href="/settings" className="underline">设置 → 偏好</Link>」中填写训练后端 URL（如 Kohya / OneTrainer / ComfyUI 训练节点的 HTTP 地址）后，即可开始真实训练。当前提交的任务会保持「等待中」。</>
                )}
              </div>
            )}

            {/* Upload zone */}
            <div
              onClick={() => fileRef.current?.click()}
              className="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-violet-500/35 bg-violet-500/6 px-3 py-5 text-center transition-colors hover:border-violet-500/55 hover:bg-violet-500/10"
            >
              <Upload size={22} strokeWidth={1.8} color="#a78bfa" />
              <p className="text-[12px] font-medium text-violet-500">{c.uploading ? "上传中…" : "点击或拖拽上传图片"}</p>
              <p className="text-[10px] text-(--color-ink-fainter)">建议 10–30 张同主题图片</p>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                onChange={onUpload}
                className="hidden"
              />
            </div>

            {/* Per-image caption editing */}
            {c.dataset.length > 0 && (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium text-(--color-ink-faint)">逐图 caption 标注</span>
                  <button
                    type="button"
                    onClick={c.fillBlank}
                    disabled={!c.form.triggerWord.trim()}
                    className="text-[10px] text-violet-600 hover:underline disabled:opacity-40"
                  >
                    用触发词填充空白
                  </button>
                </div>

                <div className="space-y-1.5">
                  {c.dataset.map((data, i) => (
                    <div key={data.name} className="flex items-center gap-2 rounded-md border border-(--color-border) bg-(--color-card) p-1.5">
                      <img
                        src={`/api/file/${encodeURIComponent(data.name)}`}
                        alt={data.name}
                        className="h-9 w-9 shrink-0 rounded object-cover"
                        onError={(event) => ((event.target as HTMLImageElement).style.visibility = "hidden")}
                      />
                      <input
                        value={data.caption}
                        onChange={(event) => c.setDataset((prev) => prev.map((item, j) => (j === i ? { ...item, caption: event.target.value } : item)))}
                        placeholder="图片描述，如：a photo of somecjkstyle person"
                        className="min-w-0 flex-1 rounded border border-(--color-border) bg-black/20 px-2 py-1 text-[11px] text-(--color-ink-bright) outline-none focus:border-violet-500/40"
                      />
                      <button
                        onClick={() => c.setDataset((prev) => prev.filter((_, j) => j !== i))}
                        className="shrink-0 rounded px-1.5 text-[11px] text-(--color-ink-faint) hover:text-red-600"
                        aria-label="移除"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] leading-relaxed text-(--color-ink-faintest)">
                  文件名与 caption 会随任务一起提交给训练后端；留空则默认使用触发词。
                </p>
              </>
            )}
          </div>
        </aside>

        {/* ═══ Center: Training Monitor ═══ */}
        <main className="flex min-w-0 flex-1 flex-col overflow-y-auto p-5">
          <div className="mb-4 flex items-center gap-2">
            <span className="text-[13px] font-semibold text-(--color-ink-field)">训练监控</span>
            {activeJob && (
              <span className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${statusMeta(activeJob.status).cls}`}>
                {statusMeta(activeJob.status).label}
              </span>
            )}
          </div>

          {/* Progress ring + metrics card */}
          <div className="rounded-2xl border border-(--color-border-subtle) bg-(--color-card) p-4">
            <div className="flex items-center gap-5">
              {/* Ring */}
              <div className="relative shrink-0" style={{ width: 96, height: 96 }}>
                <svg width="96" height="96" viewBox="0 0 96 96">
                  <circle cx="48" cy="48" r={RING_R} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="8" />
                  <circle
                    cx="48"
                    cy="48"
                    r={RING_R}
                    fill="none"
                    stroke="url(#trainRing)"
                    strokeWidth="8"
                    strokeLinecap="round"
                    strokeDasharray={RING_C}
                    strokeDashoffset={RING_C * (1 - ringProgress / 100)}
                    transform="rotate(-90 48 48)"
                    style={{ transition: "stroke-dashoffset 0.5s ease" }}
                  />
                  <defs>
                    <linearGradient id="trainRing" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor="#8B5CF6" />
                      <stop offset="100%" stopColor="#22d3ee" />
                    </linearGradient>
                  </defs>
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-lg font-semibold text-(--color-ink-field)">{ringProgress}%</span>
                  <span className="text-[10px] text-(--color-ink-fainter)">进度</span>
                </div>
              </div>

              {/* Metrics */}
              <div className="grid min-w-0 flex-1 grid-cols-2 gap-x-4 gap-y-3">
                <div>
                  <p className="text-[10px] text-(--color-ink-fainter)">当前步数</p>
                  <p className="truncate text-[13px] font-medium text-(--color-ink-field)">{ringSteps} / {activeJob?.steps ?? 0}</p>
                </div>
                <div>
                  <p className="text-[10px] text-(--color-ink-fainter)">触发词</p>
                  <p className="truncate text-[13px] font-medium text-violet-600">{activeJob?.triggerWord ?? "—"}</p>
                </div>
                <div className="col-span-2 min-w-0">
                  <p className="text-[10px] text-(--color-ink-fainter)">底模</p>
                  <p className="truncate text-[13px] font-medium text-(--color-ink-field)">{activeJob?.baseModel ?? "—"}</p>
                </div>
              </div>
            </div>

            {/* Progress bar */}
            <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-(--color-surface-2)">
              <div
                className="h-full rounded-full bg-linear-to-r from-violet-500 to-cyan-400 transition-all"
                style={{ width: `${ringProgress}%` }}
              />
            </div>
          </div>

          {/* Loss curve card */}
          <div className="mt-4 rounded-2xl border border-(--color-border-subtle) bg-(--color-card) p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-[12px] font-medium text-(--color-ink-field)">Loss 曲线</span>
              <div className="flex items-center gap-3 text-[10px] text-(--color-ink-fainter)">
                <span className="flex items-center gap-1"><span className="inline-block h-[2px] w-3 bg-violet-400" />训练</span>
                <span className="flex items-center gap-1"><span className="inline-block h-[2px] w-3 bg-cyan-400" />验证</span>
              </div>
            </div>
            <svg width="100%" viewBox={`0 0 ${lossGeo.W} ${lossGeo.H}`} preserveAspectRatio="none" className="h-[120px] w-full">
              {/* horizontal gridlines */}
              {[0.25, 0.5, 0.75].map((gain) => (
                <line key={gain} x1="12" x2={lossGeo.W - 12} y1={12 + gain * (lossGeo.H - 24)} y2={12 + gain * (lossGeo.H - 24)} stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
              ))}
              <path d={lossGeo.val} fill="none" stroke="#22d3ee" strokeOpacity="0.55" strokeWidth="1.5" strokeLinejoin="round" />
              <path d={lossGeo.train} fill="none" stroke="#a78bfa" strokeWidth="2" strokeLinejoin="round" />
            </svg>
          </div>

          {/* Job list */}
          <div className="mt-4">
            <h3 className="mb-3 text-[12px] font-medium text-(--color-ink-faint)">训练任务</h3>
            {c.jobs.length === 0 ? (
              <div className="grid min-h-[160px] place-items-center rounded-2xl border border-dashed border-(--color-border) text-(--color-ink-muted)">
                <p className="text-sm">还没有训练任务。在右侧配置并点击「开始训练」。</p>
              </div>
            ) : (
              <div className="space-y-3">
                {c.jobs.map((job) => {
                  const sm = statusMeta(job.status);
                  const logs = job.logs ?? [];
                  const isOpen = expanded === job.id;
                  return (
                    <div key={job.id} className="rounded-2xl border border-(--color-border-subtle) bg-(--color-card) p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <h4 className="u-title truncate">{job.name}</h4>
                            <span className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${sm.cls}`}>{sm.label}</span>
                          </div>
                          <p className="mt-1 text-[11px] text-(--color-ink-muted)">
                            {job.baseModel} · 触发词 <span className="text-violet-600">{job.triggerWord}</span> · {job.datasetImages?.length ?? 0} 张图 · {job.steps} 步
                          </p>
                        </div>
                        <div className="flex shrink-0 gap-2">
                          <button
                            onClick={() => router.push(`/train/${job.id}`)}
                            className="rounded-lg border border-violet-500/30 bg-violet-500/10 px-2.5 py-1 text-[11px] text-violet-600 hover:bg-violet-500/20"
                          >
                            详情 ↗
                          </button>
                          {(job.status === "QUEUED" || job.status === "RUNNING") && (
                            <button onClick={() => void c.cancelJob(job.id)} className="rounded-lg border border-(--color-border) px-2.5 py-1 text-[11px] text-(--color-ink-strong) hover:bg-(--color-subtle)">
                              取消
                            </button>
                          )}
                          <button onClick={() => setExpanded(isOpen ? null : job.id)} className="rounded-lg border border-(--color-border) px-2.5 py-1 text-[11px] text-(--color-ink-strong) hover:bg-(--color-subtle)">
                            {isOpen ? "收起" : "日志"}
                          </button>
                        </div>
                      </div>

                      {(job.status === "RUNNING" || job.status === "QUEUED") && (
                        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-(--color-surface-2)">
                          <div className="h-full rounded-full bg-linear-to-r from-violet-500 to-cyan-400 transition-all" style={{ width: `${job.progress}%` }} />
                        </div>
                      )}

                      {job.status === "DONE" && job.outputName && (
                        <p className="mt-2 text-[11px] text-emerald-600">
                          ✓ 已产出 LoRA：<span className="font-mono">{job.outputName}</span> · 已加入模型库，可在创作台 LoRA 中选择使用。
                        </p>
                      )}
                      {job.status === "FAILED" && job.error && (
                        <p className="mt-2 text-[11px] text-red-600">✗ {job.error}</p>
                      )}
                      {job.status === "QUEUED" && !c.backendConfigured && (
                        <p className="mt-2 text-[11px] text-amber-600/80">等待训练后端（未配置 LORA_TRAINER_URL）。</p>
                      )}

                      {isOpen && (
                        <div className="mt-3 rounded-lg border border-(--color-border-subtle) bg-black/30 p-2.5 font-mono text-[11px] leading-relaxed">
                          {logs.length === 0 ? (
                            <p className="text-(--color-ink-fainter)">暂无日志</p>
                          ) : (
                            logs.map((log, i) => (
                              <div
                                key={`${log.t}-${i}`}
                                className={
                                  log.level === "error"
                                    ? "text-red-400"
                                    : log.level === "success"
                                    ? "text-emerald-400"
                                    : log.level === "warn"
                                    ? "text-amber-400"
                                    : log.level === "progress"
                                    ? "text-violet-600"
                                    : "text-(--color-ink-faint)"
                                }
                              >
                                {log.msg}
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </main>

        {/* ═══ Right: Hyperparameters (320px) ═══ */}
        <aside className="flex w-[320px] shrink-0 flex-col border-l border-(--color-border-subtle) bg-(--color-panel-deep)/85 backdrop-blur-sm">
          <div className="flex h-11 items-center border-b border-(--color-border-subtle) px-4">
            <span className="text-[13px] font-semibold text-(--color-ink-field)">超参数</span>
          </div>

          <div className="flex-1 space-y-3.5 overflow-y-auto p-4">
            <div>
              <label className={labelClass}>任务名称</label>
              <input value={c.form.name} onChange={(event) => c.setName(event.target.value)} placeholder="如：我的水墨风格" className={fieldClass} />
            </div>

            <div>
              <label className={labelClass}>底模（Checkpoint）</label>
              <DarkSelect
                className="!bg-(--color-subtle) !border-(--color-border) h-9 text-[13px] text-(--color-ink-field)"
                value={c.form.baseModel}
                onChange={c.setBaseModel}
                options={c.checkpoints.map((checkpoint) => checkpoint.fileName)}
                labels={Object.fromEntries(c.checkpoints.map((checkpoint) => [checkpoint.fileName, checkpoint.name]))}
                placeholder="请选择…"
              />
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className={labelClass}>触发词</label>
                <input value={c.form.triggerWord} onChange={(event) => c.setTriggerWord(event.target.value)} placeholder="如：somecjkstyle" className={fieldClass} />
              </div>
              <div>
                <label className={labelClass}>类别词（可选）</label>
                <input value={c.form.classWord ?? ""} onChange={(event) => c.setClassWord(event.target.value)} placeholder="person / style" className={fieldClass} />
              </div>
            </div>

            <div>
              <label className={labelClass}>分辨率</label>
              <DarkSelect
                className="!bg-(--color-subtle) !border-(--color-border) h-9 text-[13px] text-(--color-ink-field)"
                value={String(c.form.resolution)}
                onChange={(value) => c.setResolution(Number(value))}
                options={RESOLUTIONS.map(String)}
                placeholder="选择分辨率"
              />
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[11px] font-medium text-(--color-ink-faint)">训练步数</span>
                <span className="text-[11px] font-medium text-violet-600">{c.form.steps}</span>
              </div>
              <input type="range" min={500} max={4000} step={100} value={c.form.steps} onChange={(event) => c.setSteps(Number(event.target.value))} className="w-full accent-violet-500" />
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[11px] font-medium text-(--color-ink-faint)">批次大小</span>
                <span className="text-[11px] font-medium text-violet-600">{c.form.batchSize}</span>
              </div>
              <input type="range" min={1} max={8} value={c.form.batchSize} onChange={(event) => c.setBatchSize(Number(event.target.value))} className="w-full accent-violet-500" />
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[11px] font-medium text-(--color-ink-faint)">LoRA 维度 (rank)</span>
                <span className="text-[11px] font-medium text-violet-600">{c.form.rankDim}</span>
              </div>
              <input type="range" min={8} max={128} step={8} value={c.form.rankDim} onChange={(event) => c.setRankDim(Number(event.target.value))} className="w-full accent-violet-500" />
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[11px] font-medium text-(--color-ink-faint)">Alpha</span>
                <span className="text-[11px] font-medium text-violet-600">{c.form.networkAlpha}</span>
              </div>
              <input type="range" min={0} max={128} step={8} value={c.form.networkAlpha} onChange={(event) => c.setNetworkAlpha(Number(event.target.value))} className="w-full accent-violet-500" />
            </div>

            <div>
              <label className={labelClass}>学习率</label>
              <NumberField
                value={c.form.learningRate}
                onChange={c.setLearningRate}
                min={0}
                max={1}
                step={0.0001}
                decimalPlaces={4}
              />
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className={labelClass}>优化器</label>
                <DarkSelect
                  className="!bg-(--color-subtle) !border-(--color-border) h-9 text-[13px] text-(--color-ink-field)"
                  value={c.form.optimizer}
                  onChange={c.setOptimizer}
                  options={OPTIMIZERS}
                  placeholder="选择优化器"
                />
              </div>
              <div>
                <label className={labelClass}>调度器</label>
                <DarkSelect
                  className="!bg-(--color-subtle) !border-(--color-border) h-9 text-[13px] text-(--color-ink-field)"
                  value={c.form.scheduler}
                  onChange={c.setScheduler}
                  options={SCHEDULERS}
                  placeholder="选择调度器"
                />
              </div>
            </div>

            <div>
              <label className={labelClass}>随机种子</label>
              <NumberField value={c.form.seed} onChange={c.setSeed} min={0} max={999999} step={1} />
            </div>

            {c.error && <p className="text-xs text-red-400">{c.error}</p>}

            <button
              onClick={() => void c.submit()}
              disabled={c.submitting || c.uploading}
              className="w-full rounded-xl bg-violet-500 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-violet-400 disabled:opacity-50"
            >
              {c.submitting ? "提交中…" : "开始训练"}
            </button>
            <p className="text-center text-[10px] leading-relaxed text-(--color-ink-faintest)">
              全部在本机运行 · 无需登录 · 零授权
            </p>
          </div>
        </aside>
      </div>

      {/* ── Status Bar ────────────────────────────── */}
      <footer className="relative z-10 flex h-6 shrink-0 items-center justify-center gap-2 border-t border-(--color-border-subtle) bg-(--color-panel-deep)/95 backdrop-blur-sm">
        <span className="inline-block h-[7px] w-[7px] rounded-full bg-emerald-400 shadow-sm shadow-emerald-400/40" />
        <span className="text-[11px] text-(--color-ink-muted)">
          ComfyUI·Kohya 就绪 · 本地算力 · 零授权
        </span>
      </footer>
    </div>
  );
}
