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
import { env } from "~/env";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./db/schema";

function resolveDbPath(url: string): string {
  if (url.startsWith("file:")) {
    const u = new URL(url);
    let p = decodeURIComponent(u.pathname);
    // Windows 上 pathname 可能带前导 "/"，如 "/C:/..."，需去掉
    if (process.platform === "win32" && p.startsWith("/") && /^[A-Za-z]:/.test(p.slice(1))) {
      p = p.slice(1);
    }
    return p;
  }
  return url;
}

const sqlite = new Database(resolveDbPath(env.DATABASE_URL));
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

const globalForDb = globalThis as unknown as {
  db: ReturnType<typeof drizzle<typeof schema>> | undefined;
};

export const db = globalForDb.db ?? drizzle(sqlite, { schema });

if (env.NODE_ENV !== "production") globalForDb.db = db;
