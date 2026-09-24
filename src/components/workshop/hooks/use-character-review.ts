"use client";

// 角色卡「AI 评审」控制 hook（Phase 8 · P8-1b 续）。
//
// 与镜头评审同构，但只做「评审 + 重新评审」：角色卡是可直接编辑的文本设定（名字 / 外貌 / 服装 /
// 性格），不合格的修法就是照建议改这些字段、再用既有「定妆照」通道重出 —— 不像镜头那样有独立的
// 抽卡 / 改提示词重生成端点。所以本 hook 只承载判定与在途态，IO 走 `run-client.reviewCharacter`
// （视图/hook 不碰 vanillaApi，§17），评审在途用 `beginStaleRun` 作废守卫（弹窗中途关即不落地）。
import { useCallback, useEffect, useRef, useState } from "react";

import { useBusyAction } from "~/components/ui/use-busy-action";
import { reviewCharacter } from "~/lib/production/run-client";
import type { ReviewVerdict } from "~/lib/production/review-types";
import { beginStaleRun, type StaleRunGuard } from "~/lib/stale-run";

export interface CharacterReviewController {
  verdict: ReviewVerdict | null;
  reviewing: boolean;
  error: string;
  review: (characterId: string) => Promise<void>;
  reset: () => void;
}

export function useCharacterReview(
  projectId: string,
): CharacterReviewController {
  const [verdict, setVerdict] = useState<ReviewVerdict | null>(null);
  const [error, setError] = useState("");
  const reviewBusy = useBusyAction();

  const guardRef = useRef<StaleRunGuard>(beginStaleRun());
  useEffect(() => {
    const guard = guardRef.current;
    return () => guard.dispose();
  }, []);

  const review = useCallback(
    async (characterId: string) => {
      if (!projectId) return;
      guardRef.current.dispose();
      const guard = beginStaleRun();
      guardRef.current = guard;
      setError("");
      await reviewBusy.run(async () => {
        try {
          const v = await reviewCharacter(projectId, characterId);
          guard.commit(() => setVerdict(v));
        } catch (e) {
          guard.commit(() => {
            setVerdict(null);
            setError(e instanceof Error ? e.message : "评审失败");
          });
        }
      });
    },
    [projectId, reviewBusy],
  );

  const reset = useCallback(() => {
    setVerdict(null);
    setError("");
  }, []);

  return {
    verdict,
    reviewing: reviewBusy.busy,
    error,
    review,
    reset,
  };
}
