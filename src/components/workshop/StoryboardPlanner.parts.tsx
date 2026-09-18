"use client";

import { Trash } from "lucide-react";
import { DarkSelect } from "~/components/studio/ui/DarkSelect";
import type { Shot, ShotType, Character, StyleRef } from "~/lib/workshop/types";
import { SHOT_TYPE_LABELS } from "~/lib/workshop/types";
import { Button } from "~/components/ui/button";
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

export function StatusBadge({ status }: { status: Shot["status"] }) {
  const map: Record<Shot["status"], { label: string; cls: string }> = {
    idle: { label: "待生成", cls: "bg-subtle text-muted-foreground" },
    queued: {
      label: "排队中",
      cls: "bg-amber-100 text-amber-800 dark:text-amber-300",
    },
    running: {
      label: "生成中",
      cls: "bg-blue-100 text-blue-800 dark:text-blue-300",
    },
    done: {
      label: "已完成",
      cls: "bg-emerald-100 text-emerald-800 dark:text-emerald-300",
    },
    failed: { label: "失败", cls: "bg-red-100 text-red-800 dark:text-red-300" },
    stale: {
      label: "待更新",
      cls: "bg-red-100 text-red-800 dark:text-red-300",
    },
  };
  const s = map[status];
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${s.cls}`}
    >
      {s.label}
    </span>
  );
}

export function ShotRow({
  shot,
  characters,
  styles,
  progressByShot,
  generating,
  polishBusy,
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
        <span className="bg-primary-soft text-primary grid h-6 w-6 place-items-center rounded-full text-xs font-semibold">
          {shot.index}
        </span>
        <span className="text-muted-foreground text-xs">
          {shot.sceneHeading}
        </span>
        <StatusBadge status={shot.status} />
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => onRemove(shot.id)}
          className="text-muted-foreground hover:text-danger-strong ml-auto"
          aria-label="删除镜头"
        >
          <Trash size={15} />
        </Button>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {/* Shot type */}
        <label className="block">
          <span className="text-muted-foreground mb-1 block text-xs">景别</span>
          <DarkSelect
            className="!bg-subtle !border-border text-xs"
            value={shot.shotType}
            onChange={(value) =>
              onUpdate(shot.id, { shotType: value as ShotType })
            }
            options={SHOT_TYPES}
            labels={SHOT_TYPE_LABELS as Record<string, string>}
            placeholder="选择景别"
          />
        </label>

        {/* Style */}
        <label className="block">
          <span className="text-muted-foreground mb-1 block text-xs">
            风格 Skill
          </span>
          <DarkSelect
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
        </label>
      </div>

      {/* Description */}
      <textarea
        value={shot.description}
        onChange={(event) =>
          onUpdate(shot.id, { description: event.target.value })
        }
        rows={2}
        className="border-border bg-bg focus:border-primary mt-2 w-full rounded-md border px-2 py-1.5 text-xs outline-none"
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
            <Button
              variant="ghost"
              size="xs"
              onClick={onPolish}
              disabled={polishBusy}
              title="用模型润色为更有画面感的提示词"
              className="text-primary hover:bg-primary/10 h-auto rounded px-1.5 py-0.5 text-[10px]"
            >
              {polishBusy ? "润色中…" : "✨ AI 润色"}
            </Button>
          )}
        </p>
        <p className="text-ink/80 text-xs leading-relaxed break-words">
          {shot.prompt || "填写描述后自动生成…"}
        </p>
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
          const pct = p?.pct ?? 0;
          return (
            <div className="mt-2" aria-live="polite">
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">
                  {p?.label ? `正在执行 ${p.label}` : "正在生成…"}
                </span>
                <span className="text-primary font-medium">{pct}%</span>
              </div>
              <div
                className="bg-subtle h-1.5 w-full overflow-hidden rounded-full"
                role="progressbar"
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="bg-primary h-full rounded-full transition-[width] duration-300"
                  style={{ width: `${pct}%` }}
                />
              </div>
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
        <img
          src={shot.imageUrl}
          alt={shot.sceneHeading}
          className="border-border mt-2 w-full rounded-lg border"
        />
      )}
    </div>
  );
}
