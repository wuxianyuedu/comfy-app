"use client";

// 分镜镜头「AI 评审」弹窗（Phase 8 · P8-1b）。
//
// 纯展示 + 交互壳：打开即评审该镜头（走`useShotReview`），展示「过 / 不过 + 逐条缺陷 + 改进建议」；
// 不合格时给两个出口 —— 「抽卡」（同提示词换种子重出）与「改提示词重生成」（据评审意见改写提示词）。
// 浮层用官方`ui/dialog`（P9 不自绘模态），忙碌/反馈由 hook 里的 useBusyAction + runAsyncAction 兜。
import { useEffect } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";

import { useShotReview } from "./hooks/use-shot-review";

export interface ShotReviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 所属项目 id（评审 / 重生成的落库锚点）。 */
  projectId: string;
  /** 被评审的镜头（id = 统一项目的 production shot id）。 */
  shot: { id: string; name: string };
  /** 重生成成功后的回调（调用方据此刷新镜头列表）。 */
  onRegenerated?: () => void;
}

export function ShotReviewDialog({
  open,
  onOpenChange,
  projectId,
  shot,
  onRegenerated,
}: ShotReviewDialogProps) {
  const review = useShotReview(projectId, onRegenerated);

  /* 每次打开（或切到别的镜头）都重新评一次 —— 内容可能已被用户改过，旧判定不作数。 */
  useEffect(() => {
    if (!open) return;
    void review.review(shot.id);
    // 依赖只认「打开」与「目标镜头」；review 内部有作废守卫。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, shot.id]);

  const { verdict, reviewing, regenerating, error } = review;
  const busy = reviewing || regenerating;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>镜头评审 · {shot.name}</DialogTitle>
          <DialogDescription>
            由 AI 对这一镜的文本内容（画面 /
            提示词）做质检，不合格可抽卡或改提示词重生成。
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-24 flex-col gap-3">
          {reviewing ? (
            <p className="text-ink-fainter text-sm">正在评审…</p>
          ) : error ? (
            <p className="text-destructive text-sm">{error}</p>
          ) : !verdict ? (
            <p className="text-ink-fainter text-sm">
              尚无评审结果，点「重新评审」开始。
            </p>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-md px-2 py-0.5 text-xs font-medium ${
                    verdict.pass
                      ? "bg-success/15 text-success-strong"
                      : "bg-destructive/15 text-destructive"
                  }`}
                >
                  {verdict.pass ? "评审通过" : "不合格"}
                </span>
                {verdict.issues.length > 0 && (
                  <span className="text-ink-faintest text-xs">
                    {verdict.issues.length} 处待改进
                  </span>
                )}
              </div>

              {verdict.issues.length > 0 && (
                <ul className="text-ink-strong flex list-disc flex-col gap-1 pl-5 text-sm">
                  {verdict.issues.map((issue, index) => (
                    <li key={index}>{issue}</li>
                  ))}
                </ul>
              )}

              {verdict.suggestion && (
                <p className="text-ink-fainter text-sm">
                  建议：{verdict.suggestion}
                </p>
              )}
            </>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void review.review(shot.id)}
          >
            重新评审
          </Button>
          {/* 不合格才给重生成出口；通过时只保留重新评审。 */}
          {verdict && !verdict.pass && (
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void review.regenerate(shot.id, "gacha")}
              >
                {regenerating ? "处理中…" : "抽卡重生成"}
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={busy}
                onClick={() => void review.regenerate(shot.id, "reprompt")}
              >
                {regenerating ? "处理中…" : "改提示词重生成"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
