/**
 * 代码驱动影片（CodeFilm）API。
 *
 * P0 的三个无副作用口：编译预览、静态校验、合同→镜头预览（合同层可独立验证）。
 * P1 追加三个有副作用口：generate（LLM 编译合同）、render（落库 + 逐镜入队）、
 * status（逐镜任务状态）。入队走 orchestrator，复用 task 表单一派发循环。
 *
 * 错误出口按规范 10.9：tRPC 一律 TRPCError 带正确 code，客户端拿得到分支。
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";

import { createTRPCRouter, authedProcedure } from "~/server/api/trpc";
import { codeFilmContractSchema, type CodeFilmContract } from "~/lib/codefilm/contract-schema";
import { checkContract } from "~/lib/codefilm/qa-rules";
import { contractToShots } from "~/lib/codefilm/contract-to-shots";
import { contractToRuns } from "~/lib/codefilm/contract-to-runs";
import { taskRepository } from "~/lib/core/repository-task";
import { compileContract } from "~/lib/codefilm/contract-compiler.server";
import { runCodeFilm } from "~/server/codefilm/orchestrator";

/** 入参就是合同 JSON；用 z.unknown 接住后由 contract-schema 做唯一校验，
 *  这样 ZodError 的字段路径就是合同字段路径，不套一层 input 外壳。 */
const contractInput = z.unknown();

/** unknown → 合同：非法入参抛 BAD_REQUEST，并把 Zod 的字段路径带给调用方。 */
function parseContract(raw: unknown): CodeFilmContract {
  const parsed = codeFilmContractSchema.safeParse(raw);
  if (!parsed.success) {
    const paths = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `制片合同不合法：${paths}`,
    });
  }
  return parsed.data;
}

export const codeFilmRouter = createTRPCRouter({
  /** 编译预览：校验合同并回吐规范化后的合同（字段默认值已补齐）。
   *  P0 的「编译」= 校验 + 规范化；LLM 生成在 P1 接。 */
  compile: authedProcedure.input(contractInput).mutation(({ input }) => {
    return { contract: parseContract(input) };
  }),

  /** 静态 QA：返回逐条字段路径与原因；不通过不抛错，交由调用方决定重试。 */
  validate: authedProcedure.input(contractInput).query(({ input }) => {
    return checkContract(parseContract(input));
  }),

  /** 合同 → 工坊镜头预览（不写 production）。供 UI 在入队前核对镜头表。 */
  toShots: authedProcedure
    .input(
      z.object({
        contract: contractInput,
        fps: z.number().int().positive().optional(),
      }),
    )
    .query(({ input }) => {
      const contract = parseContract(input.contract);
      const report = checkContract(contract);
      if (!report.ok) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `合同未通过静态 QA：${report.issues
            .map((issue) => `${issue.path}: ${issue.message}`)
            .join("; ")}`,
        });
      }
      return {
        shots: contractToShots(contract),
        runs: contractToRuns(contract, { fps: input.fps }),
      };
    }),

  /** P1：从剧本文本让 LLM 编译出合同（有界 QA 修复重试）。不落库。 */
  generate: authedProcedure
    .input(
      z.object({
        scriptMarkdown: z.string().min(1),
        meta: z.object({ title: z.string().optional(), tone: z.string().optional() }).optional(),
        targetShots: z.number().int().positive().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        return await compileContract(input);
      } catch (error) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: error instanceof Error ? error.message : "合同编译失败",
        });
      }
    }),

  /** P1：合同落 production.shots + 逐镜入队。失败时已建任务逐个补偿取消。 */
  render: authedProcedure
    .input(
      z.object({
        contract: contractInput,
        projectId: z.string().optional(),
        videoWorkflowId: z.string().min(1),
        fps: z.number().int().positive().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return runCodeFilm({
        contract: parseContract(input.contract),
        fps: input.fps,
        projectId: input.projectId ?? null,
        userId: ctx.user.id,
        videoWorkflowId: input.videoWorkflowId,
      });
    }),

  /** P1：按任务 id 批量取逐镜状态（复用 task 仓储，不新增状态体系）。 */
  status: authedProcedure
    .input(z.object({ taskIds: z.array(z.string()).max(256) }))
    .query(async ({ ctx, input }) => {
      const rows = await taskRepository.findByIdsWithImages(input.taskIds);
      return input.taskIds.map((id) => {
        const row = rows.find((item) => item.id === id);
        if (row === undefined || row.userId !== ctx.user.id) {
          return { id, status: "NOT_FOUND" };
        }
        return { id, status: row.status };
      });
    }),
});
