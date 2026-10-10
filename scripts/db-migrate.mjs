#!/usr/bin/env node
// 数据库**版本化迁移**入口（`pnpm db:migrate`）。
//
// 为什么不能直接 `drizzle-kit migrate`：它在本仓有一个与 `drizzle-kit push`
// **同形**的静默失败 —— 实测（无 TTY、`drizzle/` 目录缺失）它 exit 1，但
// **把 `db.sqlite` 留成 0 字节**。调用方看到的是"命令失败了"，而下一个动作
// （起应用）才炸成 `no such table`，那时已经看不出是谁干的（ISSUE #1624）。
//
// `pnpm db:push` 早就有一条复核（`scripts/db-push.mjs`：不看退出码、直接查库），
// 本脚本把**同一套口径**搬到迁移这一路 —— 但它比 push 好的地方在于**有账可查**：
// 迁移是版本化的，"该建的表有没有建起来" 由 `drizzle/` 里的 SQL 决定，不是
// 由一次 diff 的结论决定。
//
// 本脚本做四件事：
//   1. 先**看清前提**：`drizzle/` 有没有迁移文件（没有就直接报「没有迁移可应用」，
//      而不是让 drizzle-kit 起一次、留个空库、退 1 —— 那正是要消灭的形态）；
//   2. 跑 `drizzle-kit migrate`；
//   3. **复核结果**：迁移前后比库结构摘要（`schemaDigest`，与启动链路同源），
//      并在库里查 `__drizzle_migrations` 的已应用条数 —— 不看退出码；
//   4. 复核失败即**非零退出并打印可行动提示**，绝不把「留了个空库」当成功。
//
// 关于「无 TTY」：`migrate` 本身**不需要交互**（SQL 是生成好的），所以它没有
// `push` 那条「交互提示被静默吞掉」的路径。这里要挡的是另一类：**前提不成立
// 时它照样先建库文件**。所以第 1 步是**前置判决**，不是事后复核。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { runPnpmSync } from "./launcher-core/shell.mjs";
import { resolveSqlitePath } from "./db-schema-state.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dbPath = resolveSqlitePath(root);

/** 迁移文件目录（与 `drizzle.config.ts` 的 `out` 同源，写死一处便于核对）。 */
const MIGRATIONS_DIR = path.join(root, "drizzle");
/** drizzle 的迁移账本表名。 */
const LEDGER_TABLE = "__drizzle_migrations";

function fail(message) {
  process.stderr.write(`\n[db:migrate] ✗ ${message}\n\n`);
  process.exit(1);
}

/** 数一遍库里的用户表（排除 sqlite 内部表与 drizzle 的账本表）。读不到 → -1。 */
function countUserTables() {
  if (!fs.existsSync(dbPath)) return -1;
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true, open: true });
    try {
      const row = db
        .prepare(
          `SELECT count(*) AS c FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != '${LEDGER_TABLE}'`,
        )
        .get();
      return Number(row.c ?? 0);
    } finally {
      db.close();
    }
  } catch {
    return -1;
  }
}

/** 账本里的已应用迁移条数（迁移到底跑没跑，这是唯一权威）。读不到 → -1。 */
function appliedMigrations() {
  if (!fs.existsSync(dbPath)) return -1;
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true, open: true });
    try {
      const exists = db
        .prepare(
          "SELECT count(*) AS c FROM sqlite_master WHERE type = 'table' AND name = ?",
        )
        .get(LEDGER_TABLE);
      if (Number(exists.c ?? 0) === 0) return 0;
      return Number(
        db.prepare(`SELECT count(*) AS c FROM ${LEDGER_TABLE}`).get().c ?? 0,
      );
    } finally {
      db.close();
    }
  } catch {
    return -1;
  }
}

/** `drizzle/` 下的迁移文件（`*.sql`，按文件名排序 = 应用序）。 */
function migrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/* ── ① 前置判决：没有迁移文件就别往下走 ─────────────────────────────────
 *
 * 这一条是**必需的**，不是防御性代码：没有它，`drizzle-kit migrate` 会先
 * 建出库文件、再发现无事可做，然后退 1 —— 留下一个 0 字节的库（实测）。
 * 也就是说「前提不成立」的代价被记在了**目标文件**上，而调用方拿到的是一个
 * 看起来像「迁移失败」的退出码 + 一个坏掉的库。 */
const files = migrationFiles();
if (files.length === 0) {
  fail(
    [
      `没有可应用的迁移：${MIGRATIONS_DIR} 下没有 .sql 文件。`,
      "",
      "这不是「迁移失败」，是**前提不成立**——本脚本刻意在起 drizzle-kit 之前拦下它，",
      "因为 drizzle-kit 在同样前提下会先建出库文件、再退 1，留下一个 0 字节的库。",
      "",
      "可行动作：",
      "  · 首次建库 / 库已与 schema 一致 → 用 `pnpm db:push`（它按 diff 同步，不需要迁移文件）；",
      "  · 想让迁移成为正路 → 先 `pnpm db:generate` 生成基线迁移，再跑本命令；",
      "  · 确认 drizzle.config.ts 的 `out` 指向的是 ./drizzle（本脚本按它找迁移）。",
    ].join("\n"),
  );
}

