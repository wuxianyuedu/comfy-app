"use client";

import { useState } from "react";

import { Button } from "~/components/ui/button";
import { textHandler } from "~/lib/form-props";
import { EmptyState } from "~/components/ui/empty-state";
import { Skeleton } from "~/components/ui/skeleton";
import { ModelCard, type ModelCardData } from "./ModelCard";
import { ModelDetailDialog } from "./ModelDetailDialog";
import { MODEL_TYPE_FILTERS } from "./model-type-labels";
import { useModelLibrary } from "./hooks/use-model-library";

/**
 * 模型卡片库 —— 视图层（规范 17 §17.2 第③层）。
 * 拉取、筛选与同步在 hooks/use-model-library.ts；本文件只渲染。
 * 对外导出名与组件签名保持不变，消费方（app/(main)/models/page.tsx）零改动。
 *
 * 档位表由 `model-type-labels` 派生（此前这里另写一份、少了「放大」，而卡片却会
 * 渲染出「放大」的徽标 —— 一类模型看得见却筛不出来）。
 *
 * `active` 是纯视图状态（开哪个详情），不涉及取数，因此留在视图层；
 * 详情弹窗取代了原来指向 `/models/[id]` 的死链（那条路由不存在）。
 */
export function ModelLibrary() {
  const c = useModelLibrary();
  const [active, setActive] = useState<ModelCardData | null>(null);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {MODEL_TYPE_FILTERS.map((filter) => (
          <Button
            key={filter.key}
            variant="outline"
            size="sm"
            onClick={() => c.setType(filter.key)}
            className={`h-auto rounded-full px-3 py-1.5 ${
              c.type === filter.key
                ? "border-primary bg-primary-soft text-primary"
                : "border-border text-muted-foreground hover:bg-subtle hover:text-ink"
            }`}
          >
            {filter.label}
          </Button>
        ))}
        <input
          value={c.q}
          onChange={textHandler(c.setQ)}
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
              className="bg-subtle aspect-4/3 rounded-xl"
            />
          ))}
        </div>
      ) : c.models.length === 0 ? (
        <EmptyState
          description="暂无可用的本地模型。请确认 ComfyUI 已启动，然后点击「同步模型」。"
          className="p-12"
        />
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {c.models.map((model) => (
            <ModelCard key={model.id} model={model} onOpen={setActive} />
          ))}
        </div>
      )}

      <ModelDetailDialog model={active} onClose={() => setActive(null)} />
    </div>
  );
}
