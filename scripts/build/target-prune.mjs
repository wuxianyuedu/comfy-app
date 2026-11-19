#!/usr/bin/env node
/**
 * target-prune.mjs — Rust 构建产物（`src-tauri/target`）的清理入口。
 *
 * ## 为什么需要它
 *
 * `node_modules` 那一侧有 `pnpm deps:prune`，`target` 这一侧没有：debug + release
 * 两份产物全量常驻、只增不减，开发盘被吃到剩余 0.48GB 时 `cargo test` 直接死在
 * `error: failed to build archive at ...: 磁盘空间不足。(os error 112)`——看着像
 * 判据红，其实是机器没空间（#4489 的现场）。本入口把「清哪一层」收成一条有名字
 * 的命令（规范 §12.20）：
 *
 * · 默认        —— 只清各 profile 的 `incremental/`（最大头；删了只影响下一次
 *                  编译速度，不影响正确性）；
 * · `--release` —— 连 release 产物整棵一起清（壳 exe / bundle 中间物；下一次
 *                  `cargo build --release --features custom-protocol` 现重建）；
 * · `--all`     —— 整棵 `target/`（= `cargo clean`；下一次构建全量重编）。
 *
 * ## 安全栏
 *
 * · 删除目标必须落在 `<repo>/src-tauri/target` 之内（`path.relative` 判界，
 *   越界即红退 1），任何拼路径形态都不许把范围放大；
 * · 纯 Node 删目录，不调 cargo（与 deps:prune 同款，不引入第二套工具链依赖）；
 * · 删不掉（Windows 上常见：产物被编辑器 / 常驻进程占用）逐条点名，落「红」
 *   不静默吞掉。
 *
 * 用法：`pnpm target:prune [--release] [--all] [--dry-run]`
 * 退出码：0 收干净 / 1 有事实是红的（删不掉、越界）/ 2 用法错或前置不成立。
 */
import { existsSync, rmSync, statfsSync } from "node:fs";
import path from "node:path";

import { dirSize, humanSize, unknownDetail as detail } from "../lib/dir-size.mjs";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const TARGET_DIR = path.join(ROOT, "src-tauri", "target");

const EXIT = { OK: 0, RED: 1, NOT_RUN: 2 };
const TAG = "[target-prune]";
/** 清单最多逐条念多少行；其余只给总数。 */
const LIST_LIMIT = 20;
const KNOWN_FLAGS = new Set(["--release", "--all", "--dry-run"]);

/**
 * 磁盘可用余量（非特权进程视角 `bavail`）；量不到（旧 Node / 异常文件系统）给
 * `null`，调用方跳过这一行读数——「量不到」不是「清完了」。
 * @param {string} at
 */
