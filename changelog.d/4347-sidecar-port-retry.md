## Fixed

- **壳（Rust）：sidecar 端口被抢占时换端口重试，不再一次启动即败**（#4347）。
  `pick_free_port` 先 `bind("127.0.0.1:0")` 拿到空闲端口后立即 drop 监听器，再把
  端口号经环境变量交给 node sidecar——两步之间端口可被其它进程抢占（TOCTOU），
  node 起来后 bind 失败退出。现在 sidecar 拉起后观察 1.5s grace 窗口：窗口内就退
  （EADDRINUSE 一类）即换新端口重试，最多 3 次；重试救的是「可避免的失败」，
  三次都早退时维持单次失败的原有行为（Terminated 已记录、不挂死），并补上
  明确的 WARN/ERROR 日志。
