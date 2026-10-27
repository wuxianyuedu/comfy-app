## Fixed

**`src/components/studio` 子集跑完不再刷 ECONNREFUSED / AbortError 噪声**（ISSUE #2458）。

- 当场读数（`pnpm exec vitest run --no-file-parallelism src/components/studio`，146 文件 /
  1585 条全绿）：stderr 里 120 行 `connect ECONNREFUSED ::1:3000` / `127.0.0.1:3000` 与
  2 条 `DOMException [AbortError]`，且**归因未钉到文件** —— 日志里它们落在别的文件的
  `✓` 行旁边（异步泄漏的打印位置本来就不可信）。
- 量具（一次性，未入库）：`setupFiles` 里包一层 `globalThis.fetch` 记调用点，再补一层
  `net.Socket.prototype.connect`（端口 3000）—— 后者要认 Node `net.connect` 传进来的
  **数组形参** `[options, cb]`，只看第一参会把端口读成 `undefined`，第一版量具就漏在这里。
- 根因是四份用例各挂了一个真实周期源 / 数据入口没换桩：
  · `BrowserStatusBar.test.tsx`：`useSchemaSyncStatus`（每挂载一次 `GET /api/schema`）与
    `useComfyQueue`（订阅即拉起 `GET /api/comfy/queue` 轮询），10 条用例 × 2 条请求；
  · `WorkflowIOPreviewPanel.test.tsx`：「选递增值」走 `workflow-mutations` 真发
    `POST /api/trpc/workflow.update`；
  · `WorkflowEditorInner.test.tsx`：`~/trpc/vanilla` 的 `workflow.detailFull.query` 与
    `refreshCustomNodes()` 的 `GET /api/custom-nodes/manifest`（`~/trpc/react` 的桩覆盖不到）；
  · `use-workflow-library.test.ts`：卡住用例的列表请求在 fake timers 下没落地，
    happy-dom 拆窗时 abort。
- 修法都在用例侧：前三份把数据入口换成已有约定的桩（`~/trpc/react`、`~/trpc/vanilla`、
  `~/config/custom-nodes` 的部分替换），第四份在断言后用 `advanceTimersByTimeAsync`
  把延迟推完、再恢复真实时钟并让出一个宏任务，让请求在拆除前落地。
- 判据（同一子集，探针在场与不在场各跑一次）：`ECONNREFUSED` 0 行、`AbortError` 0 条，
  146 文件 / 1585 条照样全绿。**不新写门禁**：这个形态取决于时序（跑快了就不出现），
  做成红绿判据只会假红。
