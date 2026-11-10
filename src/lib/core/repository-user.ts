/**
 * `repository-user.ts` — User 与 LlmConfig 仓储（Drizzle 版）
 * @module core/repository-user — User 与 LlmConfig 仓储（Drizzle 版）
 *
 * LlmConfig 是唯一存 API Key 的配置表。为避免密钥以明文落盘（本地 SQLite 可被
 * 直接读取），仓库在此层对 DB 字节做 AES-256-GCM 加密：落库前加密、读取后解密，
 * 上层（getLLMConfig / 各 API 路由）拿到的始终是内存中的明文，DB 里只有密文。
 *
 * 写入范围也在这一层：一次设置保存要动两张表（`remoteModel` 全量清单 ⇄ `llmConfig`
 * 单例），事务由 `saveLlmSettings` 开一次并把 executor 传给两个方法 —— 路由层不写库、
 * 也不自己 `db.transaction(`（口径见 `docs/standards/18-lib层规范.md` §18.10.1）。
 */
import "server-only";

import { db } from "~/lib/db";
import { firstRowOfExisting, firstRowRequired } from "./repository-row";
import { decryptLlmKey, encryptLlmKey } from "~/lib/llm/secrets";
import { type RawExtraModel, splitExtraModels, type RemoteModelEntry } from "~/lib/llm/types";
import { isLlmApiFormat } from "~/lib/llm/provider-types";
import {
  user,
  llmConfig,
  llmProvider,
  remoteModel,
  type User,
  type LlmConfig,
  type LlmProvider,
  type RemoteModel,
} from "~/server/db/schema";
import { eq, inArray, isNull, sql } from "drizzle-orm";
import { SETTINGS_DB_WRITE } from "~/lib/retry-policy";
import { runWithSqliteBusyRetry } from "~/lib/sqlite-busy-retry";
import type { DbExecutor } from "./repository-executor-types";
import {
  parseRemoteModeAdapters,
  type RemoteModeAdapter,
} from "~/lib/workshop/model-mode-contract";
import { OLLAMA_DEFAULT_BASE_URL } from "~/lib/endpoints";

export class UserRepository {
  async findByEmail(email: string): Promise<User | null> {
    const rows = await db.select().from(user).where(eq(user.email, email)).limit(1);
    return rows[0] ?? null;
  }

  async createUser(input: { email: string; name: string | null; password: string }): Promise<User> {
    const rows = await db.insert(user).values(input).returning();
    return firstRowRequired(rows, "用户插入");
  }

  async updateEmail(id: string, email: string): Promise<User> {
    const rows = await db.update(user).set({ email }).where(eq(user.id, id)).returning();
    return firstRowOfExisting(rows, `用户不存在: ${id}`);
  }

