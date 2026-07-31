"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";

type ModelOpt = { id: string; fileName: string; name: string };
type TrainLogEntry = { t: number; level: string; msg: string };
type TrainJob = {
  id: string;
  name: string;
  baseModel: string;
  triggerWord: string;
  classWord: string | null;
  datasetImages: { name: string }[];
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

const OPTIMIZERS = ["AdamW8bit", "AdamW", "Lion", "SGD"];
const SCHEDULERS = ["cosine", "constant", "linear", "constant_with_warmup"];
const RESOLUTIONS = [512, 768, 1024];

export function TrainingStudio() {
  const [checkpoints, setCheckpoints] = useState<ModelOpt[]>([]);
  const [backendConfigured, setBackendConfigured] = useState(true);
  const [jobs, setJobs] = useState<TrainJob[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  // ── form state ──
  const [name, setName] = useState("");
  const [baseModel, setBaseModel] = useState("");
  const [triggerWord, setTriggerWord] = useState("");
  const [classWord, setClassWord] = useState("");
  const [dataset, setDataset] = useState<{ name: string }[]>([]);
  const [resolution, setResolution] = useState(512);
  const [steps, setSteps] = useState(1500);
  const [batchSize, setBatchSize] = useState(4);
  const [learningRate, setLearningRate] = useState(0.0001);
  const [rankDim, setRankDim] = useState(32);
  const [networkAlpha, setNetworkAlpha] = useState(16);
  const [optimizer, setOptimizer] = useState("AdamW8bit");
  const [scheduler, setScheduler] = useState("cosine");
  const [seed, setSeed] = useState(0);

  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const loadModels = useCallback(() => {
    fetch("/api/models?type=CHECKPOINT")
      .then((r) => r.json())
      .then((d) => setCheckpoints(d.models ?? []));
  }, []);

  const loadJobs = useCallback(() => {
    fetch("/api/train")
      .then((r) => r.json())
      .then((d) => {
        setJobs(d.jobs ?? []);
        setBackendConfigured(d.backendConfigured ?? false);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadModels();
    loadJobs();
    const t = setInterval(loadJobs, 4000);
    return () => clearInterval(t);
  }, [loadModels, loadJobs]);

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setUploading(true);
    try {
      for (const f of files) {
        const fd = new FormData();
        fd.append("image", f);
        const res = await fetch("/api/upload", { method: "POST", body: fd });
        const d = await res.json();
        if (d.name) setDataset((prev) => [...prev, { name: d.name }]);
      }
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function submit() {
    setError("");
    if (!name.trim()) return setError("请填写任务名称");
    if (!baseModel) return setError("请选择底模（Checkpoint）");
    if (!triggerWord.trim()) return setError("请填写触发词");
    if (!dataset.length) return setError("请至少上传一张数据集图片");

    setSubmitting(true);
    try {
      const res = await fetch("/api/train", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          baseModel,
          triggerWord: triggerWord.trim(),
          classWord: classWord.trim() || undefined,
          datasetImages: dataset,
          resolution,
          steps,
          batchSize,
          learningRate,
          rankDim,
          networkAlpha,
          optimizer,
          scheduler,
          seed,
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error ?? "创建失败");
        return;
      }
      // reset form
      setName("");
      setTriggerWord("");
      setClassWord("");
      setDataset([]);
      setSteps(1500);
      setRankDim(32);
      setNetworkAlpha(16);
      loadJobs();
    } finally {
      setSubmitting(false);
    }
  }

  async function cancelJob(id: string) {
    await fetch(`/api/train/${id}/cancel`, { method: "POST" });
    loadJobs();
  }

  const inputClass =
    "w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-gray-200 outline-none transition-colors focus:border-violet-500/40";
  const labelClass = "mb-1 block text-xs font-medium text-gray-400";

  return (
    <div className="flex h-full">
      {/* ── Config aside ── */}
      <aside className="flex w-[420px] shrink-0 flex-col border-r border-white/[0.06] bg-[#0c0c12]">
        <div className="border-b border-white/[0.06] px-4 py-3">
          <h2 className="text-sm font-semibold text-gray-100">LoRA 训练（炼丹）</h2>
          <p className="mt-0.5 text-xs text-gray-500">用一组图片 + 触发词，训练专属风格 / 角色 LoRA。</p>
        </div>

        <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto px-4 py-4">
          {!backendConfigured && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-[11px] leading-relaxed text-amber-200">
              <p className="mb-1 font-semibold">未配置训练后端</p>
              设置环境变量 <code className="rounded bg-black/30 px-1">LORA_TRAINER_URL</code> 指向你的训练服务（Kohya / OneTrainer / ComfyUI 训练节点）后重启，即可开始真实训练。当前提交的任务会保持「等待中」。
            </div>
          )}

          <div>
            <label className={labelClass}>任务名称</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="如：我的水墨风格" className={inputClass} />
          </div>

          <div>
            <label className={labelClass}>底模（Checkpoint）</label>
            <select value={baseModel} onChange={(e) => setBaseModel(e.target.value)} className={inputClass}>
              <option value="">请选择…</option>
              {checkpoints.map((m) => (
                <option key={m.id} value={m.fileName}>{m.name}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className={labelClass}>触发词</label>
              <input value={triggerWord} onChange={(e) => setTriggerWord(e.target.value)} placeholder="如：somecjkstyle" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>类别词（可选）</label>
              <input value={classWord} onChange={(e) => setClassWord(e.target.value)} placeholder="person / style" className={inputClass} />
            </div>
          </div>

          <div>
            <label className={labelClass}>数据集图片（{dataset.length}）</label>
            <input ref={fileRef} type="file" accept="image/*" multiple onChange={onUpload} className="block w-full text-xs text-gray-400 file:mr-3 file:rounded-lg file:border-0 file:bg-violet-500/15 file:px-3 file:py-1.5 file:text-violet-200" />
            {uploading && <p className="mt-1 text-[11px] text-violet-300">上传中…</p>}
            {dataset.length > 0 && (
              <div className="mt-2 grid grid-cols-4 gap-1.5">
                {dataset.map((d, i) => (
                  <div key={i} className="group relative aspect-square overflow-hidden rounded-md border border-white/10">
                    <img src={`/api/file/${encodeURIComponent(d.name)}`} alt={d.name} className="h-full w-full object-cover" onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />
                    <button
                      onClick={() => setDataset(dataset.filter((_, j) => j !== i))}
                      className="absolute right-0.5 top-0.5 hidden rounded bg-black/60 px-1 text-[10px] text-white group-hover:block"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
            <p className="mt-1 text-[10px] leading-relaxed text-gray-600">建议 10–30 张同主题图片；上传至本机后文件名会随任务一起提交给训练后端。</p>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className={labelClass}>分辨率</label>
              <select value={resolution} onChange={(e) => setResolution(Number(e.target.value))} className={inputClass}>
                {RESOLUTIONS.map((r) => (<option key={r} value={r}>{r}</option>))}
              </select>
            </div>
            <div>
              <label className={labelClass}>批次大小 {batchSize}</label>
              <input type="range" min={1} max={8} value={batchSize} onChange={(e) => setBatchSize(Number(e.target.value))} className="w-full accent-violet-500" />
            </div>
          </div>

          <div>
            <label className={labelClass}>训练步数 {steps}</label>
            <input type="range" min={500} max={4000} step={100} value={steps} onChange={(e) => setSteps(Number(e.target.value))} className="w-full accent-violet-500" />
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className={labelClass}>LoRA 维度 (rank) {rankDim}</label>
              <input type="range" min={8} max={128} step={8} value={rankDim} onChange={(e) => setRankDim(Number(e.target.value))} className="w-full accent-violet-500" />
            </div>
            <div>
              <label className={labelClass}>Alpha {networkAlpha}</label>
              <input type="range" min={0} max={128} step={8} value={networkAlpha} onChange={(e) => setNetworkAlpha(Number(e.target.value))} className="w-full accent-violet-500" />
            </div>
          </div>

          <div>
            <label className={labelClass}>学习率 {learningRate}</label>
            <input
              type="number"
              step={0.0001}
              value={learningRate}
              onChange={(e) => setLearningRate(Number(e.target.value))}
              className={inputClass}
            />
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className={labelClass}>优化器</label>
              <select value={optimizer} onChange={(e) => setOptimizer(e.target.value)} className={inputClass}>
                {OPTIMIZERS.map((o) => (<option key={o}>{o}</option>))}
              </select>
            </div>
            <div>
              <label className={labelClass}>调度器</label>
              <select value={scheduler} onChange={(e) => setScheduler(e.target.value)} className={inputClass}>
                {SCHEDULERS.map((s) => (<option key={s}>{s}</option>))}
              </select>
            </div>
          </div>

          <div>
            <label className={labelClass}>随机种子</label>
            <input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value))} className={inputClass} />
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <button
            onClick={submit}
            disabled={submitting || uploading}
            className="w-full rounded-xl bg-violet-500 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-violet-400 disabled:opacity-50"
          >
            {submitting ? "提交中…" : "开始训练"}
          </button>
        </div>
      </aside>

      {/* ── Job list ── */}
      <main className="min-w-0 flex-1 overflow-y-auto bg-[#0a0a0f]">
        <div className="mx-auto max-w-[900px] px-8 py-8">
          <h3 className="mb-4 text-sm font-semibold text-gray-200">训练任务</h3>
          {jobs.length === 0 ? (
            <div className="grid min-h-[260px] place-items-center rounded-2xl border border-dashed border-white/[0.08] text-gray-500">
              <p className="text-sm">还没有训练任务。在左侧配置并点击「开始训练」。</p>
            </div>
          ) : (
            <div className="space-y-3">
              {jobs.map((job) => {
                const sm = STATUS_META[job.status] ?? STATUS_META.QUEUED;
                const logs = job.logs ?? [];
                const isOpen = expanded === job.id;
                return (
                  <div key={job.id} className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="truncate text-sm font-semibold text-gray-100">{job.name}</h4>
                          <span className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${sm.cls}`}>{sm.label}</span>
                        </div>
                        <p className="mt-1 text-[11px] text-gray-500">
                          {job.baseModel} · 触发词 <span className="text-violet-300">{job.triggerWord}</span> · {job.datasetImages?.length ?? 0} 张图 · {job.steps} 步
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        {(job.status === "QUEUED" || job.status === "RUNNING") && (
                          <button onClick={() => cancelJob(job.id)} className="rounded-lg border border-white/10 px-2.5 py-1 text-[11px] text-gray-300 hover:bg-white/5">
                            取消
                          </button>
                        )}
                        <button onClick={() => setExpanded(isOpen ? null : job.id)} className="rounded-lg border border-white/10 px-2.5 py-1 text-[11px] text-gray-300 hover:bg-white/5">
                          {isOpen ? "收起" : "日志"}
                        </button>
                      </div>
                    </div>

                    {(job.status === "RUNNING" || job.status === "QUEUED") && (
                      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                        <div className="h-full rounded-full bg-violet-500 transition-all" style={{ width: `${job.progress}%` }} />
                      </div>
                    )}

                    {job.status === "DONE" && job.outputName && (
                      <p className="mt-2 text-[11px] text-emerald-300">
                        ✓ 已产出 LoRA：<span className="font-mono">{job.outputName}</span> · 已加入模型库，可在创作台 LoRA 中选择使用。
                      </p>
                    )}
                    {job.status === "FAILED" && job.error && (
                      <p className="mt-2 text-[11px] text-red-300">✗ {job.error}</p>
                    )}
                    {job.status === "QUEUED" && !backendConfigured && (
                      <p className="mt-2 text-[11px] text-amber-300/80">等待训练后端（未配置 LORA_TRAINER_URL）。</p>
                    )}

                    {isOpen && (
                      <div className="mt-3 rounded-lg border border-white/[0.06] bg-black/30 p-2.5 font-mono text-[11px] leading-relaxed">
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
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
