"use client";

// 产物图的「人工评分 + 收藏」行（FR-QA-07 人工侧 · #2480）：历史页任务卡与工坊
// 镜头卡里产物元数据面板的人工侧入口。评分 0~5（点当前分清除）是校准读数
// （`run.reviewCalibration`）的人侧输入；收藏是「优秀样本进 few-shot」沉淀机制的
// 输入。落库走 `setImageFeedback`（`task.setImageFeedback` 的 §17 出口）。
import { useState } from "react";
import { Bookmark, Star } from "lucide-react";

import { Button } from "~/components/ui/button";
import { errorMessage } from "~/lib/error-message";
import { setImageFeedback } from "~/lib/history-detail-actions";

export interface ImageFeedbackRowProps {
  image: {
    id: string;
    humanRating: number | null;
    isFavorite: boolean;
  };
}

export function ImageFeedbackRow({ image }: ImageFeedbackRowProps) {
  const [rating, setRatingState] = useState<number | null>(
    image.humanRating ?? null,
  );
  const [fav, setFav] = useState(image.isFavorite);
  const [error, setError] = useState("");

  const save = async (
    nextRating: number | null,
    nextFav: boolean,
    rollback: () => void,
  ) => {
    try {
      await setImageFeedback(image.id, {
        humanRating: nextRating,
        isFavorite: nextFav,
      });
      setError("");
    } catch (e) {
      rollback();
      setError(errorMessage(e, "保存失败"));
    }
  };

  const pickRating = (star: number) => {
    const prev = rating;
    const next = prev === star ? null : star;
    setRatingState(next);
    void save(next, fav, () => setRatingState(prev));
  };

  const toggleFav = () => {
    const prev = fav;
    const next = !prev;
    setFav(next);
    void save(rating, next, () => setFav(prev));
  };

  return (
    <div className="bg-surface-2/90 absolute right-1 bottom-1 left-1 flex items-center justify-between rounded-md px-1 py-0.5">
      <div className="flex items-center">
        {[1, 2, 3, 4, 5].map((star) => (
          <Button
            key={star}
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`${star} 星`}
            onClick={() => pickRating(star)}
            className="h-5 w-5"
          >
            <Star
              size={11}
              className={
                rating !== null && star <= rating
                  ? "fill-warning text-warning"
                  : "text-ink-faintest"
              }
            />
          </Button>
        ))}
        {rating !== null && (
          <span className="text-ink-faintest text-2xs">{rating}</span>
        )}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={fav ? "取消收藏" : "收藏"}
        onClick={toggleFav}
        className="h-5 w-5"
      >
        <Bookmark
          size={12}
          className={fav ? "fill-primary text-primary" : "text-ink-faintest"}
        />
      </Button>
      {error && <span className="text-destructive text-2xs">{error}</span>}
    </div>
  );
}
