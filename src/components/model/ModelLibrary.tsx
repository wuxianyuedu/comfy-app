"use client";

import { useEffect, useState } from "react";
import { ModelCard, type ModelCardData } from "./ModelCard";
import { vanillaApi } from "~/trpc/vanilla";

const FILTERS = [
  { key: "", label: "全部" },
  { key: "CHECKPOINT", label: "大模型" },
  { key: "LORA", label: "LoRA" },
  { key: "CONTROLNET", label: "控制网" },
  { key: "VAE", label: "VAE" },
  { key: "EMBEDDING", label: "嵌入" },
];

export function ModelLibrary() {
  const [models, setModels] = useState<ModelCardData[]>([]);
  const [type, setType] = useState("");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    const params: { type?: string; q?: string } = {};
    if (type) params.type = type;
    if (q) params.q = q;
    void vanillaApi.model.list
      .query(params)
      .then((data) => setModels((data.models ?? []) as unknown as ModelCardData[]))
      .finally(() => setLoading(false));
  }, [type, q]);

  async function sync() {
    setSyncing(true);
    try {
      await vanillaApi.model.sync.mutate();
      // refresh
      const params: { type?: string; q?: string } = {};
      if (type) params.type = type;
      if (q) params.q = q;
      const d = await vanillaApi.model.list.query(params);
      setModels((d.models ?? []) as unknown as ModelCardData[]);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {FILTERS.map((FILTERS) =>
(
          <button
            key={FILTERS.key}
            onClick={() => setType(FILTERS.key)}
            className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
              type === FILTERS.key
                ? "border-primary bg-primary-soft text-primary"
                : "border-border text-muted hover:text-ink"
            }`}
          >
            {FILTERS.label}
          </button>
        ))}
        <input
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder="搜索模型…"
          className="ml-auto h-9 w-44 rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:border-primary sm:w-56"
        />
        <button
          onClick={sync}
          disabled={syncing}
          className="h-9 rounded-lg border border-border px-3 text-sm text-muted transition-colors hover:text-ink disabled:opacity-50"
        >
          {syncing ? "同步中…" : "同步模型"}
        </button>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={`skeleton-${i}`} className="aspect-[4/3] animate-pulse rounded-xl bg-subtle" />
          ))}
        </div>
      ) : models.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-12 text-center text-muted">
          暂无可用的本地模型。请确认 ComfyUI 已启动，然后点击「同步模型」。
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {models.map((model) =>
(
            <ModelCard key={model.id} model={model} />
          ))}
        </div>
      )}
    </div>
  );
}
