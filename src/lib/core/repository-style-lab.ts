/**
 * `repository-style-lab.ts` — 风格实验室仓储（Drizzle 版）
 *
 * 这一层只做「试验行 + 格子行」的读写；组合数 / 预算这些**判据**住在
 * `~/lib/style-lab/style-lab-matrix`，归属与就绪校验住在路由里 —— 仓储不掺业务判断，
 * 与 `repository-production.ts` 同一取舍。
 *
 * 软删除（`deletedAt`）在这一层是**读路径的默认过滤**：列表与详情都只认「没被删的」，
 * 而不是把过滤条件交给每个调用方去记 —— 漏记一次就会把用户删掉的试验又显示出来。
 * @module core/repository-style-lab — 风格实验室仓储
 */
import "server-only";

import { and, desc, eq, inArray, isNull } from "drizzle-orm";
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

export class StyleLabRepository extends DrizzleRepository<StyleExperimentRow> {
  constructor() {
    super(styleExperiment, styleExperiment.id);
  }

  /** 列表：排除软删、按创建时间倒序、条数夹在调用方给的 `take`（路由已夹过区间）。 */
  async listRecent(take: number): Promise<StyleExperimentRow[]> {
    return db
      .select()
      .from(styleExperiment)
      .where(isNull(styleExperiment.deletedAt))
      .orderBy(desc(styleExperiment.createdAt))
      .limit(take);
  }

  /** 详情用的试验行本身（含软删行 —— 是否 404 由路由按 `deletedAt` 判，这里不越权决定）。 */
  async findExperiment(id: string): Promise<StyleExperimentRow | null> {
    return this.findById(id);
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

  /** 新建一行试验。JSON 列（styles / traits / params）传对象，Drizzle 负责序列化。 */
  async createExperiment(
    input: StyleLabCreateInput,
  ): Promise<StyleExperimentRow> {
    const rows = await db
      .insert(styleExperiment)
      .values({
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
   * 软删除：只在「这一行存在且尚未被删」时打 `deletedAt`，返回是否真的动了一行。
   * 返回 false 说明要么不存在、要么已删（幂等）—— 由路由翻译成 404 / 200，仓储不猜。
   */
  async softDelete(id: string): Promise<boolean> {
    const rows = await db
      .update(styleExperiment)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(eq(styleExperiment.id, id), isNull(styleExperiment.deletedAt)),
      )
      .returning({ id: styleExperiment.id });
    return rows.length > 0;
  }
}

export const styleLabRepository = new StyleLabRepository();
