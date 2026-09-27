/**
 * `tests/helpers/test-db.ts` 的内联 DDL 必须跟 `src/server/db/schema.ts` 同步。
 *
 * 为什么要有这一条：测试库用的是那份**手写**的 `CREATE TABLE` 文本（不是从
 * schema 生成的），于是「给业务表加一列」这件事的第二轮子就在测试基建里——
 * 缺列时的报错是 `SqliteError: table task has no column named rawCli`，指向
 * drizzle 的 insert 栈，而真正要改的是那个 helper。实测踩过一次（P3 §5 ADR
 * §14 D1 的 4-B2 加 `claimedAt` / `rawCli`），一次红 + 一轮定位。
 *
 * 只比**列名集合**（缺列/多列都算），不比类型与可空性——那些由 drizzle 与
 * 真库（`pnpm db:push` 后的 `db.sqlite`）负责，测试基建的这份镜像只需覆盖到
 * 「有没有这一列」。JSON 列的 `{ mode: "json" }` 那一半（`jsonColumns` 集合）
 * 本判据**盖不住**：它的缺失表现是读回来是字符串而不是对象，得靠各自的用例断言
 * 形状（这里不硬造一个假判据）。
 *
 * 另有一类手写 DDL 是**刻意最小**的，不在本判据范围内：`tests/executor-host.test.ts`
 * 的临时库只建「领取与 reaper 实际触达的列」、`tests/db-push-noninteractive.test.ts`
 * 与 `src/lib/db-schema-ready.test.ts` 更是故意造残缺库来验失败路径。把它们一起
 * 扫进来会把「故意缺列」判成漂移、误报一片——那类判据的处置口径是精确化而不是
 * 放宽。加列时如果动到那些路径，改法看各自文件头的说明。
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
  return Reflect.get(table, Symbol.for("drizzle:Name")) as string;
}

/** 读一张表的实际列名。
 *  `TestDb` 把 `$reset` / `$tables` 挂在 drizzle 实例上、因此带一条
 *  `[key: string]: unknown` 的索引签名，`tdb.all` 在类型层面是 unknown——
 *  这里一次性收窄，而不是在循环里到处 cast。 */
function columnsOf(name: string): string[] | null {
  const session = tdb as unknown as {
    all(query: ReturnType<typeof sql.raw>): unknown;
  };
  try {
    const rows = session.all(sql.raw(`PRAGMA table_info("${name}")`)) as Array<{
      name: string;
    }>;
    return rows.map((row) => row.name);
  } catch {
    return null;
  }
}

describe("测试库的表结构与 schema.ts 同步", () => {
  it("schema 里每一张表的每一列，测试库的 DDL 都有", () => {
    const offenders: string[] = [];
    let checkedTables = 0;

    for (const table of Object.values(schema)) {
      if (!(table instanceof Table)) continue;
      const name = tableNameOf(table);
      const columns = Object.keys(getTableColumns(table as never));
      const present = columnsOf(name);
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
    expect(checkedTables, "一张表都没比对到，判据本身失效了").toBeGreaterThan(
      20,
    );
    expect(offenders).toEqual([]);
  });
});
