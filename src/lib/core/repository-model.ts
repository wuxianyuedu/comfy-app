/**
 * `repository-model.ts` — Model（模型目录）与 UserModelConfig（用户目录配置）仓储
 * ===========================================================================
 *
 * 模型目录仓储：模型目录是**公共可读**的（不绑定用户），不强制 `userId` 隔离，
 * 仅提供按可用性 / 类型 / 名称的过滤查询与磁盘同步写操作。
 *
 * 模型目录配置仓储：每行以 `(userId, folder)` 唯一，记录用户对某个 ComfyUI
 * 目录的启用 / 别名覆盖，所有方法按 `userId` 隔离。
 *
 * @module core/repository-model
 */
import { prisma } from "@/lib/db";
import {
  type Model,
  type Prisma,
  type UserModelConfig,
} from "../../../generated/prisma";
import { PrismaRepository } from "./repository-base";

/**
 * 模型目录仓储。模型目录是**公共可读**的（不绑定用户），因此本类不强制
 * `userId` 隔离，仅提供按可用性 / 类型 / 名称的过滤查询，供
 * `GET /api/models` 等公共端点使用。所有写操作走别的业务路径，这里只暴露读。
 */
export class ModelRepository extends PrismaRepository<
  Model,
  Model,
  Partial<Model>,
  { id: string }
> {
  constructor() {
    super(
      prisma.model
    );
  }

  /**
   * 列出可用模型（默认仅 `isAvailable`）。支持按类型与名称模糊过滤。
   * 与改造前 `GET /api/models` 的 where 构造完全等价。
   */
  async list(opts?: { type?: string; q?: string }): Promise<Model[]> {
    const where: Prisma.ModelWhereInput = { isAvailable: true };
    if (opts?.type) where.type = opts.type;
    if (opts?.q) where.name = { contains: opts.q };
    return prisma.model.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 300,
    });
  }

  /**
   * 按目录批量切换可用性（models/config 启停目录时的即时反馈）。
   * 只允许对目录下已扫描入库的行生效，不触碰磁盘文件。
   */
  async setAvailabilityByFolder(
    folder: string,
    isAvailable: boolean
  ): Promise<void> {
    await prisma.model.updateMany({
      where: { folder },
      data: { isAvailable },
    });
  }

  // ── 模型同步执行层（models.ts / trainer.ts）──

  /** 全量退役所有 LOCAL 行（每次磁盘同步的第一步，防目录删除后残留假可用）。 */
  async disableAllLocal(): Promise<void> {
    await prisma.model.updateMany({
      where: { source: "LOCAL" },
      data: { isAvailable: false },
    });
  }

  /** 磁盘扫描到的单文件 upsert（fileName_folder 复合唯一键收口在此）。 */
  async upsertScanned(input: {
    fileName: string;
    folder: string;
    name: string;
    type: string;
    baseModel: string;
  }): Promise<void> {
    await prisma.model.upsert({
      where: { fileName_folder: { fileName: input.fileName, folder: input.folder } },
      create: {
        fileName: input.fileName,
        folder: input.folder,
        name: input.name,
        type: input.type,
        baseModel: input.baseModel,
        isAvailable: true,
        source: "LOCAL",
      },
      update: {
        isAvailable: true,
        name: input.name,
        type: input.type,
        baseModel: input.baseModel,
      },
    });
  }

  /** 按目录集合取可用模型文件名（canvas COMBO 下拉投影）。 */
  async listAvailableFileNamesByFolders(folders: string[]): Promise<string[]> {
    if (!folders.length) return [];
    const rows = await prisma.model.findMany({
      where: { isAvailable: true, folder: { in: folders } },
      select: { fileName: true },
    });
    return Array.from(new Set(rows.map((row) => row.fileName))).sort((left, right) =>
      left.localeCompare(right)
    );
  }

  /** 可用文件按目录计数（配置弹窗「文件数」列）。 */
  async countsByFolder(): Promise<Record<string, number>> {
    const rows = await prisma.model.groupBy({
      by: ["folder"],
      where: { isAvailable: true },
      _count: { _all: true },
    });
    const out: Record<string, number> = {};
    for (const r of rows) {
      if (r.folder) out[r.folder] = r._count._all;
    }
    return out;
  }

  /** LoRA 训练产出登记（trainer finishJob：把 .safetensors 注册进模型库）。 */
  async registerLora(input: {
    fileName: string;
    name: string;
    baseModel: string;
    triggerWord: string;
  }): Promise<void> {
    await prisma.model.upsert({
      where: { fileName_folder: { fileName: input.fileName, folder: "loras" } },
      update: { isAvailable: true, name: input.name, baseModel: input.baseModel, folder: "loras" },
      create: {
        name: input.name,
        type: "LORA",
        fileName: input.fileName,
        folder: "loras",
        baseModel: input.baseModel,
        category: "USER",
        source: "LOCAL",
        isAvailable: true,
        description: `由炼丹训练产出 · 触发词 ${input.triggerWord}`,
      },
    });
  }
}

