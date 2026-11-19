## Changed

- **B3 子批 1：47 份 / 104 处 `typescript/require-await` 直接清零**。做法：摘掉无 `await`
  的 `async`（返回 Promise 的契约处改成显式 `Promise.resolve(...)`，路由/脚本的
  `Promise<Response>` / `Promise<number[]>` 标注同步改为实际形态），并删掉这 47 份的
  文件级豁免；判决面挂账从 187 份降到 140 份。
- 连带把 `procs.mjs` / `orchestrator.mjs` 的端口探测链路里已无异步步骤的函数改成同步，
  注入点类型放宽为「同步或 Promise」（用例仍可注入异步替身）。
- 台账同步：B3 行改「清账中（子批1：47 份 / 104 处已清）」。
- 清账总账：#3181（本批挂 `Refs`）。
