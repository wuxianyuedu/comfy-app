"use client";

import { clamp } from "~/lib/clamp";
import { Icon } from "~/components/ui/icon";
import { Button } from "~/components/ui/button";
import { Alert } from "~/components/ui/alert";
import { StatusBadge } from "~/components/ui/status-badge";
import { ProgressBar } from "~/components/ui/progress-bar";
import { SHOT_STATUS_LABEL } from "./ShotStudio";
import { SelectMenu } from "~/components/ui/select-menu";
import {
  MOTION_LABELS,
  type MotionLevel,
  type Shot,
} from "~/lib/workshop/types";
import type { ApiChannelsView } from "~/lib/workshop/api-channel-shared";
import { MediaThumbnail } from "~/components/ui/media-thumbnail";
import { Input } from "~/components/ui/input";
import { framesFor, videoPrompt } from "./video-studio-utils";

const FPS_OPTIONS = ["8", "12", "16", "24"];
const MOTIONS: MotionLevel[] = ["low", "medium", "high"];

type Channel = "local" | "api";

/* ── 通道切换（本地 ComfyUI / 配置的 API）+ 放行提示 ── */
export function ChannelSwitch({
  channel,
  onChannelChange,
  apiChannels,
  apiReady,
  workflowSelected,
  fps,
  onFpsChange,
  batchRunning,
  pendingCount,
  onGenerateBatch,
  onNextStage,
  onOpenApiSettings,
}: {
  channel: Channel;
  onChannelChange: (c: Channel) => void;
  apiChannels: ApiChannelsView | null;
  apiReady: boolean;
  /** 是否选定了工作流库的视频工作流（选定后走封装口径，不再要求 Checkpoint）。 */
  workflowSelected: boolean;
  fps: number;
  onFpsChange: (fps: number) => void;
  batchRunning: boolean;
  pendingCount: number;
  onGenerateBatch: () => void;
  onNextStage: () => void;
  onOpenApiSettings: () => void;
}) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground text-xs">生成通道</span>
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            size="xs"
            onClick={() => onChannelChange("local")}
            className={`h-auto rounded-lg px-3 py-1.5 ${
              channel === "local"
                ? "border-primary bg-primary-soft text-primary"
                : "border-border text-muted-foreground hover:bg-subtle"
            }`}
          >
            本地 · ComfyUI 工作流
          </Button>
          <Button
            variant="outline"
            size="xs"
            onClick={() => onChannelChange("api")}
            className={`h-auto rounded-lg px-3 py-1.5 ${
              channel === "api"
                ? "border-primary bg-primary-soft text-primary"
                : "border-border text-muted-foreground hover:bg-subtle"
            }`}
          >
            API 直连{apiChannels ? (apiReady ? " · 已配置" : " · 未配置") : ""}
          </Button>
        </div>
        <Button
          variant="ghost"
          size="xs"
          onClick={onOpenApiSettings}
          className="text-muted-foreground hover:text-ink bg-subtle hover:bg-surface-2 h-auto gap-1 rounded-lg px-3 py-1.5"
        >
          <Icon name="settings" size={12} />
          API 通道设置
        </Button>
        <label className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">帧率</span>
          <SelectMenu
            className="!bg-subtle !border-border text-xs"
            value={String(fps)}
            onChange={(v) => onFpsChange(Number(v) || 16)}
            options={FPS_OPTIONS}
            placeholder="帧率"
          />
        </label>
        <Button
          variant="primary-solid"
          size="xs"
          onClick={onGenerateBatch}
          disabled={
            batchRunning ||
            pendingCount === 0 ||
            (channel === "local" && !workflowSelected) ||
            (channel === "api" && !apiReady)
          }
          className="ml-auto h-auto rounded-lg px-3 py-1.5"
        >
          {batchRunning ? "批量生成中…" : `批量生成视频 (${pendingCount})`}
        </Button>
        <Button
          variant="secondary"
          size="xs"
          onClick={onNextStage}
          className="text-ink bg-subtle hover:bg-surface-2 h-auto rounded-lg px-3 py-1.5"
        >
          去合成 →
        </Button>
      </div>

      {/* 通道专属的放行提示（温和，stage 仍可用） */}
      {channel === "local" && (
        <div className="text-muted-foreground bg-subtle rounded-lg px-3 py-2 text-xs">
          {workflowSelected
            ? "本地通道使用右侧「生成资源」里选定的视频工作流；工坊只暴露 提示词 / 尺寸 / 首帧，其余参数（步数、采样器、时长…）一律取工作流默认值。已生成的镜头图会自动上传为首帧。"
            : "本地通道需要先在右侧「生成资源」选择一个视频工作流（工作流库）。没有内置视频工作流可回落。已生成的镜头图会自动上传为首帧。"}
        </div>
      )}
      {channel === "api" && !apiReady && (
        <div className="bg-amber/10 text-amber flex items-center gap-2 rounded-lg px-3 py-2 text-xs">
          <Icon name="info" size={12} />
          API 视频通道未配置 — 点击上方「API 通道设置」填写 Base URL 与 API Key
          后即可使用。
        </div>
      )}
    </>
  );
}

/* ── 某镜头片段生成的状态药丸 ── */
export function ClipBadge({
  status,
}: {
  status: NonNullable<Shot["clipStatus"]>;
}) {
  return (
    <StatusBadge
      status={status}
      label={CLIP_STATUS_LABEL[status]}
      dot={false}
      className="px-2 py-0.5 text-[10px]"
    />
  );
}

