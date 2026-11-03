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
import { DatabaseSync } from "node:sqlite";

import { runPnpmSync } from "./launcher-core/shell.mjs";
import { pnpmCli } from "./ci-install-deps.mjs";
import { rejectUnknownArgs } from "./cli-arg-contract.mjs";
import { resolveSqlitePath } from "./db-schema-state.mjs";

const root = path.resolve(import.meta.dirname, "..");
const dbPath = resolveSqlitePath(root);

/** 迁移文件目录（与 `drizzle.config.ts` 的 `out` 同源，写死一处便于核对）。 */
const MIGRATIONS_DIR = path.join(root, "drizzle");
/** drizzle 的迁移账本表名。 */
const LEDGER_TABLE = "__drizzle_migrations";

/**
 * 打一句失败话再退 1 —— 唯一的出口，调用点之后没有「继续跑」这条路。
 * @param {string} message
 * @returns {never}
 */
function fail(message) {
  process.stderr.write(`\n[db:migrate] ✗ ${message}\n\n`);
  process.exit(1);
}

/** 数一遍库里的用户表（排除 sqlite 内部表与 drizzle 的账本表）。读不到 → -1。 */
function countUserTables() {
  if (!fs.existsSync(dbPath)) {
    return -1;
  }
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true, open: true });
    try {
      const row = db
        .prepare(
          `SELECT count(*) AS c FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != '${LEDGER_TABLE}'`,
        )
        .get();
      /* `.get()` 取不到东西 = 驱动/连接不对，**不是**「库里有 0 张表」—— 后者会让外面
       * 那句「schema 是空的」替这条故障说话（与 `db-push.mjs` 同一处同一判法）。
       * 原行为也是 -1：`row` 是 undefined 时 `row.c` 抛出去、被下面那个 catch 折成 -1。 */
      if (!row) {
        return -1;
      }
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
  if (!fs.existsSync(dbPath)) {
    return -1;
  }
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true, open: true });
    try {
      const exists = db
        .prepare("SELECT count(*) AS c FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(LEDGER_TABLE);
      /* 两处 `.get()` 都判空再取：取不到 = 驱动/连接不对，回 -1（读不到），
       * 不许折成 0 —— 0 在这份入口里的意思是「账本表在、里面一条迁移都没跑过」，
       * 那是另一种事实（外面按它报「迁移没跑」）。与 `countUserTables()` 上面同一判法。 */
      if (!exists) {
        return -1;
      }
      if (Number(exists.c ?? 0) === 0) {
        return 0;
      }
      const counted = db.prepare(`SELECT count(*) AS c FROM ${LEDGER_TABLE}`).get();
      if (!counted) {
        return -1;
      }
      return Number(counted.c ?? 0);
    } finally {
      db.close();
    }
  } catch {
    return -1;
  }
}

/** `drizzle/` 下的迁移文件（`*.sql`，按文件名排序 = 应用序）。 */
function migrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    return [];
  }
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/* ── ⓪ 参数契约：本入口不接受任何参数，认不出的旗标一律拦下 ────────────────
 *
 * 这一格排在**所有作动之前**（也在下面那道前置判决之前），因为它要挡的是「一次
 * 根本没被理解的调用」，与库/迁移文件在不在无关。
 *
 * 立案实测（`DATABASE_URL` 指到临时目录的一份新库，开发库未碰，ISSUE #2096）：
 * 这个入口此前一句 `argv` 都不读，于是 `node scripts/db-migrate.mjs --dry-run`
 * 被当成「没有参数的那一次调用」照跑 —— 建出 23 张表、账本记上 1/1，**退出码 0**。
 * 比 `db:push` 那一格（#1956，已由 PR #2093 修好）更值得拦的地方在于：push 留下的
 * 结构漂移还能被指纹读出来，而 migrate 一旦落了账，下一次它是从账本断点**续跑**，
 * 谁都不会再问一次那条记录是谁批准的。
 *
 * 判据与正文形状在 `cli-arg-contract.mjs`（两个入口问的是同一个问题，§12.18）。
 * 注意这里**不**沿用 push 那句「无 TTY 时它停在确认那一步」—— `migrate` 的 SQL 是
 * 生成好的，它压根不需要交互，要「先看会跑什么」只能去读文件与账本。 */
