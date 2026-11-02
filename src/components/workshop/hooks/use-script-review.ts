"use client";

// 剧本「AI 评审 / 定向改写」控制 hook（FR-QA-07 ④ · #2478）。
//
// 与镜头 / 角色卡评审 hook 同构：承载判定、分数曲线与在途态，IO 走 run-client
// （视图/hook 不碰 vanillaApi，§17），在途用 `beginStaleRun` 作废守卫（弹窗中途关
// 即不落地）。改写成功后把新剧本交回调用方（编辑器切到新版），再自动复评一轮 ——
// 「评审 → 定向改写 → 复评」的闭环在界面侧也完整可走。
import { useCallback, useEffect, useRef, useState } from "react";

import { useBusyAction } from "~/components/ui/use-busy-action";
import { reviewScript, reviseScript } from "~/lib/production/run-client";
import type { ReviewVerdict } from "~/lib/production/review-types";
import { beginStaleRun, type StaleRunGuard } from "~/lib/stale-run";

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
  const [error, setError] = useState("");
  const reviewBusy = useBusyAction();
  const reviseBusy = useBusyAction();

  const guardRef = useRef<StaleRunGuard>(beginStaleRun());
  useEffect(() => {
    const guard = guardRef.current;
    return () => {
      guard.dispose();
    };
  }, []);

  const review = useCallback(async () => {
    if (!projectId) {
      return;
    }
    guardRef.current.dispose();
    const guard = beginStaleRun();
    guardRef.current = guard;
    setError("");
    await reviewBusy.run(async () => {
      try {
        const outcome = await reviewScript(projectId);
        guard.commit(() => {
          setVerdict(outcome.verdict);
          setHistory(outcome.history);
        });
      } catch (error_) {
        guard.commit(() => {
          setError(error_ instanceof Error ? error_.message : "评审失败");
        });
      }
    });
  }, [projectId, reviewBusy]);

  const revise = useCallback(async () => {
    if (!projectId) {
      return;
    }
    guardRef.current.dispose();
    const guard = beginStaleRun();
    guardRef.current = guard;
    setError("");
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
        guard.commit(() => {
          setError(error_ instanceof Error ? error_.message : "改写失败");
        });
      }
    });
  }, [projectId, reviseBusy, onScriptRevised, review]);

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
