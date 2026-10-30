/**
 * tests/helpers/test-db.ts — Drizzle 内存测试库（测试基建，不触碰 src 源码）
 * ===========================================================================
 *
 * mock 策略：
 * - 测试文件通过 `vi.mock("~/server/db", () => ({ db: createTestDb() }))` 把
 *   `~/server/db`（即 `@/lib/db`）的 `db` 替换成本文件创建的「内存 SQLite +
 *   Drizzle」实例。Repository 层与 tRPC ctx 直接复用同一实例，src 源码零改动。
 * - 用的是真实 Drizzle API（`db.select().from(task)` …），因此 repository 的
 *   任何改写都能在集成测试里真实跑通，而非 mock 一套假语义。
 * - 内存库 `:memory:` 每次测试文件新建，建表用 CREATE_SQL（与 schema.ts 对齐），
 *   测试间用 `$reset()` 清空。
 *
 * 兼容旧测试 API（不破坏 generate.test.ts / workflow.test.ts）：
 * - `getTestDb()` 返回带 `$reset()` 与 `$tables` 的对象；`$tables.X` 是同步行数组
 *   （JSON 列已自动解析回对象），断言沿用 `tdb.$tables.tasks.find(...)` 等写法。
 * - `seedUser` / `seedWorkflowTemplate` / `seedTask` / `seedProject` 用底层同步
 *   写入（better-sqlite3），保持与原同步 seed 调用一致。
 *
 * drizzle 那一层为什么走 `sqlite-proxy` 而不是 `drizzle-orm/better-sqlite3`（ISSUE #2586）：
 * 后者把事务回调直接交给 better-sqlite3 的 `transaction()`，而它**不等 promise** ——
 * 生产代码里的 `await db.transaction(async (tx) => …)` 会在第一个 await 之前就 COMMIT，
 * 原子性静默失效（同一形状见 `tests/tw4-*` 那批与规范 §6.1 的读数）。代理层的
 * `SQLiteRemoteSession.transaction` 是 `await transaction(tx)`，`begin`/`commit`/`rollback`
 * 也走同一个回调 ⇒ 同一份生产代码在测试宿主上拿到的是**真的**事务，而不是一个看着正常的空壳。
 * 同步门面（`$reset` / `$tables` / 六个 `seed*`）不经过这一层，仍直接打 `Database` 实例。
 *
 * @module tests/helpers/test-db — Drizzle 内存测试库（测试基建，不触碰 src 源码）
 */
import Database from "better-sqlite3";
import { drizzle, type RemoteCallback } from "drizzle-orm/sqlite-proxy";
import * as schema from "~/server/db/schema";
import { encryptLlmKey } from "~/lib/llm/secrets";

export type Row = Record<string, unknown>;

/** schema.ts 中声明为 `{ mode: "json" }` 的列（存为 JSON 字符串，读取需解析）。 */
const jsonColumns = new Set<string>([
  "nodes",
  "edges",
  "params",
  "workflowSnapshot",
  "referenceImages",
  "resultImages",
  "logs",
  "validationErrors",
  "execPayload",
  "progressNode",
  "rawCli",
  "paramMap",
  "workflowIO",
  "rawJson",
  "positions",
  "defaultParams",
  "datasetImages",
  "temperatureByTask",
  "scenes",
  "characters",
  "shots",
  "progress",
  "run",
  "scriptReview",
  "styleTags",
  "portraits",
]);

const TABLES = [
  "user",
  "session",
  "account",
  "verification",
  "post",
  "project",
  "model",
  "userModelConfig",
  "favorite",
  "task",
  "taskImage",
  "workflowTemplate",
  "workflowModelTag",
  "workflowModelTag_workflowTemplate",
  "llmConfig",
  "skill",
  "filmProject",
  "filmShot",
  "auditLog",
  "remoteModel",
  "workshopSession",
  "workshopDraft",
  "production",
  "series",
  "season",
  "episode",
  "character",
  "episode_character",
];

