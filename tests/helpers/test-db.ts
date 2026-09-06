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
 * @module tests/helpers/test-db
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "~/server/db/schema";

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
  "graph",
  "paramMap",
  "workflowIO",
  "rawJson",
  "positions",
  "defaultParams",
  "datasetImages",
  "temperatureByTask",
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
  "loraTrainingJob",
  "filmProject",
  "filmShot",
  "auditLog",
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
  params TEXT NOT NULL, workflowName TEXT NOT NULL, workflowSnapshot TEXT, projectId TEXT, referenceImages TEXT,
  status TEXT NOT NULL DEFAULT 'QUEUED', promptId TEXT, progress INTEGER NOT NULL DEFAULT 0, resultImages TEXT,
  logs TEXT, error TEXT, validationErrors TEXT, createdAt TEXT NOT NULL, finishedAt TEXT
);
CREATE TABLE IF NOT EXISTS taskImage (
  id TEXT PRIMARY KEY, taskId TEXT NOT NULL, localPath TEXT NOT NULL, mediaType TEXT NOT NULL DEFAULT 'image',
  seed TEXT, width INTEGER, height INTEGER, isCover INTEGER NOT NULL DEFAULT 0, sortIndex INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS workflowTemplate (
  id TEXT PRIMARY KEY, userId TEXT NOT NULL, name TEXT NOT NULL, taskType TEXT NOT NULL DEFAULT 'TXT2IMG',
  modes TEXT NOT NULL DEFAULT '[]', defaultMode TEXT, graph TEXT NOT NULL, paramMap TEXT, workflowIO TEXT,
  rawJson TEXT, positions TEXT, sourcePath TEXT, sourceChecksum TEXT, sourceMtime INTEGER, apiSource TEXT, createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workflowModelTag (
  id TEXT PRIMARY KEY, userId TEXT NOT NULL, name TEXT NOT NULL, createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workflowModelTag_workflowTemplate (
  workflowModelTag TEXT NOT NULL, workflowTemplate TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS llmConfig (
  id TEXT PRIMARY KEY, provider TEXT NOT NULL DEFAULT 'local', baseUrl TEXT NOT NULL DEFAULT 'http://localhost:11434/v1',
  model TEXT NOT NULL DEFAULT '', apiKey TEXT, temperature REAL NOT NULL DEFAULT 0.7,
  temperatureByTask TEXT, maxTokens INTEGER NOT NULL DEFAULT 2048, updatedAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS skill (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, description TEXT NOT NULL, icon TEXT NOT NULL DEFAULT '✨',
  category TEXT NOT NULL DEFAULT 'style', promptTemplate TEXT NOT NULL, negativePrompt TEXT, defaultParams TEXT,
  recommendedModel TEXT, tags TEXT DEFAULT '[]', coverUrl TEXT, isBuiltIn INTEGER NOT NULL DEFAULT 0,
  sortOrder INTEGER NOT NULL DEFAULT 0, isActive INTEGER NOT NULL DEFAULT 1, createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS loraTrainingJob (
  id TEXT PRIMARY KEY, userId TEXT NOT NULL, name TEXT NOT NULL, baseModel TEXT NOT NULL, triggerWord TEXT NOT NULL,
  classWord TEXT, datasetImages TEXT NOT NULL, resolution INTEGER NOT NULL DEFAULT 512, steps INTEGER NOT NULL DEFAULT 1500,
  batchSize INTEGER NOT NULL DEFAULT 4, learningRate REAL NOT NULL DEFAULT 0.0001, rankDim INTEGER NOT NULL DEFAULT 32,
  networkAlpha INTEGER NOT NULL DEFAULT 16, optimizer TEXT NOT NULL DEFAULT 'AdamW8bit', scheduler TEXT NOT NULL DEFAULT 'cosine',
  seed INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'QUEUED', progress INTEGER NOT NULL DEFAULT 0,
  outputName TEXT, logs TEXT, error TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS filmProject (
  id TEXT PRIMARY KEY, userId TEXT NOT NULL, title TEXT NOT NULL, script TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'short_video',
  styleSlug TEXT, size TEXT NOT NULL DEFAULT '1280x720', fps INTEGER NOT NULL DEFAULT 16, framesPerShot INTEGER NOT NULL DEFAULT 49,
  subtitleOn INTEGER NOT NULL DEFAULT 1, bgmName TEXT, status TEXT NOT NULL DEFAULT 'PARSING', progress INTEGER NOT NULL DEFAULT 0,
  finalVideo TEXT, logs TEXT, error TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS filmShot (
  id TEXT PRIMARY KEY, filmId TEXT NOT NULL, "order" INTEGER NOT NULL, heading TEXT, prompt TEXT NOT NULL,
  negative TEXT, params TEXT, taskId TEXT, status TEXT NOT NULL DEFAULT 'IDLE', progress INTEGER NOT NULL DEFAULT 0,
  videoPath TEXT, duration REAL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS auditLog (
  id TEXT PRIMARY KEY, event TEXT NOT NULL, userId TEXT, ip TEXT, meta TEXT, createdAt TEXT NOT NULL
);
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
}

export interface TestDb {
  $reset(): void;
  $tables: TestTables;
  [key: string]: unknown;
}

let currentSqlite: Database.Database | null = null;
let currentDb: TestDb | null = null;

/** 判定 text 列是否应还原成 Date：schema.ts 的日期列统一 text + ISO 字符串。 */
function isDateColumn(col: string): boolean {
  return (
    col.endsWith("At") &&
    col !== "sourceMtime" &&
    col !== "sortIndex"
  );
}

function parseRow(table: string, row: Record<string, unknown>): Row {
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
  return (
    currentSqlite.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[]
  ).map((r) => parseRow(table, r));
}

function insertInto(table: string, obj: Record<string, unknown>): void {
  if (!currentSqlite) throw new Error("test db 未初始化");
  const entries = Object.entries(obj).filter(([, v]) => v !== undefined);
  const cols = entries.map(([k]) => k);
  const vals = entries.map(([k, v]) => serializeValue(k, v));
  const placeholders = cols.map(() => "?").join(",");
  const sql = `INSERT INTO ${table} (${cols.join(",")}) VALUES (${placeholders})`;
  currentSqlite.prepare(sql).run(...vals);
}

function getRow(table: string, id: string): Row {
  if (!currentSqlite) throw new Error("test db 未初始化");
  const raw = currentSqlite
    .prepare(`SELECT * FROM ${table} WHERE id = ?`)
    .get(id) as Record<string, unknown> | undefined;
  if (!raw) throw new Error(`row not found: ${table} ${id}`);
  return parseRow(table, raw);
}

export function createTestDb(): TestDb {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = OFF"); // 内存库独立插入，放宽外键
  sqlite.exec(CREATE_SQL);
  currentSqlite = sqlite;
  const db = drizzle(sqlite, { schema });

  const workflowTemplatesWithTags = (): Row[] => {
    const rows = allRows("workflowTemplate");
    const tagRows = sqlite
      .prepare(
        `SELECT wm.workflowModelTag AS tagId, wm.workflowTemplate AS wtId, t.name AS name, t.userId AS userId
         FROM workflowModelTag_workflowTemplate wm
         JOIN workflowModelTag t ON wm.workflowModelTag = t.id`
      )
      .all() as Array<{ tagId: string; wtId: string; name: string; userId: string }>;
    const byWt = new Map<string, Array<{ id: string; name: string; userId: string }>>();
    for (const r of tagRows) {
      const arr = byWt.get(r.wtId) ?? [];
      arr.push({ id: r.tagId, name: r.name, userId: r.userId });
      byWt.set(r.wtId, arr);
    }
    return rows.map((row) => ({ ...row, modelTags: byWt.get(row.id as string) ?? [] }));
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
  };

  const reset = (): void => {
    for (const t of TABLES) sqlite.prepare(`DELETE FROM ${t}`).run();
  };

  // 把 $reset / $tables 挂到 drizzle 实例上，供测试与 vi.mock 共用同一对象
  const api = Object.assign(db, {
    $reset: reset,
    $tables: tables,
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

export function seedUser(
  _tdb: TestDb,
  input: { id: string; email: string; name?: string | null }
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
  graph?: unknown;
  rawJson?: unknown;
  paramMap?: unknown;
  positions?: unknown;
  workflowIO?: unknown;
  apiSource?: string | null;
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
    graph: input.graph ?? {},
    rawJson: input.rawJson ?? null,
    paramMap: input.paramMap ?? null,
    positions: input.positions ?? null,
    workflowIO: input.workflowIO ?? null,
    apiSource: input.apiSource ?? null,
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

export function seedProject(
  _tdb: TestDb,
  input: { id?: string; userId: string; name: string; nodes?: unknown; edges?: unknown; updatedAt?: Date }
): Row {
  const id = input.id ?? `seed-proj-${++seedSeq}`;
  const now = new Date().toISOString();
  insertInto("project", {
    id,
    userId: input.userId,
    name: input.name,
    nodes: input.nodes ?? null,
    edges: input.edges ?? null,
    createdAt: input.updatedAt ?? new Date(),
    updatedAt: now,
  });
  return getRow("project", id);
}
