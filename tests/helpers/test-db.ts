/**
 * tests/helpers/test-db.ts — 内存版 Prisma 客户端替身（测试基建，不触碰 src 源码）。
 * ===========================================================================
 *
 * mock 策略：
 * - 测试文件通过 `vi.mock("~/server/db", ...)` 返回 `createTestDb()` 的单例。
 *   `@/lib/db`（兼容 shim，re-export 自 `~/server/db`）随之被替换，因此
 *   Repository 层与 tRPC ctx.db 共享同一套内存表，src 源码零改动。
 * - 只实现项目实际用到的 Prisma 语义子集：
 *   where（标量等值 / `{ in }` / `{ some }` 关系 / 复合唯一键 userId_name）、
 *   orderBy、take/skip、select 投影（含关系 select）、include（images 排序/截取）、
 *   create / update（undefined 字段跳过，null 覆盖，modelTags `{ set }` 关系替换）、
 *   upsert / delete / deleteMany。
 * - 测试体内用 `getTestDb()` 取同一实例做 seeding 与落库断言。
 *
 * @module tests/helpers/test-db
 */
import { vi, type Mock } from "vitest";

export type Row = Record<string, unknown>;

export interface FindArgs {
  where?: Row;
  orderBy?: Row | Row[];
  take?: number;
  skip?: number;
  select?: Row;
  include?: Row;
}

export interface FakeModel {
  findUnique: Mock;
  findFirst: Mock;
  findMany: Mock;
  create: Mock;
  update: Mock;
  delete: Mock;
  deleteMany: Mock;
  upsert: Mock;
}

export interface TestDbTables {
  users: Row[];
  projects: Row[];
  workflowTemplates: Row[];
  workflowModelTags: Row[];
  tasks: Row[];
}

export interface TestDb {
  $tables: TestDbTables;
  $reset(): void;
  user: FakeModel;
  project: FakeModel;
  workflowTemplate: FakeModel;
  workflowModelTag: FakeModel;
  task: FakeModel;
  llmConfig: FakeModel;
}

// ────────────────────────── where / orderBy / 投影 ──────────────────────────

function isPlainObject(v: unknown): v is Row {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function clone<T>(v: T): T {
  return structuredClone(v);
}

/** 只保留非 undefined 字段（对齐 Prisma「undefined = 不写入」语义）。 */
function defined(data: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(data)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

function matchWhere(row: Row, where?: Row): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, cond]) => {
    if (cond === undefined) return true;
    if (key === "AND" && Array.isArray(cond)) {
      return (cond as Row[]).every((w) => matchWhere(row, w));
    }
    if (key === "OR" && Array.isArray(cond)) {
      return (cond as Row[]).some((w) => matchWhere(row, w));
    }
    if (isPlainObject(cond)) {
      if ("in" in cond && Array.isArray(cond.in)) {
        return (cond.in as unknown[]).includes(row[key]);
      }
      if ("some" in cond) {
        const rel = Array.isArray(row[key]) ? (row[key] as Row[]) : [];
        return rel.some((item) => matchWhere(item, cond.some as Row));
      }
      // 复合唯一键（userId_name: { userId, name }）与嵌套等值对象
      return Object.entries(cond).every(([k, c]) => row[k] === c);
    }
    return row[key] === cond;
  });
}

function cmp(a: unknown, b: unknown): number {
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === "number" && typeof b === "number") return a - b;
  // 内存排序键:对象值仅作展示排序,不参与语义(两行同豁免)
  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  const sa = a == null ? "" : typeof a === "object" ? JSON.stringify(a) : String(a);
  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  const sb = b == null ? "" : typeof b === "object" ? JSON.stringify(b) : String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

function applyOrderBy<T extends Row>(rows: T[], orderBy?: Row | Row[]): T[] {
  if (!orderBy) return rows;
  const specs = Array.isArray(orderBy) ? [...orderBy] : [orderBy];
  const out = [...rows];
  // 多键排序：从最后一个键开始排（Array#sort 稳定，前者覆盖后者）。
  for (const spec of specs.reverse()) {
    const entry = Object.entries(spec)[0];
    if (!entry) continue;
    const [key, dir] = entry;
    const desc = dir === "desc";
    out.sort((a, b) => (desc ? -cmp(a[key], b[key]) : cmp(a[key], b[key])));
  }
  return out;
}

/** select 投影：true → 原字段；{ select } → 关系数组逐项投影。 */
function project(row: Row, select: Row): Row {
  const out: Row = {};
  for (const [key, spec] of Object.entries(select)) {
    if (spec === true) {
      out[key] = clone(row[key]);
    } else if (isPlainObject(spec) && isPlainObject(spec.select)) {
      const rel = Array.isArray(row[key]) ? (row[key] as Row[]) : [];
      out[key] = rel.map((item) => project(item, spec.select as Row));
    }
    // 其余（_count 等）本套件未涉及，保持缺省。
  }
  return out;
}

