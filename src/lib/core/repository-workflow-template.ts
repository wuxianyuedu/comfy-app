/**
 * `repository-workflow-template.ts` — WorkflowTemplate 业务仓储（Drizzle 版）
 * @module core/repository-workflow-template — WorkflowTemplate 业务仓储（Drizzle 版）
 */
import "server-only";

import { db } from "~/lib/db";
import {
  workflowTemplate,
  workflowModelTagToWorkflowTemplate,
  type WorkflowTemplate,
} from "~/server/db/schema";
import { DrizzleRepository } from "./repository-base";
import { eq, and, desc, type SQL } from "drizzle-orm";

/** 列表页需要的列：除 `positions`（列表页不读、且是大 JSON blob）外的全部。 */
const LIST_ROW_COLUMNS = {
  id: workflowTemplate.id,
  userId: workflowTemplate.userId,
  name: workflowTemplate.name,
  taskType: workflowTemplate.taskType,
  modes: workflowTemplate.modes,
  defaultMode: workflowTemplate.defaultMode,
  paramMap: workflowTemplate.paramMap,
  workflowIO: workflowTemplate.workflowIO,
  rawJson: workflowTemplate.rawJson,
  sourcePath: workflowTemplate.sourcePath,
  sourceChecksum: workflowTemplate.sourceChecksum,
  sourceMtime: workflowTemplate.sourceMtime,
  createdAt: workflowTemplate.createdAt,
} as const;

/** 详情加载时用来判断「磁盘上有没有新版本」的最小列集：只要这三列。 */
const SOURCE_META_COLUMNS = {
  id: workflowTemplate.id,
  sourcePath: workflowTemplate.sourcePath,
  sourceMtime: workflowTemplate.sourceMtime,
} as const;

/** {@link WorkflowTemplateRepository.listForUser} 的行形状（列投影的结果）。 */
export type WorkflowTemplateListRow = Omit<WorkflowTemplate, "positions">;

/** {@link WorkflowTemplateRepository.findSourceMetaForUser} 的行形状。 */
export type WorkflowTemplateSourceMeta = {
  id: string;
  sourcePath: string | null;
  sourceMtime: number | null;
};

export class WorkflowTemplateRepository extends DrizzleRepository<WorkflowTemplate> {
  constructor() {
    super(workflowTemplate, workflowTemplate.id);
  }

  async listByUser(userId: string): Promise<WorkflowTemplate[]> {
    return db
      .select()
      .from(workflowTemplate)
      .where(eq(workflowTemplate.userId, userId))
      .orderBy(desc(workflowTemplate.createdAt));
  }

  async findByIdForUser(
    userId: string,
    id: string,
  ): Promise<WorkflowTemplate | null> {
    const wf = await this.findById(id);
    return wf?.userId === userId ? wf : null;
  }

  /** 「这条工作流有没有绑着一个本地源文件」那一段元数据 —— **真投影**。
   *
   *  这里原本是一个 `findByIdForUserSelect(userId, id, _select?: unknown)`：
   *  参数名承诺投影、实现里 `select()` 全列取，三个调用点还在按 Prisma 的
   *  布尔投影写法传 `{ id: true, sourcePath: true }` —— 类型层一声不响
   *  （`unknown` + 调用点不做校验），实际每次详情加载都把 `rawJson` 与
   *  `positions` 这两个大 JSON blob 拖出来一遍（台账 F13：同一个 `unknown`
   *  签名让 `train.cancel` 从迁移起每次 500，这一处是它的性能版兄弟）。
   *  现在投影是**真的**列清单，方法名也不再承诺一个它不做的能力。 */
  async findSourceMetaForUser(
    userId: string,
    id: string,
  ): Promise<WorkflowTemplateSourceMeta | null> {
    const rows = await db
      .select(SOURCE_META_COLUMNS)
      .from(workflowTemplate)
      .where(
        and(eq(workflowTemplate.id, id), eq(workflowTemplate.userId, userId)),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /** 列表页要用的列 —— **显式投影，不是 `select()`**。
   *
   *  为什么不写 `select()`：它把每一列的整份值都取出来，其中 `positions`
   *  （每个节点的坐标数组）与 `rawJson` 都是**大 JSON blob**，而列表页对
   *  `positions` 一个字都不看。全字段读法让 SQLite 把整行物化、驱动再把
   *  几 MB 的字符串跨过 C++ ↔ JS 边界，堆压力与 GC 全落在一次轮询上。
   *
   *  `rawJson` **必须留**：可执行性判据（`hasRawContent`）与紧凑预览
   *  （`buildWorkflowPreview`）都以它为真值来源，去掉它列表就答不出
   *  「这条能不能跑」。`positions` 是唯一能整列省掉的大字段。
   *
   *  mock 边界：`~/server/db` 的测试替身走的是内存实现，列投影在类型层
   *  收窄、在行为层只影响读了多少 —— 见 `repository.test.ts` 的断言。 */
  async listForUser(
    userId: string,
    opts: { where?: SQL; orderBy?: SQL[] } = {},
  ): Promise<WorkflowTemplateListRow[]> {
    return db
      .select(LIST_ROW_COLUMNS)
      .from(workflowTemplate)
      .where(and(eq(workflowTemplate.userId, userId), opts.where))
      .orderBy(...(opts.orderBy ?? [desc(workflowTemplate.createdAt)]));
  }

  async createImported(input: {
    userId: string;
    name: string;
    taskType: string;
    paramMap?: unknown;
    rawJson?: unknown;
    positions?: unknown;
    sourcePath?: string | null;
    sourceChecksum?: string | null;
    sourceMtime?: number | null;
    modes?: string[];
    defaultMode?: string | null;
  }): Promise<WorkflowTemplate> {
    const rows = await db
      .insert(workflowTemplate)
      .values({
        userId: input.userId,
        name: input.name,
        taskType: input.taskType,
        paramMap: input.paramMap,
        rawJson: input.rawJson,
        positions: input.positions,
        sourcePath: input.sourcePath ?? undefined,
        sourceChecksum: input.sourceChecksum ?? undefined,
        sourceMtime: input.sourceMtime ?? undefined,
        modes: input.modes?.length ? JSON.stringify(input.modes) : "[]",
        defaultMode: input.defaultMode ?? undefined,
      })
      .returning();
    return rows[0]!;
  }

  async relinkSourcePath(
    id: string,
    data: { sourcePath: string; sourceMtime: number },
  ): Promise<void> {
    await db
      .update(workflowTemplate)
      .set({ sourcePath: data.sourcePath, sourceMtime: data.sourceMtime })
      .where(eq(workflowTemplate.id, id));
  }

  async setModelTags(id: string, tagIds: string[]): Promise<void> {
    await db
      .delete(workflowModelTagToWorkflowTemplate)
      .where(eq(workflowModelTagToWorkflowTemplate.workflowTemplate, id));
    if (tagIds.length) {
      await db
        .insert(workflowModelTagToWorkflowTemplate)
        .values(
          tagIds.map((t) => ({ workflowModelTag: t, workflowTemplate: id })),
        );
    }
  }
}

export const workflowTemplateRepository = new WorkflowTemplateRepository();