/** 进程内单例。 */
export const modelRepository = new ModelRepository();

/**
 * 模型目录配置仓储。每行以 `(userId, folder)` 唯一，记录用户对某个 ComfyUI
 * 目录的启用 / 别名覆盖。所有方法按 `userId` 隔离，upsert/delete 的
 * `userId_folder` 复合主键收口在此，路由不再手写 `prisma.userModelConfig`。
 */
export class UserModelConfigRepository extends PrismaRepository<
  UserModelConfig,
  UserModelConfig,
  Partial<UserModelConfig>,
  { id: string }
> {
  constructor() {
    super(
      prisma.userModelConfig
    );
  }

  /** 取某用户的全部目录配置行。 */
  async listByUser(userId: string): Promise<UserModelConfig[]> {
    return prisma.userModelConfig.findMany({ where: { userId } });
  }

  /** 取所有已启用目录的 folder 名（canvas COMBO 投影用，全局启用集）。 */
  async listEnabledFolders(): Promise<string[]> {
    const rows = await prisma.userModelConfig.findMany({
      where: { enabled: true },
      select: { folder: true },
    });
    return rows.map((row) => row.folder);
  }

  /**
   * POST 语义：新增 / 重新启用目录。每次调用都会把该目录的 type/types
   * 重置为「目录名即类型」（R-ardot45），并强制启用。
   */
  async addOrEnable(
    userId: string,
    folder: string,
    label: string | null
  ): Promise<UserModelConfig> {
    return prisma.userModelConfig.upsert({
      where: { userId_folder: { userId, folder } },
      create: {
        userId,
        folder,
        type: folder,
        types: "[]",
        label,
        enabled: true,
        isCustom: true,
      },
      update: { type: folder, types: "[]", label, enabled: true },
    });
  }

  /** PATCH 语义：仅更新给定字段；行不存在则按补丁语义创建。 */
  async patchForUser(
    userId: string,
    folder: string,
    patch: { enabled?: boolean; label?: string | null }
  ): Promise<UserModelConfig> {
    return prisma.userModelConfig.upsert({
      where: { userId_folder: { userId, folder } },
      create: {
        userId,
        folder,
        type: folder,
        types: "[]",
        label: patch.label ?? null,
        enabled: patch.enabled ?? true,
        isCustom: true,
      },
      update: patch,
    });
  }

  /** DELETE 语义：删除覆盖行；不存在静默忽略（幂等）。 */
  async deleteForUser(userId: string, folder: string): Promise<void> {
    await prisma.userModelConfig
      .delete({ where: { userId_folder: { userId, folder } } })
      .catch(() => null);
  }
}

/** 进程内单例。 */
export const userModelConfigRepository = new UserModelConfigRepository();
