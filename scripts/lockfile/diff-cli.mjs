#!/usr/bin/env node
/**
 * cli.mjs — `node scripts/lockfile/cli.mjs` 命令行入口（被 .ps1 入口调用）。
 *
 * 用法：
 *   node scripts/lockfile/cli.mjs --installed <安装时的 lockfile> --root <仓库根>
 *        [--max-per-section N] 可选
 *
 * 退出码：0 两份一致；1 存在实质差异；2 参数/读取错误。
 * 正文只用 ASCII（Windows 控制台代码页，见 AGENTS 硬规则 11）。
 */
import fs from "node:fs";
import path from "node:path";
import { diffLockfiles, isEmptyDiff } from "./lock-diff.mjs";
import { renderDriftReport } from "./render-lock-diff.mjs";

function parseArgs(argv) {
  const out = { installed: "", root: process.cwd(), maxPerSection: 8 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--installed") out.installed = argv[++i] || "";
    else if (a === "--root") out.root = argv[++i] || "";
    else if (a === "--max-per-section") out.maxPerSection = Number(argv[++i]) || 8;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const rootLock = path.join(args.root, "pnpm-lock.yaml");
if (!args.installed || !fs.existsSync(args.installed)) {
  console.error(`[lock-diff] 找不到「安装时 lockfile」：${args.installed || "(未提供 --installed)"}`);
  process.exit(2);
}
if (!fs.existsSync(rootLock)) {
  console.error(`[lock-diff] 找不到仓库 lockfile：${rootLock}`);
  process.exit(2);
}

const oldText = fs.readFileSync(args.installed, "utf8");
const newText = fs.readFileSync(rootLock, "utf8");
const diff = diffLockfiles(oldText, newText);
if (isEmptyDiff(diff)) {
  console.log("[lock-diff] 两份 lockfile 实质一致（差异仅在注释/空行/条目顺序）。");
  process.exit(0);
}
for (const line of renderDriftReport(diff, { maxPerSection: args.maxPerSection })) {
  console.log(line);
}
process.exit(1);
