/**
 * run 逐镜生图执行器（ISSUE #5216 从 run-engine 拆出）：它跟着「草图预览 / 镜头级审批 /
 * 正式生图怎么落盘」这一维动，run-engine 跟着循环控制动。先出草图再出正式图；
 * `approved === false` 的镜头直接跳过，规划器不会把它们交进来，这里再兜一层。
 */
import "server-only";

import { logger } from "~/lib/core/logger";
import { productionRepository } from "~/lib/core/repository-production";
import { synthesizeFirstFrame } from "~/lib/comfyui/firstframe";
import { randomSeed } from "~/lib/comfyui/random-seed";
import { shotSizeFor } from "~/lib/film/film-size";
import { asRecord } from "~/lib/is-record";
import {
  approvableShotIds,
  characterIdsOf,
  checkStoryboardQuality,
} from "~/lib/workshop/storyboard-quality";
import {
  markActionProcessed,
  type ProductionRun,
  type ProductionRunView,
} from "~/lib/production/run-types";
import { withProductionContentLock } from "~/lib/production/content-write-lock";
import { generateShotPreview } from "~/server/film/preview";
import type { Shot } from "~/lib/workshop/types";
import type { Production } from "~/server/db/schema";

export type ImageExecResult = {
  error?: string;
  ok: boolean;
  run?: ProductionRun;
  skipLog?: boolean;
  summary?: string;
};

/** 与引擎同口径的镜头数组守卫（外来 JSON 只判数组这一层）。 */
function isShotArray(v: unknown): v is Array<Shot> {
  return Array.isArray(v);
}

/** 主调用点：`render_images` 动作。 */
export async function execImages(
  userId: string,
  projectId: string,
  run: ProductionRun,
  row: Production,
  io: { shotIds: Array<string>; view: ProductionRunView },
): Promise<ImageExecResult> {
  const { view, shotIds } = io;
  if (!run.imageWorkflowId) {
    return {
      ok: false,
      error: "缺少图类工作流（imageWorkflowId），无法逐镜生图",
    };
  }
  const shots = isShotArray(row.shots) ? row.shots : [];
  /* 分镜质量口径（ISSUE #5216）：只读判据，问题只记日志不阻断——把「角色指向不到 /
   * 提示词没重算 / 时长量级不对」挡在昂贵生图之前。审批停点由规划器承担。 */
  const issues = checkStoryboardQuality({
    characterIds: characterIdsOf(row.characters),
    shots: shots.map((shot) => ({
      characterIds: shot.characterIds,
      description: shot.description,
      duration: shot.duration,
      prompt: shot.prompt,
    })),
  });
  if (issues.length > 0) {
    logger.warn(`分镜质量口径：${issues.map((issue) => issue.message).join("；")}`);
  }
  const blocked = new Set(approvableShotIds(shots).blocked);
  const want = new Set(shotIds.filter((id) => !blocked.has(id)));
  /* 先收集本轮产出、不落库（ISSUE #3864）：生图是分钟级慢 IO，必须留在
   * 内容写锁外；锁内只做「重读最新 shots → 叠加本轮产出 → 写回」。 */
  const produced = new Map<
    string,
    { imageUrl?: string; previewUrl?: string; status: "done" | "failed" }
  >();
  for (const shot of shots) {
    if (!want.has(shot.id)) {
      continue;
    }
    // 「种子」默认随机：每次自主出图带一个新 seed，经「种子」对外参数下发，运行期不改工作流节点。
    /* 低草图预览（ISSUE #5216）：只压画幅、复用同一图类工作流；失败只记缺失，
     * 不影响下面的正式生图。已有预览的镜头不重复出，避免每次重跑白烧算力。 */
    let previewUrl: string | undefined;
    if (shot.previewUrl === undefined || shot.previewUrl === "") {
      // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：草图要先于正式图产出
      const preview = await generateShotPreview({
        negative: shot.negativePrompt || undefined,
        params: shot.params,
        projectId,
        prompt: shot.prompt,
        userId,
        workflowId: run.imageWorkflowId,
      });
      if (preview !== null) {
        previewUrl = preview;
      }
    }
    try {
      // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：后一步要用前一步的结果（既有串行路径）
      const path = await synthesizeFirstFrame({
        userId,
        workflowId: run.imageWorkflowId,
        prompt: shot.prompt,
        negative: shot.negativePrompt || undefined,
        projectId,
        seed: randomSeed(),
        /* 与逐镜视频任务同一份场景无关画幅（ISSUE #5138）：首帧与潜空间同尺寸。 */
        size: shotSizeFor(asRecord(shot.params)?.size),
      });
      produced.set(shot.id, { imageUrl: path, previewUrl, status: "done" });
    } catch {
      // 单镜失败：记为 failed，不阻断其它镜；已处理 rev 仍写，避免无限重试同一坏镜。
      produced.set(shot.id, { status: "failed" });
    }
  }
  await withProductionContentLock(projectId, async () => {
    const fresh = await productionRepository.getForUser(userId, projectId);
    const freshShots = isShotArray(fresh?.shots) ? fresh.shots : [];
    const merged = freshShots.map((shot) => {
      const p = produced.get(shot.id);
      if (p === undefined) {
        return shot;
      }
      return {
        ...shot,
        ...(p.imageUrl === undefined ? {} : { imageUrl: p.imageUrl }),
        ...(p.previewUrl === undefined ? {} : { previewUrl: p.previewUrl }),
        status: p.status,
      };
    });
    await productionRepository.patchContent(userId, projectId, { shots: merged });
  });
  const doneCount = [...produced.values()].filter((p) => p.status === "done").length;
  const failedCount = want.size - doneCount;
  const skippedCount = shotIds.length - want.size;
  // 只记录真正处理过的镜头——被审批挡下的镜头保持未处理，批准后还能被继续纳入。
  return {
    ok: true,
    summary: `逐镜生图：${doneCount} 成功${failedCount > 0 ? ` / ${failedCount} 失败` : ""}${skippedCount > 0 ? ` / ${skippedCount} 镜未批准已跳过` : ""}`,
    run: markActionProcessed(run, view, { kind: "render_images", shotIds: [...want] }),
  };
}
