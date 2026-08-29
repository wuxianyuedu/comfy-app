/**
 * `repository-project.ts` — Project 业务仓储
 * ===========================================================================
 *
 * 项目仓储。在基类 CRUD 之上，强制所有查询按 `userId` 隔离，
 * 杜绝「A 用户读到 B 用户项目」的越权风险。
 *
 * @module core/repository-project
 */
import { prisma } from "@/lib/db";
import { type Prisma, type Project } from "../../../generated/prisma";
import { PrismaRepository, type PrismaDelegate } from "./repository-base";

/**
 * 项目仓储。在基类 CRUD 之上，强制所有查询按 `userId` 隔离，
 * 杜绝「A 用户读到 B 用户项目」的越权风险。
 */
export class ProjectRepository extends PrismaRepository<
  Project,
  Project,
  Partial<Project>,
  { id: string }
> {
  constructor() {
    super(prisma.project as unknown as PrismaDelegate<
      Project,
      Project,
      Partial<Project>,
      { id: string }
    >);
  }

  /** 取某用户的所有项目（按更新时间倒序，最新的在前）。 */
  async listByUser(userId: string): Promise<Project[]> {
    return prisma.project.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
    });
  }

  /**
   * 按用户 upsert：客户端生成的稳定 `proj_*` id 即主键，
   * 首次写入建行（归属 userId），之后仅更新字段。
   */
  async upsertForUser(
    userId: string,
    data: {
      id: string;
      name: string;
      nodes?: unknown;
      edges?: unknown;
    }
  ): Promise<Project> {
    return prisma.project.upsert({
      where: { id: data.id },
      create: {
        id: data.id,
        name: data.name,
        nodes: data.nodes as Prisma.InputJsonValue,
        edges: data.edges as Prisma.InputJsonValue,
        userId,
      },
      update: {
        name: data.name,
        nodes: data.nodes as Prisma.InputJsonValue,
        edges: data.edges as Prisma.InputJsonValue,
        updatedAt: new Date(),
      },
    });
  }

  /** 仅当用户拥有该项目时才删除，避免越权删除。 */
  async deleteForUser(userId: string, id: string): Promise<void> {
    await prisma.project.deleteMany({ where: { id, userId } });
  }
}

/** 进程内单例：API 路由与 server action 共享同一实例。 */
export const projectRepository = new ProjectRepository();
