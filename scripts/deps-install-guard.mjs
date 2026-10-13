#!/usr/bin/env node
/**
 * deps-install-guard.mjs —— 「现在能不能安全地跑 pnpm install」（AGENTS 硬规则 9）
 *
 * 判据本身**不在这里**：它复用 `launcher-core/port-reap.mjs` 的
 * `runningAppInstances()`，与编排器补装路径（`launcher-core/downstream.mjs` 的
 * `syncDependencies`）同一个实现。本文件只是那条判据的**命令行出口**，给
 * 「人不经过编排器直接装依赖」的那条路用（Windows 双击 `tools/start/sync-lint.ps1`）。
 *
 * 为什么需要单独一个入口：那条路上没有任何一方会替我问这句 —— 编排器的端口检查
 * 排在补装之后，而 `reapStaleSession` 在「上一位 launcher 还活着」时刻意不动。
 * 两侧各写一遍端口探测的形态这里也一并收掉：`.ps1` 里那份 `Get-NetTCPConnection`
 * 既判不出归属（隔壁检出占着同一个端口并不算锁住本检出的 `node_modules`），
 * 又是「同一件事在两个平台各有一份实现」（规范 §9 / §9.5）。
 *
 * 用法：node scripts/deps-install-guard.mjs
 * 退出码：0 = 没有本检出的实例在跑，可以装；1 = 有实例在跑（已打印 PID 与出口）。
 */
import process from "node:process";

import { resolveRepoRoot } from "./app-port.mjs";
import { runningAppInstances } from "./launcher-core/port-reap.mjs";

const root = resolveRepoRoot();
const live = await runningAppInstances(root);

if (!live.running) {
  console.log("✓ 本检出没有正在运行的应用服务，可以执行 pnpm install。");
  process.exit(0);
}

const who =
  live.pids.length > 0
    ? `PID ${live.pids.join(", ")}`
    : "见 run/launcher-session.json";
console.error(
  `本检出的应用服务正在运行（${who}，经由 ${live.via}）—— 现在执行 pnpm install 会因原生模块` +
    "（`.node`）被进程锁定而 EPERM 连锁失败，并拖垮后续每一条 pnpm 命令（AGENTS 硬规则 9）。",
);
console.error(
  "出口：先关掉本检出的应用窗口（或停掉正在跑的 `pnpm dev`），再重新执行本入口。",
);
process.exit(1);