const CREATE_SQL = `
CREATE TABLE IF NOT EXISTS user (
  id TEXT PRIMARY KEY, name TEXT, email TEXT NOT NULL UNIQUE, emailVerified INTEGER NOT NULL DEFAULT 0,
  image TEXT, password TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY, expiresAt TEXT NOT NULL, token TEXT NOT NULL UNIQUE, createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL, ipAddress TEXT, userAgent TEXT, userId TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS account (
  id TEXT PRIMARY KEY, accountId TEXT NOT NULL, providerId TEXT NOT NULL, issuer TEXT, userId TEXT NOT NULL,
  accessToken TEXT, refreshToken TEXT, idToken TEXT, accessTokenExpiresAt TEXT, refreshTokenExpiresAt TEXT,
  scope TEXT, password TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS verification (
  id TEXT PRIMARY KEY, identifier TEXT NOT NULL, value TEXT NOT NULL, expiresAt TEXT NOT NULL,
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS post (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, createdById TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS project (
  id TEXT PRIMARY KEY, userId TEXT NOT NULL, name TEXT NOT NULL, nodes TEXT NOT NULL DEFAULT '[]',
  edges TEXT NOT NULL DEFAULT '[]', createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS model (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, fileName TEXT NOT NULL, folder TEXT, subfolder TEXT,
  baseModel TEXT, coverUrl TEXT, description TEXT, category TEXT, isAvailable INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'LOCAL', createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS userModelConfig (
  id TEXT PRIMARY KEY, userId TEXT NOT NULL, folder TEXT NOT NULL, label TEXT, type TEXT NOT NULL,
  types TEXT NOT NULL DEFAULT '[]', enabled INTEGER NOT NULL DEFAULT 1, isCustom INTEGER NOT NULL DEFAULT 0, createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS favorite (
  id TEXT PRIMARY KEY, userId TEXT NOT NULL, modelId TEXT NOT NULL, createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS task (
  id TEXT PRIMARY KEY, userId TEXT NOT NULL, type TEXT NOT NULL, prompt TEXT NOT NULL, negativePrompt TEXT,
  params TEXT NOT NULL, workflowName TEXT NOT NULL, workflowSnapshot TEXT, projectId TEXT, shotId TEXT, referenceImages TEXT,
  status TEXT NOT NULL DEFAULT 'QUEUED', parentId TEXT, promptId TEXT, progress INTEGER NOT NULL DEFAULT 0, resultImages TEXT,
  logs TEXT, error TEXT, validationErrors TEXT, createdAt TEXT NOT NULL, finishedAt TEXT, claimedBy TEXT, execPayload TEXT, progressNode TEXT, claimedAt TEXT, rawCli TEXT
);
CREATE TABLE IF NOT EXISTS taskImage (
  id TEXT PRIMARY KEY, taskId TEXT NOT NULL, localPath TEXT NOT NULL, mediaType TEXT NOT NULL DEFAULT 'image',
  seed TEXT, width INTEGER, height INTEGER, isCover INTEGER NOT NULL DEFAULT 0, sortIndex INTEGER NOT NULL DEFAULT 0,
  humanRating INTEGER, isFavorite INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS workflowTemplate (
  id TEXT PRIMARY KEY, userId TEXT NOT NULL, name TEXT NOT NULL, taskType TEXT NOT NULL DEFAULT 'TXT2IMG',
  modes TEXT NOT NULL DEFAULT '[]', defaultMode TEXT, paramMap TEXT, workflowIO TEXT,
  rawJson TEXT, positions TEXT, sourcePath TEXT, sourceChecksum TEXT, sourceMtime INTEGER, createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workflowModelTag (
  id TEXT PRIMARY KEY, userId TEXT NOT NULL, name TEXT NOT NULL, createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workflowModelTag_workflowTemplate (
  workflowModelTag TEXT NOT NULL, workflowTemplate TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS llmConfig (
  id TEXT PRIMARY KEY, provider TEXT NOT NULL DEFAULT 'local', baseUrl TEXT NOT NULL DEFAULT 'http://localhost:11434/v1',
  model TEXT NOT NULL DEFAULT '', extraModels TEXT, apiKey TEXT, temperature REAL NOT NULL DEFAULT 0.7,
  temperatureByTask TEXT, maxTokens INTEGER NOT NULL DEFAULT 2048, updatedAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS skill (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, description TEXT NOT NULL, icon TEXT NOT NULL DEFAULT '✨',
  category TEXT NOT NULL DEFAULT 'style', promptTemplate TEXT NOT NULL, negativePrompt TEXT, defaultParams TEXT,
  recommendedModel TEXT, tags TEXT DEFAULT '[]', coverUrl TEXT, isBuiltIn INTEGER NOT NULL DEFAULT 0,
  sortOrder INTEGER NOT NULL DEFAULT 0, isActive INTEGER NOT NULL DEFAULT 1, createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS filmProject (
  id TEXT PRIMARY KEY, userId TEXT NOT NULL, projectId TEXT, title TEXT NOT NULL, script TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'short_video',
  styleSlug TEXT, size TEXT NOT NULL DEFAULT '1280x720', fps INTEGER NOT NULL DEFAULT 16, framesPerShot INTEGER NOT NULL DEFAULT 49,
  subtitleOn INTEGER NOT NULL DEFAULT 1, bgmName TEXT, status TEXT NOT NULL DEFAULT 'PARSING', progress INTEGER NOT NULL DEFAULT 0,
  finalVideo TEXT, logs TEXT, error TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS filmShot (
  id TEXT PRIMARY KEY, filmId TEXT NOT NULL, shotId TEXT, "order" INTEGER NOT NULL, heading TEXT, prompt TEXT NOT NULL,
  negative TEXT, params TEXT, taskId TEXT, status TEXT NOT NULL DEFAULT 'IDLE', progress INTEGER NOT NULL DEFAULT 0,
  videoPath TEXT, duration REAL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS auditLog (
  id TEXT PRIMARY KEY, event TEXT NOT NULL, userId TEXT, ip TEXT, meta TEXT, createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS remoteModel (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, baseUrl TEXT, apiKey TEXT,
  kind TEXT NOT NULL DEFAULT 'chat', workshopAdapters TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workshopSession (
  id TEXT PRIMARY KEY, userId TEXT, title TEXT NOT NULL DEFAULT '未命名工坊项目', type TEXT NOT NULL DEFAULT 'short_video',
  tone TEXT NOT NULL DEFAULT '', logline TEXT NOT NULL DEFAULT '', idea TEXT NOT NULL DEFAULT '',
  scriptMarkdown TEXT NOT NULL DEFAULT '', scenes TEXT NOT NULL DEFAULT '[]', characters TEXT NOT NULL DEFAULT '[]',
  shots TEXT NOT NULL DEFAULT '[]', stage TEXT NOT NULL DEFAULT 'script', projectId TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workshopDraft (
  id TEXT PRIMARY KEY, userId TEXT, title TEXT NOT NULL DEFAULT '未命名工坊项目', type TEXT NOT NULL DEFAULT 'short_video',
  tone TEXT NOT NULL DEFAULT '', logline TEXT NOT NULL DEFAULT '', scriptMarkdown TEXT NOT NULL DEFAULT '',
  scenes TEXT NOT NULL DEFAULT '[]', characters TEXT NOT NULL DEFAULT '[]', shots TEXT NOT NULL DEFAULT '[]',
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS production (
  id TEXT PRIMARY KEY, userId TEXT NOT NULL, title TEXT NOT NULL DEFAULT '未命名项目', type TEXT NOT NULL DEFAULT 'short_video',
  tone TEXT NOT NULL DEFAULT '', logline TEXT NOT NULL DEFAULT '', scriptMarkdown TEXT NOT NULL DEFAULT '',
  scenes TEXT NOT NULL DEFAULT '[]', characters TEXT NOT NULL DEFAULT '[]', shots TEXT NOT NULL DEFAULT '[]',
  progress TEXT NOT NULL DEFAULT '{}', run TEXT NOT NULL DEFAULT '{}', scriptReview TEXT NOT NULL DEFAULT '{}', createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS series (
  id TEXT PRIMARY KEY, userId TEXT NOT NULL, title TEXT NOT NULL DEFAULT '未命名系列',
  description TEXT NOT NULL DEFAULT '', coverUrl TEXT, styleSlug TEXT,
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS season (
  id TEXT PRIMARY KEY, seriesId TEXT NOT NULL, seasonNumber INTEGER NOT NULL DEFAULT 1,
  title TEXT NOT NULL DEFAULT '', createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS episode (
  id TEXT PRIMARY KEY, seasonId TEXT NOT NULL, projectId TEXT, episodeNumber INTEGER NOT NULL DEFAULT 1,
  title TEXT NOT NULL DEFAULT '', synopsis TEXT NOT NULL DEFAULT '', coverUrl TEXT,
  targetDurationSec INTEGER, status TEXT NOT NULL DEFAULT 'draft',
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS "character" (
  id TEXT PRIMARY KEY, seriesId TEXT NOT NULL, name TEXT NOT NULL, ageGender TEXT NOT NULL DEFAULT '',
  appearance TEXT NOT NULL DEFAULT '', costume TEXT NOT NULL DEFAULT '', personality TEXT NOT NULL DEFAULT '',
  temperament TEXT NOT NULL DEFAULT '', styleTags TEXT NOT NULL DEFAULT '[]', skillSlug TEXT,
  positivePrompt TEXT NOT NULL DEFAULT '', negativePrompt TEXT NOT NULL DEFAULT '',
  params TEXT NOT NULL DEFAULT '{}', portraitUrl TEXT, portraits TEXT NOT NULL DEFAULT '[]',
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS episode_character (
  id TEXT PRIMARY KEY, episodeId TEXT NOT NULL, characterId TEXT NOT NULL, role TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL
);

-- 与 schema.ts 对齐的唯一索引（缺了它们，仓储的 onConflictDoUpdate 会直接抛
-- ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint）：
CREATE UNIQUE INDEX IF NOT EXISTS umc_user_folder_uniq ON userModelConfig (userId, folder);
CREATE UNIQUE INDEX IF NOT EXISTS model_file_folder_uniq ON model (fileName, folder);
CREATE UNIQUE INDEX IF NOT EXISTS skill_slug_uniq ON skill (slug);
CREATE UNIQUE INDEX IF NOT EXISTS wmt_user_name_uniq ON workflowModelTag (userId, name);
CREATE UNIQUE INDEX IF NOT EXISTS remoteModel_name_uniq ON remoteModel (name);
CREATE UNIQUE INDEX IF NOT EXISTS episode_project_uniq ON episode (projectId);
CREATE UNIQUE INDEX IF NOT EXISTS episode_character_uniq ON episode_character (episodeId, characterId);
`;

