/**
 * deps-diff.mjs —— `pnpm deps:diff` 的薄入口（ISSUE #5184）。
 *
 * `scripts/lockfile/diff-cli.mjs` 已经把「两份 lockfile 差异」的取数、渲染与退码
 * （0 一致 / 1 实质差异 / 2 判据跑不起来）写全了，缺的只是 pnpm 名字：此前文档让人
 * 手敲带 Windows 反斜杠的 `--installed node_modules\.pnpm\lock.yaml --root .`，
 * 顺序抄错会把「跑不起来（2）」误读成「依赖陈旧（1）」。这里把两个路径填死，
 * 退码原样透传，不判「该不该装」。
 */
import { pathToFileURL } from "node:url";

import { runGateStep } from "../launcher-core/shell.mjs";

const ROOT = process.cwd();

/**
 * 既有 diff-cli 的参数。纯函数，便于用例钉住路径与旗标顺序。
 *
 * @param {{root?:string, extra?:string[]}} input
 * @returns {string[]}
 */
export function diffArgs({ root = ".", extra = [] } = {}) {
  return [
    "scripts/lockfile/diff-cli.mjs",
    "--installed",
    "node_modules/.pnpm/lock.yaml",
    "--root",
    root,
    ...extra,
  ];
}

/** @param {string[]} argv */
function main(argv) {
  /** @type {string[]} */
  const extra = [];
  /** @type {string[]} */
  const bad = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--max-per-section") {
      extra.push("--max-per-section", String(argv[++i] ?? ""));
    } else {
      bad.push(String(argv[i] ?? ""));
    }
  }
  if (bad.length > 0) {
    process.stderr.write(
      "用法：pnpm deps:diff [--max-per-section N]\n  路径与仓库根由本入口填死。\n",
    );
    return 2;
  }
  const res = runGateStep(process.execPath, diffArgs({ extra }), {
    cwd: ROOT,
    timeoutMs: 120_000,
    echo: true,
  });
  process.stdout.write(String(res.stdout ?? ""));
  process.stderr.write(String(res.stderr ?? ""));
  return res.status ?? 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
