"use client";

/**
 * `CharacterCard` — 角色库网格里的单张角色卡（ISSUE #5009）：
 * 竖版立绘缩略图 + 名字 + 状态徽标 + 原型 + 质量分 + 特征标签（前几枚）。
 * 状态徽标放信息区、不压在立绘上（反馈：徽标挡图影响观看）。
 * 纯展示组件：数据与回调都由 CharacterLibrary 注入（规范 17 §17.2 第③层）。
 */
import { Trash2, UserRound } from "lucide-react";

import { Button } from "~/components/ui/button";
import { ViewableImage } from "~/components/ui/image-viewer";
import { TruncatedText } from "~/components/ui/truncated-text";
import { cn } from "~/lib/utils";

import { characterStatusClass, CHARACTER_STATUS_LABELS } from "./character-status";
import type { CharacterListItem } from "./hooks/use-character-library";

export type CharacterCardProps = {
  character: CharacterListItem;
  onOpenDetail: (id: string) => void;
  onRemove: (character: CharacterListItem) => void;
};

/** 卡面上最多展示几枚标签（其余进详情看）。 */
const CARD_TAG_LIMIT = 3;

export function CharacterCard({ character, onOpenDetail, onRemove }: CharacterCardProps) {
  const visibleTags = character.tags.slice(0, CARD_TAG_LIMIT);
  const hiddenTagCount = character.tags.length - visibleTags.length;
  return (
    <div
      className="group bg-card border-border-subtle relative flex flex-col overflow-hidden rounded-xl border transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/5 dark:hover:shadow-black/25"
      data-character-id={character.id}
    >
      {/* ── 竖版缩略图（3:4，与立绘生成尺寸同族）── */}
      <div className="bg-panel-deep relative aspect-3/4 w-full overflow-hidden">
        {character.portraitUrl !== null && character.portraitUrl !== "" ? (
          <ViewableImage
            alt={character.name}
            className="h-full w-full object-cover"
            label={character.name}
            src={character.portraitUrl}
          />
        ) : (
          <span className="text-ink-fainter flex size-full flex-col items-center justify-center gap-1 text-xs">
            <UserRound aria-hidden className="size-8" />
            {character.status === "failed" ? "生成失败" : "暂无立绘"}
          </span>
        )}
        {/* 删除入口（悬停浮现，与资产卡同纪律）。 */}
        <Button
          aria-label={`删除角色 ${character.name}`}
          className="hover:text-danger-strong absolute top-2 right-2 size-7 rounded-md bg-black/45 text-white opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
          onClick={() => {
            onRemove(character);
          }}
          size="icon-xs"
          variant="ghost"
        >
          <Trash2 aria-hidden className="size-3.5" data-icon="inline-start" />
        </Button>
      </div>

      {/* ── 信息区：名字 + 状态 + 原型 + 质量 + 标签（整块可点，进详情） ── */}
      <Button
        className="flex h-auto flex-col gap-1.5 p-3 text-left"
        onClick={() => {
          onOpenDetail(character.id);
        }}
        type="button"
        variant="ghost"
      >
        <TruncatedText className="text-ink-strong truncate text-sm font-medium">
          {character.name}
        </TruncatedText>
        {/* 状态徽标放信息区、不压在立绘上（ISSUE #5009 反馈：徽标挡图）。 */}
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "text-2xs rounded-full px-1.5 py-0.5 font-medium",
              characterStatusClass(character.status),
            )}
          >
            {CHARACTER_STATUS_LABELS[character.status] ?? character.status}
          </span>
          {character.qualityScore !== null && character.qualityScore !== undefined ? (
            <span
              className={cn(
                "text-2xs font-medium",
                character.qualityScore >= 80
                  ? "text-success-strong"
                  : character.qualityScore >= 60
                    ? "text-warning-strong"
                    : "text-danger-strong",
              )}
            >
              质量 {character.qualityScore}
            </span>
          ) : null}
        </div>
        <p className="text-ink-fainter text-2xs truncate">
          {character.archetype === "" ? "未设原型" : character.archetype}
          {character.gender === "" ? "" : ` · ${character.gender}`}
        </p>
        {character.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {visibleTags.map((tag) => (
              <span
                className="bg-primary-soft text-primary-strong text-2xs rounded-full px-1.5 py-0.5 font-medium"
                key={tag}
              >
                {tag}
              </span>
            ))}
            {hiddenTagCount > 0 ? (
              <span className="text-ink-fainter text-2xs py-0.5">+{hiddenTagCount}</span>
            ) : null}
          </div>
        ) : null}
      </Button>
    </div>
  );
}
