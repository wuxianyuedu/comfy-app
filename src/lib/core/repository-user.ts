/**
 * `repository-user.ts` — User 与 LlmConfig 仓储（Drizzle 版）
 * @module core/repository-user
 *
 * LlmConfig 是唯一存 API Key 的配置表。为避免密钥以明文落盘（本地 SQLite 可被
 * 直接读取），仓库在此层对 DB 字节做 AES-256-GCM 加密：落库前加密、读取后解密，
 * 上层（getLLMConfig / 各 API 路由）拿到的始终是内存中的明文，DB 里只有密文。
 */
import "server-only";

import { db } from "@/lib/db";
import {
  decryptSecret,
  encryptSecret,
} from "@/lib/llm/secrets";
import type { RawExtraModel } from "@/lib/llm/types";
import { user, llmConfig, remoteModel, type User, type LlmConfig, type RemoteModel } from "~/server/db/schema";
import { eq, inArray } from "drizzle-orm";
import type { RemoteModelKind } from "@/lib/llm/types";

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

/* ── 逐条解密远端模型条目里的独立 apiKey（与整表 apiKey 字段同密） ─────── */
function decryptRow(row: LlmConfig): LlmConfig {
  const apiKey = decryptSecret(row.apiKey);
  const extraModels = Array.isArray(row.extraModels)
    ? row.extraModels.map((item: RawExtraModel) => {
        if (typeof item === "object" && item !== null && "apiKey" in item) {
          const rec = { ...item };
          if (typeof rec.apiKey === "string") {
            rec.apiKey = decryptSecret(rec.apiKey);
          }
          return rec;
        }
        return item;
      })
    : row.extraModels;
  return { ...row, apiKey, extraModels };
}

/** 落库前加密：apiKey 字段 + 每个远端条目的独立 apiKey。 */
function encryptInput(
  apiKey: string | null | undefined,
  extraModels: RawExtraModel[] | null | undefined,
): { apiKey: string | null | undefined; extraModels: RawExtraModel[] | null | undefined } {
  const encKey = encryptSecret(apiKey ?? null);
  const encExtra = extraModels
    ? extraModels.map((item) => {
        if (typeof item === "object" && item !== null && "apiKey" in item) {
          return {
            ...item,
            apiKey: encryptSecret(typeof item.apiKey === "string" ? item.apiKey : null),
          };
        }
        return item;
      })
    : extraModels;
  return { apiKey: encKey, extraModels: encExtra };
}

export class LlmConfigRepository {
  /** 读取单例；返回时已解密（内存中为明文，DB 里为密文）。 */
  async findSingleton(): Promise<LlmConfig | null> {
    const rows = await db
      .select()
      .from(llmConfig)
      .where(eq(llmConfig.id, "singleton"))
      .limit(1);
    return rows[0] ? decryptRow(rows[0]) : null;
  }

  async upsertSingleton(input: {
    provider?: string;
    baseUrl?: string;
    model?: string;
    /** 候选模型：旧纯名字字符串 / 新条目对象（远端条目可带独立 baseUrl、apiKey） */
    extraModels?: RawExtraModel[] | null;
    apiKey?: string | null;
    temperature?: number;
    temperatureByTask?: unknown;
    maxTokens?: number;
  }): Promise<LlmConfig> {
    const taskJson = input.temperatureByTask ?? null;
    const enc = encryptInput(input.apiKey, input.extraModels);
    const extraModelsJson = enc.extraModels ?? null;
    const existing = await this.findSingleton();
    if (!existing) {
      const rows = await db
        .insert(llmConfig)
        .values({
          id: "singleton",
          provider: input.provider ?? "local",
          baseUrl: input.baseUrl ?? "http://localhost:11434/v1",
          model: input.model ?? "",
          extraModels: extraModelsJson,
          apiKey: enc.apiKey ?? null,
          temperature: input.temperature ?? 0.7,
          temperatureByTask: taskJson,
          maxTokens: input.maxTokens ?? 2048,
        })
        .returning();
      return decryptRow(rows[0]!);
    }
    const patch: Partial<LlmConfig> = {};
    if (input.provider !== undefined) patch.provider = input.provider;
    if (input.baseUrl !== undefined) patch.baseUrl = input.baseUrl;
    if (input.model !== undefined) patch.model = input.model;
    if (input.extraModels !== undefined) patch.extraModels = extraModelsJson;
    if (input.apiKey !== undefined) patch.apiKey = enc.apiKey ?? null;
    if (input.temperature !== undefined) patch.temperature = input.temperature;
    if (input.temperatureByTask !== undefined) patch.temperatureByTask = taskJson;
    if (input.maxTokens !== undefined) patch.maxTokens = input.maxTokens;
    const rows = await db
      .update(llmConfig)
      .set(patch)
      .where(eq(llmConfig.id, "singleton"))
      .returning();
    return decryptRow(rows[0]!);
  }
}

// ── 远端独立模型仓储（option C：远端模型独立成表，不与本地 ollama 候选混存）──
export class RemoteModelRepository {
  /** 全部远端模型，按创建先后排序（配置视图稳定顺序）。 */
  async list(): Promise<RemoteModel[]> {
    const rows = await db
      .select()
      .from(remoteModel)
      .orderBy(remoteModel.createdAt);
    return rows;
  }

  /** 按名查找单个远端模型；不存在返回 null。 */
  async findByName(name: string): Promise<RemoteModel | null> {
    const rows = await db
      .select()
      .from(remoteModel)
      .where(eq(remoteModel.name, name))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * 以给定条目列表为远端模型的最终态做全量同步（去重键=name）：
   *   已存在 name → 更新 baseUrl/apiKey/kind；新 name → 插入；
   *   库里存在但本次未给出 → 删除。
   * 设置页保存整份远端清单时调用，保证服务端只认这一份真相。
   */
  async replaceAll(entries: Array<{
    name: string;
    baseUrl?: string | null;
    apiKey?: string | null;
    kind?: RemoteModelKind | null;
  }>): Promise<RemoteModel[]> {
    const seen = new Set<string>();
    const cleaned: Array<{
      name: string;
      baseUrl: string | null;
      apiKey: string | null;
      kind: string;
    }> = [];
    for (const e of entries) {
      const name = e.name.trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      cleaned.push({
        name,
        baseUrl: e.baseUrl?.trim() ? e.baseUrl.trim() : null,
        apiKey: e.apiKey?.trim() ? e.apiKey.trim() : null,
        kind: e.kind ?? "chat",
      });
    }
    const rows = await this.list();
    const removed = rows.filter((r) => !seen.has(r.name));
    if (removed.length > 0) {
      await db
        .delete(remoteModel)
        .where(inArray(remoteModel.name, removed.map((r) => r.name)));
    }
    for (const e of cleaned) {
      const existing = rows.find((r) => r.name === e.name);
      if (existing) {
        await db
          .update(remoteModel)
          .set({ baseUrl: e.baseUrl, apiKey: e.apiKey, kind: e.kind })
          .where(eq(remoteModel.id, existing.id));
      } else {
        await db.insert(remoteModel).values(e);
      }
    }
    return this.list();
  }
}

export const userRepository = new UserRepository();
export const llmConfigRepository = new LlmConfigRepository();
export const remoteModelRepository = new RemoteModelRepository();
