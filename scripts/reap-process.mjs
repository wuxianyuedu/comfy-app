#!/usr/bin/env node
// 命令行回收一个 PID 的整棵进程树（跨平台）。
//
// 为什么要有这个入口：编排器之外还有**几个宿主进程**需要在极端路径上补一刀
// （Python 启动器的监控线程 / 兜底回收、构建脚本的残留壳清理）。它们各自去拼
// `taskkill` / kill 命令，就又是一处会静默分叉的平台判据 —— 而「各写一遍」
// 正是历史「单杀留孤儿」反复出现的原因。
//
// 用法：node scripts/reap-process.mjs <pid> [--force]
// 退出码：0 已发起回收；1 参数不合法。
// 结果以一行文本打印（via），便于宿主解析或写进日志。

import path from "node:path";
import { fileURLToPath } from "node:url";

const arg = process.argv[2] ?? "";
const pid = Number.parseInt(arg, 10);
if (!Number.isInteger(pid) || pid <= 0) {
  process.stderr.write(`[reap-process] 无效 PID：${arg || "(缺参数)"}\n`);
  process.exit(1);
}
const force = process.argv.includes("--force");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const specifier = ["..", "src", "lib", "kill-process-tree.ts"].join("/");
try {
  const mod = await import(specifier);
  const result = await mod.killProcessTree({
    pid,
    detached: process.platform !== "win32",
    force,
  });
  process.stdout.write(`${result.via}\n`);
  process.exit(result.ok ? 0 : 0);
} catch (error) {
  // 动态加载失败时给出可行动的报错（不静默成功）：调用方据此走自己的兜底提示。
  process.stderr.write(
    `[reap-process] 无法加载 ${path.join(root, specifier)}：` +
      `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
}
