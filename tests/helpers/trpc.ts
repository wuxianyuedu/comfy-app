/**
 * tests/helpers/trpc.ts — tRPC 集成测试的 context / caller 基建。
 *
 * - `makeCtx` 按现有中间件契约手工构造测试 context（与 createTRPCContext
 *   返回形状一致：db / session / user / headers）。db 为 `~/server/db`
 *   的内存替身（见 tests/helpers/test-db.ts），经类型断言注入。
 * - `user: null` 时走 authedProcedure 的 demo-user 兜底分支，可用于覆盖
 *   鉴权中间件逻辑。
 *
 * @module tests/helpers/trpc — tRPC 集成测试的 context / caller 基建
 */
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type Database from "better-sqlite3";
import type * as schema from "~/server/db/schema";
import type { TRPCUser } from "~/server/api/trpc";
import { getTestDb } from "./test-db";

/** 与 `createTRPCContext` 返回形状一致的 db 类型（Drizzle better-sqlite3 实例）。 */
export type TestDb = BetterSQLite3Database<typeof schema> & {
  $client: Database.Database;
};

/** 构造一个默认测试用户（id 固定为 user-a，可与 seedUser 对齐）。 */
export function makeUser(overrides: Partial<TRPCUser> = {}): TRPCUser {
  return {
    id: "user-a",
    email: "a@test.dev",
    name: "User A",
    ...overrides,
  };
}

/** 构造 tRPC caller 所需的 context；`opts.user === null` 时显式传空用户。 */
export function makeCtx(opts: { user?: TRPCUser | null } = {}): {
  db: TestDb;
  session: null;
  user: TRPCUser | null;
  headers: Headers;
} {
  const user = opts.user === undefined ? makeUser() : opts.user;
  return {
    db: getTestDb() as unknown as TestDb,
    session: null,
    user,
    headers: new Headers({ "x-forwarded-for": "127.0.0.1" }),
  };
}
