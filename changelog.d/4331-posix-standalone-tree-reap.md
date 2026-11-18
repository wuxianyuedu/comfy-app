## Fixed

- **POSIX standalone 分发包退出时回收整棵 sidecar 树（#4331，P1）**：
  `reap_process_tree` 此前对空项目根（standalone 安装目录里恒为空串）直接返回，
  而 POSIX 没有 Windows 的 Job Object 兜底、统一回收脚本
  `scripts/reap-process.mjs` 又只存在于检出里——三层叠加的结果是 Linux/macOS
  分发包退出后 node 之下的 next-server / 执行宿主残留成孤儿，继续占端口与日志
  句柄。现在空根时在 Rust 侧沿父子关系枚举整棵树（Linux 读 `/proc/*/status`
  的 PPid；macOS 退用 `pgrep -P`），先杀后代再杀 leader，深度/数量有界；
  行为判据由真起 `sh → sleep` 小树的用例钉住。
