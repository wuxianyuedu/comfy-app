/** 代码驱动影片的服务端编排：合同 → 落 production.shots → 逐镜入队。
 *
 * 复用现成地基，不新建队列 / 不新建产物体系：
 *  - 落库走 `productionRepository.patchContent`（只写 shots，不碰别的列）
 *  - 逐镜入队走 `createWorkflowRunTask`（task 表 + kickQueue，单一派发循环）
 *  - 失败补偿走 `cancelTask`，与 film/orchestrator 同一口径
 *
 * 依赖通过可选入参注入，便于在没有 ComfyUI / DB 的环境下做行为测试。 */
import "server-only";

import { TRPCError } from "@trpc/server";

import { createLogger } from "~/lib/core/logger";
import { productionRepository } from "~/lib/core/repository-production";
import { cancelTask } from "~/lib/comfyui/enqueue";
import { createWorkflowRunTask } from "~/lib/workshop/workflow-run.server";
import { contractToRuns } from "~/lib/codefilm/contract-to-runs";
import { contractToShots } from "~/lib/codefilm/contract-to-shots";
import { checkContract } from "~/lib/codefilm/qa-rules";
import type { CodeFilmContract } from "~/lib/codefilm/contract-schema";
import type { WorkshopExposedValues } from "~/lib/workshop/workflow-encapsulation";

const log = createLogger("codefilm:orchestrator");

export type RenderCodeFilmInput = {
  /** 已通过 QA 的合同。 */
  contract: CodeFilmContract;
  /** 帧率覆盖（缺省取合同 meta.fps）。 */
  fps?: number;
  /** 绑定界面侧的 production 项目 id（proj_*）；不传则只入队不落库。 */
  projectId?: string | null;
  userId: string;
  /** 逐镜使用的视频工作流 id（工作流库，唯一来源）。 */
  videoWorkflowId: string;
};

export type RenderCodeFilmResult = {
  projectId: string | null;
  shotsWritten: number;
  tasks: Array<{ shotId: string; taskId: string }>;
};

/** 一次入队的最小依赖面（默认接真实实现，测试可注入假件）。 */
export type RenderCodeFilmDeps = {
  cancel: (taskId: string) => Promise<void>;
  enqueue: (input: {
    fps?: number;
    projectId?: string | null;
    shotId: string;
    userId: string;
    values: WorkshopExposedValues;
    workflowId: string;
  }) => Promise<{ taskId: string }>;
  patchShots: (input: {
    projectId: string;
    shots: Array<unknown>;
    userId: string;
  }) => Promise<boolean>;
};

/** 落库 + 逐镜入队。入队按镜头 index 顺序；任一步失败则取消已建任务并返回失败。 */
export async function runCodeFilm(
  input: RenderCodeFilmInput,
  deps?: Partial<RenderCodeFilmDeps>,
): Promise<RenderCodeFilmResult> {
  const report = checkContract(input.contract);
  if (!report.ok) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `合同未通过静态 QA：${report.issues
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join("; ")}`,
    });
  }

  const shots = contractToShots(input.contract);
  const runs = contractToRuns(input.contract, { fps: input.fps });

  const patchShots =
    deps?.patchShots ??
    (async ({ projectId, shots: rows, userId }) =>
      productionRepository.patchContent(userId, projectId, { shots: rows }));
  const enqueue = deps?.enqueue ?? (async (args) => createWorkflowRunTask(args));
  const cancel = deps?.cancel ?? cancelTask;

  if (input.projectId !== undefined && input.projectId !== null) {
    const written = await patchShots({
      projectId: input.projectId,
      shots,
      userId: input.userId,
    });
    if (!written) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `production 项目不存在或不属于当前用户：${input.projectId}`,
      });
    }
  }

  const created: Array<{ shotId: string; taskId: string }> = [];
  try {
    for (const run of runs) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- 逐镜必须按 index 顺序入队，保证多镜连续的时序
      const { taskId } = await enqueue({
        projectId: input.projectId,
        shotId: run.shotId,
        userId: input.userId,
        values: run.values,
        workflowId: input.videoWorkflowId,
      });
      created.push({ shotId: run.shotId, taskId });
    }
  } catch (error) {
    for (const item of created) {
      try {
        // oxlint-disable-next-line eslint/no-await-in-loop -- 补偿取消逐条收尾，失败只记日志不影响其余
        await cancel(item.taskId);
      } catch (cancelError) {
        log.warn("入队失败后的补偿取消未成功", {
          taskId: item.taskId,
          err: String(cancelError),
        });
      }
    }
    throw error;
  }

  return {
    projectId: input.projectId ?? null,
    shotsWritten: shots.length,
    tasks: created,
  };
}
