"use client";
import React from "react";
import { Icon } from "@/components/ui/Icon";
import { DarkSelect } from "@/components/studio/ui/DarkSelect";
import {
  MOTION_LABELS,
  type MotionLevel,
  type Shot,
} from "@/lib/workshop/types";
import { motionPromptSuffix } from "@/components/workshop/FinalComposer";
import {
  apiPollVideo,
  apiSubmitVideo,
  prepareLocalInputImage,
  startLocalGenerate,
  watchTask,
  type GenerateInput,
} from "@/lib/workshop/generation-client";
import type { ApiChannelsView } from "@/lib/workshop/api-channel-shared";

/** catch 抛出值（unknown）→ 消息提取：带 string message 的对象取 message，其余回退。 */
function errorMessage(e: unknown, fallback: string): string {
  if (typeof e === "object" && e !== null && "message" in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === "string" && m) return m;
  }
  return fallback;
}

const FPS_OPTIONS = ["8", "12", "16", "24"];
const MOTIONS: MotionLevel[] = ["low", "medium", "high"];

/** 镜头时长(秒) → 视频帧数(WAN 工作流常用 4-6 秒窗口)。 */
function framesFor(shot: Shot, fps: number): number {
  const seconds =
    typeof shot.duration === "number" && shot.duration > 0 ? shot.duration : 5;
  return Math.max(9, Math.min(121, Math.round(seconds * fps)));
}

/** 视频提示词 = 镜头生图提示词(或画面描述) + 运动强度后缀。 */
function videoPrompt(shot: Shot): string {
  return [shot.prompt || shot.description, motionPromptSuffix(shot.motion)]
    .filter(Boolean)
    .join(", ");
}

interface Props {
  shots: Shot[];
  checkpoints: string[];
  checkpoint: string;
  onCheckpointChange: (name: string) => void;
  apiChannels: ApiChannelsView | null;
  onOpenApiSettings: () => void;
  onShotsChange: React.Dispatch<React.SetStateAction<Shot[]>>;
  onPrevStage: () => void;
  onNextStage: () => void;
}

type Channel = "local" | "api";

/**
 * 视频生成 stage: consumes shot images produced upstream (auto-used as the
 * I2V first frame) and shot motion/duration (auto-prefilled from the
 * storyboard plan). Local channel runs the ComfyUI img2video/txt2video
 * workflows; API channel relays to the configured video endpoint (sync URL or
 * async task). Results are written back onto Shot.clipUrl for 成片合成.
 */
