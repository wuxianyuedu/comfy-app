"use client";

import { Trash } from "lucide-react";
import { DarkSelect } from "@/components/studio/ui/DarkSelect";
import type { Shot, ShotType, Character, StyleRef } from "@/lib/workshop/types";
import { SHOT_TYPE_LABELS } from "@/lib/workshop/types";
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
    queued: { label: "排队中", cls: "bg-amber-100 text-amber-700" },
    running: { label: "生成中", cls: "bg-blue-100 text-blue-700" },
    done: { label: "已完成", cls: "bg-emerald-100 text-emerald-700" },
    failed: { label: "失败", cls: "bg-red-100 text-red-700" },
    stale: { label: "待更新", cls: "bg-red-100 text-red-700" },
  };
  const s = map[status];
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${s.cls}`}>{s.label}</span>
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
  const linkedChars = characters.filter((character) => shot.characterIds.includes(character.id));
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="grid h-6 w-6 place-items-center rounded-full bg-primary-soft text-xs font-semibold text-primary">
          {shot.index}
        </span>
        <span className="text-xs text-muted-foreground">{shot.sceneHeading}</span>
        <StatusBadge status={shot.status} />
        <button
          type="button"
          onClick={() => onRemove(shot.id)}
          className="ml-auto text-muted-foreground hover:text-red-500"
          aria-label="删除镜头"
        >
          <Trash size={15} />
        </button>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {/* Shot type */}
        <label className="block">
          <span className="mb-1 block text-xs text-muted-foreground">景别</span>
          <DarkSelect
            className="!bg-white/3 !border-white/8 text-xs"
            value={shot.shotType}
            onChange={(value) => onUpdate(shot.id, { shotType: value as ShotType })}
            options={SHOT_TYPES}
            labels={SHOT_TYPE_LABELS as Record<string, string>}
            placeholder="选择景别"
          />
        </label>

        {/* Style */}
        <label className="block">
          <span className="mb-1 block text-xs text-muted-foreground">风格 Skill</span>
          <DarkSelect
            className="!bg-white/3 !border-white/8 text-xs"
            value={shot.skillSlug ?? ""}
            onChange={(value) => onUpdate(shot.id, { skillSlug: value || undefined })}
            options={styles.map((style) => style.slug)}
            labels={Object.fromEntries(styles.map((style) => [style.slug, `${style.icon} ${style.name}`]))}
            placeholder="跟随角色/默认"
          />
        </label>
      </div>

      {/* Description */}
      <textarea
        value={shot.description}
        onChange={(event) => onUpdate(shot.id, { description: event.target.value })}
        rows={2}
        className="mt-2 w-full rounded-md border border-border bg-bg px-2 py-1.5 text-xs outline-none focus:border-primary"
        placeholder="画面描述（留空则使用场景动作描述）"
      />

      {/* Character multi-select */}
      {characters.length > 0 && (
        <div className="mt-2">
          <span className="mb-1 block text-xs text-muted-foreground">出场角色</span>
          <div className="flex flex-wrap gap-1.5">
            {characters.map((character) => {
              const on = shot.characterIds.includes(character.id);
              return (
                <button
                  key={character.id}
                  type="button"
                  onClick={() =>
                    onUpdate(shot.id, {
                      characterIds: on
                        ? shot.characterIds.filter((id) => id !== character.id)
                        : [...shot.characterIds, character.id],
                    })
                  }
                  className={`rounded-full px-2 py-0.5 text-xs transition-colors ${
                    on
                      ? "bg-primary text-white"
                      : "border border-border text-muted-foreground hover:text-ink"
                  }`}
                >
                  {character.name || "未命名"}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Prompt preview */}
      <div className="mt-3 rounded-lg bg-subtle p-3">
        <p className="mb-1 flex items-center justify-between text-xs font-medium text-muted-foreground">
          生图提示词
          {onPolish && (
            <button
              type="button"
              onClick={onPolish}
              disabled={polishBusy}
              title="用模型润色为更有画面感的提示词"
              className="rounded px-1.5 py-0.5 text-[10px] text-primary hover:bg-primary/10 disabled:opacity-40"
            >
              {polishBusy ? "润色中…" : "✨ AI 润色"}
            </button>
          )}
        </p>
        <p className="text-xs leading-relaxed text-ink/80 break-words">
          {shot.prompt || "填写描述后自动生成…"}
        </p>
        {linkedChars.length > 0 && (
          <p className="mt-1 text-xs text-primary/70">
            关联角色：{linkedChars.map((linkedChar) => linkedChar.name || "未命名").join("、")}
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
                <span className="font-medium text-primary">{pct}%</span>
              </div>
              <div
                className="h-1.5 w-full overflow-hidden rounded-full bg-subtle"
                role="progressbar"
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-300"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })()}

      {/* Generate button */}
      <button
        type="button"
        onClick={() => onGenerate(shot)}
        disabled={shot.status === "running" || generating || !shot.prompt}
        className="mt-2 w-full rounded-lg bg-primary/90 py-2 text-xs font-medium text-white transition-opacity disabled:opacity-40"
      >
        {shot.status === "running"
          ? progressByShot?.[shot.id]
            ? `生成中 ${progressByShot[shot.id]?.pct ?? 0}%`
            : "生成中…"
          : shot.status === "done"
            ? "重新生成"
            : "生成此镜头"}
      </button>

      {shot.imageUrl && (
        <img
          src={shot.imageUrl}
          alt={shot.sceneHeading}
          className="mt-2 w-full rounded-lg border border-border"
        />
      )}
    </div>
  );
}
