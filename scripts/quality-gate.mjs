#!/usr/bin/env node
/**
 * quality-gate.mjs — 本地质量门禁的**跨平台**实现（规范 11.12 / 13.5）
 *
 * 与 `scripts/quality-gate.ps1` 同契约同产出：按顺序跑 typecheck / eslint（零警告）
 * / vitest（默认排除已知基线失败），任一失败以非零退出码结束，并打印可行动的中文提示。
 * Windows 侧的双击入口（`tools/start/verify-quality.ps1`）走 `.ps1`；Linux / macOS / CI
 * 直接跑本文件（`pnpm check:all`），不需要 pwsh。
 *
 * 为什么不把口令写进文档让人手敲：门禁是**多步串联**（三条命令 + 依赖一致性预检 +
 * 已知基线失败排除）。写成文档就有「漏跑一步 / 顺序反了 / 只跑了自己记得的那个」的
 * 空间，而这些都不会报错——只是让绿灯变得不可信（规范 §9.2 第 3 条禁止的静默失败）。
 *
 * 用法：
 *   node scripts/quality-gate.mjs                # 全部
 *   node scripts/quality-gate.mjs --mode lint    # 只跑一项
 *   node scripts/quality-gate.mjs --mode all     # 显式全部
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { spawnSync } from "node:child_process";

import { diffLockfiles, isEmptyDiff } from "./lockfile/lock-diff.mjs";
import { renderDriftReport } from "./lockfile/render-lock-diff.mjs";
import { whichCommand } from "./launcher-core/shell.mjs";
import { KNOWN_FAILED_FILES } from "./quality-gate-shared.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

/** 门禁清单：与 quality-gate.ps1 的 $Blocks 一一对应（新增门禁两处同步）。 */
const GATES = {
  typecheck: { label: "Typecheck (tsc --noEmit)", args: ["typecheck"] },
  lint: {
    label: "ESLint zero error / zero warning",
    args: ["exec", "eslint", ".", "--max-warnings", "0"],
  },
  /**
   * 格式棘轮（规范 §13.5 / ISSUE #575 第 9 项）。
   *
   * 放在一键门禁里，是因为它是**唯一一条会随时间变坏**的检查：其余命令当日跑过
   * 就是过了，而格式棘轮要求「你今天新增的文件必须干净」。只写在 pre-commit 里
   * 的话，用 `--no-verify` 或被未启用钩子的检出提交就绕过去了 —— 那恰好是它要防的。
   */
  format: { label: "Prettier format ratchet", args: ["../scripts/check-format.cjs"] },
  test: { label: "Vitest full run (excluding known baseline failures)", args: ["exec", "vitest", "run"] },
};

function parseArgs(argv) {
  const out = { mode: "all" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--mode") out.mode = argv[++i] || "all";
  }
  return out;
}

function info(msg) {
  console.log(`[INFO] ${msg}`);
}

function fail(msg) {
  console.error(`[ERROR] ${msg}`);
}

/**
 * 依赖一致性预检（ISSUE #550）。
 *
 * 拉取更新若新增/删改了依赖却没重跑 `pnpm install`，node_modules 会与 lockfile
 * 脱节：typecheck / eslint / vitest 各自抛一串晦涩的解析失败，人容易误以为是自己
 * 改坏了。这里先拦一道，并把差异**逐项**打印（只报「不一致」等于把定位成本全推走）。
 */
function dependencyDrift() {
  const nm = path.join(ROOT, "node_modules");
  if (!fs.existsSync(nm)) return { drift: true, reason: "node_modules 完全没装过" };
  const installedLock = path.join(nm, ".pnpm", "lock.yaml");
  const rootLock = path.join(ROOT, "pnpm-lock.yaml");
  if (!fs.existsSync(installedLock)) {
    return { drift: true, reason: "没有 node_modules/.pnpm/lock.yaml（install 中断或残缺）" };
  }
  if (!fs.existsSync(rootLock)) return { drift: false, reason: "" };
  const diff = diffLockfiles(
    fs.readFileSync(installedLock, "utf8"),
    fs.readFileSync(rootLock, "utf8"),
  );
  return { drift: !isEmptyDiff(diff), diff };
}