export interface TestTables {
  users: Row[];
  projects: Row[];
  workflowTemplates: Row[];
  workflowModelTags: Row[];
  tasks: Row[];
  taskImages: Row[];
  llmConfig: Row[];
  posts: Row[];
  models: Row[];
  remoteModels: Row[];
}

export interface TestDb {
  $reset(): void;
  $tables: TestTables;
  /** 本条用例经过宿主的 SQL 顺序（`$reset()` 清空）。判「读有没有落在事务内」用它。 */
  $sqlTrace: string[];
  [key: string]: unknown;
}

let currentSqlite: Database.Database | null = null;
let currentDb: TestDb | null = null;

/** 判定 text 列是否应还原成 Date：schema.ts 的日期列统一 text + ISO 字符串。 */
function isDateColumn(col: string): boolean {
  return col.endsWith("At") && col !== "sourceMtime" && col !== "sortIndex";
}

function parseRow(_table: string, row: Record<string, unknown>): Row {
  const out: Row = { ...row };
  for (const [k, v] of Object.entries(out)) {
    if (v != null && jsonColumns.has(k) && typeof v === "string") {
      try {
        out[k] = JSON.parse(v);
      } catch {
        /* 保留原值 */
      }
    } else if (
      // 日期列（finishedAt 等）经 repository 写回后是 ISO 字符串，旧记忆里是
      // Date 实例：统一还原成 Date，保持 `$tables.X` 断言语义稳定。
      typeof v === "string" &&
      isDateColumn(k) &&
      /^\d{4}-\d{2}-\d{2}T/.test(v)
    ) {
      out[k] = new Date(v);
    }
  }
  return out;
}

