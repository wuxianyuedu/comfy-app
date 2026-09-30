/**
 * `repository-user.ts` — User 与 LlmConfig 仓储（Drizzle 版）
 * @module core/repository-user — User 与 LlmConfig 仓储（Drizzle 版）
 *
 * LlmConfig 是唯一存 API Key 的配置表。为避免密钥以明文落盘（本地 SQLite 可被
 * 直接读取），仓库在此层对 DB 字节做 AES-256-GCM 加密：落库前加密、读取后解密，
 * 上层（getLLMConfig / 各 API 路由）拿到的始终是内存中的明文，DB 里只有密文。
 */
import "server-only";

import { db } from "~/lib/db";
import { decryptLlmKey, encryptLlmKey } from "~/lib/llm/secrets";
import type { RawExtraModel } from "~/lib/llm/types";
import {
  user,
  llmConfig,
  remoteModel,
  type User,
  type LlmConfig,
  type RemoteModel,
} from "~/server/db/schema";
import { eq, inArray, sql } from "drizzle-orm";
import type { RemoteModelKind } from "~/lib/llm/types";

export class UserRepository {
  async findByEmail(email: string): Promise<User | null> {
    const rows = await db
      .select()
      .from(user)
      .where(eq(user.email, email))
      .limit(1);
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
    const rows = await db
      .update(user)
      .set({ email })
      .where(eq(user.id, id))
      .returning();
    return rows[0]!;
  }

  async updatePassword(id: string, password: string): Promise<User> {
    const rows = await db
      .update(user)
      .set({ password })
      .where(eq(user.id, id))
      .returning();
    return rows[0]!;
  }
}

