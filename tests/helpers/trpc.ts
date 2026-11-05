/**
 * `tests/helpers/trpc.ts` — tRPC 集成测试的 context / caller 基建。`makeCtx` 按 createTRPCContext 形状手工
 * 造 ctx（db / session / user / headers）；`user: null` 走 authedProcedure 的 demo-user 兜底。PR-35 起
 * `~/server/db` 换成异步驱动的 sqlite-proxy（#3171 起是 node:sqlite）；测试仍用 test-db.ts 的同步 in-memory，
 * 仅 makeCtx 用 `as unknown as TestDb` 对接。
 */
import type { SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";
import type * as schema from "~/server/db/schema";
import type { TRPCUser } from "~/server/api/trpc";
import { getTestDb } from "./test-db";

/** 与 `createTRPCContext` 返回形状一致的 db 类型（Drizzle sqlite-proxy 实例）。
 *  `$client` 是 `~/server/db` 为测试保留的句柄出口（原 libsql 驱动同名属性），
 *  测试用它释放 Windows 上的库文件句柄。 */
export type TestDb = SqliteRemoteDatabase<typeof schema> & {
  $client: { close(): void };
};

/** 构造一个默认测试用户（id 固定为 user-a，可与 seedUser 对齐）。 */
export function makeUser(overrides: Partial<TRPCUser> = {}): TRPCUser {
  return {
    id: "user-a",
    email: "a@test.dev",
    name: null,
    ...overrides,
  };
}

/** 构造 tRPC caller 所需的 context；`opts.user === null` 时显式传空用户。 */
export function makeCtx(opts: { user?: TRPCUser | null } = {}): {
  db: TestDb;
  headers: Headers;
  session: null;
  user: TRPCUser | null;
} {
  const user = opts.user === undefined ? makeUser() : opts.user;
  return {
    /* SAFETY: 类型断言已复核 */
    db: getTestDb() as unknown as TestDb,
    session: null,
    user,
    headers: new Headers({ "x-forwarded-for": "127.0.0.1" }),
  };
}

/** 取一次调用的错误信封（**码 + 文案**两维都拿到）。
 *
 * 为什么：`rejects.toThrow(原文)` 只比消息，而 500 与 404 可同文案 —— 「越权与不存在同形」就
 * 有判据都不到的洞（裸 `throw new Error` 被 tRPC 归成 INTERNAL_SERVER_ERROR 时照样绿）。
 * 成功时返回 `{ code: "OK" }`，让「本该抛错却没抛」也红得看得见。 */
export async function errorEnvelope(promise: Promise<unknown>): Promise<{
  code: string;
  message: string;
}> {
  return promise.then(
    () => ({ code: "OK", message: "" }),
    (error: unknown) => {
      /* SAFETY: 类型断言已复核 */
      const err = error as { code?: unknown; message?: unknown } | null;
      // 逐维按类型收窄：拿 `String(unknown)` 兜底会在错误对象上打出
      // `[object Object]`，那等于把「码不对」这一维又判回成看运气。
      return {
        code: typeof err?.code === "string" ? err.code : "UNKNOWN",
        message: typeof err?.message === "string" ? err.message : "",
      };
    },
  );
}
