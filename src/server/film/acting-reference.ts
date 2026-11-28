/**
 * 角色表演参考视频生成（ISSUE #5296）：把已确认的定妆照变成一条短参照（开口/转头/眨眼/
 * 呼吸 + 声音提示），供后续镜头作为表演锚点。复用图类工作流的首帧封装与视频工作流的
 * 对外参数口；失败返回 null 由调用方记 warn，不阻断剧本/分镜/生图。
 */
import "server-only";

import { taskRepository } from "~/lib/core/repository-task";
import { isRecord } from "~/lib/is-record";
import { shotSizeFor } from "~/lib/film/film-size";
import { cancelTask } from "~/lib/comfyui/enqueue";
import { randomSeed } from "~/lib/comfyui/random-seed";
import { backoffDelayMs, FIRST_FRAME_WAIT } from "~/lib/retry-policy";
import { isTerminalTaskStatus } from "~/lib/task-state";
import { createWorkflowRunTask } from "~/lib/workshop/workflow-run.server";
import { performancePromptOf } from "~/lib/workshop/acting-reference";
import { resolveFilmFirstFrame } from "./first-frame";
import type { Character } from "~/lib/workshop/types";

/** 表演参考的默认时长/帧率：只做短参照，不追求动作完成度。 */
export const ACTING_REF_DURATION = 2;
export const ACTING_REF_FPS = 16;

async function waitForActingVideo(taskId: string): Promise<string> {
  for (let attempt = 0; attempt < FIRST_FRAME_WAIT.maxAttempts; attempt++) {
    // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：后一步要用前一步的结果
    const row = await taskRepository.findExecutionProgress(taskId);
    if (!row) {
      throw new Error("表演参考任务已不存在（可能被删除）");
    }
    if (isTerminalTaskStatus(row.status)) {
      if (row.status !== "SUCCEEDED") {
        throw new Error(row.error ?? `表演参考生成失败（${row.status}）`);
      }
      const outputs: Array<unknown> = Array.isArray(row.resultImages) ? row.resultImages : [];
      const video = outputs.find((item) => isRecord(item) && item.mediaType === "video");
      if (!isRecord(video) || typeof video.localPath !== "string" || video.localPath === "") {
        throw new Error("表演参考无视频输出");
      }
      return video.localPath;
    }
    // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：退避后才再查
    await new Promise((resolve) =>
      setTimeout(resolve, backoffDelayMs({ ...FIRST_FRAME_WAIT, attempt })),
    );
  }
  throw new Error("表演参考生成超时");
}

/**
 * 生成一条角色表演参考视频。返回产物地址；任何失败都返回 null（任务已建则尽力取消），
 * 由调用方记 warn 并回落定妆照。
 */
export async function generateActingReference(opts: {
  character: Character;
  projectId: string;
  userId: string;
  videoWorkflowId: string;
}): Promise<string | null> {
  const { character, projectId, userId, videoWorkflowId } = opts;
  if (
    videoWorkflowId === "" ||
    typeof character.portraitUrl !== "string" ||
    character.portraitUrl === ""
  ) {
    return null;
  }
  let taskId = "";
  try {
    const firstFrame = await resolveFilmFirstFrame(character.portraitUrl);
    const created = await createWorkflowRunTask({
      userId,
      workflowId: videoWorkflowId,
      projectId,
      values: {
        firstFrame,
        frames: ACTING_REF_DURATION * ACTING_REF_FPS,
        duration: ACTING_REF_DURATION,
        negativePrompt: "camera orbit, outfit change, text, watermark, dramatic light",
        prompt: performancePromptOf(character),
        seed: randomSeed(),
        size: shotSizeFor(),
      },
    });
    taskId = created.taskId;
    return await waitForActingVideo(taskId);
  } catch {
    /* 任务已入队却没等到产物 ⇒ 尽力取消，避免占住唯一执行槽（#4222 同形）。 */
    if (taskId !== "") {
      await cancelTask(taskId).catch(() => undefined);
    }
    return null;
  }
}
