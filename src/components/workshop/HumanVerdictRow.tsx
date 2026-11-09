"use client";

// 人工裁决行（FR-QA-07 人工侧 · #2480）：人工「通过 / 否决 + 一句话理由」+ 可选
// 0~5 星人评分的共享交互块，镜头评审弹窗（ShotReviewDialog）与剧本评审弹窗
// （ReviewVerdictDialogButton 的插槽）共用 —— 人工裁决优先于 AI 判定（FR-AG-02），
// 裁决落库由调用方注入（镜头走 `run.setHumanVerdict`、剧本走 `run.setScriptHumanVerdict`）。
// 人评分（仅镜头）写 `shot.humanRating`，是校准读数的人侧输入。
import { useState } from "react";
import { Star } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { useBusyAction } from "~/components/ui/use-busy-action";
import { runAsyncAction, type ActionReport } from "~/lib/async-action";
import { textHandler } from "~/lib/form-props";
import type { HumanVerdict } from "~/lib/production/review-types";

/** 0~5 星：星级按钮组（点第 n 颗 = n 分；再点当前分 = 清除）。 */
function RatingStars({
  value,
  disabled,
  onPick,
}: {
  disabled: boolean;
  onPick: (rating: number | null) => void;
  value: number | null;
}) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <Button
          aria-label={`${star} 星`}
          disabled={disabled}
          key={star}
          onClick={() => {
            onPick(value === star ? null : star);
          }}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <Star
            className={
              value !== null && star <= value ? "fill-warning text-warning" : "text-ink-faintest"
            }
            data-icon="inline-start"
            size={14}
          />
        </Button>
      ))}
      {value !== null && <span className="text-ink-faintest text-2xs">{value} / 5</span>}
    </div>
  );
}

export type HumanVerdictRowProps = {
  /** 弹窗整体在途（AI 评审 / 重生成中）时禁动。 */
  disabled?: boolean;
  /** 星评变更回调（镜头场景注入 `run.setHumanRating`）；不给 = 不显示星评。 */
  onRatingChange?: (rating: number | null) => Promise<void>;
  /** 裁决提交回调（pass + 一句话理由）。 */
  onSubmit: (pass: boolean, note: string) => Promise<void>;
  /** 已落库的人评分（仅镜头场景给）；缺省 = 该场景不显示星评。 */
  rating?: number | null;
  /** 已落库的人工裁决（展示「人已拍板」状态）；没裁决过 → null。 */
  verdict: HumanVerdict | null;
};

export function HumanVerdictRow({
  verdict,
  rating,
  onRatingChange,
  onSubmit,
  disabled = false,
}: HumanVerdictRowProps) {
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [localRating, setLocalRating] = useState<number | null>(rating ?? null);
  const busy = useBusyAction();

  /* 外部目标切换（换镜头 / 换剧本）时同步本地输入：用「渲染期派生重置」
   * （React 官方推荐的 You Might Not Need an Effect 形态，不进 effect）。 */
  const [syncedRating, setSyncedRating] = useState(rating ?? null);
  const [syncedVerdict, setSyncedVerdict] = useState(verdict);
  if ((rating ?? null) !== syncedRating) {
    setSyncedRating(rating ?? null);
    setLocalRating(rating ?? null);
  }
  if (verdict !== syncedVerdict) {
    setSyncedVerdict(verdict);
    setNote("");
  }

  // 反馈通道（~/lib/async-action 的形状）：成功清掉行内错误块，失败落一句话。
  const report: ActionReport = (kind, detail) => {
    setError(kind === "err" ? detail : "");
  };

  const submit = (pass: boolean) =>
    busy.run(async () => {
      setError("");
      const result = await runAsyncAction(() => onSubmit(pass, note.trim()), {
        report,
        failureText: "裁决失败",
        readResultEnvelope: false,
      });
      if (result.ok) {
        setNote("");
      }
    });

  const pickRating = async (value: number | null) => {
    const prev = localRating;
    setLocalRating(value);
    if (!onRatingChange) {
      return;
    }
    const result = await runAsyncAction(() => onRatingChange(value), {
      report,
      failureText: "评分失败",
      readResultEnvelope: false,
    });
    if (!result.ok) {
      setLocalRating(prev);
    }
  };

  return (
    <div className="border-subtle flex flex-col gap-2 rounded-md border p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-ink-faint text-xs">人工裁决（优先于 AI）</span>
        {onRatingChange && (
          <RatingStars
            disabled={disabled || busy.busy}
            onPick={(value) => {
              void pickRating(value);
            }}
            value={localRating}
          />
        )}
      </div>
      {verdict ? (
        <p className="text-ink-faintest text-2xs">
          人已拍板：{verdict.pass ? "通过" : "否决"}
          {verdict.note ? ` · ${verdict.note}` : ""}
          {verdict.at ? ` · ${verdict.at.slice(0, 10)}` : ""}
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        <Input
          className="h-7 min-w-0 flex-1 text-xs"
          disabled={disabled || busy.busy}
          maxLength={200}
          onChange={textHandler(setNote)}
          placeholder="一句话理由（可选）"
          value={note}
        />
        <Button
          disabled={disabled || busy.busy}
          onClick={() => {
            void submit(true);
          }}
          size="sm"
          type="button"
          variant="outline"
        >
          通过
        </Button>
        <Button
          disabled={disabled || busy.busy}
          onClick={() => {
            void submit(false);
          }}
          size="sm"
          type="button"
          variant="outline"
        >
          否决
        </Button>
      </div>
      {busy.busy && <p className="text-ink-fainter text-2xs">裁决中…</p>}
      {error && <p className="text-destructive text-2xs">{error}</p>}
    </div>
  );
}
