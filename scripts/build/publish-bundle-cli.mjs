/**
 * publish-bundle-cli.mjs —— `pnpm publish:bundle` 的薄入口（ISSUE #5192）。
 *
 * `scripts/build/publish-desktop-bundle.mjs` 的文件头自述「为什么必须有一个名字」，
 * CLI 也写全了，但 README / 规范里反复手敲裸 `node scripts/... --root dist\desktop`，
 * `--root` 相对 cwd 解析、同标签重发退 1 这些语义每次都要重新记。
 * 这里只透传旗标与退码，不改发布判据。
 */
import path from "node:path";
import { pathToFileURL } from "node:url";

import { runGateStep } from "../launcher-core/shell.mjs";

const ROOT = process.cwd();
const KNOWN = ["--root", "--dry-run", "--keep", "--label"];

/** @param {string[]} argv */
function main(argv) {
  const bad = argv.filter((a) => a.startsWith("--") && !KNOWN.includes(a));
  if (bad.length > 0) {
    process.stderr.write(
      "用法：pnpm publish:bundle [--root <dir>] [--dry-run] [--label <名>] [--keep]\n" +
        `不认识：${bad.join(" ")}\n`,
    );
    return 2;
  }
  const res = runGateStep(
    process.execPath,
    [path.join("scripts", "build", "publish-desktop-bundle.mjs"), ...argv],
    { cwd: ROOT, timeoutMs: 30 * 60_000, echo: true },
  );
  process.stdout.write(String(res.stdout ?? ""));
  process.stderr.write(String(res.stderr ?? ""));
  return res.status ?? 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
