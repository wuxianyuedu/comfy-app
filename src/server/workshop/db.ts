// ── Workshop MCP 本地 DB 客户端 ────────────────────────────────
// 独立的 @libsql/client 连接（与 Next 进程的 ~/server/db 解耦）：MCP stdio / 独立 HTTP
// 进程无需启动 Next、也不触碰 `~/env`；路径与 drizzle-kit push 一致（相对 CWD 解析），
// 避免 Windows 盘符根错误。换 libsql 而非 better-sqlite3：后者同步语义会把事件循环卡在
// 同一份慢 SQL 上。刻意不 import "server-only" —— 该包在普通 Node 进程里会抛错。
import path from "node:path";

import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import { tracingIgnoreArgs } from "~/lib/shell/tracing-ignore";
import { applySqlitePragmas } from "~/lib/sqlite-pragmas";
import * as schema from "~/server/db/schema";

/** 未配置 `DATABASE_URL` 时与 drizzle-kit 同锚点的兜底库文件（相对进程 CWD）。 */
const DEFAULT_DB_FILE = "./db.sqlite";

function resolveDbPath(url: string): string {
  const raw = url.startsWith("file:") ? url.slice("file:".length) : url;
  return path.resolve(...tracingIgnoreArgs(), process.cwd(), raw || DEFAULT_DB_FILE);
}

const dbUrl = process.env.DATABASE_URL ?? "file:./db.sqlite";
const client = createClient({
  url: `file:${resolveDbPath(dbUrl)}`,
});
// PRAGMA 清单与 `~/server/db` 共用（`~/lib/sqlite-pragmas`），加一条不必改两处；等锁预算
// （`timeout`）是**每条连接**的客户端选项，本侧刻意不给 —— 等锁是同步的，会把这个服务
// 进程一起停住（判据与实测见该文件头，ISSUE #1250）。模块顶层 await 保证首次查询前就位；
// 走 `applySqlitePragmas` 以容忍「别的进程正在同时切 WAL」：`next build` 起 7 个 worker
// 每个都 import 这条链，全新库文件只让一个拿到独占锁（实测 3/8 抛 SQLITE_BUSY，ISSUE #1282）。
await applySqlitePragmas(client);

export const workshopDb = drizzle(client, { schema });
