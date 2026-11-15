#!/usr/bin/env node
// 兼容垫片（#3930 过渡期）：本判据已迁往 scripts/ci/ci-ga-daily-failure-issue.mjs。
// 镜像仓 default branch 的 pr-gate workflow 在本 PR 合并前仍引用平铺路径；
// 此垫片按原样转发（argv 与退出码透传）。合并后可删（#3930）。
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const real = new URL("ci/ci-ga-daily-failure-issue.mjs", import.meta.url);
const r = spawnSync(process.execPath, [fileURLToPath(real), ...process.argv.slice(2)], {
  stdio: "inherit",
});
process.exit(r.status ?? 1);