/** include 展开：对关系数组字段按 orderBy/take 处理（images 场景）。 */
function applyInclude(row: Row, include: Row): Row {
  const out = clone(row);
  for (const [key, spec] of Object.entries(include)) {
    if (!isPlainObject(spec)) continue;
    let rel = Array.isArray(row[key]) ? (row[key] as Row[]) : [];
    if (spec.orderBy) rel = applyOrderBy(rel, spec.orderBy as Row | Row[]);
    if (typeof spec.take === "number") rel = rel.slice(0, spec.take);
    out[key] = rel;
  }
  return out;
}

function shape(row: Row, args?: FindArgs): Row {
  let out = clone(row);
  if (args?.include) out = applyInclude(out, args.include);
  if (args?.select) out = project(out, args.select);
  return out;
}

// ────────────────────────────── 工厂 ──────────────────────────────

let currentDb: TestDb | null = null;

/** 供 vi.mock("~/server/db") 工厂调用：创建并登记当前文件的内存 db。 */
export function createTestDb(): TestDb {
  const users: Row[] = [];
  const projects: Row[] = [];
  const workflowTemplates: Row[] = [];
  const workflowModelTags: Row[] = [];
  const tasks: Row[] = [];
  let seq = 0;
  const nextId = (prefix: string) => `${prefix}_${++seq}`;

  const resolveTags = (ids: string[]): Row[] =>
    ids
      .map((id) => workflowModelTags.find((t) => t.id === id))
      .filter((t): t is Row => !!t)
      .map(clone);

  const makeModel = (
    table: Row[],
    prefix: string,
    defaults?: (row: Row) => void
  ): FakeModel => {
    const find = (where?: Row) => table.find((r) => matchWhere(r, where));
    return {
      findUnique: vi.fn(async ({ where }: { where: Row }) => {
        const row = find(where);
        return row ? clone(row) : null;
      }),
      findFirst: vi.fn(async (args: FindArgs = {}) => {
        const row = find(args.where);
        return row ? clone(row) : null;
      }),
      findMany: vi.fn(async (args: FindArgs = {}) => {
        let rows = table.filter((r) => matchWhere(r, args.where));
        rows = applyOrderBy(rows, args.orderBy);
        if (args.skip !== undefined) rows = rows.slice(args.skip);
        if (args.take !== undefined) rows = rows.slice(0, args.take);
        return rows.map((r) => shape(r, args));
      }),
      create: vi.fn(async ({ data }: { data: Row }) => {
        const row: Row = {
          id: typeof data.id === "string" ? data.id : nextId(prefix),
          createdAt: new Date(),
          updatedAt: new Date(),
          ...defined(data),
        };
        defaults?.(row);
        table.push(row);
        return clone(row);
      }),
      update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const row = find(where);
        if (!row) {
          throw new Error(`Record to update not found: ${JSON.stringify(where)}`);
        }
        const patch = defined(data);
        const mt = patch.modelTags;
        if (isPlainObject(mt) && Array.isArray(mt.set)) {
          patch.modelTags = resolveTags((mt.set as Row[]).map((t) => t.id as string));
        }
        Object.assign(row, patch);
        return clone(row);
      }),
      delete: vi.fn(async ({ where }: { where: Row }) => {
        const idx = table.findIndex((r) => matchWhere(r, where));
        if (idx < 0) throw new Error("Record to delete does not exist");
        const removed = table.splice(idx, 1)[0];
        return clone(removed!);
      }),
      deleteMany: vi.fn(async ({ where }: { where?: Row } = {}) => {
        let count = 0;
        for (let i = table.length - 1; i >= 0; i--) {
          const r = table[i];
          if (r && matchWhere(r, where)) {
            table.splice(i, 1);
            count++;
          }
        }
        return { count };
      }),
      upsert: vi.fn(
        async ({
          where,
          create,
          update,
          select,
        }: {
          where: Row;
          create: Row;
          update: Row;
          select?: Row;
        }) => {
          const existing = find(where);
          if (existing) {
            Object.assign(existing, defined(update));
            return shape(existing, { select });
          }
          const row: Row = {
            id: typeof create.id === "string" ? create.id : nextId(prefix),
            createdAt: new Date(),
            updatedAt: new Date(),
            ...defined(create),
          };
          defaults?.(row);
          table.push(row);
          return shape(row, { select });
        }
      ),
    };
  };

  const taskDefaults = (row: Row): void => {
    if (!Array.isArray(row.images)) row.images = [];
    if (typeof row.progress !== "number") row.progress = 0;
  };

  const workflowTemplate = makeModel(workflowTemplates, "wt");
  const workflowModelTag = makeModel(workflowModelTags, "tag");

  // workflowModelTag.upsert 的 select 带 _count: { select: { workflows: true } }
  const baseTagUpsert = workflowModelTag.upsert;
  workflowModelTag.upsert = vi.fn(
    async (args: { where: Row; create: Row; update: Row; select?: Row }) => {
      const row = (await baseTagUpsert(args)) as Row;
      const usedBy = workflowTemplates.filter((w) =>
        (Array.isArray(w.modelTags) ? (w.modelTags as Row[]) : []).some(
          (t) => t.id === row.id
        )
      ).length;
      return { id: row.id, name: row.name, _count: { workflows: usedBy } };
    }
  );

  currentDb = {
    $tables: { users, projects, workflowTemplates, workflowModelTags, tasks },
    $reset(): void {
      users.length = 0;
      projects.length = 0;
      workflowTemplates.length = 0;
      workflowModelTags.length = 0;
      tasks.length = 0;
      seq = 0;
    },
    user: makeModel(users, "usr"),
    project: makeModel(projects, "proj"),
    workflowTemplate,
    workflowModelTag,
    task: makeModel(tasks, "task", taskDefaults),
    llmConfig: makeModel([], "llm"),
  };
  return currentDb;
}

