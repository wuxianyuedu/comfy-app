/**
 * db-inspect.mjs —— 只读核对 db.sqlite（ISSUE #5171）。
 *
 * 此前靠 `node -e "new DatabaseSync(...)"`，PowerShell 引号转义易错，路径锚点不同还会查到
 * 空库。这里复用 `resolveSqlitePath` / `schemaDigest` / `verifyBackupFile` 的既有口径，
 * 一条命令给出库绝对路径、integrity_check、表清单与行数、源码 schema 指纹 vs 库指纹。
 * **只接受只读 SELECT / WITH**，任何写语句当场拒绝（不靠 sqlite 的 readonly 兜底）。
 *
 * 用法：`pnpm db:inspect [--table <名>] [--limit N] [--sql "<只读 SELECT>"] [--json]`
 * 退码：0 = 读到；1 = 库损坏 / 查询失败；2 = 用法错 / 库不存在。
 */
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

import { resolveSqlitePath, schemaDigest } from "./db-schema-state.mjs";
import { verifyBackupFile } from "./db-backup-core.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");

/**
 * 只读语句的形状。纯函数。
 *
 * @param {string} sql
 * @returns {{ok:boolean, reason:string}}
 */
export function checkReadOnlySql(sql) {
  const text = String(sql ?? "").trim();
  if (!/^(?:SELECT|WITH)\b/i.test(text)) {
    return { ok: false, reason: "只接受 SELECT / WITH 开头的只读查询" };
  }
  /* 多条语句里只要第二条是写语句就绕过开头判断，所以整串只许一个分号且在末尾。 */
  const body = text.endsWith(";") ? text.slice(0, -1) : text;
  if (body.includes(";")) {
    return { ok: false, reason: "一次只接受一条语句（中间的分号会藏进第二条写语句）" };
  }
  return { ok: true, reason: "" };
}

/** @param {string} file @param {string} table @param {number} limit */
function readTable(file, table, limit) {
  const db = new DatabaseSync(file, { readOnly: true, open: true });
  try {
    /* 表名来自人给的 argv，不能当标识符拼接 —— 先按已知表名白名单收口。 */
    const known = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((r) => String(r?.name ?? ""));
    if (!known.includes(table)) {
      return { error: `表 ${table} 不在库里（已知：${known.join(", ")}）` };
    }
    const rows = db
      .prepare(`SELECT * FROM "${table}" LIMIT ${Math.min(Math.max(limit, 1), 100)}`)
      .all();
    const total = Number(db.prepare(`SELECT count(*) AS c FROM "${table}"`).get()?.c ?? 0);
    return { rows, total };
  } finally {
    db.close();
  }
}

/** @param {string[]} argv */
function main(argv) {
  const json = argv.includes("--json");
  const tableAt = argv.indexOf("--table");
  const limitAt = argv.indexOf("--limit");
  const sqlAt = argv.indexOf("--sql");
  const table = tableAt === -1 ? null : String(argv[tableAt + 1] ?? "");
  const limit = limitAt === -1 ? 10 : Number(argv[limitAt + 1] ?? 10);
  const sql = sqlAt === -1 ? null : String(argv[sqlAt + 1] ?? "");
  const bad = argv.filter(
    (a, i) =>
      !["--json", "--table", "--limit", "--sql"].includes(a) &&
      ![tableAt + 1, limitAt + 1, sqlAt + 1].includes(i),
  );
  if (bad.length > 0 || (sql && !checkReadOnlySql(sql).ok)) {
    process.stderr.write(
      `用法：pnpm db:inspect [--table <名>] [--limit N] [--sql "<只读 SELECT>"] [--json]\n` +
        `${sql ? checkReadOnlySql(sql).reason : bad.join(" ")}\n`,
    );
    return 2;
  }
  const file = resolveSqlitePath(ROOT);
  const verify = verifyBackupFile(file);
  if (!verify.ok) {
    process.stderr.write(`[db:inspect] ${file} 验不过：${verify.reason}\n`);
    /* 库还没建 / 读不到是前置不成立（2），不是「查到了损坏」（1）。 */
    return verify.reason.startsWith("读不到文件") || verify.reason.startsWith("打不开") ? 2 : 1;
  }
  const digest = schemaDigest(ROOT);
  const out = {
    file: path.resolve(file),
    integrity: "ok",
    tables: verify.tables,
    size: verify.size,
    schema: digest,
    /** @type {any[] | undefined} */
    query: undefined,
    /** @type {{name:string, total:number, rows:any[]} | undefined} */
    table: undefined,
  };
  if (sql) {
    const db = new DatabaseSync(file, { readOnly: true, open: true });
    try {
      out.query = db.prepare(sql).all();
    } catch (error) {
      process.stderr.write(`[db:inspect] 查询失败：${String(error)}\n`);
      return 1;
    } finally {
      db.close();
    }
  }
  if (table) {
    const got = readTable(file, table, limit);
    if (got.error) {
      process.stderr.write(`[db:inspect] ${got.error}\n`);
      return 2;
    }
    out.table = { name: table, total: Number(got.total ?? 0), rows: got.rows ?? [] };
  }
  if (json) {
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  } else {
    process.stdout.write(
      `[db:inspect] 库：${out.file} · integrity ok · ${out.tables} 张表 · ${out.size} 字节\n`,
    );
    process.stdout.write(`[db:inspect] schema：${JSON.stringify(out.schema)}\n`);
    if (out.table) {
      process.stdout.write(`  表 ${out.table.name}：${out.table.total} 行\n`);
      for (const r of out.table.rows ?? []) {
        process.stdout.write(`    ${JSON.stringify(r)}\n`);
      }
    }
    if (out.query) {
      for (const r of out.query) {
        process.stdout.write(`    ${JSON.stringify(r)}\n`);
      }
    }
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
