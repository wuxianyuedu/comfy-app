"use client";

/**
 * `CharacterDetailModal` — 角色详情弹窗（ISSUE #5009）：左侧立绘预览（含候选
 * 立绘切换），右侧档案：原型 / 性别 / 状态 / 完整描述 / 全部特征标签。
 * 操作：「重新生图」（新候选，不覆盖旧图）与「删除」。
 * 纯展示组件：数据与回调由 CharacterLibrary 注入（规范 17 §17.2 第③层）。
 */
import { useState } from "react";
import { Gauge, RefreshCw, SquarePen, Trash2 } from "lucide-react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { MediaThumbnail } from "~/components/ui/media-thumbnail";
import { ViewableImage } from "~/components/ui/image-viewer";
import { cn } from "~/lib/utils";

import { characterStatusClass, CHARACTER_STATUS_LABELS } from "./character-status";
import type { CharacterDetail } from "./hooks/use-character-library";

export type CharacterDetailModalProps = {
  character: CharacterDetail | null;
  onClose: () => void;
  onEdit: (id: string) => void;
  onRegenerate: (id: string) => void;
  onRemove: (id: string) => void;
  onScore: (id: string) => void;
  /** 弹层开关：详情 id 非空才开——查询的 pending 态不能当开关。 */
  open: boolean;
  regenerating: boolean;
  scoring: boolean;
};

/** 候选立绘条里展示的张数上限（详情弹窗宽度有限，其余在库里）。 */
const DETAIL_PORTRAIT_LIMIT = 8;

export function CharacterDetailModal({
  character,
  onClose,
  onEdit,
  onRegenerate,
  onRemove,
  onScore,
  open,
  regenerating,
  scoring,
}: CharacterDetailModalProps) {
  const [portraitIndex, setPortraitIndex] = useState(0);
  const portraits = character?.portraits ?? [];
  /* 候选列表最新在前（路由回写时新图插到最前），portraitUrl 恒等于第 0 张。 */
  const activePortrait = portraits[portraitIndex]?.url ?? character?.portraitUrl ?? null;
  const shown = portraits.slice(0, DETAIL_PORTRAIT_LIMIT);

  return (
    <Dialog
      onOpenChange={(next) => {
        if (!next) {
          onClose();
        }
      }}
      open={open}
    >
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{character?.name ?? "角色详情"}</DialogTitle>
          <DialogDescription>
            {character === null
              ? "加载中…"
              : [
                  character.archetype === "" ? "未设原型" : character.archetype,
                  character.gender,
                  CHARACTER_STATUS_LABELS[character.status] ?? character.status,
                ]
                  .filter((part) => part !== "" && part !== undefined)
                  .join(" · ")}
          </DialogDescription>
        </DialogHeader>
        {character === null ? null : (
          <div className="flex gap-4">
            {/* ── 左：立绘预览 + 候选切换 ── */}
            <div className="w-56 shrink-0">
              <div className="bg-panel-deep aspect-3/4 w-full overflow-hidden rounded-lg">
                {activePortrait === null ? (
                  <span className="text-ink-fainter flex size-full items-center justify-center text-xs">
                    {character.status === "failed" ? "最近一次生成失败" : "暂无立绘"}
                  </span>
                ) : (
                  <ViewableImage
                    alt={character.name}
                    className="h-full w-full object-cover"
                    label={character.name}
                    src={activePortrait}
                  />
                )}
              </div>
              {shown.length > 1 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {shown.map((portrait, index) => (
                    <Button
                      aria-label={`查看第 ${index + 1} 张候选立绘`}
                      className={cn(
                        "bg-panel-deep size-10 overflow-hidden rounded-md border p-0",
                        portraitIndex === index
                          ? "border-primary-strong"
                          : "border-transparent opacity-70",
                      )}
                      key={portrait.url}
                      onClick={() => {
                        setPortraitIndex(index);
                      }}
                      type="button"
                      variant="ghost"
                    >
                      {/* 候选缩略图：MediaThumbnail 带加载失败兜底（P18：不裸写 img）。 */}
                      <MediaThumbnail
                        alt=""
                        className="size-full object-cover"
                        src={portrait.url}
                      />
                    </Button>
                  ))}
                </div>
              ) : null}
            </div>

            {/* ── 右：档案描述 + 标签 + 操作 ── */}
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <div className="custom-scrollbar max-h-64 overflow-y-auto">
                <p className="text-ink-strong text-sm leading-relaxed whitespace-pre-wrap">
                  {character.description}
                </p>
              </div>
              {character.tags.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {character.tags.map((tag) => (
                    <Badge key={tag} variant="secondary">
                      {tag}
                    </Badge>
                  ))}
                </div>
              ) : null}
              {character.qualityScore !== null && character.qualityScore !== undefined ? (
                <div className="flex flex-col gap-1">
                  <p
                    className={cn(
                      "text-xs font-medium",
                      character.qualityScore >= 80
                        ? "text-success-strong"
                        : character.qualityScore >= 60
                          ? "text-warning-strong"
                          : "text-danger-strong",
                    )}
                  >
                    质量分 {character.qualityScore} / 100
                  </p>
                  {(character.qualityIssues ?? []).length > 0 ? (
                    <ul className="text-ink-fainter text-2xs list-disc pl-4">
                      {(character.qualityIssues ?? []).map((issue) => (
                        <li key={issue}>{issue}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
              <div className="mt-auto flex items-center gap-2">
                <Button
                  onClick={() => {
                    onRegenerate(character.id);
                  }}
                  size="sm"
                  type="button"
                >
                  <RefreshCw aria-hidden className="size-3.5" data-icon="inline-start" />
                  {regenerating ? "入队中…" : "重新生图"}
                </Button>
                <Button
                  disabled={scoring}
                  onClick={() => {
                    onScore(character.id);
                  }}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <Gauge aria-hidden className="size-3.5" data-icon="inline-start" />
                  {scoring ? "打分中…" : "打分"}
                </Button>
                <Button
                  onClick={() => {
                    onEdit(character.id);
                  }}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <SquarePen aria-hidden className="size-3.5" data-icon="inline-start" />
                  编辑
                </Button>
                <Button
                  onClick={() => {
                    onRemove(character.id);
                  }}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <Trash2 aria-hidden className="size-3.5" data-icon="inline-start" />
                  删除
                </Button>
                <span
                  className={cn(
                    "text-2xs ml-auto rounded-full px-2 py-0.5 font-medium",
                    characterStatusClass(character.status),
                  )}
                >
                  {CHARACTER_STATUS_LABELS[character.status] ?? character.status}
                </span>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
