## Fixed

- **内层 spawn pnpm 的形态判据收口到 `pnpmInvocation()`（ISSUE #576，规范 §2.1.6）**：`scripts/dev.mjs` / `start.mjs` / `analyze-bundle.mjs` 曾在 Windows 上写死 `pnpm.cmd`，而批处理只有 cmd.exe 会解释、Node 起它必失败（`EINVAL`），`spawnSync` 的 `status` 为 `null` 又被 `process.exit(status ?? 0)` 读成「成功退出 0」—— 表现为启动页报「dev server 已启动」后两秒静默退出、stderr 全空、Next 一行输出都没有。现在一律经 `shell.mjs` 的 `pnpmInvocation()` 拿 `{ command, args }`（形态判据唯一出口），并把「命令没起来」与「跑完非零退出」分开报、打印真实命令。
- **启动失败的出口日志落在本次运行的文件上，弹窗直接贴出 dev server 输出（ISSUE #576，规范 §2.1.6）**：收尾函数曾按文件名字典序重找「最近一份」nextjs 日志（历史 `_` 命名排在现 `T` 命名之后），弹窗给的路径恒定指向**上一次运行**那份，用户照过去看自然是别的现场；失败弹窗也不含 dev server 自己的输出。现在本次的 `nextOut` / `nextErr` 直接传入（`lastNextLog` 删除），弹窗补一段 dev server 输出尾部（按 mtime 取最新一份）与自查入口 `pnpm check:toolchain`。
- **双击启动后启动页出现在最前面（ISSUE #576，规范 §5）**：启动页曾沿用「应用窗口」的「不抢前台」策略，结果是它被文件资源管理器压在后面，用户看到「双击了没反应」。启动页是双击的直接反馈，现由 `spawn_splash_front()`（启动器，首次可见时拉一次复核进程）与壳侧 `bring_splash_to_front()` 单独抢一次前台——与主窗那套判据不合并。
