## Fixed

- **壳（Rust）：子进程输出泵不再在 tokio worker 上逐行同步写盘**（#4334）。
  sidecar / 编排器的输出泵此前在 async 任务里对每行日志做同步文件 IO
  （stat + open + write + close），而上游（tauri-plugin-shell 事件通道）无界、
  无反压——日志盘慢（杀毒扫描 / 网络盘）或编排器高频刷屏（首次编译期）时，
  通道在内存里无界堆积，被文件 IO 拖住的 worker 还会拖慢另一个泵和其它
  async 任务。新增 `LineLog`：落盘挪进专用写线程，调用方只做有界 `try_send`
  （从不阻塞、不做 IO）；通道满按「丢弃 + 计数」处理，写线程在下一行前补一条
  「落盘滞后：前段已丢弃 N 行」，内存有界、现场不静默。`ResilientShellLog`
  （shell.log）与编排器转发（shell-launch.log）两路都收口到它，#3574 的
  「目录清空后按路径重建」语义保持不变。
