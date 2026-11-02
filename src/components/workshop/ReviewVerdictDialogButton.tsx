"use client";

// 文本评审（角色卡 / 剧本）共用的「AI 评审」入口 + 判定弹窗骨架（§12.12）：
// CharacterReviewButton 与 ScriptReviewButton 的共享内核——按钮 + 弹窗 + 判定展示 +
// 在途 / 出错 / 空判定占位；打开即评审一次（评审对象由调用方的 `review` 闭包决定）。
// 判定与动作由调用方注入：带维度评分的场景（剧本）自动展示分数条与轮次曲线；
// 提供 `revise` 的场景多一个「按意见改写」按钮。共享内核不放任何一侧的业务写回
// （剧本改写后的编辑器回填等由各壳的 hook 装配，§18.4 同口径）。
import { useEffect, useState, type ReactNode } from "react";
import { ClipboardCheck } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Hint } from "~/components/ui/hint";
import { ProgressBar } from "~/components/ui/progress-bar";
import { displayValue } from "~/lib/display-value";
import { fixed } from "~/lib/number-format";
import { reviewScoreMean, type ReviewVerdict } from "~/lib/production/review-types";

/** 一条判定里的维度分数条：key 有注入的人读名用名，没有（模型自造维度）就原样展示。 */
function ScoreBars({
  verdict,
  labels,
}: {
  labels: ReadonlyMap<string, string>;
  verdict: ReviewVerdict;
}) {
  if (!verdict.scores) {
    return null;
  }
  const entries = Object.entries(verdict.scores);
  if (entries.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-col gap-1.5">
      {entries.map(([key, item]) => (
        <div className="flex items-center gap-2 text-xs" key={key}>
          <span className="text-ink-faint w-16 shrink-0 text-right">{labels.get(key) ?? key}</span>
          <ProgressBar
            ariaLabel={labels.get(key) ?? key}
            className="flex-1"
            fillClassName={
              item.score >= 4 ? "bg-success" : item.score >= 3 ? "bg-warning" : "bg-destructive"
            }
            showValue={false}
            trackClassName="h-1.5 flex-1"
            value={(item.score / 5) * 100}
          />
          <span className="text-ink-subtle w-8 shrink-0">{item.score} 分</span>
          {item.note && (
            <span className="text-ink-faintest min-w-0 flex-1 truncate">{item.note}</span>
          )}
        </div>
      ))}
    </div>
  );
}

/** 轮次曲线（均分 / 过·不过），只有多于一轮才值得展示。 */
function HistoryCurve({ history }: { history: Array<ReviewVerdict> }) {
  if (history.length <= 1) {
    return null;
  }
  return (
    <div className="text-ink-faintest text-2xs">
      轮次曲线：
      {history
        .map((item, index) => {
          const mean = reviewScoreMean(item);
          return `第${index + 1}轮 ${
            mean === null ? (item.pass ? "过" : "不过") : displayValue(fixed(mean, 1))
          }`;
        })
        .join(" → ")}
    </div>
  );
}

/** 评审弹窗骨架消费的判定面与动作（由各壳的 hook 装配）。 */
export type ReviewVerdictController = {
  /** 评审 / 改写任一在途（busy 时弹窗与按钮整体禁动）。 */
  busy: boolean;
  error: string;
  /** 完整分数曲线（旧→新含本轮）；不给 = 该场景不展示曲线。 */
  history?: Array<ReviewVerdict>;
  /** 评审动作：打开弹窗时与「重新评审」按钮都会调它。 */
  review: () => Promise<void>;
  /** 定向改写动作；不给则不渲染「按意见改写」。 */
  revise?: () => Promise<void>;
  verdict: ReviewVerdict | null;
};

export type ReviewVerdictDialogButtonProps = {
  /** 在途文案（场景有改写时可传「正在按意见改写…」）。 */
  busyText: string;
  controller: ReviewVerdictController;
  description: string;
  /** 分数条的维度 key → 人读名（带 rubric 的场景注入；不给就展示原 key）。 */
  dimensionLabels?: ReadonlyMap<string, string>;
  /** 人工裁决插槽（#2480）：场景要给「人拍板」入口时传 `HumanVerdictRow`
   *  （渲染在动作按钮上方）；不给 = 该场景没有人工裁决（如角色卡）。 */
  footerExtra?: ReactNode;
  /** 入口按钮的 Hint / aria-label（如「AI 评审这张角色卡」）。 */
  label: string;
  title: string;
};

const EMPTY_LABELS: ReadonlyMap<string, string> = new Map();

export function ReviewVerdictDialogButton({
  label,
  title,
  description,
  busyText,
  controller,
  dimensionLabels = EMPTY_LABELS,
  footerExtra,
}: ReviewVerdictDialogButtonProps) {
  const [open, setOpen] = useState(false);
  const { verdict, history, busy, error } = controller;
  const mean = verdict ? reviewScoreMean(verdict) : null;

  /* 打开即评审一次 —— 评审对象可能刚被改过（人手改 / AI 改写），旧判定不作数。 */
  useEffect(() => {
    if (!open) {
      return;
    }
    void controller.review();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <>
      <Hint label={label}>
        <Button
          aria-label={label}
          className="text-ink-soft hover:bg-primary/15"
          onClick={() => {
            setOpen(true);
          }}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <ClipboardCheck data-icon="inline-start" size={16} />
        </Button>
      </Hint>
      <Dialog onOpenChange={setOpen} open={open}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          <div className="flex min-h-24 flex-col gap-3">
            {busy ? (
              <p className="text-ink-fainter text-sm">{busyText}</p>
            ) : error ? (
              <p className="text-destructive text-sm">{error}</p>
            ) : verdict ? (
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
                  {mean !== null && (
                    <span className="text-ink-faintest text-xs">
                      维度均分 {displayValue(fixed(mean, 1))} / 5
                    </span>
                  )}
                  {verdict.issues.length > 0 && (
                    <span className="text-ink-faintest text-xs">
                      {verdict.issues.length} 处待改进
                    </span>
                  )}
                </div>
                <ScoreBars labels={dimensionLabels} verdict={verdict} />
                {verdict.issues.length > 0 && (
                  <ul className="text-ink-strong flex list-disc flex-col gap-1 pl-5 text-sm">
                    {verdict.issues.map((issue, index) => (
                      <li key={index}>{issue}</li>
                    ))}
                  </ul>
                )}
                {verdict.suggestion && (
                  <p className="text-ink-fainter text-sm">建议：{verdict.suggestion}</p>
                )}
                {history && <HistoryCurve history={history} />}
              </>
            ) : (
              <p className="text-ink-fainter text-sm">尚无评审结果，点「重新评审」开始。</p>
            )}
          </div>

          {footerExtra}

          <DialogFooter>
            {controller.revise && (
              <Button
                disabled={busy || !verdict}
                // oxlint-disable-next-line no-void -- reject 由 action 内部捕获
                onClick={() => void controller.revise?.()}
                size="sm"
                type="button"
                variant="outline"
              >
                按意见改写
              </Button>
            )}
            <Button
              disabled={busy}
              // oxlint-disable-next-line no-void -- reject 由 action 内部捕获
              onClick={() => void controller.review()}
              size="sm"
              type="button"
              variant="outline"
            >
              重新评审
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
