## Changed

- **`pnpm check:toolchain` 现在会打印「探测身份」，让「版本对不上终端」自解释**：同一窗口里 `pnpm --version` 是 `12.4.1`、自检却报 `10.34.5（…\pwsh.EXE）`，两句其实都不假 —— 终端敲的 `pnpm` 由 shell 的 PATHEXT 解析，而 Node 侧只认「真的起得来」的形态（`.ps1` 经宿主执行，命令名因此变成 `pwsh.EXE`）；PATH 上并存多个 pnpm 时，被选中的那个还可能是另一个版本。自检现在另打印 `[INFO] 选中的 pnpm：<文件>`（PATH 上真正命中的那个），经宿主时再打印 `[INFO] 经宿主执行：<宿主> … → <文件>`；版本漂移的提示也改为把方向指向「选中的 pnpm」（即 PATH 顺序问题），而不是让人去翻仓库里的 `package.json`。判据仍只在 `scripts/launcher-core/shell.mjs` 的 `commandInvocation()` 一处，自检只负责印出来。
