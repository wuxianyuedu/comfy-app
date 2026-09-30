## Fixed

- **`tests/sqlite-pragma-sites.test.ts` 里那两条并发竞态量具在 Windows 上跑不起来（`spawn EINVAL`），修好后它们真的在量了**（ISSUE #1282 的落地判据，红在 master 上）：`57de39e4` 新加的 `runOnce()` 用 `spawn(pnpmBin(), ["exec","tsx",…])`，而 `pnpmBin()` 在 Windows 上返回 `pnpm.cmd` —— 批处理只有 `cmd.exe` 会解释，Node ≥ 24 不给 shell 就直接 `EINVAL`（**本仓为这件事记过账：ISSUE #638**，`scripts/check-format.cjs` 文件头就是它的现场）。表现是两条用例各挂 10s 超时 + 一条 `Unhandled Rejection`，而不是断言失败。本机读数：rebase 到含 `57de39e4` 的 master 之后跑 `--no-file-parallelism`，这两条就是红的（串行也红 = 真红，不是并发预算问题）。至于它在别的机器上有没有被跑绿过，我没有记录，不写死。
  - 改成 `spawn(process.execPath, [TSX_CLI, …])`，tsx 入口按**它自己的 exports 表**解析（`createRequire(…).resolve("tsx/cli")`），不硬编码 `dist/cli.mjs`、不碰 shell、也不碰 `.cmd`。
  - 没有改成复用 `pnpmInvocation()`（那条才是仓库里合法的 pnpm 调用口径）：它在本机解析成 `pwsh -File pnpm.ps1`，每个子进程多一层 shell 启动 —— 而这套量具量的正是**几毫秒窗口里 7 个进程的 PRAGMA 竞态**（文件里另一处注释已经在抱怨 tsx 的启动抖动需要齐步起跑线）。测的是竞态，就不该给竞态加抖动。
  - 顺带订正一处口径：原注释写「按平台分叉成 `pnpm.cmd` 是**与仓库其余跨平台脚本同一口径**」—— 恰好相反，仓库的口径正是「不许这么起」（#638）。

## Tests

- 修完这两条真的量出了结论（`--no-file-parallelism` 整文件 9 passed）：裸循环在 8 进程同时打一份新库时**确实抛** `SQLITE_BUSY`（量具没坏），`applySqlitePragmas` 在同样形状下全绿 —— #1282 的两条前提第一次拿到执行证据，而不是「用例存在」。
