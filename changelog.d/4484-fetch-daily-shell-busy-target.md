## Fixed

- **每日纯壳获取（`pnpm fetch:daily-shell` / 双击 `tools/start/fetch-daily-shell.ps1`）在 Windows 上目标 `app.exe` 被占用时不再直接失败**（#4484）：
  把下载的壳 rename 落位到 `src-tauri/target/release/app.exe` 时，若目标被运行中的进程
  （旧壳还开着）或杀软扫描锁住，`renameSync` 会以 `EPERM` 失败、退出码 1，且临时文件
  残留在 `target/release/` 里。现在改为：短暂占用按退避间隔自动重试（约 3 秒预算）；
  仍失败则清掉临时文件，并按是否查到同名运行进程给出可执行提示——「先退出 Comfy APP
  （注意托盘/后台实例）再重试」或「先关闭应用 / 等杀软扫完 / 加白名单」，不再只抛一行
  裸 `EPERM` 栈。
