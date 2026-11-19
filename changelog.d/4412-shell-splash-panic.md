## Fixed

- 壳：启动页改程序化创建。此前 splash 走 `tauri.conf.json` 的声明式窗口，而框架在
  setup 处理里先建 config 窗口、后跑用户闭包——建窗失败（WebView2 运行时缺失/损坏，
  #4329 现场 HRESULT 0x80070057）的 Err 直达框架内部的 `panic!("Failed to setup app")`，
  `windows_subsystem` 下无控制台，进程静默死亡（双击后毫无反应），壳的失败上报链
  （`mark_launch_failed` / 启动页失败态）一格都跑不到。现在 splash 由
  `create_splash_window` 程序化创建，Err 被 setup 闭包接住走与主窗同一条失败态出口；
  `app.windows` 清空，尺寸判据随迁（`splash_window_size_matches_the_shell_constant`）。
  （#4412）
