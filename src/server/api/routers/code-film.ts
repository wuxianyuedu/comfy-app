/**
 * 代码驱动影片（CodeFilm）的合同层 API（P0）。
 *
 * P0 只暴露**无副作用**的三个口：编译预览、静态校验、合同→镜头预览。
 * 刻意不落库、不入队、不接 LLM / ComfyUI —— 这样合同层可独立验证，不依赖本机
 * 是否装了 comfy-cli。真实入队与渲染属 P1，在 orchestrator 里接。
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
});
