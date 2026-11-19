/**
 * tests/schema-uniqueness.test.ts — 唯一性契约（#3849「唯一性检测」的防复发闸）。
 *
 * 三层判据：
 *  ① schema.ts 声明的每一条唯一索引，在 tests/helpers/test-db.ts 的 CREATE_SQL 里
 *     有同名字镜像（反向亦然）——两侧漂移时，仓储的 onConflictDoUpdate 会在测试里
 *     炸「ON CONFLICT does not match any UNIQUE constraint」、或测试库静默失去约束；
 *     这道契约让它当场红，而不是等某条并发用例偶发暴露。
 *  ② REQUIRED_UNIQUE_KEYS 登记「业务上必须唯一」的键 → schema 里必须真有对应
 *     唯一约束（列级 .unique() 或 uniqueIndex）。新增业务键在这里登记；反向也判：
 *     schema 里每条唯一约束都必须登记在册（防止「约束加了、口径没人记得」）。
 *  ③ 一轮内存真库（真 Drizzle）行为用例：重复业务键必须被约束拒绝。
 *     （task 的「同镜头活动任务唯一」不设库级约束，见 REQUIRED_UNIQUE_KEYS 的注释；
 *     它的应用层语义由 generate.ts / series-generation 的自有用例守着。）
 */
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { is, Table } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import * as schema from "~/server/db/schema";
import { isSqliteUniqueViolation } from "~/lib/sqlite-error";
import { createTestDb } from "./helpers/test-db";

/** 断言这条写入撞了唯一约束 —— 用生产同一个判据（沿 cause 链认 SQLITE_CONSTRAINT），
 *  而不是拿正则去匹配 drizzle 包装层的 message（那层只有 Failed query，UNIQUE 在 cause 上）。 */
async function expectUniqueRejection(p: Promise<unknown>): Promise<void> {
  let caught: unknown = null;
  try {
    await p;
  } catch (error) {
    caught = error;
  }
  expect(caught, "应当撞唯一约束，实际写入成功").not.toBeNull();
  expect(isSqliteUniqueViolation(caught), `应判为唯一冲突，实际：${String(caught)}`).toBe(true);
}

/** schema 模块导出里的全部表（过滤 relations / 常量 / 类型擦除后的残值）。 */
function allTables(): Array<{ name: string; table: Parameters<typeof getTableConfig>[0] }> {
  return Object.entries(schema)
    .filter(([, v]) => is(v, Table))
    .map(([name, table]) => ({
      name,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- is(v, Table) 已把值收窄到 drizzle Table；sqlite-core 的 getTableConfig 要的是 SQLiteTable 这一层
      table: table as Parameters<typeof getTableConfig>[0],
    }));
}

type UniqueIndexInfo = { columns: Array<string>; name: string };

/** 表上的唯一索引（uniqueIndex 声明的那批；列级 .unique() 不在此列）。
 *  表达式键（SQL，无列名）不计入 columns —— 契约只登记「业务列」。 */
function uniqueIndexesOf(table: Parameters<typeof getTableConfig>[0]): Array<UniqueIndexInfo> {
  return getTableConfig(table)
    .indexes.filter((idx) => idx.config.unique === true)
    .map((idx) => ({
      name: idx.config.name,
      columns: idx.config.columns.flatMap((c) =>
        "name" in c && typeof c.name === "string" ? [c.name] : [],
      ),
    }));
}

/** 列级 .unique() 的列名（user.email / session.token / skill.slug 这批）。 */
function uniqueColumnsOf(table: Parameters<typeof getTableConfig>[0]): Array<string> {
  return getTableConfig(table)
    .columns.filter((c) => c.isUnique)
    .map((c) => c.name);
}

