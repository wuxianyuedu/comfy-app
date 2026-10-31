"use client";

// 角色卡「AI 评审」入口 + 弹窗（Phase 8 · P8-1b 续）。
//
// 弹窗骨架（按钮 / 判定展示 / 占位 / 在途）在 `ReviewVerdictDialogButton`（§12.12
// 共享内核）；本壳只装配角色卡场景：评审对象是这张卡（`review(character.id)`）、
// 不带维度评分与改写（角色卡是可直接编辑的设定，不合格时修法就是照建议改上方字段、
// 再用既有「定妆照」通道重出）。projectId 取自当前活跃项目（getActiveId，与工坊同源）。
import { useState } from "react";

import { getActiveId } from "~/lib/project-canvas/canvas-store";
import type { Character } from "~/lib/workshop/types";

import { ReviewVerdictDialogButton } from "./ReviewVerdictDialogButton";
import { useCharacterReview } from "./hooks/use-character-review";

export interface CharacterReviewButtonProps {
  character: Character;
}

export function CharacterReviewButton({ character }: CharacterReviewButtonProps) {
  const [projectId] = useState<string>(() => getActiveId() ?? "");
  const review = useCharacterReview(projectId);

  return (
    <ReviewVerdictDialogButton
      busyText="正在评审…"
      controller={{
        verdict: review.verdict,
        busy: review.reviewing,
        error: review.error,
        review: () => review.review(character.id),
      }}
      description="由 AI 对这张角色卡的文本设定做质检；不合格请照建议改上方字段后重出定妆照。"
      label="AI 评审这张角色卡"
      title={`角色卡评审 · ${character.name || "未命名角色"}`}
    />
  );
}
