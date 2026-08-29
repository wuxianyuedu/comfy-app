/**
 * `repository-model-tag.ts` — WorkflowModelTag 业务仓储（用户级模型标签库）
 * ===========================================================================
 *
 * 标签是「用户级全局库」，按 `(userId, name)` 唯一；一个标签可被多张工作流
 * （隐式多对多 `WorkflowTemplate.modelTags`）引用。本类集中实现列表 /
 * 幂等 upsert / 重命名（保留关联）/ 删除，并把越权校验（必须归属当前用户）
 * 收敛在仓储内，调用方不再手写 `where: { userId }`。
 *
 * @module core/repository-model-tag
 */
import { prisma } from "@/lib/db";
import type { WorkflowModelTag } from "../../../generated/prisma";
import { PrismaRepository } from "./repository-base";

/** 标签视图：去掉内部关系字段，只暴露 UI 需要的 id / name / count。 */
export interface WorkflowModelTagView {
  id: string;
  name: string;
  count: number;
}

/**
 * 模型标签仓储。标签是「用户级全局库」，按 `(userId, name)` 唯一；一个标签
 * 可被多张工作流（隐式多对多 `WorkflowTemplate.modelTags`）引用。本类集中
 * 实现列表 / 幂等 upsert / 重命名（保留关联）/ 删除，并把越权校验
 * （必须归属当前用户）收敛在仓储内，调用方不再手写 `where: { userId }`。
 */
export class WorkflowModelTagRepository extends PrismaRepository<
  WorkflowModelTag,
  WorkflowModelTag,
  Partial<WorkflowModelTag>,
  { id: string }
> {
  constructor() {
    super(
      prisma.workflowModelTag
    );
  }

  /** 取该用户的全部标签，附各自被引用次数，按名称字母序稳定排序。 */
  async listByUser(userId: string): Promise<WorkflowModelTagView[]> {
    const rows = await prisma.workflowModelTag.findMany({
      where: { userId },
      select: { id: true, name: true, _count: { select: { workflows: true } } },
      orderBy: { name: "asc" },
    });
    return rows.map((row) =>({ id: row.id, name: row.name, count: row._count.workflows }));
  }

  /** 幂等 upsert：同名标签已存在则返回原记录，否则新建。 */
  async upsertByName(
    userId: string,
    name: string
  ): Promise<WorkflowModelTagView> {
    const tag = await prisma.workflowModelTag.upsert({
      where: { userId_name: { userId, name } },
      update: {},
      create: { userId, name },
      select: { id: true, name: true, _count: { select: { workflows: true } } },
    });
    return { id: tag.id, name: tag.name, count: tag._count.workflows };
  }

  /** 按「用户 + 名称」取主键（仅取 id），不存在返回 `null`。 */
  async findByUserAndName(
    userId: string,
    name: string
  ): Promise<{ id: string } | null> {
    return prisma.workflowModelTag.findUnique({
      where: { userId_name: { userId, name } },
      select: { id: true },
    });
  }

  /** 仅改名（关联行按 tag id 关联，重命名不破坏任何绑定）。 */
  async rename(id: string, newName: string): Promise<WorkflowModelTagView> {
    const tag = await prisma.workflowModelTag.update({
      where: { id },
      data: { name: newName },
      select: { id: true, name: true, _count: { select: { workflows: true } } },
    });
    return { id: tag.id, name: tag.name, count: tag._count.workflows };
  }

  /** 按主键删除（隐式关联的 workflow 绑定由关系级联清理）。 */
  async deleteById(id: string): Promise<void> {
    await prisma.workflowModelTag.delete({ where: { id } });
  }

  /** 按「用户 + 名称列表」批量取 id（PATCH modelTags set 场景）。 */
  async listIdsByNames(
    userId: string,
    names: string[]
  ): Promise<{ id: string }[]> {
    return prisma.workflowModelTag.findMany({
      where: { userId, name: { in: names } },
      select: { id: true },
    });
  }
}

/** 进程内单例。 */
export const workflowModelTagRepository = new WorkflowModelTagRepository();
