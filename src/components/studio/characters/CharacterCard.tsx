"use client";

/**
 * `CharacterCard` — 角色库网格里的单张角色卡（ISSUE #5009）：
 * 竖版立绘缩略图 + 名字（同行带原型徽标）+ 状态徽标 + 质量分 + 全部特征标签。
 * 状态徽标放信息区、不压在立绘上（反馈：徽标挡图影响观看）。
 * 纯展示组件：数据与回调都由 CharacterLibrary 注入（规范 17 §17.2 第③层）。
 */
import { memo } from "react";
import { Trash2, UserRound, X } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { ViewableImage } from "~/components/ui/image-viewer";
import { TruncatedText } from "~/components/ui/truncated-text";
import { cn } from "~/lib/utils";

import { characterStatusClass, CHARACTER_STATUS_LABELS } from "./character-status";
import type { CharacterListItem } from "./hooks/use-character-library";

export type CharacterCardProps = {
  /** 该角色的取消动作进行中（禁用入口，防连点）。 */
  cancellingGeneration?: boolean;
  character: CharacterListItem;
  onCancelGeneration?: (id: string) => void;
  onOpenDetail: (id: string) => void;
  onRemove: (id: string) => void;
  /** 选择模式下勾选本卡（由工具行「选择角色」开关驱动）。 */
  onToggleSelection?: (id: string) => void;
  /** 本卡是否已被勾选。 */
  selected?: boolean;
  /** 选择模式：勾选框出现在缩略图左上角。 */
  selectionMode?: boolean;
};

export const CharacterCard = memo(function CharacterCard({
  cancellingGeneration = false,
  character,
  onCancelGeneration,
  onOpenDetail,
  onRemove,
  onToggleSelection,
  selected = false,
  selectionMode = false,
}: CharacterCardProps) {
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
        {/* 选择模式的勾选框：与删除入口分居左上角 / 右上角，互不遮挡。 */}
        {selectionMode ? (
          <Checkbox
            aria-label={`选择角色 ${character.name}`}
            checked={selected}
            className="bg-panel/80 absolute top-2 left-2"
            onCheckedChange={() => {
              onToggleSelection?.(character.id);
            }}
          />
        ) : null}
        {/* 单条取消：只给「生成中且有任务号」的卡，与右上角删除入口分居两角。 */}
        {character.status === "generating" && character.taskId ? (
          <Button
            aria-label={`取消生成 ${character.name}`}
            className="absolute right-2 bottom-2 size-7 rounded-md bg-black/45 text-white"
            disabled={cancellingGeneration}
            onClick={() => {
              onCancelGeneration?.(character.id);
            }}
            size="icon-xs"
            variant="ghost"
          >
            <X aria-hidden className="size-3.5" data-icon="inline-start" />
          </Button>
        ) : null}
        {/* 删除入口（悬停浮现，与资产卡同纪律）。 */}
        <Button
          aria-label={`删除角色 ${character.name}`}
          className="hover:text-danger-strong absolute top-2 right-2 size-7 rounded-md bg-black/45 text-white opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
          onClick={() => {
            onRemove(character.id);
          }}
          size="icon-xs"
          variant="ghost"
        >
          <Trash2 aria-hidden className="size-3.5" data-icon="inline-start" />
        </Button>
      </div>

      {/* ── 信息区：名字 + 原型同行 + 状态 + 质量 + 全部标签（整块可点，进详情） ── */}
      <Button
        className="flex h-auto flex-col gap-1.5 p-3 text-left"
        onClick={() => {
          onOpenDetail(character.id);
        }}
        type="button"
        variant="ghost"
      >
        <div className="flex min-w-0 items-center gap-1.5" data-testid="character-name-row">
          {/* 长名字让位给原型：名字 flex-1 先截断，原型 shrink-0 恒在同行。 */}
          <TruncatedText className="text-ink-strong min-w-0 flex-1 truncate text-sm font-medium">
            {character.name}
          </TruncatedText>
          {character.archetype === "" ? null : (
            <span
              className="bg-primary-soft text-primary-strong text-2xs shrink-0 rounded-full px-1.5 py-0.5 font-medium"
              data-testid="character-archetype"
            >
              {character.archetype}
            </span>
          )}
        </div>
        {character.gender === "" ? null : (
          <p className="text-ink-fainter text-2xs truncate">{character.gender}</p>
        )}
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
        {character.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1" data-testid="character-tags">
            {character.tags.map((tag) => (
              <span
                className="bg-primary-soft text-primary-strong text-2xs rounded-full px-1.5 py-0.5 font-medium"
                key={tag}
              >
                {tag}
              </span>
            ))}
          </div>
        ) : null}
      </Button>
    </div>
  );
});
