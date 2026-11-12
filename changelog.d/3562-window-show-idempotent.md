## Fixed

- **应用不再莫名闪任务栏、也不会隔几秒自己抢回前台（ISSUE #3562）**：用户反馈三件事——点图标收起 / 显示界面发卡、启动后在后台莫名有红色闪烁的任务栏提醒、切到别的应用把窗口遮住后几秒它又弹出来盖住正在操作的应用。三个现象同源：`show_main_window_without_focus()` 无条件调 `win.show()`，而 Windows 的 `SW_SHOW` 对**已可见**的窗口同样会激活并提到 Z 序最前；这个函数在启动完成后仍被反复调用（页面导航 `Finished`、150s 安全网、无启动页兜底，以及前端 `useStartupForeground` 每次组件挂载都重问一次进程级持久的 `COMFYAPP_FOREGROUND`）。
  - **不再抢前台**：自动显示路径改为一次性——窗口显示过之后，`request_focus == false` 的调用直接早退；`on_main_page_finished` 另以「splash 是否还在」挡住页面导航重放。此后窗口显隐只由用户操作（任务栏 / 托盘 / 二次启动）决定。
  - **点图标不卡**：显式唤起按窗口状态做最小动作——已可见且已聚焦时不再发任何窗口动作（不再重复激活 + 重绘），只有隐藏 / 最小化时才 `unminimize` / `show`。
  - **红色闪烁消失**：删掉主窗与启动页共 4 处 `request_user_attention(Informational)`（本仓锁定的 tao 0.37 在 Windows 上是 `FlashWindowEx(FLASHW_TRAY, 4)`，重复显示会一次次重新点燃它，而旧代码从没有停止动作），改为窗口真正到前台时发 `request_user_attention(None)`（`FLASHW_STOP`）收掉残留。不抢前台那一档只把窗口安静留在任务栏，常驻托盘与任务栏按钮就是入口。
  - **启动标记一次性消费**：`should_activate_on_launch` 改走 `AppState::take_startup_activation()`，`COMFYAPP_FOREGROUND=1` 只在第一次被前端问到时放行；壳在窗口交接那一刻已按 `configured` 给过前台，不影响「双击启动能正常看到窗口」。
  - **判据**：`src-tauri/src/lib.rs` 新增 `window_show_is_idempotent_and_never_restarts_taskbar_flashing` / `startup_foreground_is_consumed_only_once` 两条 Rust 单测；`tests/check-file-structure.test.ts` 新增「窗口显示幂等与任务栏闪烁（ISSUE #3562）」用例组；现行口径同步到 `docs/standards/launch-and-build.md` §1.3.1（§11 排障手册里 #359 的历史条目保留原样，注明以新节为准）。
  - 改动落在 `src-tauri/src/**`，按硬规则 5 必须重编 release 壳（`cargo build --release --features custom-protocol`）才对双击 exe 生效。
