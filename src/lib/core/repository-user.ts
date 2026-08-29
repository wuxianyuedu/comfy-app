/**
 * `repository-user.ts` — User（用户）与 LlmConfig（LLM 配置）仓储
 * ===========================================================================
 *
 * 用户仓储：认证链路（register / change-email / change-password /
 * getServerUser）统一通过本类访问 `User`，不直接碰 Prisma。查询按 email
 * 建立索引；密码哈希生成/校验仍由调用方（bcrypt）负责，本类只做持久化收口。
 *
 * LLM 配置仓储：全局单例行（`id: "singleton"`）的读写在 lib/llm/server 与
 * 本路由间收口；`upsertSingleton` 保持旧路由语义。
 *
 * @module core/repository-user
 */
import { prisma } from "@/lib/db";
import type { LlmConfig, User } from "../../../generated/prisma";

/**
 * 用户仓储。认证链路（register / change-email / change-password / getServerUser）
 * 统一通过本类访问 `User`，不直接碰 Prisma。查询按 email 建立索引；密码哈希
 * 生成/校验仍由调用方（bcrypt）负责，本类只做持久化收口。
 */
export class UserRepository {
  async findByEmail(email: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { email } });
  }

  async createUser(input: {
    email: string;
    name: string | null;
    password: string;
  }): Promise<User> {
    return prisma.user.create({ data: input });
  }

  async updateEmail(id: string, email: string): Promise<User> {
    return prisma.user.update({ where: { id }, data: { email } });
  }

  async updatePassword(id: string, password: string): Promise<User> {
    return prisma.user.update({ where: { id }, data: { password } });
  }
}

/**
 * LLM 配置仓储。全局单例行（`id: "singleton"`）的读写在 lib/llm/server 与
 * 本路由间收口；`upsertSingleton` 保持旧路由语义：仅显式传入的字段参与
 * update，空字符串 apiKey 视为清除。
 */
export class LlmConfigRepository {
  /** 读取全局单例行；未初始化返回 `null`（调用方走默认配置）。 */
  async findSingleton(): Promise<LlmConfig | null> {
    return prisma.llmConfig.findUnique({ where: { id: "singleton" } });
  }

  async upsertSingleton(input: {
    provider?: string;
    baseUrl?: string;
    model?: string;
    apiKey?: string | null;
    temperature?: number;
    maxTokens?: number;
  }): Promise<LlmConfig> {
    return prisma.llmConfig.upsert({
      where: { id: "singleton" },
      create: {
        id: "singleton",
        provider: input.provider ?? "local",
        baseUrl: input.baseUrl ?? "http://localhost:11434/v1",
        model: input.model ?? "llama3.1",
        apiKey: input.apiKey ?? null,
        temperature: input.temperature ?? 0.7,
        maxTokens: input.maxTokens ?? 2048,
      },
      update: {
        ...(input.provider !== undefined ? { provider: input.provider } : {}),
        ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : {}),
        ...(input.model !== undefined ? { model: input.model } : {}),
        ...(input.apiKey !== undefined ? { apiKey: input.apiKey ?? null } : {}),
        ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
        ...(input.maxTokens !== undefined ? { maxTokens: input.maxTokens } : {}),
      },
    });
  }
}

export const userRepository = new UserRepository();
export const llmConfigRepository = new LlmConfigRepository();
