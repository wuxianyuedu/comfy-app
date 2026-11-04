/**
 * `tests/helpers/test-db.ts` 的内联 DDL 必须跟 `src/server/db/schema.ts` 同步：测试库用的是手写 `CREATE TABLE`，加列时
 * 漏改 helper 报 `SqliteError: table task has no column named rawCli` 却指向 drizzle 栈（ADR §14 D1 4-B2 踩过）。只比列名
 * 集合；JSON `{ mode: "json" }` 盖不住；刻意精简/残缺的 DDL（`executor-host.test.ts` 等）不在范围内，扫进来会误报成漂移。
 */
import { Table, getTableColumns, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import * as schema from "~/server/db/schema";
import { createTestDb, type TestDb } from "./helpers/test-db";

let tdb: TestDb;

beforeAll(() => {
  tdb = createTestDb();
});

/** drizzle 0.45.2 没有导出 `getTableConfig`，表名挂在这个符号上。用 `Reflect.get`
 *  而不是下标：`Table` 的类型没声明这个 symbol 键（下标会踩 implicit any），而这里
 *  要的正是「读一个运行时才存在的键」。（不另存一份 schema→表名的映射——那正是本
 *  用例要防的第二轮子。） */
function tableNameOf(table: Table): string {
  /* SAFETY: 类型断言已复核 */
  return Reflect.get(table, Symbol.for("drizzle:Name")) as string;
}

/** 读一张表的实际列名。`TestDb` 带 `[key: string]: unknown` 索引签名，`tdb.all` 类型是 unknown —— 这里一次性收窄。
 *  两个形状来自换成 `sqlite-proxy` 宿主之后（ISSUE #2586）：**要 `await`** —— `resultKind` 是 async，`db.all()` 返回
 *  thenable 而非同步数组（`sqlite-core/db.cjs:281`）；**按下标取列** —— `mapResultRow` 用 `row[columnIndex]`
 *  （`utils.cjs:62`），而 `PRAGMA table_info` 列序是 `cid, name, type, notnull, dflt_value, pk` ⇒ 名字在 1。
 */
async function columnsOf(name: string): Promise<Array<string> | null> {
  /* SAFETY: 类型断言已复核 */
  const session = tdb as unknown as {
    all(query: ReturnType<typeof sql.raw>): Promise<unknown>;
  };
  try {
    /* SAFETY: 类型断言已复核 */
    const rows = (await session.all(sql.raw(`PRAGMA table_info("${name}")`))) as Array<
      Array<unknown>
    >;
    return rows.map((row) => String(row[1]));
  } catch {
    return null;
  }
}

describe("测试库的表结构与 schema.ts 同步", () => {
  it("schema 里每一张表的每一列，测试库的 DDL 都有", async () => {
    const offenders: Array<string> = [];
    let checkedTables = 0;

    for (const table of Object.values(schema)) {
      if (!(table instanceof Table)) {
        continue;
      }
      const name = tableNameOf(table);
      /* SAFETY: 类型断言已复核 */
      const columns = Object.keys(getTableColumns(table as never));
      const present = await columnsOf(name);
      if (present === null) {
        offenders.push(`${name}：测试库里没有这张表`);
        continue;
      }
      checkedTables += 1;
      const have = new Set(present);
      const missing = columns.filter((column) => !have.has(column));
      const extra = present.filter((column) => !columns.includes(column));
      if (missing.length) {
        offenders.push(
          `${name}：DDL 缺列 ${missing.join(", ")}（改 tests/helpers/test-db.ts 的 CREATE TABLE）`,
        );
      }
      if (extra.length) {
        offenders.push(`${name}：DDL 多出列 ${extra.join(", ")}`);
      }
    }

    // 表数为零说明遍历根本没认出租照对象（drizzle 内部符号变了）——
    // 那时上面那条会「全绿」而毫无价值，所以这条判据必须自己先红。
    expect(checkedTables, "一张表都没比对到，判据本身失效了").toBeGreaterThan(20);
    expect(offenders).toEqual([]);
  });
});
