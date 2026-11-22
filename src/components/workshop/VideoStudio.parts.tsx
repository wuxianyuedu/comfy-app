"use client";

import { clamp } from "~/lib/clamp";
import { Icon } from "~/components/ui/icon";
import { Button } from "~/components/ui/button";
import { Alert } from "~/components/ui/alert";
import { FieldLabel } from "~/components/ui/field";
import { TruncatedText } from "~/components/ui/truncated-text";
import { StatusBadge } from "~/components/ui/status-badge";
import { ProgressBar } from "~/components/ui/progress-bar";
import { SHOT_STATUS_LABEL } from "./shot-status-config";
import { SelectMenu } from "~/components/ui/select-menu";
import { MOTION_LABELS, type MotionLevel, type Shot } from "~/lib/workshop/types";
import { MediaThumbnail } from "~/components/ui/media-thumbnail";
import { IndexDot } from "~/components/workshop/IndexDot";
import { Input } from "~/components/ui/input";
import { framesFor, videoPrompt } from "./video-studio-utils";

const MOTIONS: Array<MotionLevel> = ["low", "medium", "high"];

/* 片段状态 → 文案。与镜头状态同源（只多一档「片段就绪」），配色同样走
 * `ui/status-badge`（规范 16 §16.2.4.5）。 */
const CLIP_STATUS_LABEL = {
  ...SHOT_STATUS_LABEL,
  done: "片段就绪",
} satisfies Record<NonNullable<Shot["clipStatus"]>, string>;

/* ── 某镜头片段生成的状态药丸 ── */
export function ClipBadge({ status }: { status: NonNullable<Shot["clipStatus"]> }) {
  return (
    <StatusBadge
      className="text-3xs px-2 py-0.5"
      dot={false}
      label={CLIP_STATUS_LABEL[status]}
      status={status}
    />
  );
}

/* ── 单个镜头行：首帧、提示词、时长 / 运动控件、生成 ── */
export function ShotCard({
  shot,
  progress,
  error,
  channelLabel,
  modelReady,
  fps,
  onPatch,
  onGenerate,
  onCancel,
}: {
  /** 角标文案：本地 / API / 未选模型（#4834 由选中的候选派生）。 */
  channelLabel: string;
  error?: string;
  fps: number;
  /** 是否已选中可用模型（生成按钮的放行判据）。 */
  modelReady: boolean;
  /** 取消本条进行中的本机视频任务（有 clipTaskId 才显示按钮）。 */
  onCancel: () => void;
  onGenerate: () => void;
  onPatch: (patch: Partial<Shot>) => void;
  progress: number;
  shot: Shot;
}) {
  const clipStatus = shot.clipStatus ?? "idle";
  return (
    <div className="border-border bg-surface rounded-xl border p-4">
      <div className="mb-2 flex items-center gap-2">
        <IndexDot index={shot.index} />
        <TruncatedText className="text-muted-foreground truncate text-xs">
          {shot.sceneHeading}
        </TruncatedText>
        <ClipBadge status={clipStatus} />
        {clipStatus === "running" && (
          <span className="text-muted-foreground text-3xs">
            {progress > 0 ? `${Math.round(progress)}%` : "排队中…"}
          </span>
        )}
        <span className="text-faint text-3xs ml-auto">{channelLabel}</span>
      </div>

      {clipStatus === "running" && (
        <ProgressBar
          className="mb-2"
          /* 0% 也留一格：这里的 `progress` 起点是 0，不给下限时条子是空的，
             用户读到「点了没反应」（保留收口前 `Math.max(4, …)` 的观感）。 */
          minVisible={4}
          showValue={false}
          trackClassName="bg-elevated h-1"
          value={progress}
        />
      )}

      <div className="flex flex-wrap items-center gap-3">
        {/* First frame (auto-prefilled from 镜头生图) */}
        <div className="bg-elevated border-border h-16 w-24 shrink-0 overflow-hidden rounded-lg border">
          {shot.imageUrl !== undefined && shot.imageUrl !== "" ? (
            <MediaThumbnail
              alt={shot.sceneHeading}
              className="h-full w-full object-cover"
              src={shot.imageUrl}
            />
          ) : (
            <div className="text-muted-foreground grid h-full place-items-center">
              <Icon name="image" size={14} />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-ink text-2xs line-clamp-2 leading-relaxed wrap-break-word">
            {videoPrompt(shot) || "(提示词为空)"}
          </p>
          <div className="mt-1.5 flex items-center gap-2">
            <FieldLabel className="text-2xs flex items-center gap-1">
              <span className="text-muted-foreground">时长(s)</span>
              <Input
                className="border-border bg-bg text-ink focus-visible:border-primary text-2xs h-auto w-14 rounded-md px-2 py-0.5"
                max={20}
                min={1}
                onChange={(e) => {
                  onPatch({
                    duration: clamp(Number(e.target.value) || 5, 1, 20),
                  });
                }}
                type="number"
                value={typeof shot.duration === "number" && shot.duration > 0 ? shot.duration : 5}
              />
            </FieldLabel>
            <FieldLabel className="text-2xs flex items-center gap-1">
              <span className="text-muted-foreground">运动</span>
              <SelectMenu
                className="bg-subtle! border-border! text-2xs"
                labels={MOTION_LABELS}
                onChange={(v) => {
                  const motion = MOTIONS.find((item) => item === v);
                  if (motion !== undefined) {
                    onPatch({ motion });
                  }
                }}
                options={MOTIONS}
                placeholder="运动"
                value={shot.motion ?? "medium"}
              />
            </FieldLabel>
            <span className="text-faint text-3xs">{framesFor(shot, fps)} 帧</span>
          </div>
        </div>
        <Button
          className="h-auto shrink-0 rounded-lg px-4 py-1.5"
          disabled={clipStatus === "running" || !videoPrompt(shot) || !modelReady}
          onClick={onGenerate}
          size="xs"
          variant="primary-solid"
        >
          {clipStatus === "running"
            ? "生成中…"
            : shot.clipUrl !== undefined && shot.clipUrl !== ""
              ? "重新生成"
              : "生成片段"}
        </Button>
        {clipStatus === "running" && shot.clipTaskId !== undefined && shot.clipTaskId !== "" && (
          /* 只对本机任务可取消：API 直连的 remoteTaskId 是另一套体系，没有
             可取消的本机任务 id。 */
          <Button
            className="text-muted-foreground hover:text-ink bg-subtle hover:bg-surface-2 h-auto shrink-0 rounded-lg px-3 py-1.5"
            onClick={onCancel}
            size="xs"
            variant="secondary"
          >
            取消
          </Button>
        )}
      </div>

      {error !== undefined && error !== "" && (
        <Alert
          /* 行内错误行：紧凑尺寸 + 无可见边框（同 CharacterPortraitStudio）。 */
          className="text-2xs mt-2 block rounded-md border-transparent px-2 py-1"
          variant="danger"
        >
          {error}
        </Alert>
      )}
      {(shot.imageUrl === undefined || shot.imageUrl === "") &&
        (error === undefined || error === "") && (
          <p className="text-muted-foreground text-2xs mt-2">
            该镜头暂无画面 — 将以文生视频方式生成;可回「镜头生图」阶段补图后自动变为图生视频。
          </p>
        )}

      {shot.clipUrl !== undefined && shot.clipUrl !== "" && (
        <MediaThumbnail
          className="border-border mt-2 max-h-64 w-auto rounded-lg border"
          controls
          loop
          src={shot.clipUrl}
        />
      )}
    </div>
  );
}
