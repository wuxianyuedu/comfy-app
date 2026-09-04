/**
 * `db.ts` — Drizzle 实例（替代原 PrismaClient 单例）
 * ===========================================================================
 *
 * 使用 better-sqlite3 同步驱动连接 `db.sqlite`（`DATABASE_URL` 形如
 * `file:./db.sqlite`）。开发模式单例挂到 globalThis，避免 Next dev 热重载
 * 反复打开连接。
 *
 * @module server/db
 */
import "server-only";
import path from "node:path";
import { env } from "~/env";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./db/schema";

function resolveDbPath(url: string): string {
  // 必须与 drizzle-kit push 相同的锚点：相对路径相对「进程 CWD」解析
  //（启动器与 drizzle-kit 都以项目根为 CWD）。此前用 new URL(url) 解析，
  // "file:./db.sqlite" 会被解析成 file:///db.sqlite → Windows 落到盘符根目录
  // （F:\db.sqlite，一个全新空库）——真实数据完全读不到（发现的
  // Drizzle 迁移遗漏，工作流库/项目列表全挂的根因）。
  const raw = url.startsWith("file:") ? url.slice("file:".length) : url;
  return path.resolve(/*turbopackIgnore: true*/ process.cwd(), raw);
}

const sqlite = new Database(resolveDbPath(env.DATABASE_URL));
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

const globalForDb = globalThis as unknown as {
  db: ReturnType<typeof drizzle<typeof schema>> | undefined;
};

export const db = globalForDb.db ?? drizzle(sqlite, { schema });

if (env.NODE_ENV !== "production") globalForDb.db = db;
