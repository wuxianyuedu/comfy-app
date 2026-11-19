"use client";

// 剧本「AI 评审 / 定向改写」控制 hook（FR-QA-07 ④ · #2478）。承载判定、分数曲线
// 与在途态，IO 走 run-client（不碰 vanillaApi，§17），在途用 `beginStaleRun`
// 作废守卫。改写成功后把新剧本交回调用方再自动复评一轮 ——「评审 → 改写 → 复评」
// 闭环在界面侧一次点击走完。
import { useCallback, useState } from "react";

import { useBusyAction } from "~/components/ui/use-busy-action";
import { useReviewGuard } from "~/components/ui/use-review-guard";
import { reviewScript, reviseScript } from "~/lib/production/run-client";
import type { ReviewVerdict } from "~/lib/production/review-types";

export type ScriptReviewController = {
  error: string;
  /** 完整分数曲线（旧→新含本轮）；还没评过 → 空数组。 */
  history: Array<ReviewVerdict>;
  review: () => Promise<void>;
  reviewing: boolean;
  revise: () => Promise<void>;
  revising: boolean;
  verdict: ReviewVerdict | null;
};

export function useScriptReview(
  projectId: string,
  onScriptRevised: (markdown: string) => void,
): ScriptReviewController {
  const [verdict, setVerdict] = useState<ReviewVerdict | null>(null);
  const [history, setHistory] = useState<Array<ReviewVerdict>>([]);
  const reviewBusy = useBusyAction();
  const reviseBusy = useBusyAction();
  const { begin, error, fail } = useReviewGuard();

  const review = useCallback(async () => {
    if (!projectId) {
      return;
    }
    const guard = begin();
    await reviewBusy.run(async () => {
      try {
        const outcome = await reviewScript(projectId);
        guard.commit(() => {
          setVerdict(outcome.verdict);
          setHistory(outcome.history);
        });
      } catch (error_) {
        fail(guard, error_, "评审失败");
      }
    });
  }, [projectId, reviewBusy, begin, fail]);

  const revise = useCallback(async () => {
    if (!projectId) {
      return;
    }
    const guard = begin();
    await reviseBusy.run(async () => {
      try {
        const markdown = await reviseScript(projectId);
        guard.commit(() => {
          // 剧本已变：编辑器 / 预览切到新版，旧判定不再作数（下一轮评审重出）。
          onScriptRevised(markdown);
          setVerdict(null);
          setHistory([]);
        });
        // 定向改写完成后立即复评 —— 闭环在界面侧一次点击走完。
        await review();
      } catch (error_) {
        fail(guard, error_, "改写失败");
      }
    });
  }, [projectId, reviseBusy, onScriptRevised, review, begin, fail]);

  return {
    verdict,
    history,
    reviewing: reviewBusy.busy,
    revising: reviseBusy.busy,
    error,
    review,
    revise,
  };
}
