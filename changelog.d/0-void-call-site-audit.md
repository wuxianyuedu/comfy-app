## Fixed

- **lib 里 10 处 `void someAsyncFn(...)` 无 catch 兜底的漏点**（PR-4b 加了
  `fireAndForget` helper，本次逐个审计被调函数的 catch 覆盖度、补齐）：

  **收口路径**（executor-finalize 的 `fail` / `complete` + trainer 的 `failJob`
  内部都是 `await taskRepository.*` / `await appendLog`，DB 抛就 reject）：
  · `src/lib/comfyui/executor-cli.ts` 7 处（line 183 / 260 / 327 / 416 / 430
  的 `void fail(...)`，加 `createCliFinisher` 回调里 `complete` / `fail` 各一处）
  · `src/lib/comfyui/executor-ws.ts` 1 处（`armWatchdog` 超时 `void fail(...)`）
  · `src/lib/comfyui/trainer.ts` 1 处（`runRemote().catch` 里的 `void failJob`）
  全部换成 `fireAndForget(fail(...), (e) => logger.warn(errorText(e, "...")))`，
  「DB 收口抛错 → unhandledRejection」路径掐掉。

  **异步事件处理**（handleMessage 里的 classify 与下游一堆同步/异步，任一抛都
  冒到 promise）：
  · `src/lib/comfyui/executor-ws.ts` 1 处 `ws.on("message", (data) =>
  void handleMessage(...))` → `fireAndForget(handleMessage(...), logger.warn)`。

  **单飞二次调用**：
  · `src/lib/comfyui/executor-ws.ts` 1 处 `void ensureComfyUiReady(...)`
  ——line 133 首次调用挂了 `.then().catch()`，line 159 「已在飞」分支
  拿到同一个 promise 却没挂 catch；单飞 promise 若因未预期路径 reject 就是
  unhandledRejection。补齐。

  **监督器自身**：
  · `src/lib/comfyui/lifecycle-exit.ts` 的 `setInterval(() => void tick())`
  ——本模块刻意「纯逻辑 + 依赖注入」、不 import logger，兜底留在回调里
  `tick().catch(() => { ... })`，注释说清「监督器自己炸不能反过来拖住主
  循环」。真故障由 caller 注入的 deps 各自日志通道暴露。

  **浏览器侧 `.then(handler)` 链尾**：
  · `src/lib/shell/window-controls-client.ts` `void isWindowMaximized().then(handler)`
  ——`isWindowMaximized` 内部已 catch 保证 resolve，但 `handler` 是 caller
  传入的 `setState` 之类回调，它抛就 unhandledRejection。改成
  `fireAndForget(isWindowMaximized().then(handler), () => {})`：本文件
  不带 `"use client"` 首行、也不在 `single-logger-channel` 的 `CLIENT_ONLY`
  白名单里，走 `console.error` 会撞那条门禁；`fireAndForget` 的 `onError`
  内抛已被吞掉，这里传空函数即可——语义「handler 抛只丢本帧刷新，下一帧
  resize 事件会再补」保持不变。

  其余未列的 `void fn()` 站点（reaper 2 处、connect 4 处、processQueue 3 处、
  persistProjectToServer 2 处、persistLogs 3 处、enqueue 内部若干、
  generation-log-client 的 fetch）经逐个开函数体核对：被调 async **内部已有
  try/catch**、或 caller 已挂 `.catch(...)`、或 caller 的 promise 已 resolve
  （processQueue / connect 都是同步 setup，返回的 Promise 不会 reject）——
  不改。类型安全审查 src/lib 报告的 H-6 条目（补齐 PR-4b 里"先审再改"承诺的
  剩余审计）。
