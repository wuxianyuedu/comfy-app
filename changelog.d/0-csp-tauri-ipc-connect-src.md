## Fixed

- **壳日志进不了前端日志面板（CSP 漏了 Tauri 的 IPC 通道）**：控制台刷
  `Connecting to 'http://ipc.localhost/plugin:event|listen' violates ... connect-src`。
  - 根因：Tauri v2 的事件系统（`listen` / `emit`）走自定义协议 `ipc://localhost`
    （Windows 上是 `http://ipc.localhost`），而两处 CSP 的 `connect-src` 都没放行它
    —— `next.config.js` 的响应头（dev / prebuilt 形态，页面从 Next dev server 的
    HTTP 加载时套的就是它）与 `src-tauri/tauri.conf.json` 的 `csp`（standalone 形态）。
    官方模板的默认 CSP 本带 `ipc: http://ipc.localhost`，当初定制时丢掉了。
  - 为什么难发现：`invoke` 走 `window.__TAURI_INTERNALS__` 的 postMessage 通道、
    **不经 fetch**，完全不受 `connect-src` 约束 —— 于是「命令能调通、只有事件监听
    静默失效」，控制台之外无任何症状；`LogProvider` 那条 `catch` 又把失败一并吞掉。
    结果是 `log:emit` 订阅压根没建立，壳转发的日志永远进不了日志面板。
  - 修法：两处 `connect-src` 各补 `ipc: http://ipc.localhost`（**两处都要**，
    形态不同各管一半）；`LogProvider` 的 `catch` 改为「在壳里失败要落一条 warn 进
    面板」，不再把「在壳里却监听失败」与「不在壳里」当同一件事静默处理。