/**
 * 业务唯一键登记表：表名 → 必须存在的唯一列组（列名按**库列名**）。
 *
 * 维护口径：给表新增业务唯一键 ⇒ 同批在这里登记；这里没有的键不设约束，
 * 想设先登记 —— 本测试是唯一性口径的唯一登记面。
 * ⚠️ `task` 的「同镜头活动任务唯一」**刻意不在册**（#3849）：drizzle-kit 0.31 的
 * SQLite diff 对部分索引 / 表达式索引永不收敛（见 schema.ts task 表注释），
 * 该约束由应用层承（generate.ts 的锁内查重 + series-generation 的占用集合），
 * 不设库级唯一索引。
 *
 * 刻意**不设**唯一约束的业务键（拍板记录，别再当缺口上报）：
 *  · `series(userId, title)` / `project(userId, name)`（#3935）：默认标题
 *    「未命名系列 / 未命名项目」的连续创建是正常流程，强唯一会挡住它；
 *  · `filmProject.projectId`（#3936）：一个项目允许多份成片（重制场景）。
 */
const REQUIRED_UNIQUE_KEYS: Record<string, Array<{ columns: Array<string> }>> = {
  user: [{ columns: ["email"] }],
  session: [{ columns: ["token"] }],
  account: [{ columns: ["providerId", "accountId", "userId"] }],
  model: [{ columns: ["fileName", "folder"] }],
  userModelConfig: [{ columns: ["userId", "folder"] }],
  favorite: [{ columns: ["userId", "modelId"] }],
  workflowModelTag: [{ columns: ["userId", "name"] }],
  workflowModelTagToWorkflowTemplate: [{ columns: ["workflowModelTag", "workflowTemplate"] }],
  workflowTemplate: [{ columns: ["userId", "name"] }],
  llmProvider: [{ columns: ["name"] }],
  remoteModel: [{ columns: ["name"] }],
  skill: [{ columns: ["slug"] }],
  episode: [{ columns: ["projectId"] }, { columns: ["seasonId", "episodeNumber"] }],
  episodeCharacter: [{ columns: ["episodeId", "characterId"] }],
  character: [{ columns: ["seriesId", "name"] }],
  season: [{ columns: ["seriesId", "seasonNumber"] }],
};

const sorted = (cols: Array<string>): string => [...cols].sort().join("+");

describe("唯一性契约：schema ⇄ 测试库 DDL 同步", () => {
  const testDbSource = fs.readFileSync(
    fileURLToPath(new URL("helpers/test-db.ts", import.meta.url)),
    "utf8",
  );
  const ddlIndexNames = new Set(
    [...testDbSource.matchAll(/CREATE UNIQUE INDEX IF NOT EXISTS (?<name>\w+)/g)].map(
      (m) => m.groups?.name ?? "",
    ),
  );
  const schemaIndexNames = new Set(
    allTables().flatMap(({ table }) => uniqueIndexesOf(table).map((idx) => idx.name)),
  );

  it("schema 里每条唯一索引在测试库 DDL 里都有同名镜像", () => {
    const missing = [...schemaIndexNames].filter((n) => !ddlIndexNames.has(n));
    expect(missing).toEqual([]);
  });

  it("测试库 DDL 里没有 schema 不认识的唯一索引（防测试侧私加）", () => {
    const extra = [...ddlIndexNames].filter((n) => !schemaIndexNames.has(n));
    expect(extra).toEqual([]);
  });
});

