/**
 * deps-install-ipv4.mjs —— 带 IPv4 preload 的依赖安装出口（ISSUE #5189）。
 *
 * IPv6 优先时 `pnpm install` 会卡在 registry；出口是
 * `NODE_OPTIONS="--require ./scripts/devtools/force-ipv4-dns.cjs" pnpm install`，
 * 但前缀漏写 / 相对路径写错就退回 IPv6，且 dev server 在跑时还会 EPERM（硬规则 9）。
 * 本入口先跑 `deps:guard`（归属判据的唯一实现），再用绝对路径拼 preload 执行 pnpm，
 * 两个子进程都原样透传退出码。
 *
 * 用法：`pnpm deps:install-ipv4 -- install --frozen-lockfile`
 */
import path from "node:path";
import { pathToFileURL } from "node:url";

import { pnpmInvocation, runGateStep } from "../launcher-core/shell.mjs";

const ROOT = process.cwd();

/**
 * pnpm 命令与参数：`--` 之后的整串原样透传。纯函数。
 *
 * @param {string[]} argv
 * @returns {{sub:string[], bad:string[]}}
 */
export function parseSub(argv) {
  const at = argv.indexOf("--");
  if (at === -1) {
    return { sub: [], bad: argv };
  }
  return { sub: argv.slice(at + 1), bad: argv.slice(0, at) };
}

/** @param {string[]} argv */
function main(argv) {
  const { sub, bad } = parseSub(argv);
  if (bad.length > 0 || sub.length === 0) {
    process.stderr.write(
      "用法：pnpm deps:install-ipv4 -- <pnpm 子命令与参数>\n" +
        "  先跑 deps:guard，再带 IPv4 preload 执行；`--` 之后原样透传。\n",
    );
    return 2;
  }
  const guardInv = pnpmInvocation(["deps:guard"], { env: process.env });
  if (!guardInv) {
    process.stderr.write("[deps:install-ipv4] pnpm 不在 PATH ⇒ 没有执行者。\n");
    return 2;
  }
  const guard = runGateStep(guardInv.command, guardInv.args, {
    cwd: ROOT,
    timeoutMs: 120_000,
    echo: true,
  });
  process.stdout.write(String(guard.stdout ?? ""));
  process.stderr.write(String(guard.stderr ?? ""));
  if (guard.status !== 0) {
    process.stderr.write("[deps:install-ipv4] deps:guard 没放行 ⇒ 不装依赖。\n");
    return guard.status ?? 2;
  }
  const preload = path.join(ROOT, "scripts/devtools/force-ipv4-dns.cjs");
  const env = {
    ...process.env,
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require ${preload}`.trim(),
  };
  const inv = pnpmInvocation(sub, { env });
  if (!inv) {
    process.stderr.write("[deps:install-ipv4] pnpm 不在 PATH ⇒ 没有执行者。\n");
    return 2;
  }
  const res = runGateStep(inv.command, inv.args, {
    cwd: ROOT,
    env,
    timeoutMs: 30 * 60_000,
    echo: true,
  });
  process.stdout.write(String(res.stdout ?? ""));
  process.stderr.write(String(res.stderr ?? ""));
  return res.status ?? 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
