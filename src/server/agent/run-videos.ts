/**
 * run 逐镜视频执行器（ISSUE #5211）：`render_videos` 阶段从 run-engine 拆出——
 * 它跟着「视频片段怎么起、什么时候算齐」这一维动，而 run-engine 跟着循环控制动。
 * 先起一条只生成片段、不自动合成的影片；片段全部 SUCCEEDED 才让规划器进入成片阶段。
 * `shotIds` 让镜头 rev 变化后只重出那些镜头，已就绪片段不重生成。
 */
import "server-only";

import { filmRepository, filmShotRepository } from "~/lib/core/repository";
import {
  markActionProcessed,
  type ProductionRun,
  type ProductionRunView,
} from "~/lib/production/run-types";
import { errorMessage } from "~/lib/error-message";

export type VideoExecResult = {
  error?: string;
  ok: boolean;
  run?: ProductionRun;
  /** 纯等待步不写执行日志，避免逐拍轮询刷屏。 */
  skipLog?: boolean;
  summary?: string;
};

/** 主调用点：`render_videos` 动作。 */
export async function execVideos(
  userId: string,
  projectId: string,
  run: ProductionRun,
  view: ProductionRunView,
  shotIds: Array<string>,
): Promise<VideoExecResult> {
  if (run.videoFilmId !== "") {
    const film = await filmRepository.findById(run.videoFilmId);
    if (!film) {
      return {
        ok: false,
        error: "视频影片不存在，已释放认领，请重试",
        run: { ...run, videoFilmId: "", videoStartedAt: "" },
      };
    }
    const shots = await filmShotRepository.listByFilm(film.id);
    if (shots.some((shot) => shot.status === "FAILED")) {
      return {
        ok: false,
        error: "有镜头视频失败，已释放认领，可只重出失败镜头",
        run: { ...run, videoFilmId: "", videoStartedAt: "" },
      };
    }
    if (shots.length > 0 && shots.every((shot) => shot.status === "SUCCEEDED")) {
      return {
        ok: true,
        skipLog: true,
        summary: "逐镜视频已就绪，等待成片阶段合成",
        run: markActionProcessed({ ...run, videoDoneAt: new Date().toISOString() }, view, {
          kind: "render_videos",
          shotIds,
        }),
      };
    }
    return { ok: true, skipLog: true, summary: "逐镜视频生成中" };
  }
  try {
    const { createFilmFromProject, startFilm } = await import("~/server/film/orchestrator");
    const created = await createFilmFromProject({
      userId,
      projectId,
      videoWorkflowId: run.videoWorkflowId || undefined,
      imageWorkflowId: run.imageWorkflowId || undefined,
      shotIds,
    });
    await startFilm(created.id, { skipCompose: true });
    return {
      ok: true,
      summary: `已启动逐镜视频（${shotIds.length} 镜）`,
      run: { ...run, videoFilmId: created.id, videoStartedAt: new Date().toISOString() },
    };
  } catch (error: unknown) {
    return { ok: false, error: errorMessage(error, "启动逐镜视频失败") };
  }
}
