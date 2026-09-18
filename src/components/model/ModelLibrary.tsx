"use client";

import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
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
        {FILTERS.map((FILTERS) => (
          <Button
            key={FILTERS.key}
            variant="outline"
            size="sm"
            onClick={() => c.setType(FILTERS.key)}
            className={`h-auto rounded-full px-3 py-1.5 ${
              c.type === FILTERS.key
                ? "border-primary bg-primary-soft text-primary"
                : "border-border text-muted-foreground hover:bg-subtle hover:text-ink"
            }`}
          >
            {FILTERS.label}
          </Button>
        ))}
        <input
          value={c.q}
          onChange={(event) => c.setQ(event.target.value)}
          placeholder="搜索模型…"
          className="border-border bg-surface focus:border-primary ml-auto h-9 w-44 rounded-lg border px-3 text-sm outline-none sm:w-56"
        />
        <Button
          variant="outline"
          onClick={() => void c.sync()}
          disabled={c.syncing}
          className="border-border text-muted-foreground hover:bg-subtle hover:text-ink h-9 rounded-lg px-3"
        >
          {c.syncing ? "同步中…" : "同步模型"}
        </Button>
      </div>

      {c.loading ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton
              key={`skeleton-${i}`}
              className="bg-subtle aspect-[4/3] rounded-xl"
            />
          ))}
        </div>
      ) : c.models.length === 0 ? (
        <div className="border-border text-muted-foreground rounded-xl border border-dashed p-12 text-center">
          暂无可用的本地模型。请确认 ComfyUI 已启动，然后点击「同步模型」。
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {c.models.map((model) => (
            <ModelCard key={model.id} model={model} />
          ))}
        </div>
      )}
    </div>
  );
}
