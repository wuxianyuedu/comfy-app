/**
 * format-files.mjs —— 点名一批文件查格式（ISSUE #5173）。
 *
 * `pnpm exec oxfmt --check <files>` 在 Windows 上经 `.cmd` shim，glob 展开与命令行长度
 * 都和 POSIX 不同；这里用 `pnpmInvocation` 的唯一实现拼命令，把参数原样交给 oxfmt，
 * 不另写一套 glob。退码沿用 oxfmt：0 干净 / 非 0 有格式问题。
 *
 * 用法：`pnpm format:files <文件…>`
 */
import { pathToFileURL } from "node:url";

import { pnpmInvocation, runGateStep } from "../launcher-core/shell.mjs";

/** @param {string[]} argv */
function main(argv) {
  if (argv.length === 0) {
    process.stderr.write(
      "用法：pnpm format:files <文件…>\n  不给文件就退 2，不跑成全仓格式判据。\n",
    );
    return 2;
  }
  const inv = pnpmInvocation(["exec", "oxfmt", "--check", ...argv], { env: process.env });
  if (!inv) {
    process.stderr.write("[format:files] pnpm 不在 PATH ⇒ 没有执行者。\n");
    return 2;
  }
  const res = runGateStep(inv.command, inv.args, { timeoutMs: 300_000, echo: true });
  process.stdout.write(String(res.stdout ?? ""));
  process.stderr.write(String(res.stderr ?? ""));
  return res.status ?? 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
