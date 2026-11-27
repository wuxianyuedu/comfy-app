/**
 * storybook-check-cli.mjs —— `pnpm storybook:check` 的薄入口（ISSUE #5188）。
 *
 * `scripts/devtools/storybook-check.mjs` 是 pre-commit 注册的执行者，多份文档要求
 * 「不抄份数、现跑那条命令」，但它没有 pnpm 名字，于是每次评审都手敲原始命令行。
 * 这里只透传旗标与退码，不改判据、不另算份数；**不覆盖被包装的脚本本身**
 * （同名包装会让 D0 的「故事面」步骤递归自调）。
 */
import path from "node:path";
import { pathToFileURL } from "node:url";

import { runGateStep } from "../launcher-core/shell.mjs";

const ROOT = process.cwd();

/** @param {string[]} argv */
function main(argv) {
  const bad = argv.filter((a) => a !== "--changed" && a !== "--json");
  if (bad.length > 0) {
    process.stderr.write("用法：pnpm storybook:check [--changed] [--json]\n");
    return 2;
  }
  const args = [path.join("scripts", "devtools", "storybook-check.mjs"), ...argv];
  const res = runGateStep(process.execPath, args, {
    cwd: ROOT,
    timeoutMs: 15 * 60_000,
    echo: true,
  });
  process.stdout.write(String(res.stdout ?? ""));
  process.stderr.write(String(res.stderr ?? ""));
  return res.status ?? 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
