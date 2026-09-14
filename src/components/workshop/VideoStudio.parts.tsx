"use client";

import { Icon } from "@/components/ui/icon";
import { DarkSelect } from "@/components/studio/ui/DarkSelect";
import {
  MOTION_LABELS,
  type MotionLevel,
  type Shot,
} from "@/lib/workshop/types";
import type { ApiChannelsView } from "@/lib/workshop/api-channel-shared";
import { framesFor, videoPrompt } from "./video-studio-utils";

const FPS_OPTIONS = ["8", "12", "16", "24"];
const MOTIONS: MotionLevel[] = ["low", "medium", "high"];

type Channel = "local" | "api";

/* ── Channel switch (local ComfyUI / configured API) + gating hints ── */
export function ChannelSwitch({
  channel,
  onChannelChange,
  apiChannels,
  apiReady,
  checkpoints,
  checkpoint,
  onCheckpointChange,
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
  checkpoints: string[];
  checkpoint: string;
  onCheckpointChange: (name: string) => void;
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
          <button
            type="button"
            onClick={() => onChannelChange("local")}
            className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${
              channel === "local"
                ? "border-primary bg-primary-soft text-primary"
                : "border-border text-muted-foreground hover:bg-subtle"
            }`}
          >
            本地 · ComfyUI 工作流
          </button>
          <button
            type="button"
            onClick={() => onChannelChange("api")}
            className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${
              channel === "api"
                ? "border-primary bg-primary-soft text-primary"
                : "border-border text-muted-foreground hover:bg-subtle"
            }`}
          >
            API 直连{apiChannels ? (apiReady ? " · 已配置" : " · 未配置") : ""}
          </button>
        </div>
        <button
          type="button"
          onClick={onOpenApiSettings}
          className="text-muted-foreground hover:text-ink flex items-center gap-1 rounded-lg bg-subtle px-3 py-1.5 text-xs hover:bg-surface-2"
        >
          <Icon name="settings" size={12} />
          API 通道设置
        </button>
        {/* 选定工作流库工作流后模型由工作流自带，不再要求先选 Checkpoint。 */}
        {channel === "local" && !workflowSelected && checkpoints.length > 0 && (
          <label className="ml-auto flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Checkpoint(可选)</span>
            <select
              value={checkpoint}
              onChange={(e) => onCheckpointChange(e.target.value)}
              className="border-border bg-bg text-ink max-w-[200px] rounded-lg border px-2 py-1 text-xs outline-none"
            >
              <option value="">工作流默认</option>
              {checkpoints.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">帧率</span>
          <DarkSelect
            className="!bg-subtle !border-border text-xs"
            value={String(fps)}
            onChange={(v) => onFpsChange(Number(v) || 16)}
            options={FPS_OPTIONS}
            placeholder="帧率"
          />
        </label>
        <button
          type="button"
          onClick={onGenerateBatch}
          disabled={batchRunning || pendingCount === 0 || (channel === "api" && !apiReady)}
          className="bg-primary ml-auto rounded-lg px-3 py-1.5 text-xs font-medium text-white transition-opacity disabled:opacity-40"
        >
          {batchRunning ? "批量生成中…" : `批量生成视频 (${pendingCount})`}
        </button>
        <button
          type="button"
          onClick={onNextStage}
          className="text-ink rounded-lg bg-subtle px-3 py-1.5 text-xs font-medium hover:bg-surface-2"
        >
          去合成 →
        </button>
      </div>

      {/* Channel-specific gating hints (gentle, stage stays usable) */}
      {channel === "local" && (
        <div className="text-muted-foreground rounded-lg bg-subtle px-3 py-2 text-xs">
          {workflowSelected
            ? "本地通道使用右侧「生成资源」里选定的视频工作流；工坊只暴露 提示词 / 尺寸 / 首帧，其余参数（步数、采样器、时长…）一律取工作流默认值。已生成的镜头图会自动上传为首帧。"
            : "本地通道使用 ComfyUI 的 img2video / txt2video 工作流(WAN);已生成的镜头图会自动上传为首帧。无画面镜头将回退为文生视频。可在右侧「生成资源」改选工作流库的视频工作流。"}
        </div>
      )}
      {channel === "api" && !apiReady && (
        <div className="flex items-center gap-2 rounded-lg bg-amber/10 px-3 py-2 text-xs text-amber">
          <Icon name="info" size={12} />
          API 视频通道未配置 — 点击上方「API 通道设置」填写 Base URL 与 API Key 后即可使用。
        </div>
      )}
    </>
  );
}

/* ── Status pill for a shot's clip generation ── */
export function ClipBadge({ status }: { status: NonNullable<Shot["clipStatus"]> }) {
  const map: Record<NonNullable<Shot["clipStatus"]>, { label: string; cls: string }> = {
    idle: { label: "待生成", cls: "bg-subtle text-muted-foreground" },
    queued: { label: "排队中", cls: "bg-amber-100 text-amber-800 dark:text-amber-300" },
    running: { label: "生成中", cls: "bg-blue-100 text-blue-800 dark:text-blue-300" },
    done: { label: "片段就绪", cls: "bg-emerald-100 text-emerald-800 dark:text-emerald-300" },
    failed: { label: "失败", cls: "bg-red-100 text-red-800 dark:text-red-300" },
    stale: { label: "待更新", cls: "bg-red-100 text-red-800 dark:text-red-300" },
  };
  const s = map[status];
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${s.cls}`}>{s.label}</span>;
}

/* ── One shot row: first frame, prompt, duration/motion controls, generate ── */
export function ShotCard({
  shot,
  progress,
  error,
  channel,
  apiReady,
  fps,
  onPatch,
  onGenerate,
}: {
  shot: Shot;
  progress: number;
  error?: string;
  channel: Channel;
  apiReady: boolean;
  fps: number;
  onPatch: (patch: Partial<Shot>) => void;
  onGenerate: () => void;
}) {
  const clipStatus = shot.clipStatus ?? "idle";
  return (
    <div className="border-border bg-surface rounded-xl border p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="bg-primary-soft text-primary grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold">
          {shot.index}
        </span>
        <span className="text-muted-foreground truncate text-xs">{shot.sceneHeading}</span>
        <ClipBadge status={clipStatus} />
        {clipStatus === "running" && (
          <span className="text-muted-foreground text-[10px]">
            {progress > 0 ? `${Math.round(progress)}%` : "排队中…"}
          </span>
        )}
        <span className="text-faint ml-auto text-[10px]">{channel === "local" ? "本地" : "API"}</span>
      </div>

      {clipStatus === "running" && (
        <div className="bg-elevated mb-2 h-1 w-full overflow-hidden rounded-full">
          <div
            className="bg-primary h-full rounded-full transition-all"
            style={{ width: `${Math.max(4, progress)}%` }}
          />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {/* First frame (auto-prefilled from 镜头生图) */}
        <div className="bg-elevated border-border h-16 w-24 shrink-0 overflow-hidden rounded-lg border">
          {shot.imageUrl ? (
            <img src={shot.imageUrl} alt={shot.sceneHeading} className="h-full w-full object-cover" />
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
              <input
                type="number"
                min={1}
                max={20}
                value={typeof shot.duration === "number" && shot.duration > 0 ? shot.duration : 5}
                onChange={(e) =>
                  onPatch({
                    duration: Math.max(1, Math.min(20, Number(e.target.value) || 5)),
                  })
                }
                className="border-border bg-bg text-ink w-14 rounded-md border px-2 py-0.5 text-[11px] outline-none focus:border-primary"
              />
            </label>
            <label className="flex items-center gap-1 text-[11px]">
              <span className="text-muted-foreground">运动</span>
              <DarkSelect
                className="!bg-subtle !border-border text-[11px]"
                value={shot.motion ?? "medium"}
                onChange={(v) => onPatch({ motion: v as MotionLevel })}
                options={MOTIONS}
                labels={MOTION_LABELS}
                placeholder="运动"
              />
            </label>
            <span className="text-faint text-[10px]">{framesFor(shot, fps)} 帧</span>
          </div>
        </div>
        <button
          type="button"
          onClick={onGenerate}
          disabled={clipStatus === "running" || !videoPrompt(shot) || (channel === "api" && !apiReady)}
          className="bg-primary/90 shrink-0 rounded-lg px-4 py-1.5 text-xs font-medium text-white transition-opacity disabled:opacity-40"
        >
          {clipStatus === "running" ? "生成中…" : shot.clipUrl ? "重新生成" : "生成片段"}
        </button>
      </div>

      {error && (
        <p className="mt-2 rounded-md bg-red-100 px-2 py-1 text-[11px] text-red-800 dark:text-red-300">{error}</p>
      )}
      {!shot.imageUrl && !error && (
        <p className="text-muted-foreground mt-2 text-[10.5px]">
          该镜头暂无画面 — 将以文生视频方式生成;可回「镜头生图」阶段补图后自动变为图生视频。
        </p>
      )}

      {shot.clipUrl && (
        <video
          src={shot.clipUrl}
          controls
          loop
          className="border-border mt-2 max-h-64 w-auto rounded-lg border"
        />
      )}
    </div>
  );
}
