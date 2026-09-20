## Added

- **启动器对「陈旧路由表」的有界自愈**：就绪探针 `classifyProbe` 现在区分三态——连不上（继续等）、2xx（就绪）、以及「服务已应答但 `/api/health` 持续 404」（Turbopack dev 会话级路由失效的确切签名）。命中后者且未自愈过时，启动器只回收 dev 子进程（保住桌面壳）、清 `.next`、带重启原因重新拉起一次；仍 404 则停止自动重启并把「路由表持续异常」写进日志与状态，绝不循环。

- **dev server 重启的前端通知**：`/api/dev/build-id` 额外回 `bootId` 与 `restartReason`；`CodeUpdateWatcher` 据此在「进程真的重启」或「加载即带自愈重启原因」时，经 toast + 消息中心提示「应用服务已重启：<原因>」，并按 bootId 跨刷新去重（复用既有构建标识轮询，不新增模块级单例）。

## Fixed

- **启动页过早导航进半死页面**：`splash.html` 的 `probeBackend` 此前探 `/workspace`（页面路由，在路由失效时仍回 200）且用 `no-cors HEAD` 兜底（对 404 也返回 true），导致服务未真就绪就把隐藏主窗导航进一个 `/api/*` 全 404、数据永远加载不出的页面。现改为以启动器权威就绪状态（`status.ready`）为准，仅无壳 IPC 时退回自主探测 `/api/health` 且要求可读 2xx；`/api/health` 相应放行 CORS 供该兜底探测读取状态码。
