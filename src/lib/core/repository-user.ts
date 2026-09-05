/**
 * `repository-user.ts` — User 与 LlmConfig 仓储（Drizzle 版）
 * @module core/repository-user
 */
import "server-only";

import { db } from "@/lib/db";
import { user, llmConfig, type User, type LlmConfig } from "~/server/db/schema";
import { eq } from "drizzle-orm";

export class UserRepository {
  async findByEmail(email: string): Promise<User | null> {
    const rows = await db.select().from(user).where(eq(user.email, email)).limit(1);
    return rows[0] ?? null;
  }

  async createUser(input: {
    email: string;
    name: string | null;
    password: string;
  }): Promise<User> {
    const rows = await db.insert(user).values(input).returning();
    return rows[0]!;
  }

  async updateEmail(id: string, email: string): Promise<User> {
    const rows = await db.update(user).set({ email }).where(eq(user.id, id)).returning();
    return rows[0]!;
  }

  async updatePassword(id: string, password: string): Promise<User> {
    const rows = await db.update(user).set({ password }).where(eq(user.id, id)).returning();
    return rows[0]!;
  }
}

export class LlmConfigRepository {
  async findSingleton(): Promise<LlmConfig | null> {
    const rows = await db
      .select()
      .from(llmConfig)
      .where(eq(llmConfig.id, "singleton"))
      .limit(1);
    return rows[0] ?? null;
  }

  async upsertSingleton(input: {
    provider?: string;
    baseUrl?: string;
    model?: string;
    extraModels?: string[] | null;
    apiKey?: string | null;
    temperature?: number;
    temperatureByTask?: unknown;
    maxTokens?: number;
  }): Promise<LlmConfig> {
    const taskJson = input.temperatureByTask ?? null;
    const extraModelsJson = input.extraModels ?? null;
    const existing = await this.findSingleton();
    if (!existing) {
      const rows = await db
        .insert(llmConfig)
        .values({
          id: "singleton",
          provider: input.provider ?? "local",
          baseUrl: input.baseUrl ?? "http://localhost:11434/v1",
          model: input.model ?? "llama3.1",
          extraModels: extraModelsJson,
          apiKey: input.apiKey ?? null,
          temperature: input.temperature ?? 0.7,
          temperatureByTask: taskJson,
          maxTokens: input.maxTokens ?? 2048,
        })
        .returning();
      return rows[0]!;
    }
    const patch: Partial<LlmConfig> = {};
    if (input.provider !== undefined) patch.provider = input.provider;
    if (input.baseUrl !== undefined) patch.baseUrl = input.baseUrl;
    if (input.model !== undefined) patch.model = input.model;
    if (input.extraModels !== undefined) patch.extraModels = extraModelsJson;
    if (input.apiKey !== undefined) patch.apiKey = input.apiKey ?? null;
    if (input.temperature !== undefined) patch.temperature = input.temperature;
    if (input.temperatureByTask !== undefined) patch.temperatureByTask = taskJson;
    if (input.maxTokens !== undefined) patch.maxTokens = input.maxTokens;
    const rows = await db
      .update(llmConfig)
      .set(patch)
      .where(eq(llmConfig.id, "singleton"))
      .returning();
    return rows[0]!;
  }
}

export const userRepository = new UserRepository();
export const llmConfigRepository = new LlmConfigRepository();
