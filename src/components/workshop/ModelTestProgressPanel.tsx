"use client";

// ── 「测试模型能力」的本地工作流执行进度面板（ISSUE #4908）──────────────
// 从 ModelTestView 拆出（§12.13：视图函数超 400 行即拆）。SSE state 帧 +
// 本地秒表在这里合成 tqdm 那一行的可读版：百分比之外，给 步数 · 速度 与
// 已用 · 预估剩余 —— 文字由 `describeSampleProgress` 纯函数算好，本件只渲染。
// `since` 含封装 / 入队段，比 ComfyUI 采样段的 tqdm 计时略长 —— 它答的是
// 「点下生成之后过了多久」；算不出的行不显示、不编数。
import { useState } from "react";

import { Progress } from "~/components/ui/progress";
import { useInterval } from "~/components/ui/use-interval";
import { clampInt } from "~/lib/clamp";
import { describeSampleProgress, type SampleProgressText } from "~/lib/progress";

/** 本地工作流任务进度帧（SSE state 帧）：pct 之外尽量带采样步数（value/max）。 */
export type WorkflowProgressFrame = { label?: string; max?: number; pct: number; value?: number };

export function ModelTestProgressPanel({
  generating,
  progress,
  since,
}: {
  generating: boolean;
  /** 当前格本地工作流任务的进度帧；null = 还没收到一拍（不渲染）。 */
  progress: WorkflowProgressFrame | null;
  /** 本轮生成开始时刻（epoch ms，会话里的 `generatingSince`）。 */
  since: number | null;
}) {
  /* 「已用」时钟：每秒跳一拍，耗时行才走秒。没格在跑时 `ms=null` 不轮询；
   * nowMs 只喂展示，不参与任何判定。走 `ui/use-interval` 唯一出口（P12）。 */
  const [nowMs, setNowMs] = useState(() => Date.now());
  useInterval(
    () => {
      setNowMs(Date.now());
    },
    { immediate: false, ms: generating ? 1000 : null },
  );

  if (!generating || progress === null) {
    return null;
  }
  const detail: SampleProgressText = describeSampleProgress(
    {
      pct: progress.pct,
      value: progress.value ?? null,
      max: progress.max ?? null,
      startedAtMs: since,
    },
    nowMs,
  );
  const stepsLine =
    detail.stepsText === null
      ? null
      : detail.rateText === null
        ? detail.stepsText
        : `${detail.stepsText} · ${detail.rateText}`;

  return (
    <div className="border-border bg-surface-1 rounded-lg border px-4 py-3" role="status">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium">
          本地工作流执行进度
          {progress.label !== undefined && progress.label !== "" ? ` · ${progress.label}` : ""}
        </span>
        <span className="text-primary-strong font-semibold tabular-nums">
          {Math.floor(progress.pct)}%
        </span>
      </div>
      <Progress className="mt-2" value={clampInt(Math.floor(progress.pct), 2, 100)} />
      <div className="text-muted-foreground text-2xs mt-2 flex flex-wrap gap-x-3 gap-y-0.5 tabular-nums">
        {detail.elapsedText === null ? null : <span>已用 {detail.elapsedText}</span>}
        {stepsLine !== null && <span>{stepsLine}</span>}
        {detail.etaText === null ? null : <span>剩余约 {detail.etaText}</span>}
      </div>
    </div>
  );
}
