## Fixed

- **桌面壳窗口装配失败不再无声闪退（#4329，P0）**：`wire_startup_windows` 的
  Err 此前从 setup 闭包一路冒到 `Builder::build().expect(...)` —— release 壳
  （`windows_subsystem`，无控制台）下表现为「双击闪退、什么都没留下」。现在
  接住它并复用 `report_standalone_setup_failure` 同款出口（`mark_launch_failed`
  → `run/launch-status.json`，启动页轮询到后显示失败原因与修法；启动页也没建成
  时至少落 `log/current/shell/shell.log`）。WebView2 初始化失败有在野先例
  （splash 建窗报 `HRESULT 0x80070057`），此前这条路径没有任何用户可见出口。
