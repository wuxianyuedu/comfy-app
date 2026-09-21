#!/usr/bin/env node
// 数据库 schema 同步入口（`pnpm db:push`）。
//
// 为什么不能直接 `drizzle-kit push`：它在需要交互确认时会**静默失败**——
// `drizzle-kit push` 遇到「要丢数据/重建表」的语句会弹交互提示，而在无 TTY
// 环境（CI、脚本、远程会话、容器）里它报
// `Interactive prompts require a TTY terminal` 后 **exit 0**，并把
// `db.sqlite` 留成 **0 字节**（一张表都没有）。调用方（尤其照着文档
// `pnpm db:push && pnpm dev` 走的人）看到的是「成功」，随后应用起来
// `/`、`/api/health` 都 200，只有真实业务路由 500（`no such table`）——
// 属规范 §9.2 第 3 条明令禁止的「静默失败」，比抛错难查得多。
//
// 本脚本做三件事：
//   1. 以 `--force` 运行（无交互、幂等：已有 schema 时输出 No changes detected）；
//   2. **复核结果**——不看退出码，看库里到底有没有表（退出码在这条链路上不可信）；
//   3. 复核失败即**非零退出并打印可行动提示**，绝不把「留了个空库」当成功。
//
// 关于 `--force`：它的语义是「自动批准会丢数据的语句」（drop column / 重建表
// 等）。首次建表与增量加表都没有丢数据的语句，无风险；但**当 schema 变更需要
// 丢弃既有数据时它会直接执行而不询问**——那时请先在副本上确认，或改用
// `pnpm db:generate` + `pnpm db:migrate` 审阅 SQL 后再应用（见
// docs/standards/launch-and-build.md §9.1）。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { pushSchema } from "./db-push-core.mjs";
import {
  schemaFingerprint,
  writeSchemaFingerprint,
} from "./db-schema-state.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** 与 `src/server/db.ts::resolveDbPath` / `src/lib/db-schema-ready.ts` 同一锚点：
 *  `DATABASE_URL` 去 `file:` 前缀后相对**进程 CWD**（也就是项目根）解析。 */
function resolveDbPath() {
  const url = process.env.DATABASE_URL ?? "file:./db.sqlite";
  const raw = url.startsWith("file:") ? url.slice("file:".length) : url;
  return path.resolve(root, raw);
}

const dbPath = resolveDbPath();

