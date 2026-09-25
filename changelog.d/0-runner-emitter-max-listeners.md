## Fixed

- **单例 emitter 的监听器泄漏被彻底静音（`src/lib/comfyui/runner-state.ts`）**：
  `emitter.setMaxListeners(0)` 是「无限」而不是「0 个」—— 它永久关掉 Node 的
  `MaxListenersExceededWarning`，而那个警告是这条链路上唯一能自动报出「某个 taskId 的
  订阅没退干净」的信号（每条 SSE 连接靠 `subscribe` 的返回值退订，漏一处就在这个进程级
  单例上留一个监听器，存活期间不释放）。改为 50：正常使用远远够，超过就说明真泄漏了。
