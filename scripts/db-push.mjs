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

import { runPnpmSync } from "./launcher-core/shell.mjs";

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

// pnpm 的可执行形态由 shell.mjs 一处判定（规范 §2.1.1 / §9.5）：写死 `pnpm`
// 在 Windows 上选中的是 Node 起不来的形态，而 `status` 会是 null —— 本脚本刻意
// 不看退出码，于是「命令没起来」会被下面那句「库里表数为 0」的复核捕获并报成
// 「drizzle-kit 无 TTY」的误导现场（ISSUE #638 同族）。
const result = runPnpmSync(["exec", "drizzle-kit", "push", "--force"], {
  cwd: root,
  stdio: "inherit",
  timeoutMs: 600_000,
});

// 注意：这里**刻意不看 result.status**。drizzle-kit 在无 TTY 上正是「报错但
// exit 0」，退出码在这条链路上不是事实来源；下面直接查库。
const tables = countUserTables();
if (tables <= 0) {
  const hint = result.error
    ? `起 pnpm 失败（${result.error.code ?? "UNKNOWN"}）：${result.error.message}；实际命令：${result.command} ${result.args.join(" ")}。`
    : result.status === 0
      ? "drizzle-kit 报告成功，但库里的用户表数为 0 —— 典型的「无 TTY 交互提示被静默吞掉」。"
      : `drizzle-kit 退出码 ${result.status ?? "?"}，且库里的用户表数为 0。`;
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

process.stdout.write(`[db:push] ✓ 用户表 ${tables} 张，schema 已就绪\n`);
