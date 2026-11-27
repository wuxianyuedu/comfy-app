"use client";

/**
 * 生图暂停闸的**共享只读状态**（ISSUE #5143）：侧栏「队列」行要在页签上直接
 * 显示「生图已暂停」，不能只为这枚角标再挂一整套 `useQueueMonitor`（那会起轮询
 * 与一批写操作）。这里只订阅已有的 tRPC `pauseState` 查询出口，与队列页操作条
 * 共享同一份 React Query 缓存，切换暂停后两处同步更新。
 */
import { useQuery } from "@tanstack/react-query";

import { useTRPC } from "~/trpc/react";

export function useGenerationPauseState(): boolean {
  const trpc = useTRPC();
  const query = useQuery(
    trpc.generationControl.pauseState.queryOptions(undefined, { refetchInterval: 30_000 }),
  );
  return query.data?.paused === true;
}
