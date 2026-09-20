## Fixed

- **关掉 Tauri 窗口后 next dev 进程树残留为孤儿**：`start_tauri_launcher.py` 的 `launch_dev_server` 仅用 `CREATE_NO_WINDOW` 拉起 `dev-launcher.mjs`，未让其脱离启动器进程树；启动器在主窗口出现后即退出并连带回收 dev-launcher，使其来不及在桌面窗口关闭时回收 dev server。`launch_dev_server` 改为以 `DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP` 起编排器，使其独立存活并负责回收，关窗后进程树随之干净退出。
