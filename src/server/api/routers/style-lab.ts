import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, authedProcedure } from "~/server/api/trpc";
import {
  styleLabRepository,
  taskRepository,
  workflowTemplateRepository,
} from "~/lib/core/repository";
import { deriveEncapsulationStatus } from "~/lib/workshop/workshop-encapsulation-status";
import { combinationCount, medianSeconds } from "~/lib/style-lab/style-lab-matrix";
import type {
  StyleLabExperimentRow,
  StyleLabListItem,
  StyleLabTraits,
} from "~/lib/style-lab/style-lab-types";
import type {
  StyleExperimentRow,
  StyleExperimentCellRow,
} from "~/server/db/schema";

/* ETA 的样本量：取最近这么多条已完成出图算中位数。用中位数而不是均值、用一批
 * 而不是最近一条，是因为单张图的耗时会被「显存吃紧慢一轮」这类离群值拉偏——
 * 一个偏慢的样本会让用户以为整批要更久，从而做出错误的分批决定。 */
const MEDIAN_SAMPLE_SIZE = 20;

/* JSON 列（styles / traits / params）在 schema 里是 `text(..., { mode: "json" })`，
 * Drizzle 读回来是已解析的 JS 值，但推断类型是 `unknown`；这里按 DTO 声明收窄。
 * 收窄而非重解析：库里存的形状由写入侧（本路由 create）保证是数组 / 对象。 */
function asStyles(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}
function asTraits(value: unknown): StyleLabTraits {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: StyleLabTraits = {};
  for (const [axisId, values] of Object.entries(value as Record<string, unknown>)) {
    out[axisId] = Array.isArray(values)
      ? values.filter((v): v is string => typeof v === "string")
      : [];
  }
  return out;
}
function asParams(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toExperimentRow(row: StyleExperimentRow): StyleLabExperimentRow {
  return {
    id: row.id,
    name: row.name,
    workflowId: row.workflowId,
    mode: row.mode,
    styles: asStyles(row.styles),
    traits: asTraits(row.traits),
    params: asParams(row.params),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** 按试验 id 聚合格子数与已完成数（taskId 非空 = 已出图）。 */
function buildCounts(cells: readonly StyleExperimentCellRow[]): Map<string, { cell: number; done: number }> {
  const map = new Map<string, { cell: number; done: number }>();
  for (const cell of cells) {
    const entry = map.get(cell.experimentId) ?? { cell: 0, done: 0 };
    entry.cell += 1;
    if (cell.taskId) entry.done += 1;
    map.set(cell.experimentId, entry);
  }
  return map;
}

/* traits 的形状按 DTO 声明：`{ 维度 id: 选中值[] }`；空数组 = 这一维不约束。 */
const traitsSchema = z.record(z.string(), z.array(z.string()));

export const styleLabRouter = createTRPCRouter({
  /* 列表：最新在前、排除软删，每行带派生的 cellCount / doneCount。 */
  list: authedProcedure
    .input(
      z
        .object({
          take: z.number().int().min(1).max(200).default(60),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const take = input?.take ?? 60;
      const rows = await styleLabRepository.listRecent(take);
      const cells = await styleLabRepository.findCellsForExperiments(
        rows.map((row) => row.id),
      );
      const counts = buildCounts(cells);
      const items: StyleLabListItem[] = rows.map((row) => {
        const entry = counts.get(row.id) ?? { cell: 0, done: 0 };
        return {
          ...toExperimentRow(row),
          cellCount: entry.cell,
          doneCount: entry.done,
        };
      });
      /* ETA 的唯一来源：本机最近已完成出图的真实耗时中位数。
       * 没有历史就给 null —— 界面宁可说「暂无参考」，也不拿一个编出来的秒数
       * 让用户据此决定要不要分批。 */
      const durations = await taskRepository.findRecentImageDurations(
        ctx.user.id,
        MEDIAN_SAMPLE_SIZE,
      );
      return { items, medianSecPerImage: medianSeconds(durations) };
    }),

  /* 创建：只立「试验定义」，不产生格子 —— 扇出入口在下一批。 */
  create: authedProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(80),
        workflowId: z.string().min(1),
        mode: z.string().min(1),
        styles: z.array(z.string()).default([]),
        traits: traitsSchema.default({}),
        params: z.record(z.string(), z.unknown()).default({}),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      /* 就绪校验走**真数据**（不装作查过）：路由拿得到工作流行的 workflowIO / paramMap，
       * 于是复用工坊那条 `deriveEncapsulationStatus` —— 与工坊生成链路同一口径判
       * 「这个模式的必备口是否都已有落点」，而不是另写一份宽松版。 */
      const workflow = await workflowTemplateRepository.findByIdForUser(
        ctx.user.id,
        input.workflowId,
      );
      if (!workflow) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "所选工作流不存在",
        });
      }
      const status = deriveEncapsulationStatus({
        io: (workflow.workflowIO ?? null) as Parameters<
          typeof deriveEncapsulationStatus
        >[0]["io"],
        paramMap: (workflow.paramMap ?? null) as Parameters<
          typeof deriveEncapsulationStatus
        >[0]["paramMap"],
        mode: input.mode,
      });
      if (!status.ready) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `该工作流在「${input.mode}」模式下尚未封装就绪，缺：${status.missingRequired.join("、")}`,
        });
      }
      /* 再挡一道纯算术的闸：这套选择会展开成的格数若为 0（形状异常）就不落一行
       * 永远跑不出东西的空试验。空维按 1 计，所以正常半成品至少是 1。 */
      if (combinationCount(input.traits) <= 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "特征组合展开为零格，请检查选择",
        });
      }
      const row = await styleLabRepository.createExperiment(input);
      return { experiment: toExperimentRow(row) };
    }),

  /* 软删除：这一屏的行是「我试过什么」的记录，删的是可见性不是数据本体。 */
  softDelete: authedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const deleted = await styleLabRepository.softDelete(input.id);
      if (!deleted) {
        throw new TRPCError({ code: "NOT_FOUND", message: "试验不存在或已删除" });
      }
      return { ok: true as const };
    }),
});
