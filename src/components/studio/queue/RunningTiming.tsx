"use client";

import { useState } from "react";

import { useInterval } from "~/components/ui/use-interval";
import { displayValue } from "~/lib/display-value";
import { formatSampleRateText } from "~/lib/progress";

import { estimateRemainingMs, remainingText, runningElapsedText } from "./queue-monitor-config";
import { Field } from "./QueueMonitorParts";

/**
 * 跑动中富卡的秒表读数（队列 1s tick 的渲染隔离）：
 * 全局队列 store 每秒更新一次 elapsedMs，若让整页 controller 依赖它，
 * 50 行排队 + 8 行最近结果每秒都要整树重渲染一次。这里把秒表下沉到
 * 富卡自己的三格读数里：每秒只重渲染这三格，列表不动。
 * 定时器走 useInterval（规范 16：视图不自写 setInterval）。
 */
export function RunningTiming({
  progressPct,
  progressValue,
  startedAt,
  stepsText,
}: {
  progressPct: number;
  progressValue: number | null;
  startedAt: number;
  stepsText: string;
}) {
  const [elapsedMs, setElapsedMs] = useState(() => Math.max(0, Date.now() - startedAt));
  useInterval(
    () => {
      setElapsedMs(Math.max(0, Date.now() - startedAt));
    },
    { immediate: false, ms: 1000 },
  );
  const remainingMs = estimateRemainingMs(elapsedMs, progressPct);
  return (
    <>
      <Field label="已跑">{runningElapsedText(elapsedMs)}</Field>
      <Field label="预计剩余">{remainingText(remainingMs)}</Field>
      <Field label="步数">{stepsText}</Field>
      <Field label="速度">{displayValue(formatSampleRateText(progressValue, elapsedMs))}</Field>
    </>
  );
}
