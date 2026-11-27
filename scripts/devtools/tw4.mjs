/**
 * tw4.mjs —— Tailwind 4 巡检四档的统一入口（ISSUE #5187）。
 *
 * `scripts/tw4/*` 既有脚本已把判据写全，但文档让人手拼
 * `grep -rlE … | tr -d '\r' | while IFS= read -r f; do node … codemod "$f"; done`，
 * `--write` / `--with-tests` 的边界全靠人记。这里只做薄包装：
 * 默认只读，写档显式；参数与退码原样透传，不另写扫描逻辑。
 *
 * 用法：
 *   pnpm tw4:scan
 *   pnpm tw4:report [--write] [--with-tests] [--check]
 *   pnpm tw4:spacing [--write]
 *   pnpm tw4:codemod <文件…>
 */
import { pathToFileURL } from "node:url";

import { runGateStep } from "../launcher-core/shell.mjs";

const ROOT = process.cwd();
/** @type {Record<string,string>} */
const SCRIPTS = {
  scan: "scripts/tw4/tw4-scan-core.mjs",
  report: "scripts/tw4/tw4-canonical-report.mjs",
  spacing: "scripts/tw4/tw4-spacing-canonical.mjs",
  codemod: "scripts/tw4/tw4-canonical-codemod.cjs",
};

/**
 * 子命令 → 既有脚本 + 参数。纯函数，便于用例钉住写档的显式性。
 *
 * @param {{cmd:string, args:string[]}} input
 */
export function tw4Invocation({ cmd, args }) {
  const script = SCRIPTS[cmd];
  if (!script) {
    return null;
  }
  if (cmd === "codemod" && args.length === 0) {
    return null;
  }
  return { script, args: [...args] };
}

/** @param {string[]} argv */
function main(argv) {
  const [cmd, ...args] = argv;
  const inv = tw4Invocation({ cmd: cmd ?? "", args });
  if (!inv) {
    process.stderr.write(
      "用法：pnpm tw4:scan | tw4:report [--write] [--with-tests] [--check] | tw4:spacing [--write] | tw4:codemod <文件…>\n" +
        "  codemod 必须点名文件；写档要显式给 --write，默认只读。\n",
    );
    return 2;
  }
  if (args.includes("--write")) {
    process.stdout.write(`[tw4] 写档：${inv.script} 将改动点名面\n`);
  }
  const res = runGateStep(process.execPath, [inv.script, ...inv.args], {
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
