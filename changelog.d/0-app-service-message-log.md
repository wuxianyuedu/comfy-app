## Fixed

- **应用服务断开与启动没有留下任何记录（此前「做过但没生效」）**：底部状态栏右下角翻成红色的「应用服务已断开」之后，用户能看到的只有四个字——什么时候断的靠猜、因为什么断的问不到、恢复了没有要看颜色变回去。消息中心此前只有三处生产方，全部只 `push` `kind: "update"`，其中与重启相关的那一条由 `use-code-update-watch` 驱动，而它 30 秒一拍轮询构建标识、服务断开期间那一路取不到任何标识（`code-update-since-load` 的 catch 分支直接返回全 `null`），于是在**整个故障窗口里一声不吭**；`restart` / `info` 两档在生产代码里从未被产出过。改为由 `useAppServiceMessageLog` 记录：探活 2 秒一拍的边沿直接落到消息中心，「断开」给时刻与影响、「启动 / 恢复」给断开时刻 + 持续时长 + 上一份进程为什么结束 + 该做什么。证据：`src/lib/shell/app-service-message.ts`（判据与文案，纯函数）、`src/components/message-center/hooks/use-app-service-message-log.ts`、`src/components/studio/BrowserStatusBar.tsx`。

- **同一次重启在消息中心出两条消息**：`use-code-update-watch` 此前在「页面长开、进程重启」时也会 `push` 一条「应用服务已重启」（没有时刻、没有原因），与新加的「断开 → 恢复」撞在同一次事件上。改为只有**启动器自愈**那一档（`restartReason` 非空，如路由表与源码不一致）才由它单独提示——那个原因只有构建标识这条链路拿得到，且它发生在探测边沿之外（重启比一拍还快时探活根本没失败过）。证据：`src/components/code-update/hooks/use-code-update-watch.ts`。

## Added

- **消息中心的消息落盘（刷新之后仍查得到）**：面板此前是纯内存的，而它记的恰恰是「应用服务断开 / 启动」——这类事件的观察窗口覆盖一次整页刷新（应用服务重启会让页面重载），于是内存里的消息随之归零，用户回到应用点开铃铛只看到空列表，这是「记了等于没记」的直接来源。改为落一份 `localStorage`（带版本号的键、逐条校验、坏数据回落为空而不抛错，坏存储不会把面板整个打不开），恢复走挂载后的 `hydrate()` 而不是模块加载期——后者会让客户端首帧就带上未读角标，与 SSR 输出对不上（水合不匹配）。证据：`src/components/message-center/message-center-store.ts`。

- **消息中心新增「断开」一档分档**：此前 `MessageKind` 有 `restart` / `info` 两档没有生产方，渲染侧却已经给它们配了图标与色调；`KIND_META` 因此收成 `Record<MessageKind, …>`（少一档在 tsc 就红，而不是运行期静默退化成 `info` 那一档）。证据：`src/components/message-center/MessageCenterPanel.tsx`。
