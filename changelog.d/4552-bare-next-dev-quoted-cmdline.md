## Fixed

- 裸 `next dev` 占住推导端口时，应用实例归属读数看不见它：Windows 命令行会把脚本路径整个加引号，node 起 next 的 JS bin 是 `node "…\bin\next" dev --turbo`，`next` 与 `dev` 之间隔了一个收尾引号；`isAppDevServerCmdline` 的 `next dev|start` 正则在 `\s+` 前不容许引号，这一最常见形态被卡在判据外——于是 `pnpm dev` 报 `EADDRINUSE`、`runningAppInstances()` 却报「无实例」，两个读数互相矛盾。现在容许 `next`/`next.cmd`/`next.ps1` 与 `dev`/`start` 之间隔一个收尾引号（`["']?`），`dev|start` 后的 `\b` 仍挡住 `devtools`/`startup` 这类前缀词，隔壁检出与别的 CLI 照旧不收。（#4552）
