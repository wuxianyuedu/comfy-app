## Fixed

- **`src/lib/comfyui/runner-state.ts` 的 `persistLogs` 无内部 catch，
  caller 侧变成 unhandledRejection**：`persistLogs` 里
  `await taskRepository.replaceLogs(...)` 一旦抛，
  三处 `void persistLogs(taskId)`（防抖回调 `setTimeout` 里）就是**裸的
  未处理 Promise**、七处 `await persistLogs(...)`（enqueue /
  executor-finalize / reaper）会让整个 finalize 链路回滚 —— 两种都不是
  「一份日志没落库」应有的严重度。改成**内部** try/catch + `logger.warn`
  落 `app-runtime.log` 镜像通道，行为对外只保证「这一次不持久化」、
  不再向上抛；面板的内存视图（`state().logs`）本就完整，语义一致。

## Added

- **`src/lib/async-action.ts` 新增 `fireAndForget(task, onError)`**：用来
  取代散在 lib 里的 `void fn()` 形态，把「刻意不 await 的失败通道」显式
  命名。`onError` **必填**、不给默认（本文件是全库地基、被 Next 服务端与
  `"use client"` 侧共同 import，通道只能由调用处注入 —— 与 `runAsyncAction`
  的 `report` 同口径）；`onError` 内抛由本函数吞掉，兑现「不制造新的
  unhandledrejection」的承诺。用 `.catch` 而不是 `async/await` 是为了
  让本函数**返回 void**、caller 那侧没有 Promise 要处理，不然问题只是
  下移一层。用例见 `async-action.test.ts` 新增 `describe("fireAndForget")`
  三条：成功不报 / 失败原样交 `onError` / `onError` 自己抛不冒。
  本轮只做「审计 + 补最紧迫的一处内部 catch + 立地基」，现有 30+ 处
  `void fn()` 站点里其余 29 处经审计均有各自内部 catch 或 caller 侧 `.catch`，
  不强行迁移；后续新增「无等待方的异步动作」按 §12.18 走 `fireAndForget`。
