"use client";

import { ModelCard } from "./ModelCard";
import { useModelLibrary } from "./hooks/use-model-library";

const FILTERS = [
  { key: "", label: "全部" },
  { key: "CHECKPOINT", label: "大模型" },
  { key: "LORA", label: "LoRA" },
  { key: "CONTROLNET", label: "控制网" },
  { key: "VAE", label: "VAE" },
  { key: "EMBEDDING", label: "嵌入" },
];

/**
 * 模型卡片库 —— 视图层（规范 17 §17.2 第③层）。
 * 拉取、筛选与同步在 hooks/use-model-library.ts；本文件只渲染。
 * 对外导出名与组件签名保持不变，消费方（app/(main)/models/page.tsx）零改动。
 */
export function ModelLibrary() {
  const c = useModelLibrary();

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {FILTERS.map((FILTERS) =>
(
          <button
            key={FILTERS.key}
            onClick={() => c.setType(FILTERS.key)}
            className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
              c.type === FILTERS.key
                ? "border-primary bg-primary-soft text-primary"
                : "border-border text-muted-foreground hover:text-ink"
            }`}
          >
            {FILTERS.label}
          </button>
        ))}
        <input
          value={c.q}
          onChange={(event) => c.setQ(event.target.value)}
          placeholder="搜索模型…"
          className="ml-auto h-9 w-44 rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:border-primary sm:w-56"
        />
        <button
          onClick={() => void c.sync()}
          disabled={c.syncing}
          className="h-9 rounded-lg border border-border px-3 text-sm text-muted-foreground transition-colors hover:text-ink disabled:opacity-50"
        >
          {c.syncing ? "同步中…" : "同步模型"}
        </button>
      </div>

      {c.loading ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={`skeleton-${i}`} className="aspect-[4/3] animate-pulse rounded-xl bg-subtle" />
          ))}
        </div>
      ) : c.models.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-12 text-center text-muted-foreground">
          暂无可用的本地模型。请确认 ComfyUI 已启动，然后点击「同步模型」。
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {c.models.map((model) =>
(
            <ModelCard key={model.id} model={model} />
          ))}
        </div>
      )}
    </div>
  );
}
