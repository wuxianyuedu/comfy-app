## Changed

- **消息中心按「每一次启动」分组（此前多次启动的记录混成一列平铺）**：手验反馈是「多次启动混在了一起，每次启动之间要能明显区分开」——面板记的恰恰是故障，分不清批次等于分不清故障次数（18:41 那次与 18:14 那次之间没有任何分隔，用户数不出断过几次）。每条消息盖一个「启动戳」`runId`（launcher 单点产出的 6 位十六进制，一次启动一个值，与 `log/runs/<日期>_<时分秒>-<runId>`、`run/app-service-exit.json` 的 runId 同源），面板按它分组并在组间给出分隔头：**本次启动 / 上一次启动 / 更早的启动 / 未标记启动 + 组内最新时刻 + 条数 + runId**，当前这一次用主色与实心点标出。判据是纯函数 `~/lib/shell/message-run-groups`（`groupMessagesByRun`），视图只把它摊平成交错的「组头 + 消息行」。证据：`src/lib/shell/message-run-groups.ts`、`src/components/message-center/MessageCenterPanel.tsx`、`src/components/message-center/message-center-store.ts`。

- **探活那条通道顺带回 runId（与 bootId 同一次应答）**：`GET /api/dev/server-id` 现在回 `{ bootId, runId }`。两者都只在服务应答时才拿得到，**必须同批**——分成两次请求会在「服务刚恢复」那一刻还拿着旧 runId，把恢复那条消息盖到上一组。读它的地方收成 `getServerRunId()`（`~/lib/shell/dev-server-id`），`server-id` 与 `last-exit` 两个端点都经它，不各读一次 `process.env`。`use-dev-server-liveness` 暴露 `currentRunId`，且**只在探测成功时更新**（断开那一刻要盖「正在死的这次启动」的戳，服务已经不在、端点问不到）。证据：`src/app/api/dev/server-id/route.ts`、`src/lib/shell/dev-server-id.ts`、`src/components/studio/hooks/use-dev-server-liveness.ts`。

- **runId 落盘，且老数据不丢**：`runId` 随消息持久化（面板记的故障观察窗口覆盖一次整页刷新，戳没了就等于每次刷新退回「混在一起」）。它是**追加的可选字段**而不是换存储键：老数据没有它时按 null 处理（落「未标记启动」那一组），换键等于让用户丢掉全部历史消息——而那是这个面板唯一的留底。`currentRunId` 是运行时事实、**不落盘**。

- **`push` 没给 runId 时用当前启动补上**：代码更新、版本更新这些生产方不必各自接一次探活链路，也不会漏盖（漏盖的消息只能落到「未标记启动」那一组，而它本可以归对批次）。**显式给的 `null` 留 null**（「明确不知道」≠「没提供」）——用 `??` 补会把纯手工 `pnpm dev` 起的服务断言成「属于现在这次启动」，而面板正是拿它分组的。
