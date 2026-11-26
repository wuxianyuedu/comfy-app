/**
 * `generation-control.ts` — 生图队列的暂停 / 恢复控制（ISSUE #5055）。
 *
 * 状态落在 `generationControl` 单行表（读写经任务仓储的同一份 impl，inline 与
 * host 两个执行宿主都读得到）：暂停期间派发循环不领生图类排队任务，正在跑的
 * 那条照常收尾；恢复后按队列序继续。应用重启后仍是库里那份，直到显式恢复。
 * @module server/routers/generation-control — 生图暂停控制路由
 */
import { z } from "zod";

import { createTRPCRouter, authedProcedure } from "~/server/api/trpc";
import { taskRepository } from "~/lib/core/repository-task";

export const generationControlRouter = createTRPCRouter({
  /** 当前暂停状态（队列页的图标态）。 */
  pauseState: authedProcedure.query(async () => {
    return taskRepository.getGenerationPauseState();
  }),

  /** 设置暂停 / 恢复。暂停是落库的持久状态：重启后仍保持，直到再调本口恢复。 */
  setPaused: authedProcedure
    .input(z.object({ paused: z.boolean() }))
    .mutation(async ({ input }) => {
      return taskRepository.setGenerationPaused(input.paused);
    }),
});
