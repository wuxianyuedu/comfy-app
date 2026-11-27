"use client";

/** 项目活动流 controller（ISSUE #5208）：只读，切换项目重取，卸载后不写。 */
import { useEffect, useState } from "react";

import { fetchProjectActivity, type ActivityItem } from "~/lib/production/activity-client";
import { beginStaleRun } from "~/lib/stale-run";

export function useProjectActivity(projectId?: string) {
  const [items, setItems] = useState<Array<ActivityItem>>([]);

  useEffect(() => {
    if (!projectId) {
      return;
    }
    const guard = beginStaleRun();
    void fetchProjectActivity(projectId).then((rows) => {
      guard.commit(() => {
        setItems(rows);
      });
    });
    return () => guard.dispose();
  }, [projectId]);

  return { items };
}
