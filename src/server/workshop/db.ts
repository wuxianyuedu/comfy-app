// ── Workshop MCP 本地 DB 客户端 ────────────────────────────────
// 独立的 @libsql/client 连接（与 Next 进程的 ~/server/db 解耦），
// 这样 MCP stdio / 独立 HTTP 进程无需启动 Next、也不触碰 `~/env`。
// 复用同一份 schema（含 workshopSession 表），数据库文件路径锚定
// 与 drizzle-kit push 一致（相对进程 CWD 解析），避免 Windows 盘符根错误。
//
// 与 ~/server/db 同步换 driver：better-sqlite3 的同步语义会把整个事件循环
// 卡在同一份慢 SQL 上；libsql 保持同 file: 布局、异步不阻塞。
//
// 注意：刻意不 import "server-only" —— 该包在普通 Node 进程里会抛错。
import path from "node:path";

import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import { tracingIgnoreArgs } from "~/lib/shell/tracing-ignore";
import { SQLITE_PRAGMAS } from "~/lib/sqlite-pragmas";
import * as schema from "~/server/db/schema";

/** 未配置 `DATABASE_URL` 时与 drizzle-kit 同锚点的兜底库文件（相对进程 CWD）。 */
const DEFAULT_DB_FILE = "./db.sqlite";

function resolveDbPath(url: string): string {
  const raw = url.startsWith("file:") ? url.slice("file:".length) : url;
  return path.resolve(
    ...tracingIgnoreArgs(),
    process.cwd(),
    raw || DEFAULT_DB_FILE,
  );
}

const dbUrl = process.env.DATABASE_URL ?? "file:./db.sqlite";
const client = createClient({
  url: `file:${resolveDbPath(dbUrl)}`,
});
// 与 `~/server/db` 共用同一份 PRAGMA 清单（`~/lib/sqlite-pragmas`）：以前两边各写
// 两行，加一条就要记得加两处。清单里只有**库级**那两条；等锁预算是**每条连接**的
// 客户端选项（`timeout`），本侧刻意不给 —— 等锁是同步的，会把服务界面的这个进程
// 一起停住那么久（判据与实测见 `sqlite-pragmas` 文件头，ISSUE #1250）。
// 模块顶层 await 让首次查询前一定就位。
for (const pragma of SQLITE_PRAGMAS) {
  await client.execute(pragma);
}

export const workshopDb = drizzle(client, { schema });
