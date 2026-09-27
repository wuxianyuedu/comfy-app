## Fixed

- **常驻定时器吊住事件循环、重连句柄不可取消（`src/lib/comfyui/`）**：
  - `reaper.ts` 的回收循环与 `executor-scheduler.ts` 的心跳都是模块加载即启动的
    `setInterval`，既无 `clearInterval` 也未 `unref()` —— 它们会把 Node 事件循环一直
    吊住，dev server 关停时无法自然退出。现在两者都 `unref()`（常驻 HTTP server
    仍持有事件循环，不会提前退出）。
  - `executor-ws.ts` 的重连 `setTimeout` 句柄原先不保存：退避窗口内若再次调度会
    排队两个 `connect()`，也没有任何取消路径。现在句柄存到模块级，重复调度先清旧。