function serializeValue(col: string, v: unknown): unknown {
  if (v === null || v === undefined) return v;
  // better-sqlite3 只接受 number/string/bigint/buffer/null 绑定值：boolean 必须
  // 先转 0/1（schema.ts 的 boolean 列是 integer({ mode: "boolean" })，存 0/1）。
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v instanceof Date) return v.toISOString();
  if (jsonColumns.has(col)) return JSON.stringify(v);
  // better-sqlite3（v13 / Node 24 编译）拒绝绑定 boolean，需按 schema 的
  // INTEGER 列语义归一为 1/0（旧版 better-sqlite3 曾隐式强转 true→1）。
  if (typeof v === "boolean") return v ? 1 : 0;
  return v;
}

function allRows(table: string): Row[] {
  if (!currentSqlite) throw new Error("test db 未初始化");
  return /* SAFETY: 类型断言已复核 */ (
    currentSqlite.prepare(`SELECT * FROM "${table}"`).all() as Record<string, unknown>[]
  ).map((r) => parseRow(table, r));
}

function insertInto(table: string, obj: Record<string, unknown>): void {
  if (!currentSqlite) throw new Error("test db 未初始化");
  const entries = Object.entries(obj).filter(([, v]) => v !== undefined);
  const cols = entries.map(([k]) => k);
  const vals = entries.map(([k, v]) => serializeValue(k, v));
  const placeholders = cols.map(() => "?").join(",");
  const sql = `INSERT INTO "${table}" (${cols.join(",")}) VALUES (${placeholders})`;
  currentSqlite.prepare(sql).run(...vals);
}

