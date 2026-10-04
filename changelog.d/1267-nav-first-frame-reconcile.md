## Fixed

- **左轨自动让位的首帧对账不再「靠顺带的重渲染」**（ISSUE #1267）。
  `useNarrowNavState` 的首帧读的是 `getServerSnapshot`（服务端按非窄窗渲染的那一份），
  而「进页面时窗口就已经是窄窗」这种情况媒体查询**不会再 change** —— 全靠订阅里补排的
  那次 `setTimeout(0)` 通知让 React 重读快照。问题是那次通知**挂在订阅的清理函数上**：
  React 开发态把 effect 跑两遍（挂载 → 卸载 → 再挂载），清理里的 `clearTimeout` 把刚排的
  通知取消，第二次订阅排的又被下一次双挂载取消。实测（`innerWidth=1100` 首屏，`setTimeout(0)`
  共排 5 次、取消 2 次）：**被取消的第二个正是 store 自己排的通知**，于是 `data-state` 停在
  服务端那份「展开」上，只能等某个无关的重渲染（实测是 `model.configList` 的 tRPC 响应）
  顺带读一次快照才纠正。并发跑 `e2e/nav-auto-collapse.spec.ts` 时那次重渲染可以晚到 5s 之后
  ⇒ 两条用例在默认并发下必红，而 `--workers=1` 串行绿（与报告完全一致）。
  - 修法：通知排期提到**模块级**（`initialSyncTimer`），任何订阅的退订都不撤销它；回调里
    只有**真的把通知发给了订阅者**才算完，否则重排一次（双挂载期间 `listeners` 可能是空的，
    发给空气等于没发）。改后同口径实测：取消数 2 → 1（剩下的那条与本 store 无关），
    通知必达。
  - 判据从「一次恰好跑通」变成**两步分开报**：`sidebar.tsx` 的 wrapper 新增 `data-narrow` /
    `data-narrow-crossings`，`e2e/nav-auto-collapse.spec.ts` 先判「客户端判据到位」再判
    「生效态落盘」。红了能直接分清是**判据没到**（还在水合 / 首帧对账没落地）还是
    **判据到了而状态没跟着落**（`resolveRailCollapsed` 那条推导断了）—— 两者修法完全不同。
    实测这一步确认了本次现场属于前者（判据与状态在同一个 commit 里一起到位，晚的是判据本身）。
  - 回归：`src/components/ui/sidebar-auto-collapse.test.tsx` 新增一条「订阅被卸载再挂载后，
    对账仍由 store 自己的通知落地」。
