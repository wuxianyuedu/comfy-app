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
- `build-desktop.mjs` / `affected-launch-scope-advice.mjs` 里的 elapsed 是「一次性的
  完成读数」而非等待中的心跳，语义不同；本次不动，留作后续项。