/** 跑一条门禁；返回退出码。 */
/** 解析要用的 pnpm（Windows 上认 PATHEXT，`spawn("pnpm")` 会 ENOENT）。 */
function resolvePnpm() {
  const pnpm = whichCommand("pnpm");
  if (pnpm) return pnpm;
  fail("未找到 pnpm 命令（需 corepack enable）。");
  console.log("        修复：corepack enable && corepack prepare pnpm@<packageManager 版本> --activate");
  return null;
}

function runGate(pnpm, key) {
  const gate = GATES[key];
  // 门禁脚本是 `node scripts/xxx.cjs` 而不是 pnpm 子命令：用 node 直接跑，
  // 免得再套一层 pnpm exec（那层只带来解析开销与 Windows 的 .cmd 差异）。
  if (gate.args[0]?.endsWith(".cjs")) {
    const script = path.resolve(ROOT, "scripts", path.basename(gate.args[0]));
    console.log("");
    console.log(`==> ${gate.label}`);
    console.log(`>>> node scripts/${path.basename(script)}`);
    const r = spawnSync(process.execPath, [script, ...gate.args.slice(1)], {
      cwd: ROOT,
      stdio: "inherit",
      windowsHide: true,
    });
    const code = r.status ?? 1;
    if (code === 0) console.log(`  [OK] ${gate.label} passed`);
    else console.log(`  [FAIL] ${gate.label} failed (exit ${code})`);
    return code;
  }
  const args = [...gate.args];
  if (key === "test") {
    for (const f of KNOWN_FAILED_FILES) {
      console.log(`  skip known failure: ${f}`);
      args.push("--exclude", f);
    }
  }
  console.log("");
  console.log(`==> ${gate.label}`);
  console.log(`>>> pnpm ${args.map((a) => `"${a}"`).join(" ")}`);
  const result = spawnSync(pnpm, args, { cwd: ROOT, stdio: "inherit", windowsHide: true });
  const code = result.status ?? 1;
  if (code === 0) console.log(`  [OK] ${gate.label} passed`);
  else console.log(`  [FAIL] ${gate.label} failed (exit ${code})`);
  return code;
}

function main() {
  const { mode } = parseArgs(process.argv.slice(2));
  const keys = mode === "all" ? Object.keys(GATES) : [mode];
  for (const k of keys) {
    if (!GATES[k]) {
      fail(`未知门禁：${mode}（可选：${Object.keys(GATES).join(" / ")} / all）`);
      return 2;
    }
  }

  const drift = dependencyDrift();
  if (drift.drift) {
    console.log("");
    console.log("==> 依赖一致性预检");
    fail(`依赖与 pnpm-lock.yaml 不一致（${drift.reason}）。`);
    if (drift.diff) {
      console.log("  差异明细（仓库 pnpm-lock.yaml 对比最近一次安装时的 lockfile）：");
      for (const line of renderDriftReport(drift.diff, { maxPerSection: 8 })) console.log(line);
    }
    console.log("        请先关闭所有正在运行的本项目窗口（dev server 会锁住原生模块），");
    console.log("        然后在项目根目录执行：pnpm install");
    console.log("        详见 docs/guides/sync-after-pull.md");
    console.log("");
    return 1;
  }

  const pnpm = resolvePnpm();
  if (!pnpm) return 1;

  let exitCode = 0;
  for (const k of keys) {
    const code = runGate(pnpm, k);
    if (code !== 0) exitCode = code;
  }
  console.log("");
  if (exitCode === 0) console.log("All quality gates passed OK");
  else fail("Quality gates have failures; please fix and re-run.");
  return exitCode;
}

process.exit(main());
