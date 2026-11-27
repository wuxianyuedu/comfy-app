"use client";

/**
 * 工坊的「服务端版本基准」（ISSUE #5208）：多检出共享同一份 production 时，
 * 保存需带上次读到的 `updatedAt` 做 CAS；成功保存后推进基准，冲突时由调用处提示。
 * 从 `useWorkshopPipeline` 抽出，避免主 hook 越过 400 行硬闸。
 */
import { useCallback, useEffect, useRef } from "react";

import {
  fetchProduction,
  pushProduction,
  type ProductionPayload,
} from "~/lib/production/production-client";
import { beginStaleRun } from "~/lib/stale-run";

export function useWorkshopServerRevision(
  projectId: string,
  reportStale: (message: string) => void,
) {
  const onStale = useCallback(
    () =>
      reportStale(
        "另一个检出已经改动了这部剧；本次保存未覆盖。请刷新后重新打开工坊再改，避免覆盖他人内容。",
      ),
    [reportStale],
  );
  const revision = useRef<string | null>(null);

  useEffect(() => {
    if (!projectId) {
      return;
    }
    const guard = beginStaleRun();
    void fetchProduction(projectId).then((data) => {
      guard.commit(() => {
        const stamp = data?.updatedAt;
        revision.current = typeof stamp === "string" ? stamp : null;
      });
    });
    return () => guard.dispose();
  }, [projectId]);

  /* 两个函数都稳定：调用方在 useEffect 依赖里列它们不会让 effect 每拍重跑。 */
  const current = useCallback(() => revision.current ?? undefined, []);
  const adopt = useCallback((stamp: string) => {
    revision.current = stamp;
  }, []);
  /** 带版本基准的写穿：调用处只需给 projectId + payload，不再各自拼 CAS 三参。 */
  const push = useCallback(
    (target: string, payload: ProductionPayload) =>
      pushProduction(target, payload, {
        expectedUpdatedAt: current(),
        onSaved: adopt,
        onStale,
      }),
    [adopt, current, onStale],
  );
  return { push };
}
