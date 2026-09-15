## Added

- **启动全链路与 Tauri v2 壳改为跨平台（ISSUE #489）**：新增 `scripts/dev-launcher.mjs`
  作为 Linux / macOS 的启动编排器，与 `dev-launcher.ps1` 同契约同产物（端口解析、
  `.next` 缓存指纹、就绪等待、进度快照 `run/launch-status.json`、日志布局），
  预检 / 缓存 / 拉起 / 回收一条链不再依赖任何 `.ps1`；桌面壳也可在 Linux / macOS 上
  编译运行（`pnpm tauri build`）。

## Fixed

- **非 Windows 上桌面包编译不过**：`Cargo.toml` 的 `windows` crate 是无条件依赖、
  `mod single_instance` 无 cfg 门控，Linux / macOS 上整棵 windows 树参与编译并以
  `cannot find type IMarshal in windows_core::imp` 失败。现改为
  `[target.'cfg(windows)'.dependencies]` + 模块内双实现（POSIX 用检出内锁文件 +
  `kill(pid,0)` 存活探测，二次启动经 `SIGUSR1` 唤起已运行窗口）。
- **sidecar 命名写死 `.exe` 导致 `build.rs` panic**：`build-desktop.mjs` 只产出
  `node-<triple>.exe`，而 `bundle.externalBin` 按目标三元组找无后缀名，报
  ``resource path `binaries/node-x86_64-unknown-linux-gnu` doesn't exist``。
  现由 `sidecarFileName()`（Node 侧）与 `sidecar_binary_name()`（Rust 侧）同一平台
  判据产出，非 Windows 一并补可执行位。
- **壳退出后 sidecar 与 next-server 不回收**：`kill_sidecar()` 写死 `taskkill`，
  在 POSIX 上等于不执行，node 之下的子进程会活过壳退出、继续占端口与日志文件。
  现 sidecar 的拉起与回收走官方 `tauri-plugin-shell`（跨平台机制由插件选择），
  并在壳内消费 sidecar 的 stdout/stderr（管道写满会让服务静默卡死）。
- **壳找不到项目根（启动页一直转圈、`log/shell/` 为空）**：`resolve_project_root()`
  判据是 `scripts/dev-launcher.ps1` 是否存在 —— Windows 专属文件，POSIX 上恒返回
  空串。现改判 `package.json` + 任一平台的 `scripts/dev-launcher.*`。
- **POSIX 上编排器退出后 dev server 仍在跑**：`spawn` 未 `detached` 时子进程与
  编排器同组，回收会命中「与调用者同组禁走组路径」的防自杀判据、退化成单杀 leader，
  其下 `pnpm` / `next` / `turbopack worker` 三层全部残留（实测残留 2 个、PPID=1）。
  现在统一 `spawnInGroup({ detached: true })` 自建进程组并整组回收；编排器被 SIGKILL
  时留下的孤儿由新增的 `run/launcher-session.json` + 心跳文件在下次启动回收
  （判据是「心跳新鲜 **且** PID 存活」两条，只判 PID 会被系统 PID 复用骗过）。
- **Linux / macOS 上偶发开发链路起不来**：新增回归测试
  `tests/cross-platform-launcher.test.ts`（真起带子进程的进程组、杀完数残留；
  会话锚点的心跳/PID 组合；缓存指纹清留判据），并把上面几条编译期/naming 契约
  变成可失败断言（反向验证：还原旧实现，对应用例必失败）。