function getRow(table: string, id: string): Row {
  if (!currentSqlite) throw new Error("test db 未初始化");
  const raw = /* SAFETY: 类型断言已复核 */ currentSqlite
    .prepare(`SELECT * FROM "${table}" WHERE id = ?`)
    .get(id) as Record<string, unknown> | undefined;
  if (!raw) throw new Error(`row not found: ${table} ${id}`);
  return parseRow(table, raw);
}

/**
 * 语句级注入点（ISSUE #2586 用它的唯一理由：验「中途失败 ⇒ 已提交的写不留痕」）。
 *
 * 为什么要有：`sqlite-proxy` 的宿主回调是本仓**唯一**一处「所有 SQL 都经过、且能改行为」
 * 的地方，而事务回滚这件事在没有这个口子时无法测——真库里造一条「第二条必失败」的输入
 * 要么依赖巧合（约束冲突面已被仓储挡掉），要么就得往生产代码里塞测试钩子。
 *
 * 生命周期：钩子挂在模块上，由 `$reset()`（每个用例的 `beforeEach` 都调它）摘干净，
 * 所以它的作用域就是**一条用例**。忘了摘也不会传染下一条。
 */
type StatementHook = {
  match: (sql: string, method: string) => boolean;
  makeError: () => Error;
  left: number;
  hits: number;
};
const statementHooks: StatementHook[] = [];
/** 本条用例经过宿主的 SQL 顺序（`$reset()` 清空）——「读有没有落在事务内」只有靠它判。 */
const sqlTrace: string[] = [];

/**
 * 让接下来匹配这条谓词的语句抛错（默认只拦一次，之后原样放行）。
 *
 * @param makeError 造错误用的工厂。**默认给一个非锁族错误**：那样 #2586 的有界重试
 *        会「认不出原因就原样抛」，测到的是回滚而不是重试。要测撞锁那条路，
 *        自己造 `cause.code = "SQLITE_BUSY"` 的错误（`sqlite-error.ts` 沿 cause 链取码）。
 * @returns `hits()` 读到这条钩子实际拦下几次——「第二条失败 ⇒ 只试了一次」这类断言靠它。
 */
export function armStatementFailure(
  match: (sql: string, method: string) => boolean,
  makeError: () => Error = () => new Error("测试注入：这条语句被用例挡住"),
  times = 1,
): { hits: () => number } {
  const hook: StatementHook = { match, makeError, left: times, hits: 0 };
  statementHooks.push(hook);
  return { hits: () => hook.hits };
}

/**
 * drizzle 的 `sqlite-proxy` 宿主：把 better-sqlite3 的同步语句包成代理层要的异步形状。
 *
 * `method` 的四种返回形状是照 `sqlite-proxy/session.cjs` 的实现取的，不是照它的类型取的
 * （`AsyncRemoteCallback` 声明 `rows: any[]`，而 `mapGetResult` 把 `clientResult.rows`
 * **整个当一行用** —— `const row = rows`）：
 *   · `get` ⇒ `{ rows: 单行 | undefined }`（不是数组；写成数组会让 `.get()` 恒拿到 undefined）
 *   · `all` / `values` ⇒ `{ rows: 行数组 }`
 *   · `run` ⇒ `{ rows: [] }`：`RemotePreparedQuery` 没覆写 `mapRunResult`（基类是原样透传），
 *     所以这里返回什么就是调用方拿到什么。全仓不读 `.changes` / `lastInsertRowid`
 *     （`src/server/workshop/repository.ts:237` 那句注释记的正是这件事），
 *     于是这里不透出 better-sqlite3 的 RunResult，免得测试宿主与生产再多一处形状差别。
 *
 * ⚠️ **行必须是 `raw()` 的位置数组，不能是列名对象**：`mapResultRow` 取值那一行是
 * `const rawValue = row[columnIndex]`（`utils.cjs:62`）——按**列序**取。返回对象的话
 * 每一列都读成 `undefined`，表现不是「查不到」而是
 * `SyntaxError: "undefined" is not valid JSON`（JSON 列的 decoder 先炸），
 * 看着像数据坏了、实际是宿主形状错了。`drizzle-orm/better-sqlite3` 那份会话走的正是
 * `stmt.raw()`，所以两边本来就要求同一个形状。
 *
 * ⚠️ 而 `raw()` **只能对会返数据的语句调**（better-sqlite3 的原话是
 * `The raw() method is only for statements that return data`）：`run` 那一支
 * （`delete` / 不带 `returning` 的 `insert` / `update`，以及事务的 `begin`/`commit`/`rollback`）
 * 若也走 `stmt.raw()` 会当场抛，表现是一批删除与写入用例红、且红在宿主里而不是被测代码上。
 */
