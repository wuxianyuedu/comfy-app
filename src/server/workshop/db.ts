// ── Workshop MCP 本地 DB 客户端 ────────────────────────────────
// 独立的 node:sqlite 连接（与 Next 进程的 ~/server/db 解耦）：MCP stdio / 独立 HTTP
// 进程无需启动 Next、也不触碰 `~/env`；路径与 drizzle-kit push 一致（相对 CWD 解析），
// 避免 Windows 盘符根错误。运行时驱动从 @libsql/client 换成 Node 自带的 node:sqlite
// （ISSUE #3171）：不再为每个进程加载 8.5 MB 原生件，同步语句经 `~/lib/sqlite-driver`
// 包成 drizzle sqlite-proxy 要的异步回调。刻意不 import "server-only" —— 该包在普通
// Node 进程里会抛错。
import path from "node:path";

import { drizzle } from "drizzle-orm/sqlite-proxy";

import { openNodeSqlite } from "~/lib/sqlite-driver";
import { gateProxyWithPragmas } from "~/lib/sqlite-pragmas";
import * as schema from "~/server/db/schema";

/** 未配置 `DATABASE_URL` 时与 drizzle-kit 同锚点的兜底库文件（相对进程 CWD）。 */
const DEFAULT_DB_FILE = "./db.sqlite";

function resolveDbPath(url: string): string {
  const raw = url.startsWith("file:") ? url.slice("file:".length) : url;
  return path.resolve(/*turbopackIgnore: true*/ process.cwd(), raw || DEFAULT_DB_FILE);
}

const dbUrl = process.env.DATABASE_URL ?? "file:./db.sqlite";
const nodeSqlite = openNodeSqlite(resolveDbPath(dbUrl));
// PRAGMA 清单与 `~/server/db` 共用（`~/lib/sqlite-pragmas`），加一条不必改两处；等锁预算
// 本侧刻意不给 —— node:sqlite 是单连接，`PRAGMA busy_timeout` 就是同步等锁，会把这个
// 服务进程的事件循环一起停住（判据与实测见该文件头，ISSUE #1250）。走共用出口以容忍
// 「别的进程正在同时切 WAL」：`next build` 起 7 个 worker 每个都 import 这条链，全新
// 库文件只让一个拿到独占锁（实测 3/8 抛 SQLITE_BUSY，#1282）。
//
// 这里**不能**用顶层 await（与 `~/server/db` 同一条理由，ISSUE #3252）：带 TLA 的模块
// 在 Turbopack 里会被编成 async module，凡是从这条链上 `class extends` 出来的模块都
// 可能在基类导出注册前求值 ⇒ `Class extends value undefined`。共用出口把初始化 promise
// gate 在 drizzle proxy 上：模块同步导出，而每条查询仍在 PRAGMA 就位之后才跑。
const gatedProxy = gateProxyWithPragmas(nodeSqlite);

export const workshopDb = drizzle(gatedProxy, { schema });