/* 片段状态 → 文案。与镜头状态同源（只多一档「片段就绪」），配色同样走
 * `ui/status-badge`（规范 16 §16.2.4.5）。 */
const CLIP_STATUS_LABEL = {
  ...SHOT_STATUS_LABEL,
  done: "片段就绪",
} satisfies Record<NonNullable<Shot["clipStatus"]>, string>;

/* ── 单个镜头行：首帧、提示词、时长 / 运动控件、生成 ── */
export function ShotCard({
  shot,
  progress,
  error,
  channel,
  apiReady,
  fps,
  onPatch,
  onGenerate,
  onCancel,
}: {
  shot: Shot;
  progress: number;
  error?: string;
  channel: Channel;
  apiReady: boolean;
  fps: number;
  onPatch: (patch: Partial<Shot>) => void;
  onGenerate: () => void;
  /** 取消本条进行中的本机视频任务（有 clipTaskId 才显示按钮）。 */
  onCancel: () => void;
}) {
  const clipStatus = shot.clipStatus ?? "idle";
  return (
    <div className="border-border bg-surface rounded-xl border p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="bg-primary-soft text-primary grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold">
          {shot.index}
        </span>
        <span className="text-muted-foreground truncate text-xs">
          {shot.sceneHeading}
        </span>
        <ClipBadge status={clipStatus} />
        {clipStatus === "running" && (
          <span className="text-muted-foreground text-[10px]">
            {progress > 0 ? `${Math.round(progress)}%` : "排队中…"}
          </span>
        )}
        <span className="text-faint ml-auto text-[10px]">
          {channel === "local" ? "本地" : "API"}
        </span>
      </div>

      {clipStatus === "running" && (
        <ProgressBar
          value={progress}
          /* 0% 也留一格：这里的 `progress` 起点是 0，不给下限时条子是空的，
             用户读到「点了没反应」（保留收口前 `Math.max(4, …)` 的观感）。 */
          minVisible={4}
          showValue={false}
          className="mb-2"
          trackClassName="bg-elevated h-1"
        />
      )}

      <div className="flex flex-wrap items-center gap-3">
        {/* First frame (auto-prefilled from 镜头生图) */}
        <div className="bg-elevated border-border h-16 w-24 shrink-0 overflow-hidden rounded-lg border">
          {shot.imageUrl ? (
            <MediaThumbnail
              src={shot.imageUrl}
              alt={shot.sceneHeading}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="text-muted-foreground grid h-full place-items-center">
              <Icon name="image" size={14} />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-ink line-clamp-2 text-[11px] leading-relaxed break-words">
            {videoPrompt(shot) || "(提示词为空)"}
          </p>
          <div className="mt-1.5 flex items-center gap-2">
            <label className="flex items-center gap-1 text-[11px]">
              <span className="text-muted-foreground">时长(s)</span>
              <Input
                type="number"
                min={1}
                max={20}
                value={
                  typeof shot.duration === "number" && shot.duration > 0
                    ? shot.duration
                    : 5
                }
                onChange={(e) =>
                  onPatch({
                    duration: clamp(Number(e.target.value) || 5, 1, 20),
                  })
                }
                className="border-border bg-bg text-ink focus-visible:border-primary focus-visible:ring-primary/30 h-auto w-14 rounded-md px-2 py-0.5 text-[11px]"
              />
            </label>
            <label className="flex items-center gap-1 text-[11px]">
              <span className="text-muted-foreground">运动</span>
              <SelectMenu
                className="!bg-subtle !border-border text-[11px]"
                value={shot.motion ?? "medium"}
                onChange={(v) => onPatch({ motion: v as MotionLevel })}
                options={MOTIONS}
                labels={MOTION_LABELS}
                placeholder="运动"
              />
            </label>
            <span className="text-faint text-[10px]">
              {framesFor(shot, fps)} 帧
            </span>
          </div>
        </div>
        <Button
          variant="primary-solid"
          size="xs"
          onClick={onGenerate}
          disabled={
            clipStatus === "running" ||
            !videoPrompt(shot) ||
            (channel === "api" && !apiReady)
          }
          className="h-auto shrink-0 rounded-lg px-4 py-1.5"
        >
          {clipStatus === "running"
            ? "生成中…"
            : shot.clipUrl
              ? "重新生成"
              : "生成片段"}
        </Button>
        {clipStatus === "running" && shot.clipTaskId && (
          /* 只对本机任务可取消：API 直连的 remoteTaskId 是另一套体系，没有
             可取消的本机任务 id。 */
          <Button
            variant="secondary"
            size="xs"
            onClick={onCancel}
            className="text-muted-foreground hover:text-ink bg-subtle hover:bg-surface-2 h-auto shrink-0 rounded-lg px-3 py-1.5"
          >
            取消
          </Button>
        )}
      </div>

      {error && (
        <Alert
          variant="danger"
          /* 行内错误行：紧凑尺寸 + 无可见边框（同 CharacterPortraitStudio）。 */
          className="mt-2 block rounded-md border-transparent px-2 py-1 text-[11px]"
        >
          {error}
        </Alert>
      )}
      {!shot.imageUrl && !error && (
        <p className="text-muted-foreground mt-2 text-[10.5px]">
          该镜头暂无画面 —
          将以文生视频方式生成;可回「镜头生图」阶段补图后自动变为图生视频。
        </p>
      )}

      {shot.clipUrl && (
        <MediaThumbnail
          src={shot.clipUrl}
          controls
          loop
          className="border-border mt-2 max-h-64 w-auto rounded-lg border"
        />
      )}
    </div>
  );
}
