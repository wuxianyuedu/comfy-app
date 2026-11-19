## Added

- **启动耗时分解补上服务端细分**（#4365）：「等待服务就绪」此前是一段黑盒。
  新模块 `launcher-core/server-timings.mjs` 按增量扫描编排器持有的 dev server
  stdout 落盘文件（每 2s 一轮、带 1KB 重叠、预算 5 分钟），从 `✓ Ready in <n>`
  与 `GET /workspace 200 in <t>` 两类标记反推**服务进程启动**与**首页编译**
  两段耗时补进时间线；标记落地即刷新 launch-status 快照——分解行、启动页
  耗时条、应用内「启动耗时分解」卡三处出口同源可见。timeline 增 `add()`
  （事后推算段的入口，同 key 幂等）。