export function VideoStudio({
  shots,
  checkpoints,
  checkpoint,
  onCheckpointChange,
  apiChannels,
  onOpenApiSettings,
  onShotsChange,
  onPrevStage,
  onNextStage,
}: Props) {
  const [channel, setChannel] = React.useState<Channel>("local");
  const [fps, setFps] = React.useState(16);
  const [progress, setProgress] = React.useState<Record<string, number>>({});
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [batchRunning, setBatchRunning] = React.useState(false);

  const apiReady = apiChannels?.video.configured === true;
  const doneCount = shots.filter((s) => !!s.clipUrl).length;
  const pending = shots.filter(
    (s) => !s.clipUrl && (!s.clipStatus || s.clipStatus === "idle" || s.clipStatus === "failed"),
  );

  function patchShot(id: string, p: Partial<Shot>) {
    onShotsChange((prev) => prev.map((s) => (s.id === id ? { ...s, ...p } : s)));
  }

  function setShotError(id: string, message: string | undefined) {
    setErrors((prev) => {
      const next = { ...prev };
      if (message) next[id] = message;
      else delete next[id];
      return next;
    });
  }

  /** Wait for one local ComfyUI task; resolves when the SSE stream settles. */
  function runLocalTask(shotId: string, taskId: string): Promise<void> {
    return new Promise<void>((resolve) => {
      const close = watchTask(taskId, {
        onProgress: (p) => setProgress((prev) => ({ ...prev, [shotId]: p })),
        onOutput: (out) => {
          // Prefer the video output; non-image extras (gif/other) still land.
          if (out.kind !== "image") patchShot(shotId, { clipUrl: out.url });
        },
        onSettled: (r) => {
          clearTimeout(timeout);
          patchShot(shotId, { clipStatus: r.ok ? "done" : "failed" });
          if (!r.ok) setShotError(shotId, r.message ?? "视频生成失败");
          resolve();
        },
      });
      // Safety valve: video renders are slow, but never wedge the batch loop.
      const timeout = setTimeout(() => {
        close();
        patchShot(shotId, { clipStatus: "failed" });
        setShotError(shotId, "任务超时(30 分钟无响应)");
        resolve();
      }, 30 * 60 * 1000);
    });
  }

  /** Poll an async API video task until it resolves or times out (~10 min). */
  async function pollApiVideo(shotId: string, remoteTaskId: string): Promise<void> {
    const deadline = Date.now() + 10 * 60 * 1000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 3000));
      const r = await apiPollVideo(remoteTaskId);
      if (r.url) {
        patchShot(shotId, { clipStatus: "done", clipUrl: r.url });
        return;
      }
      if (!r.pending) {
        patchShot(shotId, { clipStatus: "failed" });
        setShotError(shotId, "API 视频任务已结束但未返回视频");
        return;
      }
    }
    patchShot(shotId, { clipStatus: "failed" });
    setShotError(shotId, "API 视频任务轮询超时");
  }

  async function generateClip(shot: Shot): Promise<void> {
    const prompt = videoPrompt(shot);
    if (!prompt.trim()) {
      setShotError(shot.id, "提示词为空,请先回上一阶段补全镜头信息");
      return;
    }
    setShotError(shot.id, undefined);
    patchShot(shot.id, { clipStatus: "running" });
    const frames = framesFor(shot, fps);
    try {
      if (channel === "local") {
        // Generated image → ComfyUI input dir, so LoadImage nodes can use it.
        const inputImage = shot.imageUrl
          ? await prepareLocalInputImage(shot.imageUrl)
          : undefined;
        const input: GenerateInput = {
          workflow: inputImage ? "img2video" : "txt2video",
          prompt,
          negative: shot.negativePrompt || undefined,
          checkpoint: checkpoint || undefined,
          frames,
          fps,
          ...(inputImage ? { inputImage } : {}),
        };
        const taskId = await startLocalGenerate(input);
        await runLocalTask(shot.id, taskId);
      } else {
        const submit = await apiSubmitVideo({
          prompt,
          negative: shot.negativePrompt || undefined,
          image: shot.imageUrl,
          frames,
          fps,
        });
        if (submit.url) {
          patchShot(shot.id, { clipStatus: "done", clipUrl: submit.url });
        } else if (submit.remoteTaskId) {
          await pollApiVideo(shot.id, submit.remoteTaskId);
        }
      }
    } catch (e: unknown) {
      patchShot(shot.id, { clipStatus: "failed" });
      setShotError(shot.id, errorMessage(e, "视频生成失败"));
    }
  }

  async function generateBatch() {
    if (batchRunning || pending.length === 0) return;
    setBatchRunning(true);
    for (const shot of [...pending]) {
      if (shot.clipUrl || shot.clipStatus === "running") continue;
      await generateClip(shot);
    }
    setBatchRunning(false);
  }

  return (
    <div className="space-y-4">
      {/* Channel switch (local ComfyUI / configured API) */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground text-xs">生成通道</span>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setChannel("local")}
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
            onClick={() => setChannel("api")}
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
          className="text-muted-foreground hover:text-ink flex items-center gap-1 rounded-lg bg-white/4 px-3 py-1.5 text-xs hover:bg-white/8"
        >
          <Icon name="settings" size={12} />
          API 通道设置
        </button>
        {channel === "local" && checkpoints.length > 0 && (
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
            className="!bg-white/3 !border-white/8 text-xs"
            value={String(fps)}
            onChange={(v) => setFps(Number(v) || 16)}
            options={FPS_OPTIONS}
            placeholder="帧率"
          />
        </label>
        <button
          type="button"
          onClick={() => void generateBatch()}
          disabled={batchRunning || pending.length === 0 || (channel === "api" && !apiReady)}
          className="bg-primary ml-auto rounded-lg px-3 py-1.5 text-xs font-medium text-white transition-opacity disabled:opacity-40"
        >
          {batchRunning ? "批量生成中…" : `批量生成视频 (${pending.length})`}
        </button>
        <button
          type="button"
          onClick={onNextStage}
          className="text-ink rounded-lg bg-white/4 px-3 py-1.5 text-xs font-medium hover:bg-white/8"
        >
          去合成 →
        </button>
      </div>

      {/* Channel-specific gating hints (gentle, stage stays usable) */}
      {channel === "local" && (
        <div className="text-muted-foreground rounded-lg bg-subtle px-3 py-2 text-xs">
          本地通道使用 ComfyUI 的 img2video / txt2video 工作流(WAN);已生成的镜头图会自动上传为首帧。无画面镜头将回退为文生视频。
        </div>
      )}
      {channel === "api" && !apiReady && (
        <div className="flex items-center gap-2 rounded-lg bg-(--color-amber)/10 px-3 py-2 text-xs text-(--color-amber)">
          <Icon name="info" size={12} />
          API 视频通道未配置 — 点击上方「API 通道设置」填写 Base URL 与 API Key 后即可使用。
        </div>
      )}

      {shots.length === 0 ? (
        <div className="border-border text-muted-foreground rounded-xl border border-dashed py-10 text-center text-sm">
          暂无镜头数据。请先完成「场景分镜」— 镜头时长与运动强度会自动带入本阶段。
        </div>
      ) : (
        <div className="space-y-3">
          {shots.map((shot) => {
            const p = progress[shot.id] ?? 0;
            const err = errors[shot.id];
            const clipStatus = shot.clipStatus ?? "idle";
            return (
              <div key={shot.id} className="border-border bg-surface rounded-xl border p-4">
                <div className="mb-2 flex items-center gap-2">
                  <span className="bg-primary-soft text-primary grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold">
                    {shot.index}
                  </span>
                  <span className="text-muted-foreground truncate text-xs">{shot.sceneHeading}</span>
                  <ClipBadge status={clipStatus} />
                  {clipStatus === "running" && (
                    <span className="text-muted-foreground text-[10px]">{p > 0 ? `${Math.round(p)}%` : "排队中…"}</span>
                  )}
                  <span className="text-faint ml-auto text-[10px]">{channel === "local" ? "本地" : "API"}</span>
                </div>

                {clipStatus === "running" && (
                  <div className="bg-elevated mb-2 h-1 w-full overflow-hidden rounded-full">
                    <div className="bg-primary h-full rounded-full transition-all" style={{ width: `${Math.max(4, p)}%` }} />
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
                            patchShot(shot.id, {
                              duration: Math.max(1, Math.min(20, Number(e.target.value) || 5)),
                            })
                          }
                          className="border-border bg-bg text-ink w-14 rounded-md border px-2 py-0.5 text-[11px] outline-none focus:border-primary"
                        />
                      </label>
                      <label className="flex items-center gap-1 text-[11px]">
                        <span className="text-muted-foreground">运动</span>
                        <DarkSelect
                          className="!bg-white/3 !border-white/8 text-[11px]"
                          value={shot.motion ?? "medium"}
                          onChange={(v) => patchShot(shot.id, { motion: v as MotionLevel })}
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
                    onClick={() => void generateClip(shot)}
                    disabled={clipStatus === "running" || !videoPrompt(shot) || (channel === "api" && !apiReady)}
                    className="bg-primary/90 shrink-0 rounded-lg px-4 py-1.5 text-xs font-medium text-white transition-opacity disabled:opacity-40"
                  >
                    {clipStatus === "running" ? "生成中…" : shot.clipUrl ? "重新生成" : "生成片段"}
                  </button>
                </div>

                {err && <p className="mt-2 rounded-md bg-red-100 px-2 py-1 text-[11px] text-red-700">{err}</p>}
                {!shot.imageUrl && !err && (
                  <p className="text-muted-foreground mt-2 text-[10.5px]">
                    该镜头暂无画面 — 将以文生视频方式生成;可回「镜头生图」阶段补图后自动变为图生视频。
                  </p>
                )}

                {shot.clipUrl && (
                  <video src={shot.clipUrl} controls loop className="border-border mt-2 max-h-64 w-auto rounded-lg border" />
                )}
              </div>
            );
          })}
        </div>
      )}

      {shots.length > 0 && (
        <p className="text-muted-foreground text-[11px]">
          已完成 {doneCount}/{shots.length} 片段 — 片段与首帧会自动进入「成片合成」时间线;可随时回来重跑单个镜头。
        </p>
      )}
      {shots.length > 0 && (
        <button
          type="button"
          onClick={onPrevStage}
          className="text-muted-foreground hover:text-ink rounded-lg bg-white/4 px-3 py-1.5 text-xs hover:bg-white/8"
        >
          ← 回镜头生图
        </button>
      )}
    </div>
  );
}

function ClipBadge({ status }: { status: NonNullable<Shot["clipStatus"]> }) {
  const map: Record<NonNullable<Shot["clipStatus"]>, { label: string; cls: string }> = {
    idle: { label: "待生成", cls: "bg-subtle text-muted-foreground" },
    queued: { label: "排队中", cls: "bg-amber-100 text-amber-700" },
    running: { label: "生成中", cls: "bg-blue-100 text-blue-700" },
    done: { label: "片段就绪", cls: "bg-emerald-100 text-emerald-700" },
    failed: { label: "失败", cls: "bg-red-100 text-red-700" },
    stale: { label: "待更新", cls: "bg-red-100 text-red-700" },
  };
  const s = map[status];
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${s.cls}`}>{s.label}</span>;
}
