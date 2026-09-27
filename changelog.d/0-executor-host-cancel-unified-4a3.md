## Changed

- **P3 §5 第 2 期 · Phase 4-A3：取消收成一条出口 + 条件性中断（ADR §14 D2）**。tRPC `task.cancel` 改为调用执行侧那份 `enqueue.cancelTask`（此前只把行写成 `CANCELLED`），历史面板里绕过集中出口的 `api.task.cancel` 也并回 `task-cancel-client`。**中断（`POST /api/interrupt`）只由握着该任务在飞子进程的那一侧发**：inline 在 `cancelTask` 里按 `cliProcs.has(taskId)` 决定（取值必须在 kill 之前），host 在 `reconcileCancelled` kill 之后发，日志形态 `cancel-reaped taskId=… interrupt=sent|failed:<原因>`。这样跨进程不会互误停：`/api/interrupt` 是全局停、不带 prompt 参数，而 ComfyUI 实例两宿主共享。签字时设想的「问 ComfyUI 谁在跑」被端到端实测否掉（comfy-cli 提交的 prompt 整轮执行期间不出现在 `/queue` 的 `queue_running`，照它实现等于永远不中断），落地记录写在 ADR §14 D2。`interrupt()` 另加 `!res.ok` 抛错，否则调用方分不清「发出去了」与「ComfyUI 没接」，那句日志就没有判据。

## Fixed

- **取消后 ComfyUI 继续把这一轮跑完并出图**：取消现在会由执行侧发出中断，实测 host 名下的在飞任务被取消后 `taskImage` 零行、行保持 `CANCELLED`。排队中（本进程没有它的子进程）的任务取消仍只标状态、不发全局中断，并在执行日志里写明原因，免得看起来像「没反应」。
- **执行日志里看不到「是谁把任务停掉的」**：走统一出口后每次取消都落一行「用户取消任务」，中断成功/失败各有一行说明（`已请求 ComfyUI 中断当前这一轮生成` / `中断请求失败：ComfyUI 会继续跑完当前这一轮（原因）`）。中断失败不算取消失败——状态照收，但必须留下「这一轮还会跑完」的解释。
- **对已结束的任务点取消会把「已完成」翻成取消**：`cancelTask` 过去无条件补发合成的 `CANCELLED` + `error` 事件，而行已是终态时 4-A1 的守卫并不会改写库里那行，于是出现「DB 是 SUCCEEDED、界面上的节点却是取消」。现在合成事件只在非终态时发。
- **顺带清掉 master 上的一处 P80 硬闸回归**：`6b17b8c9`（镜头行内「取消」按钮）在 `ShotStudio.tsx` 留下 `h-6 w-6` 同值手写，自此 `check-ui-primitives --strict` 常红、拦下所有提交。按判据要求换成 `size-6`（tailwind 内建简写，视觉完全等价）。与本刀无关，属「门禁红挡住提交」的同型处理（先例见 #1168 里的 Build-Guard 那条）。
