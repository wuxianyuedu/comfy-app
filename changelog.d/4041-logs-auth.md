## Fixed

- **日志路由族鉴权补齐三条漏网（#4041）**：`/api/logs` 族里 list / history /
  export / diagnostics 都走 `requireRequestUser`（export 的注释还写明「鉴权与
  /api/logs/list 一致」），但读日志正文的 `current` / `sessions` 与写运行日志的
  `app-runtime` 三条完全跳过这层闸——本机任意进程 / 页面可读全部运行日志正文。
  三条补同一鉴权闸；两个路由测试按 export / diagnostics 的既有形状补鉴权 mock。
  接口契约与兼容审计 #3907 的 P2 项。
