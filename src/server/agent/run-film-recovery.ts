/**
 * `filmStartedAt` 已写但影片未就绪时的认领恢复（ISSUE #3962 / #4267）。
 * 从 run-engine 拆出：它跟着「影片实体与认领的收口」这一维动，而引擎跟着循环控制动。
 */
import "server-only";

import { logger } from "~/lib/core/logger";
import { productionRepository } from "~/lib/core/repository-production";
import { errorText } from "~/lib/error-message";
import type { ProductionRun } from "~/lib/production/run-types";

export type RecoveryResult = {
  error?: string;
  ok: boolean;
  run?: ProductionRun;
  skipLog?: boolean;
  summary?: string;
};

/** 返回 null = 没有需要收口的认领，调用方照常起片。 */
export async function recoverFilmStart(
  userId: string,
  projectId: string,
  run: ProductionRun,
): Promise<RecoveryResult | null> {
  if (!run.filmStartedAt) {
    return null;
  }
  const { filmRepository } = await import("~/lib/core/repository");
  const latest = await filmRepository.findLatestByProjectId(userId, projectId);
  const cleared = { ...run, filmStartedAt: "" };
  const release = async () => {
    await productionRepository.clearFilmStart(userId, projectId).catch((clearError: unknown) => {
      /* 释放失败要看得见：释放不掉 = filmStartedAt 永久残留、claimFilmStart 永远
       * 抢不到，该项目在释放成功前无法再次起片；不上抛（补偿路径还有多级收口）。 */
      logger.warn(
        `[run] project=${projectId} ${errorText(clearError, "释放起片认领失败")}；释放前该项目无法再次起片`,
      );
    });
  };
  if (latest === null) {
    await release();
    return {
      ok: false,
      error: "成片启动中断（未创建影片实体），已释放起片认领，请重试",
      run: cleared,
    };
  }
  if (latest.status === "PARSING") {
    try {
      await filmRepository.markFailed(latest.id, "成片启动中断（影片未进入可恢复生成态）");
    } catch {
      // 补偿尽力而为；仍需释放认领避免永久卡死。
    }
    await release();
    return {
      ok: false,
      error: "成片启动中断（影片未进入可恢复生成态），已释放起片认领，请重试",
      run: cleared,
    };
  }
  if (latest.status === "FAILED" || latest.status === "CANCELLED") {
    await release();
    return {
      ok: false,
      error: "成片生成未完成（影片已终止），已释放起片认领，请重试",
      run: cleared,
    };
  }
  if (latest.status === "DONE") {
    await release();
    return { ok: true, run: cleared, skipLog: true, summary: "成片已完成，等待状态同步" };
  }
  return { ok: true, skipLog: true, summary: "成片生成中（等待合成完成）" };
}
