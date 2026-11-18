## Fixed

- **壳（Rust）：启动页轮询的两个读命令不再在 tokio worker 上做同步文件 IO**（#4335）。
  `get_launch_status` / `get_launch_log` 被启动页分别以 250ms / 800ms 常驻轮询，
  而命令体内的 `std::fs` 读与目录枚举是同步 IO——等于周期性占用 tokio worker
  做阻塞操作，与输出泵的同步 IO 叠加时加剧 worker 饥饿。两命令的 IO 主体
  （`get_launch_log` 顺势拆出纯同步主体 `collect_launch_log`）改经
  `tauri::async_runtime::spawn_blocking` 落到阻塞线程池：对调用方仍是异步等待，
  磁盘慢时最多占住一条阻塞线程，async worker 池不再被轮询拖住；返回内容与
  逐条读取逻辑一字未改。
