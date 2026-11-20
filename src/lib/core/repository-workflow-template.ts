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
import { isPlainRecord } from "~/lib/is-record";
import { DrizzleRepository } from "./repository-base";
import type { DbExecutor } from "./repository-executor-types";
import { eq, and, desc, isNull, sql, type SQL } from "drizzle-orm";
import { firstRowRequired } from "./repository-row";

/**
 * 「RAW 原件有没有内容」的物化判据 —— 与 `hasRawContent`
 * （`~/lib/comfyui/execution-shape`）同一口径：rawJson.nodes 是**非空数组**。
 * 判据本体复刻在这里而不是反向 import：lib/core 是地基层（§18.3，lib 反过来
 * 依赖它），core 不许 import 上层模块；判据只有一行，两处以注释互相钉住。
 */
function listHasRaw(rawJson: unknown): boolean {
  if (!isPlainRecord(rawJson)) {
    return false;
  }
  const nodes = rawJson.nodes;
  return Array.isArray(nodes) && nodes.length > 0;
}

/** 列表页需要的列：**大 JSON 列（rawJson / positions）都不再下发**（#4557）。
 *
 *  `positions` 一直没下发；`rawJson` 原本以「可执行性判据与紧凑预览都以它为
 *  真值来源」为由留在投影里 —— 但列表行真正消费的只有它的派生结论 `hasRaw`
 *  （预览字段在 #4557 核对后确认全仓零消费，已随本单移除），结论在写入时由
 *  {@link listHasRaw} 物化进 `hasRaw` 列，列表查询不再碰整图。 */
/* SAFETY: 类型断言已复核 */
const LIST_ROW_COLUMNS = {
  id: workflowTemplate.id,
  userId: workflowTemplate.userId,
  name: workflowTemplate.name,
  taskType: workflowTemplate.taskType,
  modes: workflowTemplate.modes,
  defaultMode: workflowTemplate.defaultMode,
  paramMap: workflowTemplate.paramMap,
  workflowIO: workflowTemplate.workflowIO,
  hasRaw: workflowTemplate.hasRaw,
  sourcePath: workflowTemplate.sourcePath,
  sourceChecksum: workflowTemplate.sourceChecksum,
  sourceMtime: workflowTemplate.sourceMtime,
  createdAt: workflowTemplate.createdAt,
} as const;

/** 详情加载时用来判断「磁盘上有没有新版本」的最小列集：只要这三列。 */
/* SAFETY: 类型断言已复核 */
const SOURCE_META_COLUMNS = {
  id: workflowTemplate.id,
  sourcePath: workflowTemplate.sourcePath,
  sourceMtime: workflowTemplate.sourceMtime,
} as const;

/** {@link WorkflowTemplateRepository.listForUser} 的行形状（列投影的结果）：
 *  两个大 JSON 列（rawJson / positions）都不在行里（#4557）。 */
export type WorkflowTemplateListRow = Omit<WorkflowTemplate, "positions" | "rawJson">;

/** {@link WorkflowTemplateRepository.findSourceMetaForUser} 的行形状。 */
export type WorkflowTemplateSourceMeta = {
  id: string;
  sourceMtime: number | null;
  sourcePath: string | null;
};

export class WorkflowTemplateRepository extends DrizzleRepository<WorkflowTemplate> {
  constructor() {
    super(workflowTemplate, workflowTemplate.id);
  }

  async listByUser(userId: string): Promise<Array<WorkflowTemplate>> {
    return db
      .select()
      .from(workflowTemplate)
      .where(eq(workflowTemplate.userId, userId))
      .orderBy(desc(workflowTemplate.createdAt));
  }

  async findByIdForUser(userId: string, id: string): Promise<WorkflowTemplate | null> {
    const wf = await this.findById(id);
    return wf?.userId === userId ? wf : null;
  }

  /** 「这条工作流有没有绑着一个本地源文件」那一段元数据 —— **真投影**。
   *
   *  这里原本是一个 `findByIdForUserSelect(userId, id, _select?: unknown)`：
   *  参数名承诺投影、实现里 `select()` 全列取，三个调用点还在按迁移前的
   *  布尔投影写法传 `{ id: true, sourcePath: true }` —— 类型层一声不响
   *  （`unknown` + 调用点不做校验），实际每次详情加载都把 `rawJson` 与
   *  `positions` 这两个大 JSON blob 拖出来一遍（台账 F13：同一个 `unknown`
   *  签名曾让一条 procedure 从数据层迁移起每次 500，这一处是它的性能版兄弟）。
   *  现在投影是**真的**列清单，方法名也不再承诺一个它不做的能力。 */
  async findSourceMetaForUser(
    userId: string,
    id: string,
  ): Promise<WorkflowTemplateSourceMeta | null> {
    const rows = await db
      .select(SOURCE_META_COLUMNS)
      .from(workflowTemplate)
      .where(and(eq(workflowTemplate.id, id), eq(workflowTemplate.userId, userId)))
      .limit(1);
    return rows[0] ?? null;
  }