function sqliteProxyHost(client: Database.Database) {
  return (
    sql: string,
    params: unknown[],
    method: "run" | "all" | "values" | "get",
  ): Promise<{ rows: unknown }> => {
    sqlTrace.push(sql);
    for (const hook of statementHooks) {
      if (hook.left > 0 && hook.match(sql, method)) {
        hook.left -= 1;
        hook.hits += 1;
        throw hook.makeError();
      }
    }
    const stmt = client.prepare(sql);
    const bound = params ?? [];
    switch (method) {
      case "get":
        return Promise.resolve({ rows: stmt.raw().get(...bound) });
      case "run":
        stmt.run(...bound);
        return Promise.resolve({ rows: [] });
      case "values":
      case "all":
      default:
        return Promise.resolve({ rows: stmt.raw().all(...bound) });
    }
  };
}

export function createTestDb(): TestDb {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = OFF"); // 内存库独立插入，放宽外键
  sqlite.exec(CREATE_SQL);
  currentSqlite = sqlite;
  /* 这一处双断言是**库的类型在说谎**，不是我们的宿主在将就：
   * `AsyncRemoteCallback` 声明返回 `Promise<{ rows: any[] }>`，而 `mapGetResult`
   * 把 `clientResult.rows` 整个当**一行**用（`const row = rows`）——`get` 那一支
   * 返回的是单行对象。按声明写会把 `.get()` 恒读成 undefined（宿主形状错、报错却
   * 指不到宿主，正是 #2586 这一族）。断言的目标类型取 `RemoteCallback`，
   * 让「哪里不对」只出现在这一行。 */
  const db = drizzle(
    /* SAFETY: 类型断言已复核 */ sqliteProxyHost(sqlite) as unknown as RemoteCallback,
    { schema },
  );

  const workflowTemplatesWithTags = (): Row[] => {
    const rows = allRows("workflowTemplate");
    const tagRows = /* SAFETY: 类型断言已复核 */ sqlite
      .prepare(
        `SELECT wm.workflowModelTag AS tagId, wm.workflowTemplate AS wtId, t.name AS name, t.userId AS userId
         FROM workflowModelTag_workflowTemplate wm
         JOIN workflowModelTag t ON wm.workflowModelTag = t.id`,
      )
      .all() as Array<{
      tagId: string;
      wtId: string;
      name: string;
      userId: string;
    }>;
    const byWt = new Map<string, Array<{ id: string; name: string; userId: string }>>();
    for (const r of tagRows) {
      const arr = byWt.get(r.wtId) ?? [];
      arr.push({ id: r.tagId, name: r.name, userId: r.userId });
      byWt.set(r.wtId, arr);
    }
    return rows.map((row) => ({
      ...row,
      modelTags: byWt.get(/* SAFETY: 类型断言已复核 */ row.id as string) ?? [],
    }));
  };

  const tables: TestTables = {
    get users() {
      return allRows("user");
    },
    get projects() {
      return allRows("project");
    },
    get workflowTemplates() {
      return workflowTemplatesWithTags();
    },
    get workflowModelTags() {
      return allRows("workflowModelTag");
    },
    get tasks() {
      return allRows("task");
    },
    get taskImages() {
      return allRows("taskImage");
    },
    get llmConfig() {
      return allRows("llmConfig");
    },
    get posts() {
      return allRows("post");
    },
    get models() {
      return allRows("model");
    },
    get remoteModels() {
      return allRows("remoteModel");
    },
  };

  const reset = (): void => {
    for (const t of TABLES) sqlite.prepare(`DELETE FROM "${t}"`).run();
    /* 钩子与 trace 就地清空（不是重新赋值）：`$sqlTrace` 是把这份数组**引用**挂在实例上的，
     * 换掉引用会让先前取到的读取者看到一份永久的旧账。 */
    statementHooks.length = 0;
    sqlTrace.length = 0;
  };

  // 把 $reset / $tables 挂到 drizzle 实例上，供测试与 vi.mock 共用同一对象
  const api = /* SAFETY: 类型断言已复核 */ Object.assign(db, {
    $reset: reset,
    $tables: tables,
    $sqlTrace: sqlTrace,
  }) as unknown as TestDb;

  currentDb = api;
  return api;
}

