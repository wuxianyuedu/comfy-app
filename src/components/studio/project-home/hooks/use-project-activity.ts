"use client";

/**
 * 项目活动流 controller（ISSUE #5251）：30s 轮询 + 回前台补跑，换项目 / 卸载后不写。
 * 定时器与 focus 监听走 `useInterval` 唯一出口，作废守卫走 `beginStaleRun`（P31）。
 */
import { useEffect, useRef, useState } from "react";

import { useInterval } from "~/components/ui/use-interval";
import { fetchProjectActivity, type ActivityItem } from "~/lib/production/activity-client";
import { beginStaleRun } from "~/lib/stale-run";

const ACTIVITY_POLL_MS = 30_000;

export function useProjectActivity(projectId?: string) {
  const [items, setItems] = useState<Array<ActivityItem>>([]);
  const guardRef = useRef<ReturnType<typeof beginStaleRun> | null>(null);

  useEffect(() => {
    guardRef.current = beginStaleRun();
    return () => {
      guardRef.current?.dispose();
      guardRef.current = null;
    };
  }, [projectId]);

  useInterval(
    () => {
      const guard = guardRef.current;
      if (!projectId || guard === null) {
        return;
      }
      void fetchProjectActivity(projectId).then((rows) => {
        guard.commit(() => {
          setItems(rows);
        });
      });
    },
    { ms: projectId ? ACTIVITY_POLL_MS : null, pauseWhenUnfocused: true },
  );

  return { items };
}
