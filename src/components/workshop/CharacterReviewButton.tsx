"use client";

// 角色卡「AI 评审」入口 + 弹窗（Phase 8 · P8-1b 续）。
//
// 自包含：一个「评审」按钮 + 一个受控弹窗，内部用 `useCharacterReview` 走 run-client。
// 打开即评审该角色卡（名字 / 外貌 / 服装 / 性格 文本），展示「过 / 不过 + 逐条缺陷 + 改进建议」。
// 角色卡是可直接编辑的设定，不合格时修法就是照建议改上方字段、再用既有「定妆照」通道重出，
// 故这里只提供「重新评审」，不另造重生成端点。projectId 取自当前活跃项目（getActiveId，与工坊同源）。
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
import { getActiveId } from "~/lib/project-canvas/canvas-store";
import type { Character } from "~/lib/workshop/types";

import { useCharacterReview } from "./hooks/use-character-review";
import { Hint } from "~/components/ui/hint";

export interface CharacterReviewButtonProps {
  character: Character;
}

export function CharacterReviewButton({
  character,
}: CharacterReviewButtonProps) {
  const [open, setOpen] = useState(false);
  const [projectId] = useState<string>(() => getActiveId() ?? "");
  const review = useCharacterReview(projectId);

  /* 每次打开重新评一次 —— 卡片字段可能刚被改过，旧判定不作数。 */
  useEffect(() => {
    if (!open) return;
    void review.review(character.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, character.id]);

  const { verdict, reviewing, error } = review;

  return (
    <>
      <Hint label="AI 评审这张角色卡">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setOpen(true)}
          aria-label="AI 评审这张角色卡"
          className="text-ink-soft hover:bg-primary/15"
        >
          <ClipboardCheck data-icon="inline-start" size={16} />
        </Button>
      </Hint>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              角色卡评审 · {character.name || "未命名角色"}
            </DialogTitle>
            <DialogDescription>
              由 AI
              对这张角色卡的文本设定做质检；不合格请照建议改上方字段后重出定妆照。
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

          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              disabled={reviewing}
              onClick={() => void review.review(character.id)}
            >
              重新评审
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
