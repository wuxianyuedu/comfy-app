"use client";

import { Trash } from "lucide-react";
import { Hint } from "~/components/ui/hint";
import { SelectMenu } from "~/components/ui/select-menu";
import { FormField } from "~/components/ui/form-field";
import type { Shot, ShotType, Character, StyleRef } from "~/lib/workshop/types";
import { SHOT_TYPE_LABELS } from "~/lib/workshop/types";
import { Button } from "~/components/ui/button";
import { StatusBadge } from "~/components/ui/status-badge";
import { ProgressBar } from "~/components/ui/progress-bar";
import { MediaThumbnail } from "~/components/ui/media-thumbnail";
import { Textarea } from "~/components/ui/textarea";
import { SHOT_STATUS_LABEL } from "./ShotStudio";
import type { ShotProgress } from "./useStoryboardPlanner";

const SHOT_TYPES: ShotType[] = [
  "extreme_wide",
  "wide",
  "full",
  "medium",
  "close",
  "extreme_close",
  "poi",
  "pod",
];

/* 镜头状态标签 —— 配色与文案都走与 ShotStudio 同一处（此前两处各写一份
 * 逐字相同的 map，改状态色要点两遍名；规范 16 §16.2.4.5）。 */
export function ShotStatusBadge({ status }: { status: Shot["status"] }) {
  return (
    <StatusBadge
      status={status}
      label={SHOT_STATUS_LABEL[status]}
      dot={false}
      className="px-2 py-0.5 text-[10px]"
    />
  );
}

