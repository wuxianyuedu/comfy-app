## Changed

- **覆盖率门槛表抽成纯数据模块（#4612）**：`vitest.config.ts`（2353 行，全仓最大且被最频繁
  同批编辑的配置）里的 `coverage.include` / `coverage.thresholds`（152 条门槛 + 121 条
  include 与随条注释）抽到 `scripts/gates/coverage/` 下四个纯数据模块（`include` /
  `thresholds-globs`（目录档）/ `thresholds-files`（单文件档）/ `thresholds-ui`（组件档），
  按 900 行长度硬闸分片），config 只做装配（476 行）。登记处具名导出
  `COVERAGE_THRESHOLDS` 与判定开关（`COMFY_COVERAGE_ENFORCE`）行为一字未改，
  `tests/coverage-targets-exist.test.ts` 的「键 ⇄ 磁盘」对账原样承重。
- **根级 `*.config.{ts,js,mjs,cjs}` 纳入 infra 文件长度门禁（#4612 期望②）**：
  `scripts/gates/check-infra-file-size.cjs` 的扫描面从 `scripts/**` + `tools/**` 扩到
  仓库根这一层（只扫根层、不递归；暂存档按文件名进根清单，不会被「未触及扫描面」跳过）。
  现场读数：456 个文件、0 超 900；`oxlint.parity.config.mjs`（899 行）进 800 行提醒名单。