  async updatePassword(id: string, password: string): Promise<User> {
    const rows = await db.update(user).set({ password }).where(eq(user.id, id)).returning();
    return firstRowOfExisting(rows, `用户不存在: ${id}`);
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
  extraModels: Array<RawExtraModel> | null | undefined,
): {
  apiKey: string | null | undefined;
  extraModels: Array<RawExtraModel> | null | undefined;
} {
  const encKey = encryptLlmKey(apiKey ?? null);
  const encExtra = extraModels
    ? extraModels.map((item) => {
        if (typeof item === "object" && item !== null && "apiKey" in item) {
          return {
            ...item,
            apiKey: encryptLlmKey(typeof item.apiKey === "string" ? item.apiKey : null),
          };
        }
        return item;
      })
    : extraModels;
  return { apiKey: encKey, extraModels: encExtra };
}

/**
 * 设置页一次保存提交的 `llmConfig` 补丁形状。
 *
 * 单独具名（而不是在两个签名里各写一遍行内对象）：`upsertSingleton` 与
 * `saveLlmSettings` 吃的是**同一份**用户输入，抄两份就会漂 —— 漂的形态是
 * 「路由多传一格，而那一格在保存路径上被静默丢掉」。
 * 每一格都是**三态**：缺键 = 不动，`undefined` 同义；显式给值才覆盖。
 */
export type LlmConfigPatch = {
  apiKey?: string | null;
  baseUrl?: string;
  /** 候选模型：旧纯名字字符串 / 新条目对象（远端条目可带独立 baseUrl、apiKey） */
  extraModels?: Array<RawExtraModel> | null;
  maxTokens?: number;
  model?: string;
  provider?: string;
  temperature?: number;
  temperatureByTask?: unknown;
};

export class LlmConfigRepository {
  /**
   * 读取单例；返回时已解密（内存中为明文，DB 里为密文）。
   * `executor` 只在不传时才落到模块级连接 —— 事务里的读必须与同一事务的写走同一条连接，
   * 否则读到的是提交前的旧行（#2592 期望 2）。
   */
  async findSingleton(executor?: DbExecutor): Promise<LlmConfig | null> {
    const rows = await (executor ?? db)
      .select()
      .from(llmConfig)
      .where(eq(llmConfig.id, "singleton"))
      .limit(1);
    return rows[0] ? decryptRow(rows[0]) : null;
  }

