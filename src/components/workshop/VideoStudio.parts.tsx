"use client";

import { clamp } from "~/lib/clamp";
import { Icon } from "~/components/ui/icon";
import { Button } from "~/components/ui/button";
import { Alert } from "~/components/ui/alert";
import { FieldLabel } from "~/components/ui/field";
import { StatusBadge } from "~/components/ui/status-badge";
import { ProgressBar } from "~/components/ui/progress-bar";
import { SelectChip } from "~/components/ui/select-chip";
import { SHOT_STATUS_LABEL } from "./shot-status-config";
import { SelectMenu } from "~/components/ui/select-menu";
import { MOTION_LABELS, type MotionLevel, type Shot } from "~/lib/workshop/types";
import type { ApiChannelsView } from "~/lib/workshop/api-channel-shared";
import { MediaThumbnail } from "~/components/ui/media-thumbnail";
import { IndexDot } from "~/components/workshop/IndexDot";
import { Input } from "~/components/ui/input";
import { framesFor, videoPrompt } from "./video-studio-utils";

const FPS_OPTIONS = ["8", "12", "16", "24"];
const MOTIONS: Array<MotionLevel> = ["low", "medium", "high"];

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
  onOpenModelAdapters,
}: {
  apiChannels: ApiChannelsView | null;
  apiReady: boolean;
  batchRunning: boolean;
  channel: Channel;
  fps: number;
  onChannelChange: (c: Channel) => void;
  onFpsChange: (fps: number) => void;
  onGenerateBatch: () => void;
  onNextStage: () => void;
  onOpenModelAdapters: () => void;
  pendingCount: number;
  /** 是否选定了工作流库的视频工作流（选定后走封装口径，不再要求 Checkpoint）。 */
  workflowSelected: boolean;
}) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground text-xs">生成通道</span>
        {/* 一排里选一个 → `ui/select-chip`（规范 16 §16.2.4.75）。
            此前与镜头台是同两份逐字相同的 `variant="outline"` + 选中三元，
            缺的同样是「已选中时的悬停值」那一半（§12.12 孪生对：修法是
            抽共享，不是两边一起改）。 */}
        <div aria-label="生成通道" className="flex gap-2" role="radiogroup">
          <SelectChip
            onClick={() => {
              onChannelChange("local");
            }}
            selected={channel === "local"}
            shape="segment"
          >
            本地 · ComfyUI 工作流
          </SelectChip>
          <SelectChip
            onClick={() => {
              onChannelChange("api");
            }}
            selected={channel === "api"}
            shape="segment"
          >
            API 直连{apiChannels ? (apiReady ? " · 已配置" : " · 未配置") : ""}
          </SelectChip>
        </div>
        <Button
          className="text-muted-foreground hover:text-ink bg-subtle hover:bg-surface-2 h-auto gap-1 rounded-lg px-3 py-1.5"
          onClick={onOpenModelAdapters}
          size="xs"
          variant="ghost"
        >
          <Icon data-icon="inline-start" name="settings" size={12} />
          模型适配
        </Button>
        <FieldLabel className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">帧率</span>
          <SelectMenu
            className="bg-subtle! border-border! text-xs"
            onChange={(v) => {
              onFpsChange(Number(v) || 16);
            }}
            options={FPS_OPTIONS}
            placeholder="帧率"
            value={String(fps)}
          />
        </FieldLabel>
        <Button
          className="ml-auto h-auto rounded-lg px-3 py-1.5"
          disabled={
            batchRunning ||
            pendingCount === 0 ||
            (channel === "local" && !workflowSelected) ||
            (channel === "api" && !apiReady)
          }
          onClick={onGenerateBatch}
          size="xs"
          variant="primary-solid"
        >
          {batchRunning ? "批量生成中…" : `批量生成视频 (${pendingCount})`}
        </Button>
        <Button
          className="text-ink bg-subtle hover:bg-surface-2 h-auto rounded-lg px-3 py-1.5"
          onClick={onNextStage}
          size="xs"
          variant="secondary"
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
          API 视频通道未配置 — 点击上方「模型适配」配置该模型的接口与字段映射 后即可使用。
        </div>
      )}
    </>
  );
}

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
  apiReady: boolean;
  channel: Channel;
  error?: string;
  fps: number;
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
        <span className="text-muted-foreground truncate text-xs">{shot.sceneHeading}</span>
        <ClipBadge status={clipStatus} />
        {clipStatus === "running" && (
          <span className="text-muted-foreground text-3xs">
            {progress > 0 ? `${Math.round(progress)}%` : "排队中…"}
          </span>
        )}
        <span className="text-faint text-3xs ml-auto">{channel === "local" ? "本地" : "API"}</span>
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
                className="border-border bg-bg text-ink focus-visible:border-primary focus-visible:ring-primary/30 text-2xs h-auto w-14 rounded-md px-2 py-0.5"
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
                  onPatch({
                    /* SAFETY: 类型断言已复核 */
                    motion: v as MotionLevel,
                  });
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
          disabled={
            clipStatus === "running" || !videoPrompt(shot) || (channel === "api" && !apiReady)
          }
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
