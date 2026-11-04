## Changed

- **长命令有了「进行中」读数（#3144）**：新增 `scripts/progress-heartbeat.mjs` ——
  本地终端用 `\r` 在同一行刷新「当前段 · 已跑 Ns」，结束时清行落总结；CI / 非 TTY
  每 15 秒打一行带北京时间戳的纯文本心跳（无 `\r`、无 ANSI，可 grep）。两种输出由
  同一 `startProgress()` 驱动，一律写 stderr，stdout 与退出码不变。
- 接入 `scripts/premerge-check.mjs`（段起点 + 组内 base 复算逐条；这一跳用**跨进程**
  心跳 —— 底下 `spawnSync` 一阻塞，进程内定时器整段不跳）、
  `scripts/ci-install-deadline.mjs`（原 30s 心跳改走同一入口）、`scripts/ship.mjs` 的
  CI 轮询，以及 `.githooks` 组 D 的逐步步骤（经 `--label … -- <cmd>` 透传退出码；
  D0 是 16s 快档，不导出该开关、零开销）。
- 后续项已补齐：`scripts/build-desktop.mjs`（12 个阶段：build / 装配 / 剪枝 / 建表 /
  实体化 / 体积 / 出厂计数 / sidecar）与 `scripts/affected-launch-scope-advice.mjs`
  的归因那一跳也接进同一入口。这两处的外部命令与整树拷贝都是**阻塞式**
  （`spawnSync` / `cpSync`），所以用的是跨进程心跳 `startProgressSync`；
  `build-desktop` 原有的「耗时 …」完成读数保持不变（它走 `time-format.ts` 那一份）。
