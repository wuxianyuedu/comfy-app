"use client";

// 剧本「AI 评审 / 定向改写」入口 + 弹窗（FR-QA-07 ④ · #2478）。
//
// 自包含：一个「评审」按钮 + 一个受控弹窗，内部用 `useScriptReview` 走 run-client。
// 展示「过 / 不过 + 维度分数条（rubric 锚点口径）+ 逐条缺陷 + 分数曲线（每轮均分可回看）」；
// 不合格时提供「按意见改写」——消费低分维度定向改写、旧版留档、改完自动复评。
// projectId 取自当前活跃项目（getActiveId，与工坊同源）。
import { useEffect, useState } from "react";
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
import { getActiveId } from "~/lib/project-canvas/canvas-store";
import {
  reviewScoreMean,
  type ReviewVerdict,
} from "~/lib/production/review-types";
import { rubricFor } from "~/lib/production/review-rubrics";

import { useScriptReview } from "./hooks/use-script-review";

/** 剧本 rubric 的维度 key → 人读名（分数条与曲线的展示用）。 */
const SCRIPT_DIMENSIONS = new Map(
  rubricFor("script").dimensions.map((d) => [d.key, d.label]),
);

/** 一条判定里的维度分数条：key 有 rubric 名用名，没有（模型自造维度）就原样展示。 */
function ScoreBars({ verdict }: { verdict: ReviewVerdict }) {
  if (!verdict.scores) return null;
  const entries = Object.entries(verdict.scores);
  if (entries.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      {entries.map(([key, item]) => (
        <div key={key} className="flex items-center gap-2 text-xs">
          <span className="text-ink-faint w-16 shrink-0 text-right">
            {SCRIPT_DIMENSIONS.get(key) ?? key}
          </span>
          <span className="bg-subtle relative h-1.5 flex-1 overflow-hidden rounded-full">
            <span
              className={`absolute inset-y-0 left-0 rounded-full ${
                item.score >= 4
                  ? "bg-success"
                  : item.score >= 3
                    ? "bg-warning"
                    : "bg-destructive"
              }`}
              style={{ width: `${(item.score / 5) * 100}%` }}
            />
          </span>
          <span className="text-ink-subtle w-8 shrink-0">{item.score} 分</span>
          {item.note && (
            <span className="text-ink-faintest min-w-0 flex-1 truncate">
              {item.note}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

export interface ScriptReviewButtonProps {
  /** 定向改写成功后把新剧本交回编辑器 / 预览（人机接力：人可接着手改）。 */
  onScriptRevised: (markdown: string) => void;
}

export function ScriptReviewButton({
  onScriptRevised,
}: ScriptReviewButtonProps) {
  const [open, setOpen] = useState(false);
  const [projectId] = useState<string>(() => getActiveId() ?? "");
  const review = useScriptReview(projectId, onScriptRevised);

  /* 打开即评审一次 —— 剧本可能刚被改过（AI 改写 / 人手改），旧判定不作数。 */
  useEffect(() => {
    if (!open) return;
    void review.review();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const { verdict, history, reviewing, revising, error } = review;
  const busy = reviewing || revising;
  const mean = verdict ? reviewScoreMean(verdict) : null;

  return (
    <>
      <Hint label="AI 评审这份剧本">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => setOpen(true)}
          aria-label="AI 评审这份剧本"
          className="text-ink-soft hover:bg-primary/15"
        >
          <ClipboardCheck data-icon="inline-start" size={16} />
        </Button>
      </Hint>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>剧本评审</DialogTitle>
            <DialogDescription>
              由 AI
              按评分量表给这份剧本打分；不合格可「按意见改写」定向打磨，旧版自动留档。
            </DialogDescription>
          </DialogHeader>

          <div className="flex min-h-24 flex-col gap-3">
            {busy ? (
              <p className="text-ink-fainter text-sm">
                {revising ? "正在按意见改写…" : "正在评审…"}
              </p>
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
                  {mean !== null && (
                    <span className="text-ink-faintest text-xs">
                      维度均分 {mean.toFixed(1)} / 5
                    </span>
                  )}
                  {verdict.issues.length > 0 && (
                    <span className="text-ink-faintest text-xs">
                      {verdict.issues.length} 处待改进
                    </span>
                  )}
                </div>
                <ScoreBars verdict={verdict} />
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
                {history.length > 1 && (
                  <div className="text-ink-faintest text-2xs">
                    轮次曲线：
                    {history
                      .map((item, index) => {
                        const m = reviewScoreMean(item);
                        return `第${index + 1}轮 ${m === null ? (item.pass ? "过" : "不过") : m.toFixed(1)}`;
                      })
                      .join(" → ")}
                  </div>
                )}
              </>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy || !verdict}
              onClick={() => void review.revise()}
            >
              按意见改写
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void review.review()}
            >
              重新评审
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
