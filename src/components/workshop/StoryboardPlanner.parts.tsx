"use client";

import { Trash } from "lucide-react";
import { Hint } from "~/components/ui/hint";
import { SelectMenu } from "~/components/ui/select-menu";
import { FormField } from "~/components/ui/form-field";
import type { Shot, ShotType, Character, StyleRef } from "~/lib/workshop/types";
import { SHOT_TYPES, SHOT_TYPE_LABELS } from "~/lib/workshop/types";
import { Button } from "~/components/ui/button";
import { StatusBadge } from "~/components/ui/status-badge";
import { ProgressBar } from "~/components/ui/progress-bar";
import { MediaThumbnail } from "~/components/ui/media-thumbnail";
import { IndexDot } from "~/components/workshop/IndexDot";
import { Textarea } from "~/components/ui/textarea";
import { SHOT_STATUS_LABEL } from "./shot-status-config";
import type { ShotProgress } from "./useStoryboardPlanner";

/* 镜头状态标签 —— 配色与文案都走与 ShotStudio 同一处（此前两处各写一份
 * 逐字相同的 map，改状态色要点两遍名；规范 16 §16.2.4.5）。 */
export function ShotStatusBadge({ status }: { status: Shot["status"] }) {
  return (
    <StatusBadge
      className="text-3xs px-2 py-0.5"
      dot={false}
      label={SHOT_STATUS_LABEL[status]}
      status={status}
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
  characters: Array<Character>;
  generating: boolean;
  onGenerate: (shot: Shot) => void;
  onPolish?: () => void;
  onRemove: (id: string) => void;
  onUpdate: (id: string, patch: Partial<Shot>) => void;
  /** 该镜头的 AI 提示词润色进行中 */
  polishBusy?: boolean;
  /** 该镜头润色失败的文案（错误挂在**这一条**上，规范 16 §16.2.4.33）。 */
  polishError?: string | null;
  progressByShot?: ShotProgress;
  shot: Shot;
  styles: Array<StyleRef>;
}) {
  const linkedChars = characters.filter((character) => shot.characterIds.includes(character.id));
  /* 本镜头的实时生成进度（ComfyUI 当前节点 + 百分比）。 */
  const progress = progressByShot?.[shot.id];
  return (
    <div className="border-border bg-surface rounded-xl border p-4">
      <div className="mb-2 flex items-center gap-2">
        <IndexDot index={shot.index} />
        <span className="text-muted-foreground text-xs">{shot.sceneHeading}</span>
        <ShotStatusBadge status={shot.status} />
        <Button
          aria-label="删除镜头"
          className="text-muted-foreground hover:text-danger-strong ml-auto"
          onClick={() => {
            onRemove(shot.id);
          }}
          size="icon-sm"
          variant="ghost"
        >
          <Trash data-icon="inline-start" size={15} />
        </Button>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {/* Shot type */}
        <FormField label="景别" labelClassName="text-muted-foreground mb-1 text-xs">
          {(field) => (
            <SelectMenu
              {...field}
              className="bg-subtle! border-border! text-xs"
              labels={/* SAFETY: 类型断言已复核 */ SHOT_TYPE_LABELS as Record<string, string>}
              onChange={(value) => {
                onUpdate(shot.id, {
                  /* SAFETY: 类型断言已复核 */
                  shotType: value as ShotType,
                });
              }}
              /* 清单的唯一出处是 readonly（类型由它派生），而 `SelectMenu.options` 至今是
               * 可变 `string[]` —— 这一份浅拷贝是两边口径的接缝，不是新的真相。 */
              options={[...SHOT_TYPES]}
              placeholder="选择景别"
              value={shot.shotType}
            />
          )}
        </FormField>

        {/* Style */}
        <FormField label="风格 Skill" labelClassName="text-muted-foreground mb-1 text-xs">
          {(field) => (
            <SelectMenu
              {...field}
              className="bg-subtle! border-border! text-xs"
              labels={Object.fromEntries(
                styles.map((style) => [style.slug, `${style.icon} ${style.name}`]),
              )}
              onChange={(value) => {
                onUpdate(shot.id, { skillSlug: value || undefined });
              }}
              options={styles.map((style) => style.slug)}
              placeholder="跟随角色/默认"
              value={shot.skillSlug ?? ""}
            />
          )}
        </FormField>
      </div>

      {/* Description */}
      <Textarea
        className="field-sizing-normal border-border bg-bg text-ink placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/30 mt-2 min-h-0 rounded-md px-2 py-1.5 text-xs"
        onChange={(event) => {
          onUpdate(shot.id, { description: event.target.value });
        }}
        placeholder="画面描述（留空则使用场景动作描述）"
        rows={2}
        value={shot.description}
      />

      {/* 角色多选 */}
      {characters.length > 0 && (
        <div className="mt-2">
          <span className="text-muted-foreground mb-1 block text-xs">出场角色</span>
          <div className="flex flex-wrap gap-1.5">
            {characters.map((character) => {
              const on = shot.characterIds.includes(character.id);
              return (
                <Button
                  className="h-auto rounded-full px-2 py-0.5"
                  key={character.id}
                  onClick={() => {
                    onUpdate(shot.id, {
                      characterIds: on
                        ? shot.characterIds.filter((id) => id !== character.id)
                        : [...shot.characterIds, character.id],
                    });
                  }}
                  size="xs"
                  variant={on ? "default" : "outline"}
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
                className="text-primary hover:bg-primary/10 text-3xs h-auto rounded px-1.5 py-0.5"
                disabled={polishBusy}
                onClick={onPolish}
                size="xs"
                variant="ghost"
              >
                {polishBusy ? "润色中…" : "✨ AI 润色"}
              </Button>
            </Hint>
          )}
        </p>
        <p className="text-ink/80 text-xs leading-relaxed wrap-break-word">
          {shot.prompt || "填写描述后自动生成…"}
        </p>
        {polishError && <p className="text-danger-strong text-2xs mt-1">{polishError}</p>}
        {linkedChars.length > 0 && (
          <p className="text-primary/70 mt-1 text-xs">
            关联角色：
            {linkedChars.map((linkedChar) => linkedChar.name || "未命名").join("、")}
          </p>
        )}
      </div>

      {/* 节点上的实时生成进度：ComfyUI 当前节点 + 百分比。ComfyUI 还没报
          进度（`pct` 未定义）时是**不确定态**，不是 0% —— 此前 `?? 0`
          把它画成空条，看起来像「卡住没动」。 */}
      {shot.status === "running" && (
        <div aria-live="polite" className="mt-2">
          <ProgressBar
            label={progress?.label ? `正在执行 ${progress.label}` : "正在生成…"}
            value={progress?.pct ?? null}
          />
        </div>
      )}

      {/* Generate button */}
      <Button
        className="mt-2 h-auto w-full rounded-lg py-2"
        disabled={shot.status === "running" || generating || !shot.prompt}
        onClick={() => {
          onGenerate(shot);
        }}
        size="xs"
        variant="primary-solid"
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
          alt={shot.sceneHeading}
          className="border-border mt-2 w-full rounded-lg border"
          src={shot.imageUrl}
        />
      )}
    </div>
  );
}
