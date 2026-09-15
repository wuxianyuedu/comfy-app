#!/usr/bin/env node
// pnpm 可用性自检（跨平台，`pnpm check:toolchain`）。
//
// 为什么单独有一个入口：工具链门禁跑在**启动链路里**，命中失败就直接中断启动；
// 而「pnpm 到底怎么了」这个问题，用户最需要的时刻恰恰是「启动被拦下之后」——
// 那时他希望**只跑一次自查**、看到结论与修复动作，而不是反复双击入口撞同一堵墙。
//
// 本脚本是一个**薄壳**：所有判据都在 `scripts/launcher-core/` 里（`whichCommand`
// 的可执行形态选择、`probePnpm` 的探测、`orchestratePnpm` 的自动重建与复核、
// `buildTip` 的修复文案）。这里只负责打印与退出码 —— 判据一旦在这里重写一遍，
// 就有了第二份「pnpm 为什么不работает」的答案（Issue #576 的教训）。
//
// 退出码：0 = pnpm 可用；1 = 不可用（提示已打印，可直接照做）。
import process from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { orchestratePnpm } from "./launcher-core/corepack.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** 打印一行结论（纯 ASCII 前缀 + 原文，便于日志检索）。 */
function say(prefix, message) {
  process.stdout.write(`${prefix} ${message}\n`);
}

const result = orchestratePnpm({ root });

if (result.probe.ok) {
  say("[OK]  ", `pnpm 可用：${result.probe.version}（${result.probe.command}）`);
  if (result.expected) {
    const match = result.probe.version.replace(/^v/, "") === result.expected.replace(/^v/, "");
    say(match ? "[OK]  " : "[WARN]", match
      ? `版本与 package.json 的 packageManager 一致（pnpm@${result.expected}）。`
      : `版本与 package.json 要求不一致（本机 ${result.probe.version}，要求 ${result.expected}）。`);
  }
  if (result.repaired || result.tip) say("[INFO]", result.tip);
  process.exit(0);
}

say("[ERROR]", "pnpm 不可用 —— 启动链路会在工具链门禁处停下。");
process.stdout.write("\n");
process.stdout.write(result.tip ?? "（没有可用的修复提示，请检查 launcher-core/corepack.mjs 的 buildTip）\n");
process.stdout.write("\n");
process.stdout.write(
  [
    "自查入口：pnpm check:toolchain",
    "本脚本不修改任何全局状态（唯一例外：spawn-error 一类会自动 corepack prepare 重建，并复核结果）。",
    "",
  ].join("\n"),
);
process.exit(1);
