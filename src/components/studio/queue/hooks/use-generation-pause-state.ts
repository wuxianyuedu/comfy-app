"use client";

/**
 * 生图暂停闸的**共享只读状态**（ISSUE #5143）：侧栏「队列」行要在页签上直接
 * 显示「生图已暂停」，不能只为这枚角标再挂一整套 `useQueueMonitor`（那会起轮询
 * 与一批写操作）。这里只订阅已有的 tRPC `pauseState` 查询出口，与队列页操作条
 * 共享同一份 React Query 缓存，切换暂停后两处同步更新。
 */
import { useQuery } from "@tanstack/react-query";

import { useTRPC } from "~/trpc/react";
import { useViewTabActive } from "~/components/ui/view-tab-active";

export function useGenerationPauseState(): boolean {
  const trpc = useTRPC();
  /* 侧栏常驻共享状态：原先没有页签门控，等于每个页签后台都每 30s 轮询一次
   * （#5224 A3 / §2.10.1 自激盲区）。与 use-queue-monitor 的 pauseState 同一口径：
   * 非当前页签停摆，切回来时 stale 数据自动补拉。 */
  const isTabActive = useViewTabActive();
  const query = useQuery(
    trpc.generationControl.pauseState.queryOptions(undefined, {
      refetchInterval: 30_000,
      enabled: isTabActive,
    }),
  );
  return query.data?.paused === true;
}
