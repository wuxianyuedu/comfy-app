"use client";

// 角色卡「AI 评审」控制 hook（Phase 8 · P8-1b 续）。只做「评审 + 重新评审」：
// 角色卡可直接编辑，不合格的修法是改字段再用「定妆照」重出（不像镜头有独立重生成
// 端点）。IO 走 `run-client.reviewCharacter`（视图/hook 不碰 vanillaApi，§17），
// 在途用 `beginStaleRun` 作废守卫（弹窗中途关即不落地）。
import { useCallback, useState } from "react";

import { useBusyAction } from "~/components/ui/use-busy-action";
import { useReviewGuard } from "~/components/ui/use-review-guard";
import { reviewCharacter } from "~/lib/production/run-client";
import type { ReviewVerdict } from "~/lib/production/review-types";

export type CharacterReviewController = {
  error: string;
  reset: () => void;
  review: (characterId: string) => Promise<void>;
  reviewing: boolean;
  verdict: ReviewVerdict | null;
};

export function useCharacterReview(projectId: string): CharacterReviewController {
  const [verdict, setVerdict] = useState<ReviewVerdict | null>(null);
  const reviewBusy = useBusyAction();
  const { begin, clearError, error, fail } = useReviewGuard();

  const review = useCallback(
    async (characterId: string) => {
      if (!projectId) {
        return;
      }
      const guard = begin();
      await reviewBusy.run(async () => {
        try {
          const v = await reviewCharacter(projectId, characterId);
          guard.commit(() => {
            setVerdict(v);
          });
        } catch (error_) {
          guard.commit(() => {
            setVerdict(null);
          });
          fail(guard, error_, "评审失败");
        }
      });
    },
    [projectId, reviewBusy, begin, fail],
  );

  const reset = useCallback(() => {
    setVerdict(null);
    clearError();
  }, [clearError]);

  return {
    verdict,
    reviewing: reviewBusy.busy,
    error,
    review,
    reset,
  };
}
