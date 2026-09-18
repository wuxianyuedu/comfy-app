## Changed

- **守卫与启动器的回归用例跟上实现现状**（只影响开发者流程）：`tests/check-file-structure.test.ts` 里三个测「`dev-launcher.ps1` 自有实现」（`Get-RunningProjectShell` / `Stop-StaleProjectShell`）的用例，测的函数早在「编排收进 `scripts/dev-launcher.mjs`」时就被删除，只剩永远失败的断言（本地与 CI 都红，因而不提供任何信号）；其中唯一仍有价值的 `/T /F`（杀整棵树）契约搬到 Build-Guard 的「陈旧壳自动回收」用例继续守着。`tests/cross-platform-launcher.test.ts` 的 POSIX 进程组用例改为在 Windows 上跳过——那里既没有 `sh` 也没有 `ps`，跑起来只是 `spawn ENOENT` 这种与判据无关的红（Windows 分支由 `src/lib/process/kill-process-tree.windows.test.ts` 真跑）。同一批新增「`scripts/**` 里的动态说明符必须指向真实存在的文件」判据，以及给 Build-Guard 用例组补的打桩进程表（`Get-Process` / `taskkill` 参数留档）。
