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
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const D = require("better-sqlite3");

const root = path.join(__dirname, "..");
const dbPath = path.join(root, "db.sqlite");

function clearTempTables() {
  if (!fs.existsSync(dbPath)) return;
  const db = new D(dbPath);
  const tbls = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '__new_%'")
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
  // 用 cmd /c 包裹，与 dev-launcher.ps1 一致（Windows 下 pnpm 是 .cmd）
  return spawnSync("cmd", ["/c", "pnpm", "exec", "drizzle-kit", "push", "--force"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 1 << 26,
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
    "i"
  );
  const tblMatch = out.match(re);
  if (!tblMatch) return false;
  const table = tblMatch[1];
  const db = new D(dbPath);
  const cur = new Set(
    db.prepare('PRAGMA table_info("' + table + '")').all().map((c) => c.name)
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
        "CREATE " + unique + 'INDEX IF NOT EXISTS "' + idx + '" ON "' + tbl + '" (' + cols + ")"
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

clearTempTables();
let res = runPush();
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
