## Fixed

- **双击启动后正式窗口弹到最前，点回别处遮盖它又马上被强拉回前台（同一次启动被打断两次）**：启动期判决 `decide_foreground()` 曾把「前台是双击入口（资源管理器 / 启动器自身）」判为允许给前台，双击启动因此恒得 `COMFYAPP_FOREGROUND=1`——壳交换窗口时 `set_focus()` 弹到最前（第一次），用户切回别处后交接复核进程又按「用户就在等」把前台强拉回来（第二次）。而「双击之后切去干别的」正是常态。
  现在双击启动一律**不抢前台**：主窗口只进任务栏并闪烁提醒，用户处理完手上的事自己点开（托盘「打开主界面」、二次启动唤起、`--foreground` / `--cold-start` 等显式给前台的路径不受影响）。同时主窗口以 `focused(false)` 创建，首次显示走 `SW_SHOWNOACTIVATE`，从源头掐掉「窗口显示即被系统放行前台」的路径。
  生效条件：桌面壳需重编（`cargo build --release --features custom-protocol`）；双击入口 `start-tauri.exe` 需重打包（`tools\build\build-launcher.ps1`）。
