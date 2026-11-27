/**
 * check-standalone-cli.mjs —— `pnpm check:standalone` 的薄入口（ISSUE #5194）。
 *
 * `scripts/gates/check-standalone-contents.cjs` 同时数两层（`.next/standalone`
 * 与 `src-tauri/static`）和两个方向（不该有的 / 必须有的），AGENTS 硬规则 17/18 的
 * 现场判据。常驻指令、启动规范与控制台预设反复写裸 `node scripts/...`，却没有名字，
 * `gate run` 也解析不到（它只认钩子 run 行与 GATES）。这里只透传旗标与退码。
 */
import { pathToFileURL } from "node:url";

import { runGateStep } from "../launcher-core/shell.mjs";

const ROOT = process.cwd();

/**
 * 透传给既有判据的参数。纯函数，便于用例钉住「不另写判据」。
 *
 * @param {string[]} argv
 * @returns {{bad:string[], args:string[]}}
 */
export function standaloneArgs(argv) {
  return {
    bad: argv.filter((a) => a.startsWith("--")),
    args: ["scripts/gates/check-standalone-contents.cjs"],
  };
}

/** @param {string[]} argv */
function main(argv) {
  const { bad, args } = standaloneArgs(argv);
  if (bad.length > 0) {
    process.stderr.write(`用法：pnpm check:standalone\n不认识：${bad.join(" ")}\n`);
    return 2;
  }
  const res = runGateStep(process.execPath, args, {
    cwd: ROOT,
    timeoutMs: 10 * 60_000,
    echo: true,
  });
  process.stdout.write(String(res.stdout ?? ""));
  process.stderr.write(String(res.stderr ?? ""));
  return res.status ?? 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
