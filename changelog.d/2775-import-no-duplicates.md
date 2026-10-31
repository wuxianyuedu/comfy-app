## Changed

oxlint `import/no-duplicates` 全仓清零（#2775）：29 处 / 27 份，同一模块的多条 `import` 合成一条（`import type` 与值导入混在一处时写成 `{ type X, y }`）。ESM 的导入本来就提升到模块顶部，合成一条不改变求值顺序。

fixer 收敛了绝大多数位置；手改 4 处「合并要搬一整块」的形态：`tests/ship.test.ts` 的 `closeIssues` 与 `runRerunCiStage`、`tests/turbopack-tracing-excludes.test.ts` 与 `tests/test-sleep-gate.test.ts` 的中段 `node:fs` 导入（后者还要保住 default + named 一起写、`vi.spyOn(fs, …)` 的实现前提）、`scripts/dev-launcher.mjs` 中段重复的 `port-reap.mjs` 导入（合到顶部、保留 `export { reapProcessTree, scanPorts }`）。

fixer 合成的行是 `a,b`（逗号后无空格）形状，逐行按 `git diff -U0` 打印前后对再规范化（含跨行导入的续行），共 19 行；随后对 14 份改动过的 `src/**` / `.storybook/**` 跑 `oxfmt`（平台那层按改动面重排整份是口径内迁移）。

整条规则至此全仓 0 命中（2405 份扫描）。`tsc --noEmit`、eslint 通过；受影响用例闭包 296 份（固定 94 + 受影响 202）本地两段都跑绿（94/94、202/202，3074 条 + 2 skip）。
