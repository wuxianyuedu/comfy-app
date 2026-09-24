"use client";
import { clamp } from "~/lib/clamp";
import React from "react";
import { Icon } from "~/components/ui/icon";
import { Button } from "~/components/ui/button";
import { downloadJson } from "~/lib/browser-io";
import { fixed } from "~/lib/number-format";
import { SelectMenu } from "~/components/ui/select-menu";
import { MediaThumbnail } from "~/components/ui/media-thumbnail";
import { FormField } from "~/components/ui/form-field";
import { Input } from "~/components/ui/input";
import {
  MOTION_LABELS,
  TRANSITION_LABELS,
  type MotionLevel,
  type Shot,
  type Transition,
} from "~/lib/workshop/types";

interface Props {
  shots: Shot[];
  title: string;
  /** 镜头列表所有者回调（时长 / 转场 / 运动编辑）。 */
  onShotsChange: (shots: Shot[]) => void;
  /** Raised when the user exports the composition plan (成片产出物完成). */
  onRendered: () => void;
  rendered: boolean;
}

const TRANSITIONS: Transition[] = ["cut", "dissolve", "fade"];
const MOTIONS: MotionLevel[] = ["low", "medium", "high"];

/** 顺序播放预览中的一个时间线条目。 */
interface TimelineEntry {
  shot: Shot;
  duration: number;
}

const MOTION_PROMPTS: Record<MotionLevel, string> = {
  low: "subtle motion, gentle camera drift",
  medium: "moderate motion, smooth camera movement",
  high: "dynamic motion, dramatic camera movement",
};

/** 供视频阶段复用的运动提示词后缀。 */
export function motionPromptSuffix(motion: MotionLevel | undefined): string {
  return motion ? MOTION_PROMPTS[motion] : MOTION_PROMPTS.medium;
}

/**
 * 成片合成 stage：消费上游产出的镜头列表（imageUrl / clipUrl /
 * duration / transition / dialogue）—— 纯客户端合成。提供
 * 顺序预览播放器、逐镜头时长与转场编辑，以及
 * 合成方案导出（JSON）作为管线的最终产物。
 */
