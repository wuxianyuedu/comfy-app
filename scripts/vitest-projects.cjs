"use strict";
// 兼容垫片（#4111 过渡期）：本判据已迁往 scripts/affected-tests/vitest-projects.cjs。
// 镜像仓 default branch 的 workflow 在本 PR 合并前仍引用平铺路径；
// 此垫片按原样转发（argv 与退出码透传）。合并后可删。
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const real = path.join(__dirname, "affected-tests", "vitest-projects.cjs");
const r = spawnSync(process.execPath, [real, ...process.argv.slice(2)], {
  stdio: "inherit",
});
process.exit(r.status ?? 1);
