/**
 * 逐镜 TTS 任务与监看回写（ISSUE #5244）：把 #5213 落好的 `ttsParams` 接进任务链——
 * 建任务、按 `shouldRetryTts` 重试、成功后把产物地址写回 `filmShot.params.audioPath`。
 * 音频失败只影响对白轨，不改视频镜头状态、不阻断合成。
 */
import "server-only";

import { filmShotRepository, taskRepository } from "~/lib/core/repository";
import { asRecord } from "~/lib/is-record";
import { errorText } from "~/lib/error-message";
import { createWorkflowRunTask } from "~/lib/workshop/workflow-run.server";
import { appendFilmLog } from "./film-log";
import { shouldRetryTts } from "./voice-track";

type ShotWithParams = { id: string; params: unknown };

function isResultImages(v: unknown): v is Array<{ localPath?: string; mediaType?: unknown }> {
  return Array.isArray(v);
}

/** 建片/提交视频时给有 TTS 载荷的镜头起一条音频任务；已排队或已有产物则不重复起。 */
export async function ensureShotAudio(
  userId: string,
  filmId: string,
  shotId: string,
  params: unknown,
): Promise<void> {
  const rec = asRecord(params) ?? {};
  const workflowId = typeof rec.ttsWorkflowId === "string" ? rec.ttsWorkflowId : "";
  const values = asRecord(rec.ttsParams);
  if (workflowId === "" || values === null) {
    return;
  }
  if (typeof rec.audioPath === "string" && rec.audioPath !== "") {
    return;
  }
  if (typeof rec.audioTaskId === "string" && rec.audioTaskId !== "") {
    return;
  }
  const attempts =
    typeof rec.audioAttempts === "number" && Number.isFinite(rec.audioAttempts)
      ? rec.audioAttempts
      : 0;
  const lastError = typeof rec.audioError === "string" ? rec.audioError : "";
  if (attempts > 0 && !shouldRetryTts(attempts - 1, lastError)) {
    return;
  }
  try {
    const { taskId } = await createWorkflowRunTask({ userId, workflowId, values });
    await filmShotRepository.patchParams(shotId, {
      audioAttempts: attempts + 1,
      audioTaskId: taskId,
    });
    await appendFilmLog(filmId, "info", `镜头对白音轨已排队：${taskId}`);
  } catch (error: unknown) {
    const message = errorText(error, "TTS 任务创建失败");
    await filmShotRepository.patchParams(shotId, {
      audioAttempts: attempts + 1,
      audioError: message,
    });
    await appendFilmLog(filmId, "warn", `镜头对白音轨创建失败：${message}`);
  }
}

/**
 * 监看每一轮跟一次音频任务：成功写回 audioPath，失败清掉任务 id 让下一轮按重试口径重建；
 * 没配 TTS 的镜头一轮都不查（不额外增加数据库往返）。
 */
export async function syncShotAudio(shots: Array<ShotWithParams>, filmId: string): Promise<void> {
  const pending = shots.filter((shot) => {
    const rec = asRecord(shot.params) ?? {};
    return (
      typeof rec.audioTaskId === "string" &&
      rec.audioTaskId !== "" &&
      !(typeof rec.audioPath === "string" && rec.audioPath !== "")
    );
  });
  if (pending.length === 0) {
    return;
  }
  const rows = await taskRepository.findExecutionProgressMany(
    pending.map((shot) => String(asRecord(shot.params)?.audioTaskId)),
  );
  const byId = new Map(rows.map((row) => [row.id, row]));
  const writes: Array<Promise<void>> = [];
  for (const shot of pending) {
    const rec = asRecord(shot.params) ?? {};
    const task = byId.get(String(rec.audioTaskId));
    if (task === undefined) {
      continue;
    }
    if (task.status === "SUCCEEDED") {
      const outputs = isResultImages(task.resultImages) ? task.resultImages : [];
      const audio = outputs.find((item) => item.mediaType === "audio") ?? outputs[0];
      const localPath = typeof audio?.localPath === "string" ? audio.localPath : "";
      if (localPath === "") {
        writes.push(
          filmShotRepository.patchParams(shot.id, {
            audioError: "TTS 任务成功但没有产物",
            audioTaskId: "",
          }),
        );
        writes.push(appendFilmLog(filmId, "warn", "镜头对白音轨任务完成但没有音频产物"));
      } else {
        writes.push(filmShotRepository.patchParams(shot.id, { audioPath: localPath }));
        writes.push(appendFilmLog(filmId, "success", `镜头对白音轨已就绪：${localPath}`));
      }
    } else if (task.status === "FAILED" || task.status === "CANCELLED") {
      writes.push(
        filmShotRepository.patchParams(shot.id, {
          audioError: "TTS 任务失败",
          audioTaskId: "",
        }),
      );
      writes.push(appendFilmLog(filmId, "warn", "镜头对白音轨生成失败，视频与字幕不受影响"));
    }
  }
  await Promise.all(writes);
}
