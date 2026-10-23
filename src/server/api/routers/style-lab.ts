import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, authedProcedure } from "~/server/api/trpc";
import {
  styleLabRepository,
  taskRepository,
  workflowTemplateRepository,
} from "~/lib/core/repository";
import { deriveEncapsulationStatus } from "~/lib/workshop/workshop-encapsulation-status";
import { firstSavedImage } from "~/lib/workshop/api-channel-shared";
import { combinationCount, medianSeconds } from "~/lib/style-lab/style-lab-matrix";
import {
  runStyleLabBatch,
  stopStyleLabBatch,
} from "~/server/lib/style-lab-batch";
import type {
  StyleLabCellRow,
  StyleLabCellWithStatus,
  StyleLabExperimentRow,
  StyleLabListItem,
  StyleLabTraits,
} from "~/lib/style-lab/style-lab-types";
import type {
  StyleExperimentRow,
  StyleExperimentCellRow,
} from "~/server/db/schema";

/* ETA 的样本量：取最近这么多条已完成出图算中位数。用中位数而不是均值、用一批
 * 而不是最近一条，是因为单张图的耗时会被「显存吃紧慢一轮」这类离群值拉偏 ——
 * 一个偏慢的样本会让用户以为整批要更久，从而做出错误的分批决定。 */
const MEDIAN_SAMPLE_SIZE = 20;

/* JSON 列（styles / traits / params）在 schema 里是 `text(..., { mode: "json" })`，
 * Drizzle 读回来是已解析的 JS 值，但推断类型是 `unknown`；这里按 DTO 声明收窄。
 * 收窄而非重解析：库里存的形状由写入侧（本路由 create）保证是数组 / 对象。 */
function asStyles(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
}
function asTraits(value: unknown): StyleLabTraits {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: StyleLabTraits = {};
  for (const [axisId, values] of Object.entries(
    value as Record<string, unknown>,
  )) {
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

function toCellRow(row: StyleExperimentCellRow): StyleLabCellRow {
  return {
    id: row.id,
    experimentId: row.experimentId,
    style: row.style,
    traitKey: row.traitKey,
    prompt: row.prompt,
    isRepresentative: row.isRepresentative,
    taskId: row.taskId,
    createdAt: row.createdAt,
  };
}

/** 按试验 id 聚合格子数与已完成数（taskId 非空 = 已入过队）。 */
function buildCounts(
  cells: readonly StyleExperimentCellRow[],
): Map<string, { cell: number; done: number }> {
  const map = new Map<string, { cell: number; done: number }>();
  for (const cell of cells) {
    const entry = map.get(cell.experimentId) ?? { cell: 0, done: 0 };
    entry.cell += 1;
    if (cell.taskId) entry.done += 1;
    map.set(cell.experimentId, entry);
  }
  return map;
}

/**
 * 按 id 取「属于你的、还在的」试验行。
 *
 * 归属判在仓储那条 SQL 上（别人的 id 也返回 null），所以这里对外只给**同一句**
 * 404：软删过的、压根没写过的、不属于你的，在这一屏是同一个下一动作（去新建一条），
 * 把它们分成三个码只是多泄露一份「这个 id 存在于别人名下」。
 */
async function requireExperiment(
  id: string,
  userId: string,
): Promise<StyleExperimentRow> {
  const row = await styleLabRepository.findExperiment(id, userId);
  if (!row || row.deletedAt) {
    throw new TRPCError({ code: "NOT_FOUND", message: "试验不存在或已删除" });
  }
  return row;
}

/**
 * 「这条工作流在这个模式下真的封装就绪了吗」—— `create` 与 `runBatch` 共用那一份判据。
 *
 * 为什么批量还要再判一次：试验存的是**当时**就绪的 `workflowId + mode`，而工作流是
 * 可以被作者随时改的（拆掉一条线、删掉一个端口）。不在提交时重判，一批就会带着
 * 落不到端口的提示词跑出去 —— 出图成功、图里却是工作流的默认内容，用户在矩阵前
 * 看到「每张都差不多」也看不出原因。错误文案把缺的口写出来，下一动作才有依据。
 */
async function assertWorkflowModeReady(
  userId: string,
  workflowId: string,
  mode: string,
): Promise<void> {
  const workflow = await workflowTemplateRepository.findByIdForUser(
    userId,
    workflowId,
  );
  if (!workflow) {
    throw new TRPCError({ code: "NOT_FOUND", message: "所选工作流不存在" });
  }
  const status = deriveEncapsulationStatus({
    io: (workflow.workflowIO ?? null) as Parameters<
      typeof deriveEncapsulationStatus
    >[0]["io"],
    paramMap: (workflow.paramMap ?? null) as Parameters<
      typeof deriveEncapsulationStatus
    >[0]["paramMap"],
    mode,
  });
  if (!status.ready) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `该工作流在「${mode}」模式下尚未封装就绪，缺：${status.missingRequired.join("、")}`,
    });
  }
}

