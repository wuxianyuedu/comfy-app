## Fixed

- **壳（Rust）：`set_var` 收敛为进程内一次性，「启动期单线程」不再承重**（#4346）。
  `ensure_launch_mode` 的 `set_var("COMFYAPP_LAUNCH_MODE")` 会被 `run()` 与 setup
  闭包（经 `start_self_orchestration`）先后调用两次——当前时序下第二次被
  「已写过就早退」挡住，但那是实现恰好成立，不是结构保证；edition 2021 下
  `set_var` 与任何并发 `std::env::var` 在 POSIX 上构成数据竞争（UB）。
  三个写入点（启动模式、`COMFYAPP_PROJECT_ROOT`、`COMFYAPP_SHELL_EXE`）全部
  收进 `OnceLock` 的初始化：写入至多执行一次，setup 阶段再调也只是读缓存；
  「外部注入优先」的判据与源码契约（写入点全仓唯一）不变。
