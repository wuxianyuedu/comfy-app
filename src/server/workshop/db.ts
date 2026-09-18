// ── Workshop MCP 本地 DB 客户端 ────────────────────────────────
// 独立的 better-sqlite3 连接（与 Next 进程的 ~/server/db 解耦），
// 这样 MCP stdio / 独立 HTTP 进程无需启动 Next、也不触碰 `~/env`。
// 复用同一份 schema（含 workshopSession 表），数据库文件路径锚定
// 与 drizzle-kit push 一致（相对进程 CWD 解析），避免 Windows 盘符根错误。
//
// 注意：刻意不 import "server-only" —— 该包在普通 Node 进程里会抛错。
import path from "node:path";

import Database from "better-sqlite3";

import { tracingIgnoreArgs } from "~/lib/shell/tracing-ignore";
import { drizzle } from "drizzle-orm/better-sqlite3";
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
const sqlite = new Database(resolveDbPath(dbUrl));
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const workshopDb = drizzle(sqlite, { schema });