/** 取当前测试文件已创建的内存 db（须先触发 ~/server/db 的 mock 工厂）。 */
export function getTestDb(): TestDb {
  if (!currentDb) {
    throw new Error('test db 未初始化：请先 vi.mock("~/server/db") 并导入被测 router');
  }
  return currentDb;
}

// ────────────────────────────── seeding ──────────────────────────────

let seedSeq = 0;

/**
 * seed 期用的密钥加密：与 `lib/core/repository-user.ts` 落库前调用的是**同一个**
 * `encryptLlmKey`（不是再写一份），否则 helper 与生产写入会各自漂移 —— 而
 * 「密文形态」恰恰是 `LlmConfigRepository` / `RemoteModelRepository` 的关键行为。
 */
function encryptSeedLlmKey(plain: string | null | undefined): string | null {
  if (plain == null || plain === "") return null;
  return encryptLlmKey(plain);
}

export function seedUser(
  _tdb: TestDb,
  input: { id: string; email: string; name?: string | null },
): Row {
  const now = new Date().toISOString();
  insertInto("user", {
    id: input.id,
    email: input.email,
    name: input.name ?? null,
    createdAt: now,
    updatedAt: now,
  });
  return getRow("user", input.id);
}

export interface SeedWorkflowTemplateInput {
  id?: string;
  userId: string;
  name?: string;
  taskType?: string;
  rawJson?: unknown;
  paramMap?: unknown;
  positions?: unknown;
  workflowIO?: unknown;
  modes?: string | null;
  defaultMode?: string | null;
  sourcePath?: string | null;
  sourceChecksum?: string | null;
  sourceMtime?: number | null;
  modelTags?: Array<{ id: string; name: string; userId: string }>;
  createdAt?: Date;
}

export function seedWorkflowTemplate(_tdb: TestDb, input: SeedWorkflowTemplateInput): Row {
  const id = input.id ?? `seed-wt-${++seedSeq}`;
  const now = new Date().toISOString();
  insertInto("workflowTemplate", {
    id,
    userId: input.userId,
    name: input.name ?? "seeded workflow",
    taskType: input.taskType ?? "T2I",
    /* 默认给一份最小的 RAW 原件 —— 库里的每一行通常都有可执行内容；
     * 传 `rawJson: null` 可显式造「没有可执行内容」的行。 */
    rawJson:
      input.rawJson === undefined ? { nodes: [{ id: "1", type: "KSampler" }] } : input.rawJson,
    paramMap: input.paramMap ?? null,
    positions: input.positions ?? null,
    workflowIO: input.workflowIO ?? null,
    modes: input.modes ?? "[]",
    defaultMode: input.defaultMode ?? null,
    sourcePath: input.sourcePath ?? null,
    sourceChecksum: input.sourceChecksum ?? null,
    sourceMtime: input.sourceMtime ?? null,
    // schema.ts 的 workflowTemplate 没有 updatedAt 列（此前 seed 多写导致
    // insertInto 报 no column named updatedAt，14 个用例全红）
    createdAt: input.createdAt ?? new Date(),
  });
  if (input.modelTags?.length) {
    for (const tag of input.modelTags) {
      insertInto("workflowModelTag", {
        id: tag.id,
        userId: tag.userId,
        name: tag.name,
        createdAt: now,
      });
      insertInto("workflowModelTag_workflowTemplate", {
        workflowModelTag: tag.id,
        workflowTemplate: id,
      });
    }
  }
  return getRow("workflowTemplate", id);
}

export interface SeedTaskInput {
  id?: string;
  userId: string;
  type?: string;
  status?: string;
  prompt?: string;
  negativePrompt?: string | null;
  params?: unknown;
  workflowName?: string;
  projectId?: string | null;
  images?: Row[];
  workflowSnapshot?: unknown;
  referenceImages?: unknown;
  /** 来源任务（重绘 / 放大的追溯用例用）。 */
  parentId?: string | null;
  /** 提交时刻的 RAW 执行载荷（task.retry 用例要区分「有载荷可原样重跑」与
   *  「execPayload 为空的历史遗留行」两态）。 */
  execPayload?: unknown;
  progress?: number;
  error?: string | null;
  createdAt?: Date;
}