function freeBytes(at) {
  try {
    const fs = statfsSync(at);
    if (typeof fs.bavail === "number" && typeof fs.bsize === "number") {
      return fs.bavail * fs.bsize;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 按旗标摆清理计划：`--all` 一项；否则各 profile 的 incremental（`--release`
 * 时 release 整棵已覆盖它的 incremental，不重复列）。
 * @param {boolean} wantRelease
 * @param {boolean} wantAll
 */
function buildPlan(wantRelease, wantAll) {
  if (wantAll) {
    return [{ label: "target 整棵（= cargo clean，下一次构建全量重编）", abs: TARGET_DIR }];
  }
  const profiles = wantRelease ? ["debug"] : ["debug", "release"];
  const items = [];
  for (const profile of profiles) {
    const incremental = path.join(TARGET_DIR, profile, "incremental");
    if (existsSync(incremental)) {
      items.push({
        label: `${profile}/incremental（增量编译缓存，删了只影响下次编译速度）`,
        abs: incremental,
      });
    }
  }
  if (wantRelease && existsSync(path.join(TARGET_DIR, "release"))) {
    items.push({
      label: "release 产物整棵（壳 exe / bundle 中间物，按硬规则 5 现重建）",
      abs: path.join(TARGET_DIR, "release"),
    });
  }
  return items;
}

function printUsage() {
  console.log(
    [
      "用法：pnpm target:prune [--release] [--all] [--dry-run]",
      "",
      "  清 src-tauri/target 的 Rust 构建产物。cargo test/build 撞「磁盘空间不足",
      "  (os error 112)」时先跑它腾地方，别照着红改代码。",
      "",
      "  （默认）      只清 debug/release 的 incremental 增量编译缓存",
      "  --release    连 release 产物整棵一起清（壳 exe，下次现重建）",
      "  --all        整棵 target（= cargo clean，下次构建全量重编）",
      "  --dry-run    只列出会删什么与各占多少，一个都不删",
      "  --help       打印这份说明",
      "",
      "  退出码：0 收干净 / 1 有事实是红的（删不掉、越界）/ 2 用法错或前置不成立",
    ].join("\n"),
  );
}

/**
 * 命令行入口：解析旗标 → 摆计划 → 量盘 → 删除 / 只念清单 → 三态退出码。
 * @param {string[]} argv
 */
function main(argv) {
  if (argv.includes("--help")) {
    printUsage();
    return EXIT.OK;
  }
  const unknown = argv.filter((arg) => !KNOWN_FLAGS.has(arg));
  if (unknown.length > 0) {
    console.error(`${TAG} 未知参数：${unknown.join(" ")}`);
    printUsage();
    return EXIT.NOT_RUN;
  }
  const wantRelease = argv.includes("--release");
  const wantAll = argv.includes("--all");
  const dryRun = argv.includes("--dry-run");
  if (wantAll && wantRelease) {
    console.error(`${TAG} --all 已含 release 产物，不要再给 --release（二选一）。`);
    return EXIT.NOT_RUN;
  }
  if (!existsSync(TARGET_DIR)) {
    console.log(
      `${TAG} ${path.relative(ROOT, TARGET_DIR).split(path.sep).join("/")} 不存在（还没构建过），无可清理。`,
    );
    return EXIT.OK;
  }

  const plan = buildPlan(wantRelease, wantAll);
  if (plan.length === 0) {
    console.log(`${TAG} 没有可清的 incremental 目录${wantRelease ? "（release 也不在场）" : ""}。`);
    return EXIT.OK;
  }
  const freeBefore = freeBytes(ROOT);
  let bytes = 0;
  for (const item of plan) {
    bytes += dirSize(item.abs);
  }
  const dryNote = dryRun ? "（--dry-run：不删）" : "";
  console.log(`${TAG} 计划清理 ${String(plan.length)} 处，合计约 ${humanSize(bytes)}${dryNote}`);
  for (const item of plan.slice(0, LIST_LIMIT)) {
    const rel = path.relative(ROOT, item.abs).split(path.sep).join("/");
    console.log(`  · ${rel} — ${item.label}`);
  }
  if (plan.length > LIST_LIMIT) {
    console.log(`  ……另有 ${String(plan.length - LIST_LIMIT)} 处`);
  }

  const failures = [];
  if (!dryRun) {
    for (const item of plan) {
      /* 删除目标必须仍在这棵 target 之内（`--all` 的目标就是 target 本身，rel === ""）：
       * 路径都来自本文件常量与 readdir，本不该越界，但递归删除之前值得再挡一次。 */
      const rel = path.relative(TARGET_DIR, item.abs);
      const inside = rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
      if (!inside) {
        failures.push({ name: item.label, why: "目标不在 src-tauri/target 之下，已跳过" });
        continue;
      }
      try {
        rmSync(item.abs, { recursive: true, force: true });
      } catch (error) {
        failures.push({
          name: path.relative(ROOT, item.abs).split(path.sep).join("/"),
          why: detail(error),
        });
      }
    }
  }
  const freeAfter = freeBytes(ROOT);
  if (freeBefore !== null && freeAfter !== null) {
    console.log(`${TAG} 磁盘可用：清前 ${humanSize(freeBefore)} → 清后 ${humanSize(freeAfter)}`);
  }

  if (failures.length > 0) {
    console.error(
      `${TAG} 以下 ${String(failures.length)} 处删不掉（Windows 上常见：产物被编辑器 / 常驻进程占用）：`,
    );
    for (const item of failures) {
      console.error(`  · ${item.name} — ${item.why}`);
    }
    console.error(
      `${TAG} 出口：关掉占用它的进程（正在跑的 cargo / 壳）后重跑 \`pnpm target:prune\`；` +
        "判「磁盘不足」与「判据红」是两件事，先腾空间复跑，别照着红改代码。",
    );
    return EXIT.RED;
  }
  if (dryRun) {
    console.log(`${TAG} --dry-run 结束：以上一处都没删。`);
    return EXIT.OK;
  }
  console.log(`${TAG} 已收干净：清掉 ${String(plan.length)} 处。`);
  return EXIT.OK;
}

const invoked = process.argv[1];
if (invoked && path.resolve(invoked) === import.meta.filename) {
  process.exitCode = main(process.argv.slice(2));
}