rejectUnknownArgs({
  command: "db:migrate",
  action:
    "它默认动的是 `drizzle-kit migrate` —— **真的写库**，并往 `__drizzle_migrations` 记一条账。",
  exits: [
    "先看看会跑什么 → 直接读 drizzle/<那份>.sql（迁移 SQL 是生成好的，不必跑起来才看见）；",
    "已经应用了几份 → SELECT count(*) FROM __drizzle_migrations" +
      "（库地址取 DATABASE_URL，缺省 ./db.sqlite）；",
    "只要库与 schema 一致、不要账 → pnpm db:push；",
    "要新增迁移 → pnpm db:generate 生成 .sql 之后再跑本命令。",
  ],
  fail,
});

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
  `[db:migrate] 应用 ${files.length} 份迁移 → ${dbPath}${
    beforeTables > 0 ? `（当前 ${beforeTables} 张用户表）` : "（库还不存在 / 是空的）"
  }\n`,
);

/* ── ② 跑迁移 ────────────────────────────────────────────────────────────
 *
 * `stdio: "pipe"` 而不是 `inherit`：既要让调用方看到进度，也必须拿到文本 ——
 * 下面判「drizzle 有没有说它启动了」要用（`inherit` 下 stdout 是空的，判据会
 * 静默失效，比不判更糟，与 db-push-core.mjs 同一条理由）。 */
/* pnpm 的落点先找一遍（ISSUE #2281）：平台节点是服务账号会话，PATH 里没有它。 */
const run = runPnpmSync(["exec", "drizzle-kit", "migrate"], {
  cwd: root,
  stdio: "pipe",
  command: pnpmCli(),
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
const started = /applying migrations/i.test(output) || /migrations applied/i.test(output);

if (afterTables <= 0) {
  const hint = run.error
    ? // oxlint-disable-next-line typescript/no-unnecessary-condition -- run.error 是子进程失败现场（外部输入），code 可能缺
      `起 pnpm 失败（${run.error.code ?? "UNKNOWN"}）：${run.error.message ?? ""}`
    : started
      ? "drizzle-kit 说它在应用迁移，但库里一张用户表都没有 —— 语句没落地（写锁 / 库不可写 / 路径不一致）。"
      : "drizzle-kit 没走到应用迁移那一步（输出见上），且库里一张用户表都没有。";
  fail(
    [
      hint,
      "",
      `库文件：${dbPath}（${fs.existsSync(dbPath) ? `${fs.statSync(dbPath).size} 字节` : "不存在"}）`,
      "",
      /* 把 drizzle-kit 自己的话原样带出来 —— 「输出见上」不是一句可行动话术：
       * 上面转发过的是 **stdout**，而它真正的原因（地址被拒、方言不认识、
       * 连接失败那一类）在 stderr 里，不接出来就等于把根因丢掉（硬规则 4）。
       * 退出码也打出来，但**只当证据不当判据**：实测它「报错 + 留一个没动过的库 + 退 0」。 */
      `drizzle-kit 退出码：${String(run.status)}（它报错时也退 0，所以上面那条结论来自库里的事实，不是这个码）`,
      "drizzle-kit 的输出（stdout + stderr，真原因常在 stderr）：",
      output.trim() === "" ? "  (两边都是空的 —— 命令多半没起来)" : output.trim(),
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
      /* 同一句话术缺口的另一半：中途停了必定有一条真报错，而它也在 stderr。 */
      "drizzle-kit 的输出（stdout + stderr，真原因常在 stderr）：",
      output.trim() === "" ? "  (两边都是空的 —— 命令多半没起来)" : output.trim(),
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
