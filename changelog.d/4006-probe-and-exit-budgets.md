## Fixed

- **启动链路的等待补上预算（#4006）**：
  ① `launcher-core/orchestrator.mjs` 的 `classifyProbe` 探测 fetch 带上 2.5s 单跳
  `AbortSignal.timeout`——半死形态（端口在听、HTTP 不应答）下，无预算的 fetch 会挂到
  undici 默认 300s，把启动页承诺的 180s 预算拖到 ~480s；到点落 `not-up` 由上层按节拍重试。
  ② 退出路径上三处无预算的同步等待一并加固：`shell_launch.rs` 的 `spawn_reaper` 与
  `lib.rs` 的 `reap_process_tree` 改走 `run_with_budget`（`spawn` + `try_wait` 轮询，
  10s 预算到点强杀），`standalone-runtime.mjs` 的 `reapTree` `spawnSync` 带
  `timeout: 10_000`。可终止性审计 #3889 的 P3 项。
