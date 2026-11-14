## Added

- **性能取证入口 `pnpm perf:trace [路由]`（ISSUE #3843）**：按需录一段页面 / 操作的 Chrome DevTools trace（主线程任务 `devtools.timeline` + CPU 采样 `cpu_profiler`），按次命名落 `log/profiles/`，并打印页面计时摘要与「怎么读」（perfetto / chrome://tracing、看主线程长任务与采样栈）。支持 `--settle`（录制时长）、`--click`（把一次操作录进 trace）、`--out`、`--no-server`；Windows 双击入口 `tools/start/perf-trace.ps1`，用法与边界见 `docs/guides/perf-trace.md`。边界：trace 有开销，按需取证用，不挂常驻轮询、不进 CI。注意动词是 `perf:trace`——`pnpm profile` 撞 pnpm 内建命令（与 `pnpm docs` 同款坑）。