export function ShotRow({
  shot,
  characters,
  styles,
  progressByShot,
  generating,
  polishBusy,
  polishError,
  onPolish,
  onUpdate,
  onRemove,
  onGenerate,
}: {
  shot: Shot;
  characters: Character[];
  styles: StyleRef[];
  progressByShot?: ShotProgress;
  generating: boolean;
  /** 该镜头的 AI 提示词润色进行中 */
  polishBusy?: boolean;
  /** 该镜头润色失败的文案（错误挂在**这一条**上，规范 16 §16.2.4.33）。 */
  polishError?: string | null;
  onPolish?: () => void;
  onUpdate: (id: string, patch: Partial<Shot>) => void;
  onRemove: (id: string) => void;
  onGenerate: (shot: Shot) => void;
}) {
  const linkedChars = characters.filter((character) =>
    shot.characterIds.includes(character.id),
  );
  return (
    <div className="border-border bg-surface rounded-xl border p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="bg-primary-soft text-primary grid size-6 place-items-center rounded-full text-xs font-semibold">
          {shot.index}
        </span>
        <span className="text-muted-foreground text-xs">
          {shot.sceneHeading}
        </span>
        <ShotStatusBadge status={shot.status} />
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => onRemove(shot.id)}
          className="text-muted-foreground hover:text-danger-strong ml-auto"
          aria-label="删除镜头"
        >
          <Trash data-icon="inline-start" size={15} />
        </Button>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {/* Shot type */}
        <FormField
          label="景别"
          labelClassName="text-muted-foreground mb-1 text-xs"
        >
          <SelectMenu
            className="!bg-subtle !border-border text-xs"
            value={shot.shotType}
            onChange={(value) =>
              onUpdate(shot.id, { shotType: value as ShotType })
            }
            options={SHOT_TYPES}
            labels={SHOT_TYPE_LABELS as Record<string, string>}
            placeholder="选择景别"
          />
        </FormField>

        {/* Style */}
        <FormField
          label="风格 Skill"
          labelClassName="text-muted-foreground mb-1 text-xs"
        >
          <SelectMenu
            className="!bg-subtle !border-border text-xs"
            value={shot.skillSlug ?? ""}
            onChange={(value) =>
              onUpdate(shot.id, { skillSlug: value || undefined })
            }
            options={styles.map((style) => style.slug)}
            labels={Object.fromEntries(
              styles.map((style) => [
                style.slug,
                `${style.icon} ${style.name}`,
              ]),
            )}
            placeholder="跟随角色/默认"
          />
        </FormField>
      </div>

      {/* Description */}
      <Textarea
        value={shot.description}
        onChange={(event) =>
          onUpdate(shot.id, { description: event.target.value })
        }
        rows={2}
        className="field-sizing-normal border-border bg-bg text-ink placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/30 mt-2 min-h-0 rounded-md px-2 py-1.5 text-xs"
        placeholder="画面描述（留空则使用场景动作描述）"
      />

      {/* 角色多选 */}
      {characters.length > 0 && (
        <div className="mt-2">
          <span className="text-muted-foreground mb-1 block text-xs">
            出场角色
          </span>
          <div className="flex flex-wrap gap-1.5">
            {characters.map((character) => {
              const on = shot.characterIds.includes(character.id);
              return (
                <Button
                  key={character.id}
                  variant={on ? "default" : "outline"}
                  size="xs"
                  onClick={() =>
                    onUpdate(shot.id, {
                      characterIds: on
                        ? shot.characterIds.filter((id) => id !== character.id)
                        : [...shot.characterIds, character.id],
                    })
                  }
                  className="h-auto rounded-full px-2 py-0.5"
                >
                  {character.name || "未命名"}
                </Button>
              );
            })}
          </div>
        </div>
      )}

      {/* Prompt preview */}
      <div className="bg-subtle mt-3 rounded-lg p-3">
        <p className="text-muted-foreground mb-1 flex items-center justify-between text-xs font-medium">
          生图提示词
          {onPolish && (
            <Hint label="用模型润色为更有画面感的提示词" wrap>
              <Button
                variant="ghost"
                size="xs"
                onClick={onPolish}
                disabled={polishBusy}
                className="text-primary hover:bg-primary/10 h-auto rounded px-1.5 py-0.5 text-[10px]"
              >
                {polishBusy ? "润色中…" : "✨ AI 润色"}
              </Button>
            </Hint>
          )}
        </p>
        <p className="text-ink/80 text-xs leading-relaxed break-words">
          {shot.prompt || "填写描述后自动生成…"}
        </p>
        {polishError && (
          <p className="text-danger-strong mt-1 text-[11px]">{polishError}</p>
        )}
        {linkedChars.length > 0 && (
          <p className="text-primary/70 mt-1 text-xs">
            关联角色：
            {linkedChars
              .map((linkedChar) => linkedChar.name || "未命名")
              .join("、")}
          </p>
        )}
      </div>

      {/* 节点上的实时生成进度：ComfyUI 当前节点 + 百分比 */}
      {shot.status === "running" &&
        (() => {
          const p = progressByShot?.[shot.id];
          /* ComfyUI 还没报进度（`pct` 未定义）时是**不确定态**，不是 0%
             —— 此前 `?? 0` 把它画成空条，看起来像「卡住没动」。 */
          const pct = p?.pct ?? null;
          return (
            <div className="mt-2" aria-live="polite">
              <ProgressBar
                value={pct}
                label={p?.label ? `正在执行 ${p.label}` : "正在生成…"}
              />
            </div>
          );
        })()}

      {/* Generate button */}
      <Button
        variant="primary-solid"
        size="xs"
        onClick={() => onGenerate(shot)}
        disabled={shot.status === "running" || generating || !shot.prompt}
        className="mt-2 h-auto w-full rounded-lg py-2"
      >
        {shot.status === "running"
          ? progressByShot?.[shot.id]
            ? `生成中 ${progressByShot[shot.id]?.pct ?? 0}%`
            : "生成中…"
          : shot.status === "done"
            ? "重新生成"
            : "生成此镜头"}
      </Button>

      {shot.imageUrl && (
        <MediaThumbnail
          src={shot.imageUrl}
          alt={shot.sceneHeading}
          className="border-border mt-2 w-full rounded-lg border"
        />
      )}
    </div>
  );
}