describe("唯一性契约：业务唯一键登记表 ⇄ schema", () => {
  it("登记的每个业务键在 schema 里都有真实唯一约束", () => {
    for (const { name, table } of allTables()) {
      const required = REQUIRED_UNIQUE_KEYS[name];
      if (required === undefined) {
        continue;
      }
      const have: Array<Array<string>> = [
        ...uniqueColumnsOf(table).map((c) => [c]),
        ...uniqueIndexesOf(table).map((idx) => idx.columns),
      ];
      for (const req of required) {
        expect(
          have.some((h) => sorted(h) === sorted(req.columns)),
          `${name} 缺业务唯一键 (${req.columns.join(", ")}) —— 请在 schema 声明唯一约束`,
        ).toBe(true);
      }
    }
  });

  it("schema 里每条唯一约束都登记在册（防口径失忆）", () => {
    for (const { name, table } of allTables()) {
      const registered = REQUIRED_UNIQUE_KEYS[name] ?? [];
      const registeredSets = new Set(registered.map((r) => sorted(r.columns)));
      for (const col of uniqueColumnsOf(table)) {
        expect(
          registeredSets.has(sorted([col])),
          `${name}.${col} 有列级唯一约束但未登记 REQUIRED_UNIQUE_KEYS`,
        ).toBe(true);
      }
      for (const idx of uniqueIndexesOf(table)) {
        expect(
          registeredSets.has(sorted(idx.columns)),
          `${name} 的唯一索引 ${idx.name} (${idx.columns.join(", ")}) 未登记 REQUIRED_UNIQUE_KEYS`,
        ).toBe(true);
      }
    }
  });
});

describe("唯一约束行为（内存真库）", () => {
  it("同一系列的季号唯一；不同系列互不影响", async () => {
    const db = createTestDb();
    await db.insert(schema.season).values({ id: "se1", seriesId: "sx", seasonNumber: 1 });
    await expectUniqueRejection(
      db.insert(schema.season).values({ id: "se2", seriesId: "sx", seasonNumber: 1 }),
    );
    await db.insert(schema.season).values({ id: "se3", seriesId: "sy", seasonNumber: 1 });
  });

  it("同一季的集号唯一；episode.projectId 唯一但 NULL 可共存", async () => {
    const db = createTestDb();
    await db
      .insert(schema.episode)
      .values({ id: "e1", seasonId: "s1", episodeNumber: 1, projectId: null });
    await expectUniqueRejection(
      db.insert(schema.episode).values({ id: "e2", seasonId: "s1", episodeNumber: 1 }),
    );
    await db
      .insert(schema.episode)
      .values({ id: "e3", seasonId: "s1", episodeNumber: 2, projectId: "proj_1" });
    await expectUniqueRejection(
      db
        .insert(schema.episode)
        .values({ id: "e4", seasonId: "s1", episodeNumber: 3, projectId: "proj_1" }),
    );
  });

  it("同一系列的角色名唯一", async () => {
    const db = createTestDb();
    await db.insert(schema.character).values({ id: "c1", seriesId: "sx", name: "小明" });
    await expectUniqueRejection(
      db.insert(schema.character).values({ id: "c2", seriesId: "sx", name: "小明" }),
    );
    await db.insert(schema.character).values({ id: "c3", seriesId: "sy", name: "小明" });
  });

  it("连接表 (标签, 模板) 唯一：重复关联被拒绝", async () => {
    const db = createTestDb();
    await db
      .insert(schema.workflowModelTagToWorkflowTemplate)
      .values({ workflowModelTag: "tag1", workflowTemplate: "wt1" });
    await expectUniqueRejection(
      db
        .insert(schema.workflowModelTagToWorkflowTemplate)
        .values({ workflowModelTag: "tag1", workflowTemplate: "wt1" }),
    );
  });

  it("同一用户的模板名唯一（#3934）；不同用户互不影响", async () => {
    const db = createTestDb();
    await db.insert(schema.workflowTemplate).values({ id: "w1", userId: "u1", name: "导入 A" });
    await expectUniqueRejection(
      db.insert(schema.workflowTemplate).values({ id: "w2", userId: "u1", name: "导入 A" }),
    );
    await db.insert(schema.workflowTemplate).values({ id: "w3", userId: "u2", name: "导入 A" });
  });

  it("account 同一 (provider, account, user) 唯一（#3937）；换 provider 不受影响", async () => {
    const db = createTestDb();
    const base = { userId: "u1", accountId: "acc1", providerId: "github" };
    await db.insert(schema.account).values({ id: "a1", ...base });
    await expectUniqueRejection(db.insert(schema.account).values({ id: "a2", ...base }));
    await db.insert(schema.account).values({ id: "a3", ...base, providerId: "google" });
  });
});