  /** 列表页要用的列 —— **显式投影，不是 `select()`**。
   *
   *  为什么不写 `select()`：它把每一列的整份值都取出来，其中 `positions`
   *  与 `rawJson` 都是**大 JSON blob**（单行可达数 MB），全字段读法让 SQLite
   *  把整行物化、驱动再把几 MB 的字符串跨过 C++ ↔ JS 边界，堆压力与 GC 全落在
   *  一次轮询上（#4557：库大时列表线性变慢的存储侧根源）。列表行对 rawJson
   *  的唯一消费是派生结论 `hasRaw`，由 {@link listHasRaw} 在写入时物化进列；
   *  存量行的 NULL 在这里按用户**惰性回填一次**（只扫 NULL 行，SQL 直接判
   *  JSON 形状，与 {@link listHasRaw} 同一口径），此后回填语句匹配零行。
   *
   *  mock 边界：`~/server/db` 的测试替身走的是内存实现，列投影在类型层
   *  收窄、在行为层只影响读了多少 —— 见 `repository.test.ts` 的断言。 */
  async listForUser(
    userId: string,
    opts: { orderBy?: Array<SQL>; where?: SQL } = {},
  ): Promise<Array<WorkflowTemplateListRow>> {
    await db
      .update(workflowTemplate)
      .set({
        hasRaw: sql`CASE WHEN json_valid(${workflowTemplate.rawJson}) = 1 AND json_type(${workflowTemplate.rawJson}, '$.nodes') = 'array' AND json_array_length(${workflowTemplate.rawJson}, '$.nodes') > 0 THEN 1 ELSE 0 END`,
      })
      .where(and(eq(workflowTemplate.userId, userId), isNull(workflowTemplate.hasRaw)));
    return db
      .select(LIST_ROW_COLUMNS)
      .from(workflowTemplate)
      .where(and(eq(workflowTemplate.userId, userId), opts.where))
      .orderBy(...(opts.orderBy ?? [desc(workflowTemplate.createdAt)]));
  }

  /** 覆盖基类 update：patch 带 rawJson 时**同批物化** hasRaw（#4557）。
   *
   *  rawJson 的全部写入都经这个方法（workflow-mutations 的 update / resync /
   *  分组便签回写）或 {@link createImported}，在仓储收口物化就不必每个调用点
   *  各算一遍。rawJson 不在 patch 里 = 该列不动，hasRaw 保持原值。
   *  `hasRawContent` 的判据本体见 {@link listHasRaw}（分层约束下判据在 core
   *  本地复刻，两处互为镜像）。 */
  override async update(
    id: string,
    patch: Partial<WorkflowTemplate>,
    executor?: DbExecutor,
  ): Promise<WorkflowTemplate> {
    const merged: Partial<WorkflowTemplate> =
      patch.rawJson === undefined ? patch : { ...patch, hasRaw: listHasRaw(patch.rawJson) };
    return super.update(id, merged, executor);
  }

  async createImported(input: {
    defaultMode?: string | null;
    modes?: Array<string>;
    name: string;
    paramMap?: unknown;
    positions?: unknown;
    rawJson?: unknown;
    sourceChecksum?: string | null;
    sourceMtime?: number | null;
    sourcePath?: string | null;
    taskType: string;
    userId: string;
  }): Promise<WorkflowTemplate> {
    const rows = await db
      .insert(workflowTemplate)
      .values({
        userId: input.userId,
        name: input.name,
        taskType: input.taskType,
        paramMap: input.paramMap,
        rawJson: input.rawJson,
        hasRaw: listHasRaw(input.rawJson),
        positions: input.positions,
        sourcePath: input.sourcePath ?? undefined,
        sourceChecksum: input.sourceChecksum ?? undefined,
        sourceMtime: input.sourceMtime ?? undefined,
        modes:
          input.modes !== undefined && input.modes.length > 0 ? JSON.stringify(input.modes) : "[]",
        defaultMode: input.defaultMode ?? undefined,
      })
      .returning();
    return firstRowRequired(rows, "工作流模板插入");
  }

  async relinkSourcePath(
    id: string,
    data: { sourceMtime: number; sourcePath: string },
  ): Promise<void> {
    await db
      .update(workflowTemplate)
      .set({ sourcePath: data.sourcePath, sourceMtime: data.sourceMtime })
      .where(eq(workflowTemplate.id, id));
  }

  /** 全量覆盖模板的模型标签（保存工作流时调用，重复执行结果应一致）。
   *  delete + insert 收进 immediate 事务（ISSUE #3835）：原先两条语句各自提交，
   *  insert 失败会残留「无标签」中间态；并发保存交错（A 删 → B 删 → A 插 → B 插）
   *  还会落下重复关联行（关联表无 (tag, template) 唯一约束），列表 count 虚高。
   *  `executor`：由调用方更大的事务传入（ISSUE #3870，「模板列 + 标签」三段一事务）；
   *  传入时不再自开事务（SQLite 不许嵌套 begin）。 */
  async setModelTags(id: string, tagIds: Array<string>, executor?: DbExecutor): Promise<void> {
    const apply = async (tx: DbExecutor): Promise<void> => {
      await tx
        .delete(workflowModelTagToWorkflowTemplate)
        .where(eq(workflowModelTagToWorkflowTemplate.workflowTemplate, id));
      if (tagIds.length) {
        await tx
          .insert(workflowModelTagToWorkflowTemplate)
          .values(tagIds.map((t) => ({ workflowModelTag: t, workflowTemplate: id })));
      }
    };
    if (executor) {
      await apply(executor);
      return;
    }
    await db.transaction(async (tx) => apply(tx), { behavior: "immediate" });
  }
}

export const workflowTemplateRepository = new WorkflowTemplateRepository();
