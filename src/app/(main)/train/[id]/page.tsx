"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

type TrainLogEntry = { t: number; level: string; msg: string };
type TrainJob = {
  id: string;
  name: string;
  baseModel: string;
  triggerWord: string;
  classWord: string | null;
  datasetImages: { name: string; caption?: string }[];
  resolution: number;
  steps: number;
  batchSize: number;
  learningRate: number;
  rankDim: number;
  networkAlpha: number;
  optimizer: string;
  scheduler: string;
  seed: number;
  status: "QUEUED" | "RUNNING" | "DONE" | "FAILED" | "CANCELLED";
  progress: number;
  outputName: string | null;
  logs: TrainLogEntry[] | null;
  error: string | null;
  createdAt: string;
};

const STATUS_META: Record<string, { label: string; cls: string }> = {
  QUEUED: { label: "等待中", cls: "text-gray-300 bg-white/10" },
  RUNNING: { label: "训练中", cls: "text-violet-300 bg-violet-500/15" },
  DONE: { label: "已完成", cls: "text-emerald-300 bg-emerald-500/15" },
  FAILED: { label: "失败", cls: "text-red-300 bg-red-500/15" },
  CANCELLED: { label: "已取消", cls: "text-amber-300 bg-amber-500/15" },
};

export default function TrainDetail() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : Array.isArray(params.id) ? (params.id[0] ?? "") : "";

  const [job, setJob] = useState<TrainJob | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(() => {
    if (!id) return;
    fetch(`/api/train/${id}`)
      .then((r) => {
        if (r.status === 404) {
          setNotFound(true);
          return null;
        }
        return r.json();
      })
      .then((d) => {
        if (d?.job) setJob(d.job);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  const ringProgress = job ? job.progress : 0;
  const ringSteps = job ? Math.round((job.progress / 100) * job.steps) : 0;
  const RING_R = 44;
  const RING_C = 2 * Math.PI * RING_R;

  // Illustrative loss curve (mirrors the studio monitor).
  const lossGeo = useMemo(() => {
    const W = 320, H = 120, pad = 12, n = 26;
    const train: string[] = [];
    const val: string[] = [];
    for (let i = 0; i < n; i++) {
      const x = i / (n - 1);
      const base = 1.0 - 0.82 * Math.pow(x, 0.62);
      const noise = Math.sin(i * 1.7) * 0.018 + Math.cos(i * 0.9) * 0.012;
      const ty = Math.max(0.02, base + noise);
      const vy = Math.max(0.04, base * 0.96 + 0.06 + noise * 0.6);
      const px = pad + x * (W - 2 * pad);
      const pty = H - pad - ty * (H - 2 * pad);
      const pvy = H - pad - vy * (H - 2 * pad);
      train.push(`${i === 0 ? "M" : "L"}${px.toFixed(1)} ${pty.toFixed(1)}`);
      val.push(`${i === 0 ? "M" : "L"}${px.toFixed(1)} ${pvy.toFixed(1)}`);
    }
    return { W, H, train: train.join(" "), val: val.join(" ") };
  }, []);

  async function cancel() {
    if (!id) return;
    setCancelling(true);
    try {
      await fetch(`/api/train/${id}/cancel`, { method: "POST" });
      load();
    } finally {
      setCancelling(false);
    }
  }

  if (notFound) {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-[#0a0a0f] text-gray-400">
        <p className="mb-3 text-lg">训练任务不存在或已被删除</p>
        <Link href="/workspace?tab=train" className="rounded-lg bg-violet-500/90 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500">
          返回训练工作室
        </Link>
      </div>
    );
  }

  if (loading && !job) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#0a0a0f] text-gray-500">
        加载中…
      </div>
    );
  }

  if (!job) return null;

  const sm = STATUS_META[job.status] ?? STATUS_META.QUEUED;
  const logs = job.logs ?? [];

  const params_list: [string, string][] = [
    ["底模（Checkpoint）", job.baseModel],
    ["触发词", job.triggerWord],
    ["类别词", job.classWord || "—"],
    ["分辨率", `${job.resolution} px`],
    ["训练步数", String(job.steps)],
    ["批次大小", String(job.batchSize)],
    ["学习率", String(job.learningRate)],
    ["LoRA 维度 (rank)", String(job.rankDim)],
    ["Alpha", String(job.networkAlpha)],
    ["优化器", job.optimizer],
    ["调度器", job.scheduler],
    ["随机种子", String(job.seed)],
  ];

  return (
    <div
      className="min-h-screen w-full overflow-y-auto bg-[#0a0a0f]"
      style={{ fontFamily: 'Inter, "Noto Sans SC", system-ui, -apple-system, sans-serif' }}
    >
      {/* Aurora blobs */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
        <div
          className="absolute -right-[10%] -top-[20%] h-[70%] w-[55%] rounded-full opacity-50 mix-blend-screen"
          style={{ background: "radial-gradient(circle, rgba(139,92,246,0.40) 0%, rgba(139,92,246,0) 70%)" }}
        />
        <div
          className="absolute -left-[15%] bottom-[15%] h-[55%] w-[45%] rounded-full opacity-50 mix-blend-screen"
          style={{ background: "radial-gradient(circle, rgba(34,211,238,0.26) 0%, rgba(34,211,238,0) 70%)" }}
        />
      </div>

      <div className="relative z-10 mx-auto max-w-[1100px] px-6 py-8">
        {/* Header */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link href="/workspace?tab=train" className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-white/5 hover:text-gray-100" title="返回训练工作室">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
            </Link>
            <div>
              <h1 className="font-title text-xl font-bold text-gray-100">{job.name}</h1>
              <p className="mt-0.5 text-xs text-gray-500">LoRA 训练任务详情</p>
            </div>
            <span className={`ml-1 rounded-md px-2 py-0.5 text-[11px] font-medium ${sm.cls}`}>{sm.label}</span>
          </div>

          <div className="flex items-center gap-2">
            {(job.status === "QUEUED" || job.status === "RUNNING") && (
              <button
                onClick={cancel}
                disabled={cancelling}
                className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-gray-300 transition-colors hover:bg-white/5 hover:text-red-300 disabled:opacity-50"
              >
                {cancelling ? "取消中…" : "取消训练"}
              </button>
            )}
            <Link href="/workspace?tab=train" className="rounded-lg bg-violet-500/90 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-violet-500">
              返回训练工作室
            </Link>
          </div>
        </div>

        {/* Progress + metrics */}
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
          <div className="flex items-center gap-6">
            <div className="relative shrink-0" style={{ width: 112, height: 112 }}>
              <svg width="112" height="112" viewBox="0 0 112 112">
                <circle cx="56" cy="56" r={RING_R} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="9" />
                <circle
                  cx="56"
                  cy="56"
                  r={RING_R}
                  fill="none"
                  stroke="url(#trainRing2)"
                  strokeWidth="9"
                  strokeLinecap="round"
                  strokeDasharray={RING_C}
                  strokeDashoffset={RING_C * (1 - ringProgress / 100)}
                  transform="rotate(-90 56 56)"
                  style={{ transition: "stroke-dashoffset 0.5s ease" }}
                />
                <defs>
                  <linearGradient id="trainRing2" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#8B5CF6" />
                    <stop offset="100%" stopColor="#22d3ee" />
                  </linearGradient>
                </defs>
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-xl font-semibold text-[#e5e7eb]">{ringProgress}%</span>
                <span className="text-[10px] text-[#6b7088]">进度</span>
              </div>
            </div>

            <div className="grid min-w-0 flex-1 grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-3">
              <div>
                <p className="text-[10px] text-[#6b7088]">当前步数</p>
                <p className="truncate text-[13px] font-medium text-[#e5e7eb]">{ringSteps} / {job.steps}</p>
              </div>
              <div>
                <p className="text-[10px] text-[#6b7088]">触发词</p>
                <p className="truncate text-[13px] font-medium text-violet-300">{job.triggerWord}</p>
              </div>
              <div>
                <p className="text-[10px] text-[#6b7088]">数据集</p>
                <p className="truncate text-[13px] font-medium text-[#e5e7eb]">{job.datasetImages?.length ?? 0} 张图</p>
              </div>
              <div className="col-span-2 min-w-0 sm:col-span-3">
                <p className="text-[10px] text-[#6b7088]">底模</p>
                <p className="truncate text-[13px] font-medium text-[#e5e7eb]">{job.baseModel}</p>
              </div>
            </div>
          </div>

          <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-violet-500 to-cyan-400 transition-all"
              style={{ width: `${ringProgress}%` }}
            />
          </div>
        </div>

        {/* Loss curve (illustrative) */}
        <div className="mt-4 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[12px] font-medium text-[#e5e7eb]">Loss 曲线 <span className="text-[10px] text-gray-600">（示意）</span></span>
            <div className="flex items-center gap-3 text-[10px] text-[#6b7088]">
              <span className="flex items-center gap-1"><span className="inline-block h-[2px] w-3 bg-violet-400" />训练</span>
              <span className="flex items-center gap-1"><span className="inline-block h-[2px] w-3 bg-cyan-400" />验证</span>
            </div>
          </div>
          <svg width="100%" viewBox={`0 0 ${lossGeo.W} ${lossGeo.H}`} preserveAspectRatio="none" className="h-[120px] w-full">
            {[0.25, 0.5, 0.75].map((g) => (
              <line key={g} x1="12" x2={lossGeo.W - 12} y1={12 + g * (lossGeo.H - 24)} y2={12 + g * (lossGeo.H - 24)} stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
            ))}
            <path d={lossGeo.val} fill="none" stroke="#22d3ee" strokeOpacity="0.55" strokeWidth="1.5" strokeLinejoin="round" />
            <path d={lossGeo.train} fill="none" stroke="#a78bfa" strokeWidth="2" strokeLinejoin="round" />
          </svg>
        </div>

        {/* Two-column: dataset + params/artifacts */}
        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_340px]">
          {/* Dataset gallery */}
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
            <h2 className="mb-3 text-[13px] font-semibold text-[#e5e7eb]">训练数据集 · {job.datasetImages?.length ?? 0} 张</h2>
            {!job.datasetImages || job.datasetImages.length === 0 ? (
              <p className="text-sm text-gray-500">无数据集</p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {job.datasetImages.map((d, i) => (
                  <div key={i} className="overflow-hidden rounded-xl border border-white/[0.06] bg-black/20">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/file/${encodeURIComponent(d.name)}`}
                      alt={d.name}
                      className="aspect-square w-full object-cover"
                      onError={(e) => ((e.target as HTMLImageElement).style.visibility = "hidden")}
                    />
                    <p className="truncate px-2 py-1.5 text-[10px] text-gray-400" title={d.caption || ""}>
                      {d.caption?.trim() ? d.caption : "（无 caption）"}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Parameters + artifacts */}
          <div className="space-y-4">
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
              <h2 className="mb-3 text-[13px] font-semibold text-[#e5e7eb]">超参数</h2>
              <dl className="space-y-2.5 text-[12px]">
                {params_list.map(([k, v]) => (
                  <div key={k} className="flex items-start justify-between gap-3">
                    <dt className="shrink-0 text-[#6b7088]">{k}</dt>
                    <dd className="min-w-0 truncate text-right text-[#e5e7eb]">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>

            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
              <h2 className="mb-3 text-[13px] font-semibold text-[#e5e7eb]">产物 / 状态</h2>
              {job.status === "DONE" && job.outputName && (
                <p className="text-[12px] text-emerald-300">
                  ✓ 已产出 LoRA：<span className="font-mono">{job.outputName}</span>
                  <br />
                  <span className="text-gray-500">已加入模型库，可在创作台 LoRA 中选择使用。</span>
                </p>
              )}
              {job.status === "FAILED" && (
                <p className="text-[12px] text-red-300">✗ {job.error || "训练失败"}</p>
              )}
              {job.status === "CANCELLED" && <p className="text-[12px] text-amber-300">训练已取消。</p>}
              {(job.status === "QUEUED" || job.status === "RUNNING") && (
                <p className="text-[12px] text-gray-400">训练进行中，完成后此处显示产出的 LoRA 文件。</p>
              )}
            </div>
          </div>
        </div>

        {/* Logs */}
        <section className="mt-4 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
          <h2 className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-[#e5e7eb]">
            <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
            训练日志
          </h2>
          <div className="max-h-80 overflow-y-auto rounded-xl border border-white/[0.06] bg-black/30 p-3 font-mono text-[11px] leading-relaxed">
            {logs.length === 0 ? (
              <p className="text-gray-600">暂无日志</p>
            ) : (
              logs.map((l, i) => (
                <div
                  key={i}
                  className={
                    l.level === "error"
                      ? "text-red-400"
                      : l.level === "success"
                      ? "text-emerald-400"
                      : l.level === "warn"
                      ? "text-amber-400"
                      : l.level === "progress"
                      ? "text-violet-300"
                      : "text-gray-400"
                  }
                >
                  {l.msg}
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
