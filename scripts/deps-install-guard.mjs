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
 * 退出码三态（判据读不到 ≠ 判过了且没问题，§13.6.3）：
 *   0 = 判据跑完，没有本检出的实例在跑 ⇒ 可以装；
 *   1 = 判据跑完，确实有实例在跑 ⇒ 不许装（已打印 PID 与出口）；
 *   2 = 判据没跑起来 / 读数形状不对 ⇒ **没有结论**，同样不许装。
 *
 * 为什么 2 不并入 0：把「崩了」当成「没有实例在跑」正是 fail-open ——
 * 硬规则 9 那一问等于没问，而人拿到的却是一句「可以装」。
 */
import process from "node:process";

import { resolveRepoRoot } from "./app-port.mjs";
import { runningAppInstances } from "./launcher-core/port-reap.mjs";
import { ProbeUnavailableError } from "./launcher-core/procs.mjs";

const root = resolveRepoRoot();
try {
  const live = await runningAppInstances(root);
  /* 判据经 await 跨模块返回，运行时形状不能只信静态类型：这里漏一次就是
   * 「没有结论」被当成「没有实例在跑」，硬规则 9 当场失效。 */
  if (!live || typeof live.running !== "boolean" || !Array.isArray(live.pids)) {
    throw new Error("判据返回的读数形状不对");
  }
  if (!live.running) {
    console.log("✓ 本检出没有正在运行的应用服务，可以执行 pnpm install。");
    process.exit(0);
  }

  const who = live.pids.length > 0 ? `PID ${live.pids.join(", ")}` : "见 run/launcher-session.json";
  console.error(
    `本检出的应用服务正在运行（${who}，经由 ${live.via}）—— 现在执行 pnpm install 会因原生模块` +
      "（`.node`）被进程锁定而 EPERM 连锁失败，并拖垮后续每一条 pnpm 命令（AGENTS 硬规则 9）。",
  );
  console.error("出口：先关掉本检出的应用窗口（或停掉正在跑的 `pnpm dev`），再重新执行本入口。");
  process.exit(1);
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  const probeFailed = error instanceof ProbeUnavailableError;
  console.error(
    `[deps:guard] 归属判据没给出结论（${reason}）⇒ 这一格既不是「没有实例在跑」，` +
      "也不是「判到有实例在跑」。",
  );
  if (probeFailed) {
    console.error(
      "判据没量到：端口 / 进程探测命令没跑起来（不是「量到了、结果为空」）。" +
        "这一支过去会被吞成「没有实例在跑」⇒ 守卫放行 pnpm install，正是硬规则 9 的 fail-open。",
    );
  }
  console.error(
    "出口：复跑 `pnpm deps:guard` 先让判据给出结论；" +
      "在拿到结论之前不要执行 `pnpm install`（AGENTS 硬规则 9）。",
  );
  process.exit(2);
}
