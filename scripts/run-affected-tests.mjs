#!/usr/bin/env node
// @ts-nocheck -- 提交门槛脚本：无类型消费方，tsc 面在 src/**
/**
 * run-affected-tests.mjs — 把「固定清单 + 受影响用例」真正起起来的那一步
 *
 * 干什么：调 `scripts/affected-tests.mjs` 拿清单，然后**用 Node 直接 spawn vitest 的
 * ESM 入口**跑完它们，保住钩子原有的两个约定：一次提交只起一次 vite、
 * 钩子档单独用 `--maxWorkers=4`。
 *
 * 为什么要单独有这一层（不是随手加的包装）：清单是**位置参数**拼进命令行的，而
 * `pnpm exec <bin>` 在 Windows 上经 `.cmd` shim —— 那条链的命令行上限是 cmd.exe 的
 * **8191 字符**。实测一次改了 22 个文件的提交，清单是 10840 个字符：vitest 根本没起，
 * stdout 只有一行 GBK 乱码（「文件名或扩展名太长」），钩子的表现是「组 C 失败」
 * 而看不见任何用例名。
 * 这不是「某个用例红」，而是**门禁自己静默失效**的那一类：判据在场、跑的是 0 个用例、
 * 退出码非零但原因读不出 —— 换任何一个改动面更大的提交都会再撞一次。
 *
 * 现在的链路：`node` → `spawnSync(process.execPath, [vitest 入口, …])`，不经 cmd.exe，
 * 上限回到 Win32 `CreateProcess` 的 32767。同时按 `SAFE_ARGV_BUDGET` 预算**分块**：
 * 宁可多起一次 vite，也不许把用例丢掉 —— 「绿但没跑」比慢严重得多（口径同规范
 * §11.13「skip 不作为信号被任何门禁计数」那一族的反面）。
 *
 * 刻意**不做**的事：
 *   · 不在这里算清单 —— 收窄规则的唯一出处仍是 `affected-tests.mjs`，本文件只管启动；
 *   · 不兜「空清单」：空集会让 `vitest run` 不带位置参数跑成**全量**，那是更坏的失效，
 *     所以宁可阻断（与收口前钩子里那句 `if [ -z "$files" ]` 同一口径，只是现在有了名字）。
 */

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * 一次 spawn 的命令行长预算（字符）。
 *
 * `CreateProcess` 的整条命令行上限是 32767，这里取 **24000**：留给 node 自身、
 * vitest 入口、`run --maxWorkers=4` 这些固定段的余量，也避免将来有人在
 * 外面再套一层 shell 时直接顶穿。数字本身不是判据，**「不丢用例」**才是 ——
 * `tests/hook-affected-launch.test.ts` 判的是分块后并集等于输入且每块不超预算。
 */
export const SAFE_ARGV_BUDGET = 24_000;

/** 钩子档的并发（全量 `pnpm test` 仍走 `vitest.config.ts` 里的 8，不受这里影响）。 */
const MAX_WORKERS = 4;

/**
 * 按命令行长预算把清单切成若干块，**顺序与成员都不变**。
 *
 * 单独导出成纯函数是为了让它可判：这条链路的失效模式（用例没跑）只有把
 * 「不丢不重」写成断言才拦得住，靠肉眼看 shell 的引号是拦不住的。
 */
