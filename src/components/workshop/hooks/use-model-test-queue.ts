"use client";

// ── 测试模型页 · 生成队列总览（第②层：查询与展开态编排）───────────────
// 队列数据与「队列」页**同一份** controller（useQueueMonitor：task.list +
// /api/comfy/queue 两路同源，轮询门控随当前页签），不另造第二份队列真相。
// 在它之上补测试页需要的那一格：展开某条任务 → task.detail 拉全量 →
// 纯派生（queue-task-params）算出输入参数行。

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { useQueueMonitor } from "~/components/studio/queue/hooks/use-queue-monitor";
import {
  queueTaskParamRows,
  type QueueTaskParamRow,
} from "~/components/studio/queue/queue-task-params";
import { useTRPC } from "~/trpc/react";

export function useModelTestQueue() {
  const monitor = useQueueMonitor();
  const trpc = useTRPC();
  /* 展开的任务 id：null = 全部收起。展开才拉 task.detail（enabled 门控），
   * 换行展开时旧详情留在 React Query 缓存里，再次展开同一条不重发。 */
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const detailQ = useQuery(
    trpc.task.detail.queryOptions(
      { id: expandedId ?? "" },
      { enabled: expandedId !== null && expandedId !== "" },
    ),
  );
  const paramRows = useMemo<Array<QueueTaskParamRow>>(
    () => (detailQ.data === undefined ? [] : queueTaskParamRows(detailQ.data)),
    [detailQ.data],
  );
  return {
    ...monitor,
    /** 展开了哪条（null = 收起）。 */
    expandedId,
    /** 点同一行收起、点另一行切换。 */
    toggleExpanded: (id: string) => {
      setExpandedId((current) => (current === id ? null : id));
    },
    /** 展开那条的全量详情；还在拉取时为 null。 */
    detail: detailQ.data ?? null,
    detailLoading: detailQ.isFetching,
    paramRows,
  };
}

export type ModelTestQueueController = ReturnType<typeof useModelTestQueue>;