export function FinalComposer({
  shots,
  title,
  onShotsChange,
  onRendered,
  rendered,
}: Props) {
  const [playing, setPlaying] = React.useState(false);
  const [currentIdx, setCurrentIdx] = React.useState(0);
  const imageTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const timeline: TimelineEntry[] = shots.map((shot) => ({
    shot,
    duration:
      typeof shot.duration === "number" && shot.duration > 0
        ? shot.duration
        : 4,
  }));

  const clipsDone = timeline.filter((entry) => entry.shot.clipUrl).length;
  const totalDuration = timeline.reduce(
    (acc, entry) => acc + entry.duration,
    0,
  );
  const current = timeline[currentIdx];

  React.useEffect(() => {
    return () => {
      if (imageTimerRef.current) clearTimeout(imageTimerRef.current);
    };
  }, []);

  /** 前进到下一条（或到末尾停住）。 */
  function advance() {
    if (imageTimerRef.current) {
      clearTimeout(imageTimerRef.current);
      imageTimerRef.current = null;
    }
    setCurrentIdx((idx) => {
      if (idx + 1 >= timeline.length) {
        setPlaying(false);
        return idx;
      }
      const next = timeline[idx + 1];
      if (next && !next.shot.clipUrl && next.shot.imageUrl) {
        // 静止帧兜底：按住该镜头时长。
        imageTimerRef.current = setTimeout(
          () => advance(),
          next.duration * 1000,
        );
      }
      return idx + 1;
    });
  }

  function startPlayback() {
    if (timeline.length === 0) return;
    if (imageTimerRef.current) clearTimeout(imageTimerRef.current);
    const first = timeline[0];
    setCurrentIdx(0);
    setPlaying(true);
    if (first && !first.shot.clipUrl && first.shot.imageUrl) {
      imageTimerRef.current = setTimeout(
        () => advance(),
        first.duration * 1000,
      );
    }
  }

  function stopPlayback() {
    setPlaying(false);
    if (imageTimerRef.current) {
      clearTimeout(imageTimerRef.current);
      imageTimerRef.current = null;
    }
  }

  function updateShot(id: string, patch: Partial<Shot>) {
    onShotsChange(shots.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  function exportPlan() {
    const plan = {
      project: title,
      exportedAt: new Date().toISOString(),
      totalShots: timeline.length,
      /* 「按一位小数写数」走`~/lib/number-format`（规范 16 §16.2.4.54）。 */
      totalDurationSec: Number(fixed(totalDuration, 1) ?? "0"),
      timeline: timeline.map((entry, i) => ({
        order: i + 1,
        shotId: entry.shot.id,
        scene: entry.shot.sceneHeading,
        shotType: entry.shot.shotType,
        prompt: entry.shot.prompt,
        imageUrl: entry.shot.imageUrl ?? null,
        clipUrl: entry.shot.clipUrl ?? null,
        durationSec: entry.duration,
        motion: entry.shot.motion ?? "medium",
        transition: entry.shot.transition ?? "cut",
        dialogue: entry.shot.dialogue ?? "",
      })),
    };
    downloadJson(plan, `${title || "composition"}-合成清单.json`);
    onRendered();
  }

  if (shots.length === 0) {
    return (
      <div className="border-border bg-surface rounded-2xl border border-dashed p-8 text-center">
        <p className="text-muted-foreground text-sm">
          暂无分镜数据。请先完成「场景分镜」与「视频生成」，再回到这里合成成片。
        </p>
      </div>
    );
  }

  return (
    <div className="flex-col gap-5">
      {/* Summary row */}
      <div className="border-border bg-surface flex flex-wrap items-center gap-3 rounded-2xl border p-4">
        <span className="text-ink text-[13px] font-semibold">成片时间线</span>
        <span className="bg-primary/12 text-primary rounded-lg px-3 py-1 text-[11px]">
          {timeline.length} 镜 · 片长约 {Math.round(totalDuration)}s
        </span>
        <span
          className={`rounded-lg px-3 py-1 text-[11px] ${
            clipsDone === timeline.length
              ? "bg-emerald-100 text-emerald-800 dark:text-emerald-300"
              : "bg-amber/15 text-amber"
          }`}
        >
          片段 {clipsDone}/{timeline.length}
        </span>
        <div className="ml-auto flex gap-2">
          {!playing ? (
            <Button
              variant="primary-solid"
              onClick={startPlayback}
              disabled={
                clipsDone === 0 &&
                timeline.every((entry) => !entry.shot.imageUrl)
              }
              className="h-auto rounded-xl px-4 py-2 font-semibold"
            >
              <Icon
                name="play"
                size={13}
                className="mr-1 inline align-[-2px]"
              />
              串播预览
            </Button>
          ) : (
            <Button
              variant="secondary"
              onClick={stopPlayback}
              className="text-ink bg-subtle hover:bg-surface-2 h-auto rounded-xl px-4 py-2 font-semibold"
            >
              停止
            </Button>
          )}
          <Button
            variant="primary-solid"
            onClick={exportPlan}
            className="shadow-primary-500/20 h-auto rounded-xl px-4 py-2 font-semibold shadow-lg"
          >
            导出合成清单
          </Button>
        </div>
      </div>

      {rendered && (
        <div className="rounded-xl bg-emerald-100 px-4 py-2 text-xs text-emerald-800 dark:text-emerald-300">
          ✓ 合成清单已导出，成片产物完成。可在右侧资源库下载。
        </div>
      )}

      {/* Preview player */}
      {playing && current && (
        <div className="border-border bg-surface rounded-2xl border p-4">
          <div className="text-muted-foreground mb-2 flex items-center justify-between text-[11px]">
            <span>
              预览中 · 镜 {String(currentIdx + 1).padStart(2, "0")} /{""}
              {String(timeline.length).padStart(2, "0")}
            </span>
            <span>{current.shot.sceneHeading}</span>
          </div>
          <div className="bg-bg grid min-h-[240px] place-items-center overflow-hidden rounded-xl">
            {current.shot.clipUrl ? (
              <MediaThumbnail
                key={current.shot.id}
                src={current.shot.clipUrl}
                autoPlay
                controls
                onEnded={advance}
                className="max-h-[420px] w-full"
              />
            ) : current.shot.imageUrl ? (
              <MediaThumbnail
                src={current.shot.imageUrl}
                alt={current.shot.sceneHeading}
                className="max-h-[420px] w-full object-contain"
              />
            ) : (
              <span className="text-muted-foreground text-xs">
                该镜头缺少画面，已跳过
              </span>
            )}
          </div>
          {current.shot.dialogue && (
            <p className="text-ink mt-2 text-center text-[12.5px]">
              {current.shot.dialogue}
            </p>
          )}
        </div>
      )}

      {/* Timeline list */}
      <div className="flex flex-col gap-3">
        {timeline.map((entry, idx) => {
          const shot = entry.shot;
          const active = playing && idx === currentIdx;
          return (
            <div
              key={shot.id}
              className={`border-border bg-surface flex items-center gap-3 rounded-xl border p-3 ${
                active ? "ring-primary/40 ring-1" : ""
              }`}
            >
              <span className="bg-primary-soft text-primary grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-semibold">
                {idx + 1}
              </span>
              <div className="bg-elevated h-14 w-20 shrink-0 overflow-hidden rounded-lg">
                {shot.imageUrl ? (
                  <MediaThumbnail
                    src={shot.imageUrl}
                    alt={shot.sceneHeading}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="text-muted-foreground grid h-full place-items-center">
                    <Icon name="image" size={16} />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-ink truncate text-xs font-medium">
                  {shot.sceneHeading}
                </div>
                <div className="text-muted-foreground mt-0.5 truncate text-[10.5px]">
                  {shot.clipUrl
                    ? "片段就绪"
                    : shot.imageUrl
                      ? "待生成视频（以静帧占位）"
                      : "待生成画面"}
                  {shot.dialogue ? ` · 字幕: ${shot.dialogue}` : ""}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <FormField
                  label="时长(s)"
                  labelClassName="text-muted-foreground mb-0.5 text-[10px]"
                >
                  <Input
                    type="number"
                    min={1}
                    max={20}
                    value={entry.duration}
                    onChange={(event) =>
                      updateShot(shot.id, {
                        duration: clamp(Number(event.target.value) || 4, 1, 20),
                      })
                    }
                    className="border-border bg-bg text-ink focus-visible:border-primary focus-visible:ring-primary/30 h-auto w-14 rounded-md px-2 py-1 text-xs"
                  />
                </FormField>
                <FormField
                  label="转场"
                  labelClassName="text-muted-foreground mb-0.5 text-[10px]"
                >
                  <SelectMenu
                    className="!bg-subtle !border-border text-xs"
                    value={shot.transition ?? "cut"}
                    onChange={(value) =>
                      updateShot(shot.id, { transition: value as Transition })
                    }
                    options={TRANSITIONS}
                    labels={TRANSITION_LABELS}
                    placeholder="转场"
                  />
                </FormField>
                <FormField
                  label="运动"
                  labelClassName="text-muted-foreground mb-0.5 text-[10px]"
                >
                  <SelectMenu
                    className="!bg-subtle !border-border text-xs"
                    value={shot.motion ?? "medium"}
                    onChange={(value) =>
                      updateShot(shot.id, { motion: value as MotionLevel })
                    }
                    options={MOTIONS}
                    labels={MOTION_LABELS}
                    placeholder="运动"
                  />
                </FormField>
              </div>
            </div>
          );
        })}
      </div>

      {clipsDone < timeline.length && (
        <div className="text-muted-foreground bg-subtle rounded-xl px-3 py-2 text-xs">
          {timeline.length - clipsDone} 个镜头还没有视频片段 —
          可回到「视频生成」补齐；导出清单时缺片段镜头将以静帧占位。
        </div>
      )}
    </div>
  );
}
