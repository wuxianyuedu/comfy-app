## Fixed

- 门禁/钩子链路的子进程调用补墙钟预算：此前 `scripts/`+`tools/` 128 处 `spawnSync` 仅约 25 处带超时，任何一格挂死（杀软扫描锁文件、网络悬挂、子进程等 stdin）都会无限卡住本地提交/推送。新增统一执行器 `runGateStep`（`scripts/launcher-core/shell.mjs`，缺省预算 600s，三态收场：ran / aborted，超时与起不来都归「测量没发生」，按「未校验 ≠ 红」落 2，不冒充判据红），并先接上会触网/起服务/长跑的关键路径：quality-gate（tsc/lint/vitest 与脚本型判据）、shell-gate（cargo test 预算 900s、git、pkg-config 探针）、check-oxlint-zero-rules（全仓探针 300s）、check-scripts-typecheck（tsc 全量面）、premerge-check 与 base-check 的判据子进程、ship 的 cnb 网络调用（180s）、覆盖率上报（120s）、check-format（oxfmt 与 git 读数）。
- 门禁沙箱夹具（`tests/helpers/gate-repo.ts`）的依赖复制认 **.ts 说明符与多行 import**：判据经 launcher-core 伸进 `src/lib/process/*.ts` 这条链后，沙箱缺 .ts 依赖会在 Linux 侧 ERR_MODULE_NOT_FOUND（GA test-gates 红的现场）。（#4601）
