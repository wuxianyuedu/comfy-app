## Changed

- **日志轮询：四源并行 + 关面板放宽（性能）**：`src/components/studio/logs/LogProvider.tsx`
  是根布局常驻、每 2s 触发一次的后台轮询。两处优化：
  1. 原来 `for (const source of POLL_SOURCES) await pollSource(...)` **串行**拉
     `launcher/dev/app/app-runtime` 四路 → 一轮 = 4 次往返在单进程 Next 上顺序排队；
     改 `Promise.all(POLL_SOURCES.map(...))` 并行，一轮 ≈ 1 次往返。各 `pollSource`
     内部已各自 try/catch（网络失败只记一次「不可达」），单源出错不会让整批 reject，
     语义不变。
  2. 面板关闭时把间隔从 `POLL_MS(2000)` 放宽到 `POLL_IDLE_MS(5000)`（`isOpen` 驱动
     `useInterval` 的 `ms`）——无人看时间线时减少后台往返；新日志仍进缓冲与计数徽标，
     打开面板时 `ms` 变化会让 `useInterval` 重挂并立即补跑一次，回到实时。
  注：桌面「窗口被遮挡但仍 visible」时 `use-interval` 的 `pauseWhenHidden` 不暂停这件事，
  需要实跑验证 `hasFocus`/blur 语义（jsdom 下 `document.hasFocus()` 常为 false，会误停
  全部 interval 测试），未纳入本 PR。`log-provider-global-errors.test.ts` 6 例绿、
  eslint 零警告。