/** 取当前测试文件已创建的内存 db（须先触发 ~/server/db 的 mock 工厂）。 */
export function getTestDb(): TestDb {
  if (!currentDb) {
    throw new Error(
      'test db 未初始化：请先 vi.mock("~/server/db") 并导入被测 router'
    );
  }
  return currentDb;
}

// ────────────────────────────── seeding ──────────────────────────────

let seedSeq = 0;

export function seedUser(
  tdb: TestDb,
  input: { id: string; email: string; name?: string | null }
): Row {
  const row: Row = {
    id: input.id,
    email: input.email,
    name: input.name ?? null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  tdb.$tables.users.push(row);
  return row;
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
  modelTags?: Row[];
  createdAt?: Date;
}

export function seedWorkflowTemplate(
  tdb: TestDb,
  input: SeedWorkflowTemplateInput
): Row {
  const row: Row = {
    id: input.id ?? `seed-wt-${++seedSeq}`,
    userId: input.userId,
    name: input.name ?? "seeded workflow",
    taskType: input.taskType ?? "T2I",
    graph: input.graph ?? null,
    rawJson: input.rawJson ?? null,
    paramMap: input.paramMap ?? null,
    positions: input.positions ?? null,
    workflowIO: input.workflowIO ?? null,
    apiSource: input.apiSource ?? null,
    modes: input.modes ?? null,
    defaultMode: input.defaultMode ?? null,
    sourcePath: input.sourcePath ?? null,
    sourceChecksum: input.sourceChecksum ?? null,
    sourceMtime: input.sourceMtime ?? null,
    modelTags: input.modelTags ?? [],
    createdAt: input.createdAt ?? new Date(),
    updatedAt: new Date(),
  };
  tdb.$tables.workflowTemplates.push(row);
  return row;
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

export function seedTask(tdb: TestDb, input: SeedTaskInput): Row {
  const row: Row = {
    id: input.id ?? `seed-task-${++seedSeq}`,
    userId: input.userId,
    type: input.type ?? "TXT2IMG",
    status: input.status ?? "SUCCEEDED",
    prompt: input.prompt ?? "",
    negativePrompt: input.negativePrompt ?? null,
    params: input.params ?? {},
    workflowName: input.workflowName ?? "seeded-workflow",
    projectId: input.projectId ?? null,
    images: input.images ?? [],
    workflowSnapshot: input.workflowSnapshot ?? null,
    referenceImages: input.referenceImages ?? null,
    progress: input.progress ?? 0,
    error: input.error ?? null,
    createdAt: input.createdAt ?? new Date(),
    updatedAt: new Date(),
  };
  tdb.$tables.tasks.push(row);
  return row;
}

export function seedProject(
  tdb: TestDb,
  input: { id?: string; userId: string; name: string; nodes?: unknown; edges?: unknown; updatedAt?: Date }
): Row {
  const row: Row = {
    id: input.id ?? `seed-proj-${++seedSeq}`,
    userId: input.userId,
    name: input.name,
    nodes: input.nodes ?? null,
    edges: input.edges ?? null,
    createdAt: new Date(),
    updatedAt: input.updatedAt ?? new Date(),
  };
  tdb.$tables.projects.push(row);
  return row;
}