/**
 * 一批格子的任务进度（一次 `IN` 读，不按格往返）。
 *
 * 只取状态与产物那几列而不是整行：`task` 的 `workflowSnapshot` / `logs` 单行可达
 * 数 MB，而这里要的只是「这一格现在排队中还是已完成、出的是哪张图」。
 */
async function progressOfCells(
  cells: readonly StyleExperimentCellRow[],
): Promise<Map<string, { status: string; resultImages: unknown }>> {
  const taskIds = cells
    .map((cell) => cell.taskId)
    .filter((taskId): taskId is string => taskId !== null);
  const rows = await taskRepository.findExecutionProgressMany(taskIds);
  return new Map(
    rows.map((row) => [
      row.id,
      { status: row.status, resultImages: row.resultImages },
    ]),
  );
}

/* traits 的形状按 DTO 声明：`{ 维度 id: 选中值[] }`；空数组 = 这一维不约束。 */
const traitsSchema = z.record(z.string(), z.array(z.string()));

export const styleLabRouter = createTRPCRouter({
  /* 列表：最新在前、排除软删、只看自己的，每行带派生的 cellCount / doneCount。 */
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
      const rows = await styleLabRepository.listRecent(ctx.user.id, take);
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

  /* 详情：试验定义 + 它的座位表（每格带任务状态与那张成品图）。
   *
   * 状态与图在**这一趟**一起给：它们归 `task` 表管，但视图要按格显示
   * 「排队中 / 生成中 / 已完成」与成品。让视图自己去发第二次任务查询，就会拿到
   * 两个时点的快照（列表说这一格在跑、任务说它没了），而这两个数字都在屏上。 */
  detail: authedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const row = await requireExperiment(input.id, ctx.user.id);
      const cells = await styleLabRepository.findCellsByExperiment(row.id);
      const progress = await progressOfCells(cells);
      const items: StyleLabCellWithStatus[] = cells.map((cell) => {
        const entry = cell.taskId ? progress.get(cell.taskId) : undefined;
        return {
          ...toCellRow(cell),
          status: entry?.status ?? null,
          /* 图片地址是**读时**从那条任务的产物清单取的：格子表只存 taskId，
             再抄一份路径就会出现「删了任务、格子还指着没了的图」。 */
          imageUrl: entry ? firstSavedImage(entry.resultImages) : null,
        };
      });
      return { experiment: toExperimentRow(row), cells: items };
    }),

  /* 创建：只立「试验定义」，不产生格子 —— 格子由 `runBatch` 按当次展开现算。 */
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
      /* 就绪校验走**真数据**（不装作查过）：复用工坊那条 `deriveEncapsulationStatus`
       * —— 与批量提交、与工坊生成链路同一口径判「这个模式的必备口是否都已有落点」，
       * 而不是另写一份宽松版。 */
      await assertWorkflowModeReady(
        ctx.user.id,
        input.workflowId,
        input.mode,
      );
      /* 再挡一道纯算术的闸：这套选择会展开成的格数若为 0（形状异常）就不落一行
       * 永远跑不出东西的空试验。空维按 1 计，所以正常半成品至少是 1。 */
      if (combinationCount(input.traits) <= 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "特征组合展开为零格，请检查选择",
        });
      }
      const row = await styleLabRepository.createExperiment({
        userId: ctx.user.id,
        name: input.name,
        workflowId: input.workflowId,
        mode: input.mode,
        styles: input.styles,
        traits: input.traits,
        params: input.params,
      });
      return { experiment: toExperimentRow(row) };
    }),

  /* 跑一批：整张矩阵按格串行入队（跳过已出过图的座位）。
   *
   * 展开、预算闸、判重、节拍四件事都在 `~/server/lib/style-lab-batch.ts`，本过程只做
   * 归属与就绪这两道入口闸 —— 与 `create` 同一份判据（`assertWorkflowModeReady`）。 */
  runBatch: authedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const row = await requireExperiment(input.id, ctx.user.id);
      await assertWorkflowModeReady(ctx.user.id, row.workflowId, row.mode);
      return runStyleLabBatch({ userId: ctx.user.id, experiment: row });
    }),

  /* 停一批：取消这一试验名下仍在进行中的格子任务。
   *
   * 取消的具体动作在批量模块里复用执行侧那份 `cancelTask`（与 `task.cancel` 同一个
   * 出口），这里只判归属 —— 不在这里另写一份「把状态改成 CANCELLED」。 */
  stopBatch: authedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const row = await requireExperiment(input.id, ctx.user.id);
      return stopStyleLabBatch({ userId: ctx.user.id, experimentId: row.id });
    }),

  /* 软删除：这一屏的行是「我试过什么」的记录，删的是可见性不是数据本体。 */
  softDelete: authedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const deleted = await styleLabRepository.softDelete(
        input.id,
        ctx.user.id,
      );
      if (!deleted) {
        throw new TRPCError({ code: "NOT_FOUND", message: "试验不存在或已删除" });
      }
      return { ok: true as const };
    }),
});
