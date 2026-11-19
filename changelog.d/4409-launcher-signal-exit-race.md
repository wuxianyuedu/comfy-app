## Fixed

- launcher：SIGINT/SIGTERM 收尾收敛为单出口。此前常驻 promise 里也注册了 signal
  监听把 signal 当「正常退出」resolve 出 `code:0`，run() 的微任务续体抢在
  `reapAll`（宏任务）完成之前执行 `process.exit(0)` —— POSIX 下 dev/executor-host
  成孤儿（占端口、锁 `.next`），Windows 下退出码变 0、归档与会话锚点清理被跳过。
  现在 signal 一律走模块级处理器「回收整树 → 归档 → 退出 130/143」这一条路，
  装配收成可单测的 `wireSignalShutdown`（misc-ops.mjs），并钉了源形态判据防回归。
  （#4409）
