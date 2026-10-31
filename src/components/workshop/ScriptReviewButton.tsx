"use client";

// 剧本「AI 评审 / 定向改写」入口 + 弹窗（FR-QA-07 ④ · #2478 + 人工侧 #2480）。
//
// 弹窗骨架（按钮 / 判定展示 / 占位 / 在途 / 轮次曲线）在 `ReviewVerdictDialogButton`
// （§12.12 共享内核）；本壳装配剧本场景：注入 rubric 人读维度名、完整分数曲线，
// 并提供「按意见改写」（`use-script-review` 的 revise 在改写成功后把新剧本交回
// 编辑器、再自动复评一轮 —— 闭环在界面侧一次点击走完）。
// 人工侧（#2480）：弹窗内嵌 `HumanVerdictRow` —— 人看完 AI 评审直接拍板
// （通过 / 否决 + 理由，走 `run.setScriptHumanVerdict`，裁决快照带剧本指纹，
// 人通过的剧本 AI 不再复评）。
// projectId 取自当前活跃项目（getActiveId，与工坊同源）。
import { useMemo, useState } from "react";

import { getActiveId } from "~/lib/project-canvas/canvas-store";
import { rubricFor } from "~/lib/production/review-rubrics";
import type { HumanVerdict } from "~/lib/production/review-types";
import { setScriptHumanVerdict } from "~/lib/production/run-client";
import { useToast } from "~/components/studio/ToastProvider";

import { HumanVerdictRow } from "./HumanVerdictRow";
import { ReviewVerdictDialogButton } from "./ReviewVerdictDialogButton";
import { useScriptReview } from "./hooks/use-script-review";

export type ScriptReviewButtonProps = {
  /** 定向改写成功后把新剧本交回编辑器 / 预览（人机接力：人可接着手改）。 */
  onScriptRevised: (markdown: string) => void;
};

export function ScriptReviewButton({ onScriptRevised }: ScriptReviewButtonProps) {
  const [projectId] = useState<string>(() => getActiveId() ?? "");
  const review = useScriptReview(projectId, onScriptRevised);
  const toast = useToast();
  /** 本次会话内提交过的剧本人工裁决（落库返回值回显）。 */
  const [scriptVerdict, setScriptVerdict] = useState<HumanVerdict | null>(null);
  /** 剧本 rubric 的维度 key → 人读名（分数条展示用）。 */
  const dimensionLabels = useMemo(() => {
    const rubric = rubricFor("script");
    return new Map((rubric?.dimensions ?? []).map((d) => [d.key, d.label]));
  }, []);

  return (
    <ReviewVerdictDialogButton
      busyText={review.revising ? "正在按意见改写…" : "正在评审…"}
      controller={{
        verdict: review.verdict,
        history: review.history,
        busy: review.reviewing || review.revising,
        error: review.error,
        review: () => review.review(),
        revise: () => review.revise(),
      }}
      description="由 AI 按评分量表给这份剧本打分；不合格可「按意见改写」定向打磨，旧版自动留档。"
      dimensionLabels={dimensionLabels}
      footerExtra={
        <HumanVerdictRow
          onSubmit={async (pass, note) => {
            const saved = await setScriptHumanVerdict(projectId, pass, note);
            setScriptVerdict(saved);
            toast.success(pass ? "已人工通过：剧本定稿" : "已人工否决：请修改后再评");
          }}
          verdict={scriptVerdict}
        />
      }
      label="AI 评审这份剧本"
      title="剧本评审"
    />
  );
}
