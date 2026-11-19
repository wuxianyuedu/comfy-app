## Fixed

- **`safeFetch` 注入兜底超时**（#4205）：调用方未传 `signal` 时自动加
  `AbortSignal.timeout(60s)`（可用 `timeoutMs` 覆盖），随整条重定向链共用同一份预算；
  显式传了 `signal` 的调用方维持原样。防的是「下一个调用方漏传 signal → 这条出站
  fetch（含逐跳重定向）无限挂起、挂死 API 路由的请求处理器」。