export function planLaunches(files, budget = SAFE_ARGV_BUDGET) {
  const chunks = [];
  let current = [];
  let length = 0;
  for (const file of files) {
    const name = String(file).trim();
    if (!name) continue;
    if (name.length + 1 > budget) {
      throw new Error(
        `[affected-launch] 单个路径就超过命令行长预算（${name.length} > ${budget}）——` +
          "这一条不能被任何分块策略放进去，只能让它点名红",
      );
    }
    // 每段之间要一个空格，按 `join(" ")` 的真实长度算，不留估算余量。
    const next = current.length === 0 ? name.length : length + 1 + name.length;
    if (current.length > 0 && next > budget) {
      chunks.push(current);
      current = [name];
      length = name.length;
      continue;
    }
    current.push(name);
    length = next;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/**
 * 解析 vitest 的 ESM 入口。
 *
 * 走 `require.resolve("vitest/package.json")` 而不是写死 `node_modules/vitest/…`：
 * pnpm 的布局里真身在 `node_modules/.pnpm/vitest@<ver>_…/node_modules/vitest/`，
 * 顶层那个是链接；写死路径会在换版本或换安装方式时指到空气上。
 * 取 `bin.vitest` 的相对段而不是猜文件名，是因为入口名由包自己定义。
 */
export function resolveVitestEntry(cwd = process.cwd()) {
  const require = createRequire(path.join(cwd, "noop.js"));
  const pkgPath = require.resolve("vitest/package.json");
  const pkgDir = path.dirname(pkgPath);
  const bin = JSON.parse(readFileSync(pkgPath, "utf8"))?.bin?.vitest;
  if (typeof bin !== "string") {
    throw new Error(`[affected-launch] vitest 包没有 bin.vitest：${pkgPath}`);
  }
  const entry = path.resolve(pkgDir, bin.replace(/^\.\//, ""));
  if (!existsSync(entry)) {
    throw new Error(`[affected-launch] vitest 入口不存在：${entry}`);
  }
  return entry;
}

/** 调 `affected-tests.mjs` 拿清单（它的 stdout 只有空格分隔的路径一行）。 */
function collectList() {
  const res = spawnSync(
    process.execPath,
    [path.join(process.cwd(), "scripts", "affected-tests.mjs")],
    { encoding: "utf8" },
  );
  if (res.status !== 0) {
    process.stderr.write(res.stderr ?? "");
    throw new Error(
      `[affected-launch] 清单解析失败（退出码 ${res.status ?? "信号"}）`,
    );
  }
  // 清单脚本自己的说明走 stderr，stdout 只有那一行路径；按空白切最稳。
  return String(res.stdout ?? "")
    .split(/\s+/)
    .filter(Boolean);
}

function main(argv) {
  const dryRun = argv.includes("--dry-run");
  const files = collectList();
  if (files.length === 0) {
    process.stderr.write(
      "[affected-launch] affected 解析没给出清单 —— 宁可阻断，" +
        "也不让 vitest 不带位置参数跑成全量\n",
    );
    return 1;
  }
  let chunks;
  try {
    chunks = planLaunches(files);
  } catch (e) {
    process.stderr.write(
      `[affected-launch] ${e instanceof Error ? e.message : String(e)}\n`,
    );
    return 1;
  }
  if (dryRun) {
    process.stdout.write(
      `[affected-launch] ${files.length} 个用例 / ${chunks.length} 次启动，` +
        `最长一块 ${chunks.reduce((m, c) => Math.max(m, c.join(" ").length), 0)} 字符\n`,
    );
    return 0;
  }
  const entry = resolveVitestEntry();
  for (const [index, chunk] of chunks.entries()) {
    if (chunks.length > 1) {
      process.stderr.write(
        `[affected-launch] 第 ${index + 1}/${chunks.length} 块，` +
          `${chunk.length} 个用例（命令行长预算 ${SAFE_ARGV_BUDGET} 字符）\n`,
      );
    }
    const res = spawnSync(
      process.execPath,
      [entry, "run", `--maxWorkers=${MAX_WORKERS}`, ...chunk],
      { stdio: "inherit" },
    );
    if (res.error || res.status !== 0) {
      // 起不来的时候把机制点名，别再留一行读不出来的东西。
      process.stderr.write(
        `[affected-launch] vitest 启动失败：${
          res.error?.message ?? `退出码 ${res.status}`
        }（入口 ${entry}，本块 ${chunk.length} 个用例，命令行约 ` +
          `${chunk.join(" ").length} 字符）\n`,
      );
      return res.status ?? 1;
    }
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  process.exit(main(process.argv.slice(2)));
}
