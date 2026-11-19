"use client";

// 画布侧「生产进度」指示器（设计 §7「两侧一致展示」）。
// 数据来自 ProductionProgress（production 行 progress 列，工坊与画布共读）。
// 纯展示：数值由「阶段游标 + rendered」派生，复用 `ui/progress-bar`（规范 16 §16.2.4.19），
// 不引用工坊视图层阶段标签，避免 studio→workshop 跨特性耦合。

import { ProgressBar } from "~/components/ui/progress-bar";
import { PRODUCTION_STAGES, type ProductionProgress } from "~/lib/production/progress";

/** 由持久侧完成状态派生 0..100 的阶段百分比：rendered 记满，否则按阶段序。 */
export function stageProgressPct(progress: ProductionProgress): number {
  if (progress.rendered) {
    return 100;
  }
  const idx = PRODUCTION_STAGES.indexOf(progress.stage);
  return Math.round(((idx + 1) / PRODUCTION_STAGES.length) * 100);
}

export function CanvasProgressIndicator({ progress }: { progress: ProductionProgress }) {
  return (
    <div className="z-canvas-ui pointer-events-none absolute top-3 left-3">
      <div className="bg-card border-border-strong w-56 rounded-xl border px-3 py-2 shadow-lg">
        <ProgressBar
          label={progress.rendered ? "生产进度 · 已合成" : "生产进度"}
          value={stageProgressPct(progress)}
        />
      </div>
    </div>
  );
}
