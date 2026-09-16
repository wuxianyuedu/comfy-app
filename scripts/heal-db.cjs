#!/usr/bin/env node
// @ts-nocheck
// DB schema 自愈脚本（被 scripts/dev-launcher.ps1 的 Sync-DatabaseSchema 调用）。
//
// 背景：drizzle-kit push 在 SQLite 上对「已有表需要变更」会走「建临时表 __new_X → 拷贝
// → 删旧表 → 改名」的重建流程，且会为每个索引各发一条 CREATE INDEX。drizzle-kit 0.31.x
// 在该流程里会把索引语句发两遍（内联约束 + 独立语句），第二遍命中 "index already exists"
// 而中断；若上一次 push 中途失败还会残留 __new_* 临时表，进一步扰乱后续 push。
//
// 本脚本的处理顺序：
//   1) 先清理所有残留 __new_* 临时表；
//   2) 运行 drizzle-kit push --force，捕获其输出；
//   3) 若失败：
//      - 缺列（no such column）→ ALTER 补列（可空 text，本项目新增列均为 json/text）；
//      - 索引已存在（index ... already exists）→ 把 push 计划里的全部 CREATE INDEX 以
//        IF NOT EXISTS 幂等方式补齐到当前表上，使下次 push 无需重建表、不再重复建索引；
//   4) 清理临时表后重试，直至成功或达到尝试上限。
const fs = require("fs");
const path = require("path");
const D = require("better-sqlite3");

// pnpm 可执行形态的唯一判据（scripts/launcher-core/shell.mjs 的 runPnpmSync）。
// 这里曾写 `spawnSync("cmd", ["/c", "pnpm", ...])` —— 那不只是「Windows 专属」，
// 在 POSIX 上 `cmd` 根本不存在（整条自愈路径静默失效）；而 `/c` 又经 shell 语义，
// 「命令没起来」与「push 报错退出」混在一起。判据模块是 ESM，.cjs 用动态 import()。
let runPnpmSync = null;
async function loadShell() {
  if (runPnpmSync) return runPnpmSync;
  ({ runPnpmSync } = await import("./launcher-core/shell.mjs"));
  return runPnpmSync;
}

const root = path.join(__dirname, "..");
const dbPath = path.join(root, "db.sqlite");

function clearTempTables() {
  if (!fs.existsSync(dbPath)) return;
  const db = new D(dbPath);
  const tbls = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '__new_%'",
    )
    .all()
    .map((r) => r.name);
  for (const t of tbls) {
    try {
      db.exec('DROP TABLE IF EXISTS "' + t + '"');
    } catch (e) {
      /* 忽略个别残留表的删除失败 */
    }
  }
  db.close();
}

function runPush() {
  return runPnpmSync(["exec", "drizzle-kit", "push", "--force"], {
    cwd: root,
    timeoutMs: 600_000,
  });
}

function healMissingColumn(out) {
  const colMatch = out.match(/no such column:\s*"?([\w]+)"?/i);
  if (!colMatch) return false;
  const col = colMatch[1];
  const re = new RegExp(
    'INSERT\\s+INTO\\s+[`"]__new_(\\w+)[`"]\\s*\\([\\s\\S]*?\\)\\s*SELECT[\\s\\S]*?[`"]' +
      col +
      '[`"]',
    "i",
  );
  const tblMatch = out.match(re);
  if (!tblMatch) return false;
  const table = tblMatch[1];
  const db = new D(dbPath);
  const cur = new Set(
    db
      .prepare('PRAGMA table_info("' + table + '")')
      .all()
      .map((c) => c.name),
  );
  if (cur.has(col)) {
    db.close();
    return false;
  }
  db.exec('ALTER TABLE "' + table + '" ADD COLUMN "' + col + '" text');
  db.close();
  console.log("[heal] 已为 " + table + " 自动补列 " + col);
  return true;
}

function healIndexes(out) {
  // 提取 push 计划中全部 CREATE [UNIQUE] INDEX "idx" ON "tbl" (cols)，以 IF NOT EXISTS 补齐
  const re =
    /CREATE\s+(UNIQUE\s+)?INDEX\s+[`"]?(\w+)[`"]?\s+ON\s+[`"]?(\w+)[`"]?\s*\(([^)]*)\)/gi;
  let m;
  let changed = false;
  const db = new D(dbPath);
  const seen = new Set();
  while ((m = re.exec(out))) {
    const unique = m[1] ? "UNIQUE " : "";
    const idx = m[2];
    const tbl = m[3];
    const cols = m[4];
    const key = idx + "@" + tbl;
    if (seen.has(key)) continue; // 跳过 drizzle-kit 重复发出的第二条
    seen.add(key);
    try {
      db.exec(
        "CREATE " +
          unique +
          'INDEX IF NOT EXISTS "' +
          idx +
          '" ON "' +
          tbl +
          '" (' +
          cols +
          ")",
      );
      changed = true;
    } catch (e) {
      /* 列不存在等情形忽略，交由下一轮补列后再试 */
    }
  }
  db.close();
  if (changed) console.log("[heal] 已幂等补齐缺失/重复索引");
  return changed;
}

async function main() {
  await loadShell();

  clearTempTables();
  let res = runPush();
  // 「命令压根没起来」必须与「push 报错退出」分开：前者的 stdout/stderr 通常是空的，
  // 下面那轮「按报错自愈」会反复无效重试，最后只说一句「仍失败：」（无内容）。
  // 它在 ISSUE #638 的现场就是 EINVAL —— 起不来的永远是那个命令形态。
  if (res.error) {
    console.error(
      `[heal] 起 pnpm 失败（${res.error.code ?? "UNKNOWN"}）：${res.error.message}\n` +
        `[heal]   实际命令：${res.command} ${res.args.join(" ")}\n` +
        `[heal]   先跑 pnpm check:toolchain 看选中的 pnpm 形态。`,
    );
    process.exit(1);
  }
  let out = (res.stdout || "") + (res.stderr || "");
  let attempts = 0;
  const MAX = 4;
  while (res.status !== 0 && attempts < MAX) {
    const healedCol = healMissingColumn(out); // 先补列，索引才能建得上
    const healedIdx = healIndexes(out);
    if (!healedCol && !healedIdx) break;
    clearTempTables();
    res = runPush();
    out = (res.stdout || "") + (res.stderr || "");
    attempts++;
  }

  if (res.status === 0) {
    console.log("[heal] drizzle-kit push 成功");
    process.exit(0);
  } else {
    console.error("[heal] drizzle-kit push 仍失败：");
    console.error(out.slice(-2000));
    process.exit(1);
  }
}

main();
