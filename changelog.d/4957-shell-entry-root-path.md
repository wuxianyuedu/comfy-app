## Fixed

- 桌面壳入口地址不再拼 `/workspace`（#4957）：dev 的 `default_dev_url`、standalone sidecar 的 `app_url` 与启动页兜底 URL 全部改为根路径 `/`，与 #4881「首页停在 / 直接渲染创作台」对齐；`/workspace` 路由本身保留。
