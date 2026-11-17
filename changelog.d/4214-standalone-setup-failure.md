## Fixed

- **standalone 载荷缺失不再无声崩溃**（#4214）：`setup_standalone_runtime` 的 Err 此前经
  `?` 冒到 `Builder::build` 之后的 `.expect(...)`——release 壳无控制台，用户看到的是
  双击后进程直接消失。现在调用点就地接住：错误进日志与 `mark_launch_failed`（启动页
  轮询得到「装配失败 + 重装指引」），壳继续跑着显示失败态。
- **托盘创建的 `default_window_icon().unwrap()`** 同族拆除：图标资源缺失只让托盘缺位
  （WARN），不让 setup 阶段 panic 带走整个应用。