export function seedTask(_tdb: TestDb, input: SeedTaskInput): Row {
  const id = input.id ?? `seed-task-${++seedSeq}`;
  insertInto("task", {
    id,
    userId: input.userId,
    type: input.type ?? "TXT2IMG",
    status: input.status ?? "SUCCEEDED",
    prompt: input.prompt ?? "",
    negativePrompt: input.negativePrompt ?? null,
    params: input.params ?? {},
    workflowName: input.workflowName ?? "seeded-workflow",
    projectId: input.projectId ?? null,
    workflowSnapshot: input.workflowSnapshot ?? null,
    referenceImages: input.referenceImages ?? null,
    parentId: input.parentId ?? null,
    execPayload: input.execPayload ?? null,
    progress: input.progress ?? 0,
    error: input.error ?? null,
    createdAt: input.createdAt ?? new Date(),
  });
  // task 表没有 images 列（Drizzle 用 taskImage 子表 + 关系装载）：
  // seed 的 images 逐行写入 taskImage，首图 isCover=1（与 task.list 封面投影一致）
  (input.images ?? []).forEach((img, idx) => {
    insertInto("taskImage", {
      sortIndex: idx,
      isCover: idx === 0 ? 1 : 0,
      ...img,
      id: img.id ?? `${id}-img-${idx}`,
      taskId: id,
    });
  });
  return getRow("task", id);
}

/**
 * 种一条项目。两个易踩的坑在这里收掉：
 *  · `nodes` / `edges` 在 schema 里是 `NOT NULL DEFAULT '[]'` —— 缺省给 `null`
 *    会被 `insertInto` 原样写进去（`undefined` 才跳过），于是「按默认值种项目」
 *    直接撞约束；
 *  · 排序判据（`project.list` 按 `updatedAt` 倒序）用的是 `updatedAt`，
 *    所以调用方传的日期必须落到那一列，否则传多少日期都是同一时刻、断言变成掷硬币。
 */
export function seedProject(
  _tdb: TestDb,
  input: {
    id?: string;
    userId: string;
    name: string;
    nodes?: unknown;
    edges?: unknown;
    updatedAt?: Date;
  },
): Row {
  const id = input.id ?? `seed-proj-${++seedSeq}`;
  const at = input.updatedAt ?? new Date();
  insertInto("project", {
    id,
    userId: input.userId,
    name: input.name,
    nodes: input.nodes ?? [],
    edges: input.edges ?? [],
    createdAt: at,
    updatedAt: at,
  });
  return getRow("project", id);
}

/**
 * 种一条成片。给归属类用例用（`films/<id>.mp4` 的落点名字里就是成片行 id），
 * 其余列一律吃 schema 默认值 —— 这些用例只关心 `userId` 那一格。
 * 与 `filmRepository.create` 的取舍：那条会生成 cuid，路径断言就得先读回 id；
 * 这里允许调用方钉死 id，才写得清「猜得到别人的成片 id」这个攻击形状。
 */
export function seedFilm(
  _tdb: TestDb,
  input: {
    id?: string;
    userId: string;
    projectId?: string | null;
    title?: string;
    script?: string;
    finalVideo?: string | null;
  },
): Row {
  const id = input.id ?? `seed-film-${++seedSeq}`;
  const at = new Date();
  insertInto("filmProject", {
    id,
    userId: input.userId,
    projectId: input.projectId ?? null,
    title: input.title ?? "seeded-film",
    script: input.script ?? "",
    finalVideo: input.finalVideo ?? null,
    createdAt: at,
    updatedAt: at,
  });
  return getRow("filmProject", id);
}

export interface SeedRemoteModelInput {
  id?: string;
  name: string;
  baseUrl?: string | null;
  /** 明文密钥；helper 内部按 schema 约定加密后再落库（与运行时写入同形）。 */
  apiKey?: string | null;
  kind?: string;
  workshopAdapters?: unknown;
}

/**
 * seed 一行远端模型。`apiKey` 收**明文**、由 helper 调 `encryptLlmKey` 落库
 * —— 直接 insert 明文的测试会绕开 `LlmConfigRepository.replaceAll` 的加密语义，
 * 让「读取时解密」这条真实行为在测试里消失（假通过）。
 */
export function seedRemoteModel(_tdb: TestDb, input: SeedRemoteModelInput): Row {
  const id = input.id ?? `seed-rm-${++seedSeq}`;
  const now = new Date().toISOString();
  insertInto("remoteModel", {
    id,
    name: input.name,
    baseUrl: input.baseUrl ?? null,
    apiKey: encryptSeedLlmKey(input.apiKey),
    kind: input.kind ?? "chat",
    workshopAdapters:
      input.workshopAdapters === undefined ? null : JSON.stringify(input.workshopAdapters),
    createdAt: now,
    updatedAt: now,
  });
  return getRow("remoteModel", id);
}
