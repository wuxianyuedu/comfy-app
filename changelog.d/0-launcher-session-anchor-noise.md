## Fixed

- **启动编排：不再每次启动都刷一条「回收上一次运行遗留的进程树：PID …」**
  （`scripts/dev-launcher.mjs` + `src-tauri/src/shell_launch.rs`）。壳正常退出时用
  `Child.kill()`（Windows 上是 `TerminateProcess`）收编排器，编排器收不到任何信号、
  没机会执行自己的清理，于是会话锚点（`run/launcher-session.json` /
  `run/launcher-heartbeat.txt`）**必然**残留；下一次启动读到「心跳陈旧 + PID 已死」，
  按 `child_pids` 把早已被插件 `kill()` / Job Object 收干净的进程再「回收」一遍并报
  一条 WARN —— 每次正常关窗后的启动都刷，且旧号被系统复用时还会误伤无关进程。

  - 编排器侧（`reapStaleSession`）：回收前再探一次 `child_pids`。一个都不活着 =
    上一次的树已被壳 / Job Object 收干净，只清锚点、**不回报**（调用点也就不会打印
    那条 WARN）；还有活着的才是真孤儿，照旧按组回收并回报。
  - 壳侧（`shell_launch::reap`）：`kill()` 成功后顺手清掉锚点
    （`clear_session_anchor`），把这条必经的残留从源头去掉；`kill()` 失败时原样留着，
    交给下一次启动的回收。**清锚点不削弱回收**：壳认亲靠的是进程环境块里的
    `COMFYAPP_SHELL_OWNED`，与锚点无关。

## Verified

- `tests/cross-platform-launcher.test.ts` 新增两条：子进程全已不在时 `reapStaleSession`
  返回 `null` 且锚点被清；还有活着的子树时真回收（真起进程、杀完核实已消失）并回报
  被回收的 PID。
- `tests/shell-self-launch.test.ts` 新增一条静态判据：`clear_session_anchor` 只在
  `kill()` 成功那一支被调用；两份锚点路径与 `scripts/dev-launcher-session.mjs` 同源
  （名字漂开 = 壳清了个不存在的文件）。
- Rust 侧新增 `session_anchor_paths_match_orchestrator_side` 与
  `clear_session_anchor_removes_both_files_and_is_idempotent`（`cargo test` 40 条全过）。
- 规范同步：`docs/standards/launch-and-build.md` §1.5「回收」行、§3.3 会话锚点判决表
  与回归锚点表、§3.3 新增「锚点残留 ≠ 有孤儿」说明。
