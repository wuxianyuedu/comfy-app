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
import {
  user,
  llmConfig,
  remoteModel,
  type User,
  type LlmConfig,
  type RemoteModel,
} from "~/server/db/schema";
import { eq, inArray, sql } from "drizzle-orm";
import { SETTINGS_DB_WRITE } from "~/lib/retry-policy";
import { runWithSqliteBusyRetry } from "~/lib/sqlite-busy-retry";
import type { DbExecutor } from "./repository-executor-types";

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

import {
  parseRemoteModeAdapters,
  type RemoteModeAdapter,
} from "~/lib/workshop/model-mode-contract";
import { OLLAMA_DEFAULT_BASE_URL } from "~/lib/endpoints";

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
  const keyByName = new Map(rows.map((r) => [r.name, r.apiKey ?? null]));
  const seen = new Set<string>();
  const cleaned: Array<{
    apiKey: string | null;
    baseUrl: string | null;
    kind: string;
    name: string;
  }> = [];
  for (const e of entries) {
    const name = e.name.trim();
    if (!name || seen.has(name)) {
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
  const removed = rows.filter((r) => !seen.has(r.name));
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

export class RemoteModelRepository {
  /** 全部远端模型，按创建先后排序（配置视图稳定顺序）。 */
  async list(): Promise<Array<RemoteModel>> {
    const rows = await db.select().from(remoteModel).orderBy(remoteModel.createdAt);
    return rows;
  }

  /** 按名查找单个远端模型；不存在返回 null。 */
  async findByName(name: string): Promise<RemoteModel | null> {
    const rows = await db.select().from(remoteModel).where(eq(remoteModel.name, name)).limit(1);
    return rows[0] ?? null;
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
    /* 运行时这一侧本来就拿得到带写锁的事务：`db.transaction` 走 `drizzle-orm/libsql`
     * → `client.transaction()`，默认 mode 是 `write`（= `BEGIN IMMEDIATE`），且整条事务
     * 绑在连接池里的**同一条**连接上（正好避开 §7.6 那条「开机 PRAGMA 只覆盖当时借到的
     * 那条连接」）。两侧都不显式传 `behavior`：libsql 会话把第二个参数整个丢掉，
     * 而测试宿主那一侧（`drizzle-orm/sqlite-proxy`）会真把它拼进 `begin` —— 不传，
     * 这条调用才在两侧都只依赖「回调被 await」这一件事。
     *
     * 旧注释里那句「测试基建跑 better-sqlite3（同步驱动）不接受 async 事务回调」描述的是
     * 换宿主之前的形状，那是**测试的形状、不是生产的约束**；测试宿主现在也接得住 async
     * 回调了（见 `tests/helpers/test-db.ts` 文件头），所以这条通道没有理由继续空着。 */
    await runWithSqliteBusyRetry(
      () => db.transaction(async (tx) => syncRemoteModels(tx, entries)),
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
export const llmConfigRepository = new LlmConfigRepository();
export const remoteModelRepository = new RemoteModelRepository();

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
  await runWithSqliteBusyRetry(
    () =>
      db.transaction(async (tx) => {
        if (split) {
          await syncRemoteModels(tx, split.remoteEntries);
        }
        await llmConfigRepository.upsertSingleton(
          { ...input, extraModels: split ? split.localNames : undefined },
          tx,
        );
      }),
    { policy: SETTINGS_DB_WRITE },
  );
}
