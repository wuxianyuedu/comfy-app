## Fixed

- **Rust 壳的编排器认亲补上检出维度，多检出并行不再误杀别家的启动过程**（ISSUE #3851）：
  `find_owned_orchestrator` 原先只凭环境块里的 `COMFYAPP_SHELL_OWNED=1` 认「是某个壳起的」，
  全系统扫到即回收——同一台机器双检出并行（§1.4 支持的形态）时，双击 B 检出的壳会把
  A 检出正在跑的编排器连同 dev server 整树杀掉。现在认亲双判据：`COMFYAPP_SHELL_OWNED=1`
  **且** 环境块里的 `COMFYAPP_PROJECT_ROOT` 与当前项目根一致（该值本就由 `spawn_orchestrator`
  写入子进程环境，此前没用于比对）。
