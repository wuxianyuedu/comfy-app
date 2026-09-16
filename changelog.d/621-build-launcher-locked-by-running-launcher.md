## Fixed

- **发布构建第二步报「无法清理 start-tauri，可能被其他程序占用」而用户其实已经关掉了桌面窗口（ISSUE #621）**：`start-tauri\` 是 onedir 打包产物，运行中的 `start-tauri.exe` 把整个产物目录锁住（`_internal\*.dll` 删不掉），而启动器是独立 exe —— 关掉它的启动画面 / 桌面窗口并不会让它自己退出，旧提示既指不出是谁占着（没查进程表），给出的动作也照做无效。现在 `build-launcher*.ps1` 在清理旧产物之前先经 `Assert-LauncherNotRunning` 按 exe 真实路径自查本仓库启动器，命中即中止并点名 PID + 给 `taskkill /PID <pid> /T /F`；清理仍然失败时兜底提示补上 `Get-Process` 自查与「确认无同名进程 = 权限问题（提权残留的 pyinstaller / 杀毒软件），重启后重试」的分流。
