## Fixed

- **启动器不再把「PATH 上选错了 pnpm 可执行形态」误报成「corepack 缓存损坏」**（ISSUE #576）：用户现场是 `pnpm 工具链不可用（exit=?）：未知错误`，`dev-launcher-stderr` 为空、stdout 里也没有 pnpm 自己的报错，提示却让去 `corepack prepare pnpm@<项目版本> --activate`。根因是 `whichCommand` 只按 `PATH × PATHEXT` 找**存在的文件**：Windows 上 corepack 的 pnpm 是三个文件（无扩展名 shim / `.cmd` / `.ps1`），Node 起不了 shebang 与 `.cmd`，而 PATHEXT 把 `.CMD` 排在最前 —— 于是选中的必然是跑不起来的那个，`spawnSync` 回落成 `EACCES` + 空输出。
  - `whichCommand` 改为**选第一个真的能跑的候选**：`executableExts()` 定优先级（无扩展名 / `.EXE` → `.PS1` → `.CMD`/`.BAT` 垫底），`usableCommand()` 用 `accessSync(X_OK)` 加「对 shebang 形态真起一次」确认，起不来则回退同目录 `<name>.ps1`（经 PowerShell 宿主）。POSIX 行为不变。
  - 探测结果结构化（`not-found` / `spawn-error` / `exit-nonzero` / `no-version`），把 `error.code` 与实际输出头几行一起带出来；文案里「现象」与「可能成因」分两句，不再把推测写成结论。
  - 修复提示里的版本号**取自 `package.json` 的 `packageManager`**（不再有占位符），多行提示经 launch-status 进入启动页横幅（横幅按换行原样渲染，修复动作不会被压成一行）。
  - `spawn-error` 一类先**自动 `corepack prepare` 重建并用同一条探测复核**：`corepack prepare` 的退出码只说明动作完成，shim 仍不可执行时它照样成功。
  - `spawnDevServer()` 复用同一个命令形态，避免「探测通过了、起服务又失败一次」。

## Added

- **`pnpm check:toolchain`**（`scripts/check-pnpm-available.mjs`）：pnpm 可用性自查与修复入口，跨平台、无需任何 `.ps1` 副本（登记在规范 §9.5 对照表）。启动被门禁拦下时，用户要的是「只跑一次自查、看清结论与动作」，而不是反复双击入口撞同一堵墙。
