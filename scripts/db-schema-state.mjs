// 库就绪探测的**非 TS**实现（scripts/*.mjs 用），判据与
// `src/lib/db-schema-ready.ts` 完全一致：读 `sqlite_master` 找哨兵表。
//
// 为什么要有一份 .mjs：dev.mjs / start.mjs 是纯 Node 入口，不能 import
// `src/lib/db-schema-ready.ts`（它 `import "server-only"` 且要过 TS 编译）。
// 两处判据必须同源，所以哨兵表名只在这里定义一次、由 TS 侧引用同名常量，
// 分歧会被 tests/db-schema-ready-parity.test.ts 拦下。
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export const SENTINEL_TABLE = "task";

/**
 * `file:` 前缀去掉后相对传入 root 解析（与 src/server/db.ts 同一锚点）。
 * @param {string} root 项目根（绝对路径）
 * @param {string} [databaseUrl] 形如 `file:./db.sqlite`
 * @returns {string} 绝对路径
 */
export function resolveSqlitePath(root, databaseUrl) {
  const url = databaseUrl ?? process.env.DATABASE_URL ?? "file:./db.sqlite";
  const raw = url.startsWith("file:") ? url.slice("file:".length) : url;
  return path.resolve(root, raw);
}

/**
 * @param {string} root 项目根（绝对路径）
 * @param {string} [databaseUrl] 形如 `file:./db.sqlite`
 * @returns {"ready" | "missing" | "unknown"}
 */
export function probeSchemaSync(root, databaseUrl) {
  const file = resolveSqlitePath(root, databaseUrl);
  if (!fs.existsSync(file)) return "unknown";
  try {
    const db = new DatabaseSync(file, { readOnly: true, open: true });
    try {
      const row = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(SENTINEL_TABLE);
      return row ? "ready" : "missing";
    } finally {
      db.close();
    }
  } catch {
    return "unknown";
  }
}
