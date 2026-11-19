## Fixed

- 四处平台写 / 派发跳的 `fetch` 补 30s 墙钟预算（`AbortSignal.timeout`）：GA→CNB
  判决信使（callback）、派发器的探 sha 与派发跳、镜像推送后的 repository_dispatch。
  对端不回话时不再挂到 undici 默认超时（约 5 分钟）挤占外框余量。（#4447）
