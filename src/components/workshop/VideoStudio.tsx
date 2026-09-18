"use client";
import React from "react";
import type { Shot } from "~/lib/workshop/types";
import {
  apiPollVideo,
  apiSubmitVideo,
  buildLibraryWorkflowInput,
  prepareLocalInputImage,
  startLocalGenerate,
  watchTask,
  type GenerateInput,
} from "~/lib/workshop/generation-client";
import type { ApiChannelsView } from "~/lib/workshop/api-channel-shared";
import { ChannelSwitch, ShotCard } from "./VideoStudio.parts";
import { framesFor, videoPrompt } from "./video-studio-utils";
import { errorMessage } from "~/lib/error-message";
import { Button } from "~/components/ui/button";

interface Props {
  shots: Shot[];
  /** 选定的视频工作流 id：本地通道的唯一可执行来源（内置模板已移除）。
   *  按封装口径暴露 提示词 / 尺寸 / 首帧，其余参数用工作流默认值。 */
  workflowId: string;
  apiChannels: ApiChannelsView | null;
  onOpenApiSettings: () => void;
  onShotsChange: React.Dispatch<React.SetStateAction<Shot[]>>;
  onPrevStage: () => void;
  onNextStage: () => void;
}

type Channel = "local" | "api";

/**
 * 视频生成 stage：消费上游产出的镜头图片（自动用作
 * I2V 首帧）与镜头的运动 / 时长（从
 * 分镜方案自动预填）。本地通道跑 ComfyUI 的 img2video/txt2video
 * 工作流；API 通道中转到配置的视频端点（同步 URL 或
 * 异步任务）。结果写回 Shot.clipUrl，供成片合成。
 */
export function VideoStudio({
  shots,
  workflowId,
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
    (s) =>
      !s.clipUrl &&
      (!s.clipStatus || s.clipStatus === "idle" || s.clipStatus === "failed"),
  );

  function patchShot(id: string, p: Partial<Shot>) {
    onShotsChange((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...p } : s)),
    );
  }

  function setShotError(id: string, message: string | undefined) {
    setErrors((prev) => {
      const next = { ...prev };
      if (message) next[id] = message;
      else delete next[id];
      return next;
    });
  }

  /** 等一个本地 ComfyUI 任务；SSE 流落定后 resolve。 */
  function runLocalTask(shotId: string, taskId: string): Promise<void> {
    return new Promise<void>((resolve) => {
      const close = watchTask(taskId, {
        onProgress: (p) => setProgress((prev) => ({ ...prev, [shotId]: p })),
        onOutput: (out) => {
          // 优先取视频输出；非图片的额外产出（gif / 其他）照样落地。
          if (out.kind !== "image") patchShot(shotId, { clipUrl: out.url });
        },
        onSettled: (r) => {
          clearTimeout(timeout);
          patchShot(shotId, { clipStatus: r.ok ? "done" : "failed" });
          if (!r.ok) setShotError(shotId, r.message ?? "视频生成失败");
          resolve();
        },
      });
      // 安全阀：视频渲染慢，但永不让批量循环卡住。
      const timeout = setTimeout(
        () => {
          close();
          patchShot(shotId, { clipStatus: "failed" });
          setShotError(shotId, "任务超时(30 分钟无响应)");
          resolve();
        },
        30 * 60 * 1000,
      );
    });
  }

  /** 轮询异步 API 视频任务直到 resolve 或超时（约 10 分钟）。 */
  async function pollApiVideo(
    shotId: string,
    remoteTaskId: string,
  ): Promise<void> {
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
    /* 本地通道没有内置模板可回落：必须先在工作流库选好一个视频工作流。
     * 门禁放在入口，避免带着空 workflow id 去拉详情。 */
    if (channel === "local" && !workflowId) {
      setShotError(
        shot.id,
        "本地通道需要先在右侧「生成资源」选择一个视频工作流；或切到远端 API 通道",
      );
      return;
    }
    setShotError(shot.id, undefined);
    patchShot(shot.id, { clipStatus: "running" });
    const frames = framesFor(shot, fps);
    try {
      if (channel === "local") {
        // 生成出的图片 → ComfyUI 输入目录，好让 LoadImage 节点能用它。
        const inputImage = shot.imageUrl
          ? await prepareLocalInputImage(shot.imageUrl)
          : undefined;
        /* 没有内置模板作为回落：本地通道必须先在工作流库选好一个视频工作流
         *（封装口径暴露 提示词 / 尺寸 / 首帧 / 时长，其余走工作流默认值）。
         * 见 generateClip 入口的门禁。 */
        const input: GenerateInput = (
          await buildLibraryWorkflowInput(workflowId, {
            prompt,
            negativePrompt: shot.negativePrompt || undefined,
            ...(inputImage ? { firstFrame: inputImage } : {}),
            ...(typeof shot.duration === "number" && shot.duration > 0
              ? { duration: shot.duration }
              : {}),
            frames,
          })
        ).input;

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
      <ChannelSwitch
        channel={channel}
        onChannelChange={setChannel}
        apiChannels={apiChannels}
        apiReady={apiReady}
        workflowSelected={!!workflowId}
        fps={fps}
        onFpsChange={setFps}
        batchRunning={batchRunning}
        pendingCount={pending.length}
        onGenerateBatch={() => void generateBatch()}
        onNextStage={onNextStage}
        onOpenApiSettings={onOpenApiSettings}
      />

      {shots.length === 0 ? (
        <div className="border-border text-muted-foreground rounded-xl border border-dashed py-10 text-center text-sm">
          暂无镜头数据。请先完成「场景分镜」—
          镜头时长与运动强度会自动带入本阶段。
        </div>
      ) : (
        <div className="space-y-3">
          {shots.map((shot) => (
            <ShotCard
              key={shot.id}
              shot={shot}
              progress={progress[shot.id] ?? 0}
              error={errors[shot.id]}
              channel={channel}
              apiReady={apiReady}
              fps={fps}
              onPatch={(p) => patchShot(shot.id, p)}
              onGenerate={() => void generateClip(shot)}
            />
          ))}
        </div>
      )}

      {shots.length > 0 && (
        <p className="text-muted-foreground text-[11px]">
          已完成 {doneCount}/{shots.length} 片段 —
          片段与首帧会自动进入「成片合成」时间线;可随时回来重跑单个镜头。
        </p>
      )}
      {shots.length > 0 && (
        <Button
          variant="secondary"
          size="xs"
          onClick={onPrevStage}
          className="text-muted-foreground hover:text-ink bg-subtle hover:bg-surface-2 h-auto rounded-lg px-3 py-1.5"
        >
          ← 回镜头生图
        </Button>
      )}
    </div>
  );
}
