"use client";

import React, { useEffect, useMemo, useState } from "react";
import { AuroraBackground } from "@/components/updream/AuroraBackground";
import { Icon } from "@/components/ui/Icon";

interface ModelRow {
  id: string;
  name: string;
  type: string;
  fileName: string;
  isAvailable: boolean;
  fileSize?: number | null;
  createdAt: string;
}

const TYPE_LABELS: Record<string, { label: string; color: string }> = {
  CHECKPOINT: { label: "大模型", color: "text-violet-300 bg-violet-500/15" },
  LORA: { label: "LoRA", color: "text-emerald-300 bg-emerald-500/15" },
  VAE: { label: "VAE", color: "text-sky-300 bg-sky-500/15" },
  CONTROLNET: { label: "ControlNet", color: "text-amber-300 bg-amber-500/15" },
  EMBEDDING: { label: "Embedding", color: "text-pink-300 bg-pink-500/15" },
  UPSCALER: { label: "放大", color: "text-rose-300 bg-rose-500/15" },
};

function fmtSize(n?: number | null) {
  if (!n) return "—";
  if (n > 1024 * 1024 * 1024) return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (n > 1024 * 1024) return `${(n / 1024 / 1024).toFixed(0)} MB`;
  return `${(n / 1024).toFixed(0)} KB`;
}

export function ModelLibrary() {
  const [models, setModels] = useState<ModelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<string>("ALL");

  useEffect(() => {
    setLoading(true);
    fetch("/api/models")
      .then((r) => r.json())
      .then((d) => setModels(d.models ?? []))
      .finally(() => setLoading(false));
  }, []);

  const types = useMemo(() => {
    const set = new Set(models.map((m) => m.type));
    return Array.from(set);
  }, [models]);

  const filtered = useMemo(() => {
    return models.filter((m) => {
      if (filter !== "ALL" && m.type !== filter) return false;
      if (q && !`${m.name} ${m.fileName}`.toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    });
  }, [models, q, filter]);

  return (
    <div className="h-full overflow-y-auto">
      <AuroraBackground />
      <div className="mx-auto max-w-[1200px] px-4 sm:px-8 py-8 sm:py-10">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-title text-xl font-bold text-gray-100">模型库</h1>
            <p className="mt-1 text-sm text-gray-500">本机 ComfyUI 可用模型（Checkpoint / LoRA / VAE 等）。</p>
          </div>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索模型名称…"
            className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-gray-200 outline-none focus:border-violet-500/40 sm:w-64"
          />
        </div>

        <div className="mb-5 flex flex-wrap gap-2">
          <FilterChip active={filter === "ALL"} onClick={() => setFilter("ALL")} label={`全部 (${models.length})`} />
          {types.map((t) => (
            <FilterChip
              key={t}
              active={filter === t}
              onClick={() => setFilter(t)}
              label={`${TYPE_LABELS[t]?.label ?? t} (${models.filter((m) => m.type === t).length})`}
            />
          ))}
        </div>

        {loading ? (
          <p className="text-sm text-gray-500">加载中…</p>
        ) : filtered.length === 0 ? (
          <div className="grid min-h-[300px] place-items-center rounded-2xl border border-dashed border-white/[0.08] text-gray-500">
            <div className="text-center">
              <p className="text-lg font-medium text-gray-300">暂无模型</p>
              <p className="mt-1 text-sm">请先在 ComfyUI 中安装模型，运行同步后在此显示。</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {filtered.map((m) => {
              const tl = TYPE_LABELS[m.type] ?? { label: m.type, color: "text-gray-300 bg-white/10" };
              return (
                <div
                  key={m.id}
                  className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 transition-all hover:border-white/[0.14] hover:bg-white/[0.04]"
                >
                  <div className="mb-3 flex h-20 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500/10 to-sky-500/10 text-violet-300">
                    <Icon name="package" size={28} />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${tl.color}`}>{tl.label}</span>
                    {!m.isAvailable && <span className="rounded-md bg-white/10 px-2 py-0.5 text-[11px] text-gray-400">不可用</span>}
                  </div>
                  <h3 className="u-title mt-2 line-clamp-1" title={m.name}>
                    {m.name}
                  </h3>
                  <p className="mt-0.5 line-clamp-1 text-xs text-gray-500" title={m.fileName}>
                    {m.fileName}
                  </p>
                  <p className="mt-1 text-[11px] text-gray-600">{fmtSize(m.fileSize)}</p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function FilterChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
        active ? "bg-violet-500/20 text-violet-200" : "bg-white/[0.04] text-gray-400 hover:text-gray-200"
      }`}
    >
      {label}
    </button>
  );
}