  async upsertSingleton(input: LlmConfigPatch, executor?: DbExecutor): Promise<LlmConfig> {
    const exec = executor ?? db;
    const taskJson = input.temperatureByTask ?? null;
    const enc = encryptInput(input.apiKey, input.extraModels);
    const extraModelsJson = enc.extraModels ?? null;
    /* 读—改—写三条语句落在**同一个** executor 上：本方法自己是 read-modify-write，
     * 读若走模块级连接，被 `saveLlmSettings` 传进事务调用时就会读到提交前的旧行，
     * patch 也就按一份已经不存在的状态算出来（#2592 期望 2）。 */
    const existing = await this.findSingleton(exec);
    if (!existing) {
      const rows = await exec
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
      return decryptRow(firstRowRequired(rows, "LLM 配置写入"));
    }
    const patch: Partial<LlmConfig> = {};
    if (input.provider !== undefined) {
      patch.provider = input.provider;
    }
    if (input.baseUrl !== undefined) {
      patch.baseUrl = input.baseUrl;
    }
    if (input.model !== undefined) {
      patch.model = input.model;
    }
    if (input.extraModels !== undefined) {
      patch.extraModels = extraModelsJson;
    }
    if (input.apiKey !== undefined) {
      patch.apiKey = enc.apiKey ?? null;
    }
    if (input.temperature !== undefined) {
      patch.temperature = input.temperature;
    }
    if (input.temperatureByTask !== undefined) {
      patch.temperatureByTask = taskJson;
    }
    if (input.maxTokens !== undefined) {
      patch.maxTokens = input.maxTokens;
    }
    const rows = await exec
      .update(llmConfig)
      .set(patch)
      .where(eq(llmConfig.id, "singleton"))
      .returning();
    /* 单例行（id = "singleton"）理论上总在；缺席按「资源不存在」抛出，
     * 不把 `undefined` 冒充成 `LlmConfig` 往下游传。 */
    return decryptRow(firstRowOfExisting(rows, "LLM 配置不存在"));
  }
}

// ── 远端独立模型仓储（option C：远端模型独立成表，不与本地 ollama 候选混存）──

/**
 * 远端清单「整份覆盖」的语句体：读（继承来源）+ 删 + 批量 upsert，**自己不碰事务**。
 *
 * 为什么把这段从 `replaceAll` 的事务回调里搬出来（ISSUE #2592）：跨两张表的那次保存
 * 需要在**同一个** executor 上做这件事，而事务只能开一层（SQLite 在嵌套 `begin` 上
 * 直接报错）。留在原处当回调体，`saveLlmSettings` 就只能重抄这四十行 —— 重抄的那一份
 * 会漂，而漂的形态正是 #2586 已经修掉的那个半态。
 *
 * 事务归属由调用方决定，这里两条都不做：既不 `db.transaction(`，也不套重试预算
 * （`replaceAll` 与 `saveLlmSettings` 各按自己的范围开一次带重试的事务）。
 */
async function syncRemoteModels(
  exec: DbExecutor,
  entries: ReadonlyArray<RemoteModelEntry>,
): Promise<void> {
  /* 既有行在这里取：`workshopAdapters` 与 `apiKey` 都要从它继承。这个接口是
   * 「整份覆盖」，而调用点（设置页保存）手里的清单来自 `getConfigForClient` ——
   * 那份是**脱敏过的**（条目不带 apiKey）。把「没带」读成「用户要清空」，就是
   * 台账 A11：原样保存一次设置，所有远端模型的密钥没了。
   * 读放在事务**内**而不是让调用方在事务外先取一份快照：那份快照可以被另一次保存
   * 插队改掉，那时这里会按一份已经不存在的状态去继承（#2586 的期望 1 明确
   * 不许「只把两条写塞进事务、读仍留在外面」）。 */
  const rows = await exec.select().from(remoteModel).orderBy(remoteModel.createdAt);
  /* #3501：整份清单保存只管**历史遗留行**（providerId IS NULL）。挂在供应商下的
   * 模型由供应商页各自维护，整份覆盖读不到它们、也不许删它们 —— 否则设置页保存
   * 一次别的设置，用户配好的供应商模型就整批消失。 */
  const legacyRows = rows.filter((r) => r.providerId === null);
  const providerNames = new Set(rows.filter((r) => r.providerId !== null).map((r) => r.name));
  const keyByName = new Map(legacyRows.map((r) => [r.name, r.apiKey ?? null]));
  const seen = new Set<string>();
  const cleaned: Array<{
    apiKey: string | null;
    baseUrl: string | null;
    kind: string;
    name: string;
  }> = [];
  for (const e of entries) {
    const name = e.name.trim();
    /* 供应商模型的同名条目一律不在这里写：那条连接参数属于供应商，不该被
     * 一份「本地候选 + 遗留远端」的清单覆盖。 */
    if (!name || seen.has(name) || providerNames.has(name)) {
      continue;
    }
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
    /* trim 后空串与缺省同义 = 清空（与 apiKey 的三态语义一致） */
    cleaned.push({
      name,
      baseUrl: e.baseUrl?.trim() !== undefined && e.baseUrl.trim() !== "" ? e.baseUrl.trim() : null,
      apiKey,
      kind: e.kind ?? "chat",
    });
  }
  const removed = legacyRows.filter((r) => !seen.has(r.name));
  if (removed.length > 0) {
    await exec.delete(remoteModel).where(
      inArray(
        remoteModel.name,
        removed.map((r) => r.name),
      ),
    );
  }
  if (cleaned.length > 0) {
    /* 单条语句批量 upsert（P2：替代原先循环内逐条 update/insert）。
     * 以唯一索引 remoteModel_name_uniq 为冲突目标：已存在则更新、不存在则插入；
     * workshopAdapters 从既有行继承（本接口不覆盖它）。 */
    const adaptersByName = new Map(rows.map((r) => [r.name, r.workshopAdapters]));
    await exec
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
}

/** 远端模型行的读侧解密：`apiKey` 密文 → 明文（历史明文由 `decryptLlmKey` 原样透传）。 */
function decryptRemoteRow(row: RemoteModel): RemoteModel {
  return { ...row, apiKey: decryptLlmKey(row.apiKey) };
}

export class RemoteModelRepository {
  /** 全部远端模型，按创建先后排序（配置视图稳定顺序）。读侧解密独立 apiKey
   *  （#3509：此前只在写侧加密，读侧把密文当密钥发给上游）。 */
  async list(): Promise<Array<RemoteModel>> {
    const rows = await db.select().from(remoteModel).orderBy(remoteModel.createdAt);
    return rows.map(decryptRemoteRow);
  }

  /** 按名查找单个远端模型；不存在返回 null（apiKey 已解密）。 */
  async findByName(name: string): Promise<RemoteModel | null> {
    const rows = await db.select().from(remoteModel).where(eq(remoteModel.name, name)).limit(1);
    return rows[0] ? decryptRemoteRow(rows[0]) : null;
  }

  /**
   * 以给定条目列表为远端模型的最终态做全量同步（去重键=name）：
   *   已存在 name → 更新 baseUrl / kind / apiKey；新 name → 插入；
   *   库里存在但本次未给出 → 删除。
   * 设置页保存整份远端清单时调用，保证服务端只认这一份真相。
   * ⚠️ `apiKey` 是**三态**的（缺键 = 继承既有、`null`/空 = 清空、非空串 = 写入新值），
   *   `workshopAdapters` 一律从既有行继承 —— 见 `syncRemoteModels` 里的注释与台账 A11。
   * 读、删、写三条语句在同一个事务内（`BEGIN IMMEDIATE`）：这份「整份覆盖」中途
   * 失败必须整体回滚，否则未给出的行已删而新清单没落库，用户会丢整份配置与其中的密钥。
   *
   * 这条链自己开事务 ⇒ 它**不能**被用在别人的事务里（SQLite 不许嵌套 `begin`）。
   * 设置页那条跨两张表的保存走 `saveLlmSettings`，它直接复用 `syncRemoteModels`
   * 那一份语句体、把事务开在更大的范围上 —— 两个入口共用实现，不各写一份。
   */
  async replaceAll(entries: ReadonlyArray<RemoteModelEntry>): Promise<Array<RemoteModel>> {
    /* 运行时这一侧要带写锁的事务（ISSUE #3171）：生产已从 `drizzle-orm/libsql`
     * 换成 `drizzle-orm/sqlite-proxy`（node:sqlite 单连接），proxy 会话会把第二个
     * 参数拼进 `begin`，所以这里显式给 `immediate`（= `BEGIN IMMEDIATE`）；不传就
     * 退回默认的 deferred，撞锁时是「先读后写」才失败，晚了半拍。测试宿主
     * （`tests/helpers/test-db.ts`）也是 sqlite-proxy，两侧同形。
     *
     * 旧注释里那句「测试基建跑 better-sqlite3（同步驱动）不接受 async 事务回调」描述的是
     * 换宿主之前的形状，那是**测试的形状、不是生产的约束**；测试宿主现在也接得住 async
     * 回调了（见 `tests/helpers/test-db.ts` 文件头），所以这条通道没有理由继续空着。 */
    await runWithSqliteBusyRetry(
      () => db.transaction(async (tx) => syncRemoteModels(tx, entries), { behavior: "immediate" }),
      { policy: SETTINGS_DB_WRITE },
    );
    return this.list();
  }

  /** 读取某条远端模型的工坊模式适配器（JSON 列；未配置返回空数组）。 */
  async getWorkshopAdapters(name: string) {
    const row = await this.findByName(name);
    if (!row) {
      return [];
    }
    return parseAdaptersJson(row.workshopAdapters);
  }

  /** 保存某条远端模型的工坊模式适配器（整份覆盖）。模型不存在返回空数组。 */
  async saveWorkshopAdapters(name: string, adapters: Array<RemoteModeAdapter>) {
    const row = await this.findByName(name);
    if (!row) {
      return [];
    }
    await db
      .update(remoteModel)
      .set({
        workshopAdapters: JSON.stringify(adapters),
        updatedAt: new Date(),
      })
      .where(eq(remoteModel.id, row.id));
    return adapters;
  }

  /** 新建 / 更新一条供应商下的模型（#3501）。
   *  `apiKey` 三态与 `syncRemoteModels` 同一语义：缺键 = 不动既有、`null`/空白 = 清空、
   *  非空串 = 加密后写入。 */
  async saveModel(input: RemoteModelInput): Promise<RemoteModel> {
    const name = input.name.trim();
    if (name === "") {
      throw new Error("模型名称不能为空");
    }
    const baseUrl = input.baseUrl?.trim() ? input.baseUrl.trim() : null;
    /* 格式是模型级配置（#3517）：非法值折成 null = 跟随供应商，不在写侧猜一个格式
     * （猜错的表现是「请求发到了一个不存在的端点」，比回落更难查）。 */
    const apiFormat = isLlmApiFormat(input.apiFormat) ? input.apiFormat : null;
    const values = {
      name,
      providerId: input.providerId,
      baseUrl,
      apiFormat,
      kind: input.kind ?? "chat",
      enabled: input.enabled ?? true,
      contextWindow: input.contextWindow ?? null,
      maxOutputTokens: input.maxOutputTokens ?? null,
      inputTypes: input.inputTypes ?? null,
      capabilities: input.capabilities ?? null,
      reasoningLevels: input.reasoningLevels ?? null,
      reasoningParamMapping: input.reasoningParamMapping ?? null,
      smartConfig: input.smartConfig ?? true,
    };
    if (input.id !== undefined) {
      const patch: Record<string, unknown> = { ...values, updatedAt: new Date() };
      if (input.apiKey !== undefined) {
        patch.apiKey =
          input.apiKey === null || input.apiKey.trim() === ""
            ? null
            : encryptLlmKey(input.apiKey.trim());
      }
      const rows = await db
        .update(remoteModel)
        .set(patch)
        .where(eq(remoteModel.id, input.id))
        .returning();
      return decryptRemoteRow(firstRowOfExisting(rows, `模型不存在: ${input.id}`));
    }
    const rows = await db
      .insert(remoteModel)
      .values({
        ...values,
        apiKey: encryptLlmKey(input.apiKey?.trim() ? input.apiKey.trim() : null),
      })
      .returning();
    return decryptRemoteRow(firstRowRequired(rows, "模型写入"));
  }

  /** 删除一条模型（供应商页的行内删除）。 */
  async deleteModel(id: string): Promise<void> {
    await db.delete(remoteModel).where(eq(remoteModel.id, id));
  }

  /** 启用 / 停用一条模型（停用的模型不下发给工坊下拉）。 */
  async setEnabled(id: string, enabled: boolean): Promise<RemoteModel> {
    const rows = await db
      .update(remoteModel)
      .set({ enabled, updatedAt: new Date() })
      .where(eq(remoteModel.id, id))
      .returning();
    return decryptRemoteRow(firstRowOfExisting(rows, `模型不存在: ${id}`));
  }
}

/* ── LLM 供应商仓储（#3501）──────────────────────────────────────── */

export type LlmProviderInput = {
  /** 缺省 = 新建；更新时省略 = 不动既有（格式已下移到模型级，见 #3517）。 */
  apiFormat?: string;
  /** 三态：缺键 = 不动既有、`null`/空白 = 清空、非空串 = 加密后写入 */
  apiKey?: string | null;
  baseUrl: string;
  id?: string;
  name: string;
};

export type RemoteModelInput = {
  apiFormat?: string | null;
  apiKey?: string | null;
  baseUrl?: string | null;
  capabilities?: Array<string> | null;
  contextWindow?: number | null;
  enabled?: boolean;
  id?: string;
  inputTypes?: Array<string> | null;
  kind?: string;
  maxOutputTokens?: number | null;
  name: string;
  providerId: string;
  reasoningLevels?: Array<string> | null;
  reasoningParamMapping?: unknown;
  smartConfig?: boolean;
};

function decryptProviderRow(row: LlmProvider): LlmProvider {
  return { ...row, apiKey: decryptLlmKey(row.apiKey) };
}

/* 迁移要在 `LlmProviderRepository` 内部读单例行（默认供应商继承全局 Base URL），
 * 所以这个单例必须先于该类声明 —— 其余单例仍在文件末尾集中导出。 */
export const llmConfigRepository = new LlmConfigRepository();

export class LlmProviderRepository {
  /** 全部供应商（按创建先后），apiKey 已解密。 */
  async list(): Promise<Array<LlmProvider>> {
    const rows = await db.select().from(llmProvider).orderBy(llmProvider.createdAt);
    return rows.map(decryptProviderRow);
  }

  async findById(id: string): Promise<LlmProvider | null> {
    const rows = await db.select().from(llmProvider).where(eq(llmProvider.id, id)).limit(1);
    return rows[0] ? decryptProviderRow(rows[0]) : null;
  }

  async save(input: LlmProviderInput): Promise<LlmProvider> {
    const name = input.name.trim();
    if (name === "") {
      throw new Error("供应商名称不能为空");
    }
    const baseUrl = input.baseUrl.trim();
    const apiFormat = isLlmApiFormat(input.apiFormat) ? input.apiFormat : "chat-completions";
    if (input.id !== undefined) {
      const patch: Record<string, unknown> = { name, baseUrl, updatedAt: new Date() };
      /* 省略 apiFormat = 不动既有：格式已下移到模型级（#3517），详情页不再编辑它，
       * 拿默认值覆盖会把历史供应商的协议悄悄改回 chat-completions。 */
      if (input.apiFormat !== undefined) {
        patch.apiFormat = apiFormat;
      }
      if (input.apiKey !== undefined) {
        patch.apiKey =
          input.apiKey === null || input.apiKey.trim() === ""
            ? null
            : encryptLlmKey(input.apiKey.trim());
      }
      const rows = await db
        .update(llmProvider)
        .set(patch)
        .where(eq(llmProvider.id, input.id))
        .returning();
      return decryptProviderRow(firstRowOfExisting(rows, `供应商不存在: ${input.id}`));
    }
    const rows = await db
      .insert(llmProvider)
      .values({
        name,
        baseUrl,
        apiFormat,
        apiKey: encryptLlmKey(input.apiKey?.trim() ? input.apiKey.trim() : null),
      })
      .returning();
    return decryptProviderRow(firstRowRequired(rows, "供应商写入"));
  }

  /** 删除供应商及其名下模型（同一事务：留着孤儿模型会让列表出现「无主」条目）。 */
  async delete(id: string): Promise<void> {
    await runWithSqliteBusyRetry(
      () =>
        db.transaction(
          async (tx) => {
            await tx.delete(remoteModel).where(eq(remoteModel.providerId, id));
            await tx.delete(llmProvider).where(eq(llmProvider.id, id));
          },
          { behavior: "immediate" },
        ),
      { policy: SETTINGS_DB_WRITE },
    );
  }

  /**
   * 历史遗留模型（`providerId IS NULL`）迁进「默认供应商」。
   *
   * 为什么读侧做而不是一次性迁移脚本：`remoteModel` 是用户已经配好的数据，
   * 迁移必须幂等、且不能因为某次没跑就把模型从列表里藏起来。每次读供应商列表
   * 前跑一遍，代价是一次 `WHERE providerId IS NULL LIMIT 1`（无孤儿时立刻返回）。
   * 已有供应商时优先挂到最早创建的那一个（不新造第二个「默认」）。
   */
  async ensureLegacyProvider(): Promise<void> {
    const orphans = await db
      .select({ id: remoteModel.id })
      .from(remoteModel)
      .where(isNull(remoteModel.providerId))
      .limit(1);
    if (orphans.length === 0) {
      return;
    }
    await runWithSqliteBusyRetry(
      () =>
        db.transaction(
          async (tx) => {
            const existing = await tx
              .select()
              .from(llmProvider)
              .orderBy(llmProvider.createdAt)
              .limit(1);
            let provider = existing[0];
            if (provider === undefined) {
              const cfg = await llmConfigRepository.findSingleton(tx);
              const rows = await tx
                .insert(llmProvider)
                .values({
                  name: "默认供应商",
                  baseUrl: cfg?.baseUrl ?? "",
                  apiFormat: "chat-completions",
                })
                .returning();
              provider = firstRowRequired(rows, "默认供应商创建");
            }
            await tx
              .update(remoteModel)
              .set({ providerId: provider.id })
              .where(isNull(remoteModel.providerId));
          },
          { behavior: "immediate" },
        ),
      { policy: SETTINGS_DB_WRITE },
    );
  }
}

/** 解析 remoteModel.workshopAdapters JSON 列（坏数据按空处理）。 */
export function parseAdaptersJson(raw: string | null): Array<RemoteModeAdapter> {
  /* DB 读出的 JSON 列空串与 null 同义 = 没有数据 */
  if (raw === null || raw === "") {
    return [];
  }
  try {
    return parseRemoteModeAdapters(JSON.parse(raw));
  } catch {
    return [];
  }
}

export const userRepository = new UserRepository();
export const remoteModelRepository = new RemoteModelRepository();
export const llmProviderRepository = new LlmProviderRepository();

/* ── 设置页保存的唯一跨表入口（ISSUE #2592）────────────────────────────── */

/**
 * 一次 LLM 设置保存：在**同一个事务**里同步 `remoteModel` 全量清单、再写 `llmConfig` 单例。
 *
 * 为什么边界在这一层（而不是调用点）：设置页那一条 mutation 此前是两个 await ——
 * `replaceAll` 已提交，`upsertSingleton` 随后失败（AES-GCM 抛错、`SQLITE_BUSY` 都落在
 * 第二条写上），用户就拿到「远端模型列表已经换了、LLM 配置还是旧的」这两张表指向
 * 不同一套模型；而界面下一次读的是 `getConfigForClient()` 拼出来的合并结果，不一致
 * 会被直接呈现。事务开在路由里也能跑，但那是把「谁负责跨表原子性」下放到每条调用链，
 * 第二个保存入口一定会漏。所以这一条链上只有一句话可说：**路由层不写库，跨表原子性
 * 由仓库层这一个入口负责。**
 *
 * 三条刻意的取舍：
 *   · `extraModels` 缺键 ⇒ 本次不动 `remoteModel` 表（候选名单也保持原值）。拆分放在
 *     这里而不是调用点，因为「哪一条候选落哪张表」是存储形状（option C）的决定。
 *   · 重试预算复用 `SETTINGS_DB_WRITE`，与 #2586 同一个数字：事务范围扩到两张表 ⇒ 持锁
 *     更久，撞锁的表现从「偶发丢数据」变成「偶发保存报错」，但那仍是同一格预算的事，
 *     不另立第二个数字。
 *   · 不返回那份合并配置：`getConfigForClient()` 的读**不在**本事务里 —— 读侧一致性
 *     不是这条链的诉求，搬进来只会把持锁时间再拉长。提交之后由调用点自己读。
 */
export async function saveLlmSettings(input: LlmConfigPatch): Promise<void> {
  const split = input.extraModels === undefined ? null : splitExtraModels(input.extraModels);
  // 同样显式 `immediate`（ISSUE #3171）：sqlite-proxy 会把 behavior 拼进 `begin`，
  // 生产与测试宿主一致；不传就退回 deferred，锁要等第一次写才拿。
  await runWithSqliteBusyRetry(
    () =>
      db.transaction(
        async (tx) => {
          if (split) {
            await syncRemoteModels(tx, split.remoteEntries);
          }
          await llmConfigRepository.upsertSingleton(
            { ...input, extraModels: split ? split.localNames : undefined },
            tx,
          );
        },
        { behavior: "immediate" },
      ),
    { policy: SETTINGS_DB_WRITE },
  );
}