const beforeTables = countUserTables();
const beforeApplied = appliedMigrations();
process.stdout.write(
  `[db:migrate] 应用 ${files.length} 份迁移 → ${dbPath}` +
    (beforeTables > 0 ? `（当前 ${beforeTables} 张用户表）` : "（库还不存在 / 是空的）") +
    "\n",
);

/* ── ② 跑迁移 ────────────────────────────────────────────────────────────
 *
 * `stdio: "pipe"` 而不是 `inherit`：既要让调用方看到进度，也必须拿到文本 ——
 * 下面判「drizzle 有没有说它启动了」要用（`inherit` 下 stdout 是空的，判据会
 * 静默失效，比不判更糟，与 db-push-core.mjs 同一条理由）。 */
const run = runPnpmSync(["exec", "drizzle-kit", "migrate"], {
  cwd: root,
  stdio: "pipe",
  timeoutMs: 600_000,
});
const output = `${run.stdout}\n${run.stderr}`;
process.stdout.write(run.stdout);

/* ── ③ 复核（**不看退出码**）────────────────────────────────────────────
 *
 * 退出码在这条链路上不可信（实测：先把库建成 0 字节、再退 1）。判据取库里
 * 的真事实，两条同时成立才算迁移落地：
 *   · 用户表数 > 0（表建起来了）；
 *   · 账本里的已应用条数 == 迁移文件数（**每一份都应用了**，不是"应用了一部分"）。
 *
 * 第二条是这一路独有的、也是它比 push 那一版更强的地方：迁移有账本，
 * 「应用了几份」是精确可查的，不像 diff 只能说"看起来一致了"。 */
const afterTables = countUserTables();
const afterApplied = appliedMigrations();
const started =
  /applying migrations/i.test(output) || /migrations applied/i.test(output);

if (afterTables <= 0) {
  const hint = run.error
    ? `起 pnpm 失败（${run.error.code ?? "UNKNOWN"}）：${run.error.message ?? ""}`
    : started
      ? "drizzle-kit 说它在应用迁移，但库里一张用户表都没有 —— 语句没落地（写锁 / 库不可写 / 路径不一致）。"
      : "drizzle-kit 没走到应用迁移那一步（输出见上），且库里一张用户表都没有。";
  fail(
    [
      hint,
      "",
      `库文件：${dbPath}（${fs.existsSync(dbPath) ? `${fs.statSync(dbPath).size} 字节` : "不存在"}）`,
      "",
      "可行动作：",
      "  · 确认 drizzle.config.ts 的 dbCredentials.url 与 DATABASE_URL 指向同一个库；",
      "  · 手工重跑看完整输出：pnpm exec drizzle-kit migrate",
      "  · 迁移 SQL 本身有错时（改过 schema.ts 却忘了重新 generate）先 pnpm db:generate；",
      "  · 库不可写 / 被别的进程占着写锁时先停掉那个进程。",
    ].join("\n"),
  );
}

if (afterApplied !== files.length) {
  fail(
    [
      `迁移没应用全：drizzle/ 里有 ${files.length} 份，账本里记了 ${afterApplied} 份。`,
      "",
      "这不是「差一点」——drizzle 的账本是**逐条**记的，条数不等说明中途停了",
      "（语句报错 / 库被占用 / 进程被杀）。库里现在的结构可能是半途状态，",
      "**别直接起应用**。",
      "",
      "可行动作：",
      "  · 手工重跑：pnpm exec drizzle-kit migrate（它从账本断点继续，可重入）；",
      "  · 反复失败时看它报的是哪一份迁移，直接读 drizzle/<那份>.sql；",
      "  · 库是崭新的话，删掉重跑比修半途状态快。",
    ].join("\n"),
  );
}

process.stdout.write(
  `[db:migrate] ✓ 用户表 ${afterTables} 张，账本已记 ${afterApplied}/${files.length} 份迁移\n`,
);

/* ── ④ 提示与 push 的分工（不替代它）──────────────────────────────────────
 *
 * 两条路都能把库带到「与 schema 一致」，差别是**有没有账**：push 按 diff 同步、
 * 不留痕迹（适合本地开发快速对齐）；migrate 按文件逐条应用、留下账本（适合
 * 任何"要能说清这个库是怎么变成现在这样"的场合）。不在这里自动二选一 ——
 * 那等于替用户决定他的库要不要留账（同 db-push.mjs 不替用户决定丢不丢数据）。 */
if (beforeApplied === 0 && afterApplied === files.length) {
  process.stdout.write(
    "[db:migrate] 这是这个库的第一次迁移（账本从空到满）—— 后续 schema 变更走\n" +
      "             `pnpm db:generate` 生成新迁移 + 本命令应用；只要快、不要账的可继续用 db:push。\n",
  );
}
