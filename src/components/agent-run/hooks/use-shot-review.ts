"use client";

// 分镜镜头「AI 评审 + 不合格重生成」的共享控制 hook（Phase 8 · P8-1b）。
//
// 把「评审一个镜头 → 不合格时抽卡 / 改提示词重生成」这条交互的执行态收在一处，供
// `ShotReviewDialog` 消费。IO 全走 `~/lib/production/run-client`（视图/hook 不碰 vanillaApi，
// §17）；评审是在途异步，用 `beginStaleRun` 作废守卫（弹窗中途关闭即不落地，§16.2.4.34）；
// 重生成走 `useBusyAction` + `runAsyncAction`（忙碌位绑 finally 复位 + 成功/失败都有可见出口，
// §16.2.4.71 / §16.2.4.30），成功后回调通知调用方刷新镜头列表。
import { useCallback, useEffect, useRef, useState } from "react";

import { useBusyAction } from "~/components/ui/use-busy-action";
import { useToast } from "~/components/studio/ToastProvider";
import { runAsyncAction, type ActionReport } from "~/lib/async-action";
import {
  regenerateShot,
  reviewShot,
  setHumanRating,
  setHumanVerdict,
} from "~/lib/production/run-client";
import type { HumanVerdict, ReviewMode, ReviewVerdict } from "~/lib/production/review-types";
import { beginStaleRun, type StaleRunGuard } from "~/lib/stale-run";

export type ShotReviewController = {
  /** 评审失败文案（就地展示，不外抛）。 */
  error: string;
  /** 人工裁决结果（本次会话内提交过的；切换镜头即清）。 */
  humanVerdict: HumanVerdict | null;
  /** 不合格后的重生成：gacha=同提示词换种子，reprompt=据评审意见改写提示词。 */
  regenerate: (shotId: string, mode: ReviewMode) => Promise<void>;
  /** 重生成在途。 */
  regenerating: boolean;
  /** 清空当前判定（弹窗切换目标镜头时调用）。 */
  reset: () => void;
  /** 评审指定镜头（结果写进 `verdict`，服务端同时落库到 `shot.review`）。 */
  review: (shotId: string) => Promise<void>;
  /** 评审在途。 */
  reviewing: boolean;
  /** 人评分（0~5，null = 清除）。 */
  setRating: (shotId: string, rating: number | null) => Promise<void>;
  /** 人工裁决（#2480，优先于 AI）：落库后回显 + 通知调用方刷新。 */
  submitVerdict: (shotId: string, pass: boolean, note: string) => Promise<void>;
  /** 最近一次评审判定（未评 / 已重置 → null）。 */
  verdict: ReviewVerdict | null;
};

const REGEN_SUCCESS: Record<ReviewMode, string> = {
  gacha: "已抽卡：镜头已退回，将在下次执行时换种子重出",
  reprompt: "已改提示词：镜头已退回，将用新提示词重出",
};

export function useShotReview(projectId: string, onRegenerated?: () => void): ShotReviewController {
  const [verdict, setVerdict] = useState<ReviewVerdict | null>(null);
  const [humanVerdict, setHumanVerdictState] = useState<HumanVerdict | null>(null);
  const [error, setError] = useState("");
  const reviewBusy = useBusyAction();
  const regenBusy = useBusyAction();
  const toast = useToast();

  /* 评审作废守卫：弹窗可能在 LLM 返回前被关闭 / 切到别的镜头，那一轮结果不该落到界面上。
   * 每次评审换一把新守卫；卸载时作废当前这把。 */
  const guardRef = useRef<StaleRunGuard>(beginStaleRun());
  useEffect(() => {
    const guard = guardRef.current;
    return () => guard.dispose();
  }, []);

  const review = useCallback(
    async (shotId: string) => {
      if (!projectId) {
        return;
      }
      guardRef.current.dispose();
      const guard = beginStaleRun();
      guardRef.current = guard;
      setError("");
      await reviewBusy.run(async () => {
        try {
          const v = await reviewShot(projectId, shotId);
          guard.commit(() => setVerdict(v));
        } catch (e) {
          // 失败也走守卫：卸载后到达的错误不往界面写。原文交 errorMessage 翻译。
          guard.commit(() => {
            setVerdict(null);
            setError(e instanceof Error ? e.message : "评审失败");
          });
        }
      });
    },
    [projectId, reviewBusy],
  );

  const report: ActionReport = useCallback(
    (kind, detail) => {
      if (kind === "ok") {
        toast.success(detail);
      } else {
        toast.error(detail);
      }
    },
    [toast],
  );

  const regenerate = useCallback(
    async (shotId: string, mode: ReviewMode) => {
      if (!projectId) {
        return;
      }
      const result = await regenBusy.run(() =>
        runAsyncAction(
          async () => {
            await regenerateShot(projectId, shotId, mode);
          },
          {
            failureText: "重生成失败",
            readResultEnvelope: false,
            report,
            successText: REGEN_SUCCESS[mode],
          },
        ),
      );
      if (result.ok) {
        onRegenerated?.();
      }
    },
    [projectId, regenBusy, report, onRegenerated],
  );

  const submitVerdict = useCallback(
    async (shotId: string, pass: boolean, note: string) => {
      if (!projectId) {
        return;
      }
      const saved = await setHumanVerdict(projectId, "shot", shotId, pass, note);
      setHumanVerdictState(saved);
      report("ok", pass ? "已人工通过：该镜定稿放行" : "已人工否决：将重出这一镜");
      onRegenerated?.();
    },
    [projectId, report, onRegenerated],
  );

  const setRating = useCallback(
    async (shotId: string, rating: number | null) => {
      if (!projectId) {
        return;
      }
      await setHumanRating(projectId, shotId, rating);
    },
    [projectId],
  );

  const reset = useCallback(() => {
    setVerdict(null);
    setHumanVerdictState(null);
    setError("");
  }, []);

  return {
    error,
    humanVerdict,
    regenerate,
    regenerating: regenBusy.busy,
    reset,
    review,
    reviewing: reviewBusy.busy,
    setRating,
    submitVerdict,
    verdict,
  };
}