/** 数一遍库里的用户表（排除 sqlite 内部表）。读不到/不是库 → -1。 */
function countUserTables() {
  if (!fs.existsSync(dbPath)) return -1;
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true, open: true });
    try {
      const row = db
        .prepare(
          "SELECT count(*) AS c FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
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

function fail(message) {
  process.stderr.write(`\n[db:push] ✗ ${message}\n\n`);
  process.exit(1);
}

process.stdout.write(`[db:push] 同步 schema → ${dbPath}\n`);

/* pnpm 的可执行形态由 shell.mjs 一处判定（规范 §2.1.1 / §9.5）；「跑一次并
 * 复核它真的落地」收在 `db-push-core.mjs` —— 启动链路的按需同步用同一份，
 * 判据不会分叉（写死 `pnpm` 在 Windows 上会选中 Node 起不来的形态，而本脚本
 * 刻意不看退出码，于是「命令没起来」会被下面那句「库里表数为 0」的复核捕获，
 * 报成一句与真相无关的「drizzle-kit 无 TTY」，ISSUE #638 同族）。
 *
 * `--force` 是本命令的既定口径（自动批准「会丢数据」的语句）——启动链路刻意
 * **不**沿用它，见 db-schema-state.mjs 的 `ensureSchemaCurrent`。 */
const result = pushSchema(root, { force: true });

/* 注意：这里**刻意不看 drizzle-kit 的退出码**。它在无 TTY 上正是「报错但
 * exit 0」，退出码在这条链路上不是事实来源；下面直接查库。 */
const tables = countUserTables();
if (tables <= 0) {
  const hint = result.invocationFailed
    ? `起 pnpm 失败（${result.error?.code ?? "UNKNOWN"}）：${result.error?.message ?? ""}`
    : result.blockedByTty
      ? "drizzle-kit 报「Interactive prompts require a TTY terminal」——交互提示被静默吞掉，库原样没动。"
      : "drizzle-kit 没走到 diff 那一步（输出见上），且库里的用户表数为 0。";
  fail(
    [
      hint,
      "",
      `库文件：${dbPath}（${fs.existsSync(dbPath) ? `${fs.statSync(dbPath).size} 字节` : "不存在"}）`,
      "",
      "可行动作：",
      "  · 确认 drizzle.config.ts 的 dbCredentials.url 与 DATABASE_URL 指向同一个库；",
      "  · 手工重跑看完整输出：pnpm exec drizzle-kit push --force",
      "  · schema 有语法/引用错误时先修 src/server/db/schema.ts 再重跑。",
    ].join("\n"),
  );
}

process.stdout.write(`[db:push] ✓ 用户表 ${tables} 张\n`);

/* ── 复核二：表**结构**是否真的与 schema 一致 ────────────────────────────
 *
 * 「有表」不等于「表就是 schema 说的那一张」。实测现场：库里的
 * `workflowTemplate` 留着历史版本删过的 `graph TEXT NOT NULL`，于是新建工作流
 * 直接 `NOT NULL constraint failed: workflowTemplate.graph` —— 而上面那条
 * 「表数 > 0」的复核一路绿灯，`probeSchemaSync` 也只判「表建没建」，同样说
 * ready。用户看到的是一句数据库报错，所有自检都说没问题。
 *
 * 判据（跑了第二次仍不是 `No changes detected`）收在 `db-push-core.mjs`。 */
if (!result.converged) {
  fail(
    [
      "drizzle-kit 两次都报告有变更：第一次的语句没有全部落地，表结构与 schema 仍不一致。",
      "",
      `库文件：${dbPath}`,
      "",
      "第二次输出的尾部：",
      ...result.finalOutput
        .trim()
        .split("\n")
        .slice(-12)
        .map((line) => `  ${line}`),
      "",
      "可行动作：",
      "  · 手工重跑看完整输出：pnpm exec drizzle-kit push --force",
      "  · 按签名里的表名核对库里的实际列（PRAGMA table_info(<表名>)），与",
      "    src/server/db/schema.ts 对齐后再重跑；",
      "  · 确认没有另一个进程（dev server）长时间占着写锁。",
    ].join("\n"),
  );
}

process.stdout.write(`[db:push] ✓ schema 已收敛（无待应用变更）\n`);

/* ── 登记 schema 指纹 ────────────────────────────────────────────────────
 *
 * 启动链路（dev / start / 启动器）靠这个数判断「库是不是当前这版 schema 建的」，
 * 好让「拉了含 schema 变更的代码后忘了跑 db:push」不再依赖人记得
 * （见 db-schema-state.mjs 的 `ensureSchemaCurrent`）。
 *
 * 登记失败**不算错**：最坏的后果只是启动时多跑一次 diff（那次会说
 * No changes detected），所以这里只提示不退出。 */
const fingerprint = schemaFingerprint(root);
if (fingerprint === null) {
  process.stdout.write(
    "[db:push] ⚠ 读不到 src/server/db/*.ts，跳过指纹登记（启动时会多跑一次 diff）\n",
  );
} else if (writeSchemaFingerprint(root, undefined, fingerprint)) {
  process.stdout.write(`[db:push] ✓ 已登记 schema 指纹 ${fingerprint}\n`);
} else {
  process.stdout.write(
    "[db:push] ⚠ 指纹登记失败（库不可写 / 被占用）——启动时会多跑一次 diff\n",
  );
}
