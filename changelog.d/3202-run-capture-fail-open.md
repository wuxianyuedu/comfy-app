## Fixed

- **端口归属判据不再把「探测命令没跑起来」吞成「量到空」（ISSUE #3202）**：`runCapture()` 把 `execFile` 的 error 塌成空串，Windows 上 `netstat` / PowerShell CIM 起不来时，`runningAppInstances()` 会返回一份形状完全合法的 `{running:false}`，`pnpm deps:guard` 于是 exit 0「可以执行 pnpm install」—— AGENTS 硬规则 9 那一问在这一支上恒等于没问。现在探测层分三态：宽松档 `runCapture()` 保留给尽力而为查询，新增严格版 `runCaptureStrict()` 与可识别的 `ProbeUnavailableError`，端口 / 命令行 / `/proc` 三路失败都冒泡；`deps-install-guard` 落 exit 2「没给出结论」、补装路径与启动编排停止继续动作，并补齐 netstat 起不来不进缓存、失败可重试的回归用例。
