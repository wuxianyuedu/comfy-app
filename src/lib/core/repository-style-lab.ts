/**
 * `repository-style-lab.ts` — 风格实验室仓储（Drizzle 版）
 *
 * 这一层只做「试验行 + 格子行」的读写；组合数 / 预算这些**判据**住在
 * `~/lib/style-lab/style-lab-matrix`，就绪校验住在路由里 —— 仓储不掺业务判断，
 * 与 `repository-production.ts` 同一取舍。
 *
 * 软删除（`deletedAt`）与归属（`userId`）在这一层都是**读路径的默认条件**：列表与
 * 详情都只认「这个用户名下、没被删的」，而不是把两个条件交给每个调用方去记 ——
 * 漏记一次就会把用户删掉的试验、或别人试过的组合显示在这一屏上。
 * @module core/repository-style-lab — 风格实验室仓储
 */
import "server-only";

import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "~/lib/db";
import {
  styleExperiment,
  styleExperimentCell,
  type StyleExperimentRow,
  type StyleExperimentCellRow,
} from "~/server/db/schema";
import type { StyleLabCreateInput } from "~/lib/style-lab/style-lab-types";
import { DrizzleRepository } from "./repository-base";
import { firstRowRequired } from "./repository-row";

/** 格子行的插入形状：取自表定义本身，schema 加列时这里自动跟着变。 */
type StyleExperimentCellInsert = typeof styleExperimentCell.$inferInsert;

export class StyleLabRepository extends DrizzleRepository<StyleExperimentRow> {
  constructor() {
    super(styleExperiment, styleExperiment.id);
  }

  /** 列表：限定归属 + 排除软删 + 按创建时间倒序，条数夹在调用方给的 `take`（路由已夹过区间）。 */
  async listRecent(
    userId: string,
    take: number,
  ): Promise<StyleExperimentRow[]> {
    return db
      .select()
      .from(styleExperiment)
      .where(
        and(
          eq(styleExperiment.userId, userId),
          isNull(styleExperiment.deletedAt),
        ),
      )
      .orderBy(desc(styleExperiment.createdAt))
      .limit(take);
  }

  /**
   * 详情用的试验行本身（含软删行 —— 是否 404 由路由按 `deletedAt` 判，这里不越权决定）。
   *
   * 归属判在**这一条 SQL** 上：别人名下的 id 与根本不存在的 id 都给 `null`，于是
   * 路由那句 404 不会外泄「有这一行，但不归你」。
   */
  async findExperiment(
    id: string,
    userId: string,
  ): Promise<StyleExperimentRow | null> {
    const rows = await db
      .select()
      .from(styleExperiment)
      .where(
        and(eq(styleExperiment.id, id), eq(styleExperiment.userId, userId)),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /** 一批试验的格子（用于在列表侧聚合 cellCount / doneCount）。空入参不查。 */
  async findCellsForExperiments(
    experimentIds: readonly string[],
  ): Promise<StyleExperimentCellRow[]> {
    if (experimentIds.length === 0) return [];
    return db
      .select()
      .from(styleExperimentCell)
      .where(inArray(styleExperimentCell.experimentId, [...experimentIds]));
  }

  /**
   * 单条试验的格子（详情 / 矩阵视图用）。
   *
   * 按 `createdAt` 升序而不是自然序：矩阵是「风格 × 特征」的固定座位表，
   * 刷新后换序就没法跟上一眼看到的对得上。
   */
  async findCellsByExperiment(
    experimentId: string,
  ): Promise<StyleExperimentCellRow[]> {
    return db
      .select()
      .from(styleExperimentCell)
      .where(eq(styleExperimentCell.experimentId, experimentId))
      .orderBy(asc(styleExperimentCell.createdAt));
  }

  /**
   * 批量落格子（一次试验展开出的整批），并**返回落下来的行**。
   *
   * 行形状取 schema 的 `$inferInsert`：在这里重抄一遍列名，将来加一列就会
   * 静默不写（对象少字段运行时没人报警），而类型能替我们拦住。
   *
   * 返回行而不是条数：扇出要把 `taskId` 记回**新**格子，而 id 是库里生成的 ——
   * 只回一个数就得再读一次表（多一次往返，且两次读之间库可能已被改写）。
   * 空入参不发 SQL，直接回空数组。
   */
  async insertCells(
    rows: readonly StyleExperimentCellInsert[],
  ): Promise<StyleExperimentCellRow[]> {
    if (rows.length === 0) return [];
    return db.insert(styleExperimentCell).values([...rows]).returning();
  }

  /**
   * 把入队得到的任务 id 记回某一格（扇出的最后一笔）。
   *
   * 只 `update` 这一列而不是整行替换：格子行的其它字段（风格 / 特征键 / 提示词）是
   * 入队**之前**算好并落库的，替换写法会按调用方手里的内存副本再写一遍 —— 同一行
   * 就有了两个写入者，而这里的意图只是补上「这一格由哪条任务跑出」这一个事实。
   *
   * 归属不在这条 SQL 上判：调用方（路由）取格子时已经按 `userId` 过了一遍试验行，
   * 这里的 `cellId` 只能来自那份清单。
   */
  async setCellTask(cellId: string, taskId: string): Promise<void> {
    await db
      .update(styleExperimentCell)
      .set({ taskId })
      .where(eq(styleExperimentCell.id, cellId));
  }

  /** 新建一行试验。JSON 列（styles / traits / params）传对象，Drizzle 负责序列化。 */
  async createExperiment(
    input: StyleLabCreateInput,
  ): Promise<StyleExperimentRow> {
    const rows = await db
      .insert(styleExperiment)
      .values({
        userId: input.userId,
        name: input.name,
        workflowId: input.workflowId,
        mode: input.mode,
        styles: input.styles,
        traits: input.traits,
        params: input.params ?? {},
      })
      .returning();
    return firstRowRequired(rows, "风格试验插入");
  }

  /**
   * 软删除：只在「这一行存在、属于你的用户名下、且尚未被删」时打 `deletedAt`，
   * 返回是否真的动了一行。返回 false 说明要么不存在 / 不是你的、要么已删（幂等）
   * —— 由路由翻译成 404 / 200，仓储不猜。
   */
  async softDelete(id: string, userId: string): Promise<boolean> {
    const rows = await db
      .update(styleExperiment)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(styleExperiment.id, id),
          eq(styleExperiment.userId, userId),
          isNull(styleExperiment.deletedAt),
        ),
      )
      .returning({ id: styleExperiment.id });
    return rows.length > 0;
  }
}

export const styleLabRepository = new StyleLabRepository();