/* ── 逐条解密远端模型条目里的独立 apiKey（与整表 apiKey 字段同密） ─────── */
function decryptRow(row: LlmConfig): LlmConfig {
  const apiKey = decryptLlmKey(row.apiKey);
  const extraModels = Array.isArray(row.extraModels)
    ? row.extraModels.map((item: RawExtraModel) => {
        if (typeof item === "object" && item !== null && "apiKey" in item) {
          const rec = { ...item };
          if (typeof rec.apiKey === "string") {
            rec.apiKey = decryptLlmKey(rec.apiKey);
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
): {
  apiKey: string | null | undefined;
  extraModels: RawExtraModel[] | null | undefined;
} {
  const encKey = encryptLlmKey(apiKey ?? null);
  const encExtra = extraModels
    ? extraModels.map((item) => {
        if (typeof item === "object" && item !== null && "apiKey" in item) {
          return {
            ...item,
            apiKey: encryptLlmKey(
              typeof item.apiKey === "string" ? item.apiKey : null,
            ),
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
          baseUrl: input.baseUrl ?? OLLAMA_DEFAULT_BASE_URL,
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
    if (input.temperatureByTask !== undefined)
      patch.temperatureByTask = taskJson;
    if (input.maxTokens !== undefined) patch.maxTokens = input.maxTokens;
    const rows = await db
      .update(llmConfig)
      .set(patch)
      .where(eq(llmConfig.id, "singleton"))
      .returning();
    return decryptRow(rows[0]!);
  }
}

import {
  parseRemoteModeAdapters,
  type RemoteModeAdapter,
} from "~/lib/workshop/model-mode-contract";
import { OLLAMA_DEFAULT_BASE_URL } from "~/lib/endpoints";

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
   *   已存在 name → 更新 baseUrl / kind / apiKey；新 name → 插入；
   *   库里存在但本次未给出 → 删除。
   * 设置页保存整份远端清单时调用，保证服务端只认这一份真相。
   * ⚠️ `apiKey` 是**三态**的（缺键 = 继承既有、`null`/空 = 清空、非空串 = 写入新值），
   *   `workshopAdapters` 一律从既有行继承 —— 见下面循环里的注释与台账 A11。
   */
  async replaceAll(
    entries: Array<{
      name: string;
      baseUrl?: string | null;
      apiKey?: string | null;
      kind?: RemoteModelKind | null;
    }>,
  ): Promise<RemoteModel[]> {
    /* 既有行先取一次：`workshopAdapters` 与 `apiKey` 都要从它继承。这个接口是
     * 「整份覆盖」，而调用点（设置页保存）手里的清单来自 `getConfigForClient` ——
     * 那份是**脱敏过的**（条目不带 apiKey）。把「没带」读成「用户要清空」，就是
     * 台账 A11：原样保存一次设置，所有远端模型的密钥没了。 */
    const rows = await this.list();
    const keyByName = new Map(rows.map((r) => [r.name, r.apiKey ?? null]));
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
      /* `apiKey` 的三态（与 `~/lib/llm/types` 的 `normalizeEntryApiKey` 同一语义）：
       *   · `undefined`（缺键）→ 继承库里那把，不二次加密、也不清空；
       *   · `null` / 空串 / 全空白 → 用户显式清空；
       *   · 非空串 → 加密后写入。加密这一步 `llmConfig` 那条路径一直有做，而这里
       *     此前直接落明文 —— `db.sqlite` 会被 `next build` 整份复制进 standalone
       *     产物（硬规则 17），明文密钥就是这么跟着桌包分发的。读取侧
       *     `decryptLlmKey` 对历史明文值原样透传，所以老数据不受影响。 */
      const apiKey =
        e.apiKey === undefined
          ? (keyByName.get(name) ?? null)
          : e.apiKey === null || e.apiKey.trim() === ""
            ? null
            : encryptLlmKey(e.apiKey.trim());
      cleaned.push({
        name,
        baseUrl: e.baseUrl?.trim() ? e.baseUrl.trim() : null,
        apiKey,
        kind: e.kind ?? "chat",
      });
    }
    const removed = rows.filter((r) => !seen.has(r.name));
    if (removed.length > 0) {
      await db.delete(remoteModel).where(
        inArray(
          remoteModel.name,
          removed.map((r) => r.name),
        ),
      );
    }
    if (cleaned.length > 0) {
      /* 单条语句批量 upsert（P2：替代原先循环内逐条 update/insert）。
       * 以唯一索引 remoteModel_name_uniq 为冲突目标：已存在则更新、不存在则插入；
       * workshopAdapters 从既有行继承（本接口不覆盖它）。
       * 不包事务：测试基建跑 better-sqlite3（同步驱动）不接受 async 事务回调，
       * 且原实现本就非原子，故只批量化、不改原子性语义。 */
      const adaptersByName = new Map(
        rows.map((r) => [r.name, r.workshopAdapters]),
      );
      await db
        .insert(remoteModel)
        .values(
          cleaned.map((e) => ({
            name: e.name,
            baseUrl: e.baseUrl,
            apiKey: e.apiKey,
            kind: e.kind,
            workshopAdapters: adaptersByName.get(e.name) ?? null,
          })),
        )
        .onConflictDoUpdate({
          target: remoteModel.name,
          set: {
            baseUrl: sql`excluded.baseUrl`,
            apiKey: sql`excluded.apiKey`,
            kind: sql`excluded.kind`,
            workshopAdapters: sql`excluded.workshopAdapters`,
            updatedAt: new Date(),
          },
        });
    }
    return this.list();
  }

  /** 读取某条远端模型的工坊模式适配器（JSON 列；未配置返回空数组）。 */
  async getWorkshopAdapters(name: string) {
    const row = await this.findByName(name);
    if (!row) return [];
    return parseAdaptersJson(row.workshopAdapters);
  }

  /** 保存某条远端模型的工坊模式适配器（整份覆盖）。模型不存在返回空数组。 */
  async saveWorkshopAdapters(name: string, adapters: RemoteModeAdapter[]) {
    const row = await this.findByName(name);
    if (!row) return [];
    await db
      .update(remoteModel)
      .set({
        workshopAdapters: JSON.stringify(adapters),
        updatedAt: new Date(),
      })
      .where(eq(remoteModel.id, row.id));
    return adapters;
  }
}

/** 解析 remoteModel.workshopAdapters JSON 列（坏数据按空处理）。 */
export function parseAdaptersJson(raw: string | null): RemoteModeAdapter[] {
  if (!raw) return [];
  try {
    return parseRemoteModeAdapters(JSON.parse(raw));
  } catch {
    return [];
  }
}

export const userRepository = new UserRepository();
export const llmConfigRepository = new LlmConfigRepository();
export const remoteModelRepository = new RemoteModelRepository();
