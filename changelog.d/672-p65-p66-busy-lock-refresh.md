## Fixed

- **一次异步动作的忙碌位复位写在成功路径上（20 处）**：`await` 之后那一行只要
  抛错，忙碌位就永远停在 `true` —— 界面从此显示「正在保存…」/「批量生成中…」，
  按钮再也点不动，只有刷新页面才恢复。收口到新出口
  `~/components/ui/use-busy-action` 的 `useBusyAction`（复位绑在 `finally` 上、
  异常不吞、卸载守卫）；store 级忙碌位收在
  `~/components/update-check/update-check-store` 的 `runChecking`。
  设置页 6 个启停动作、工坊两个批处理、影片台、训练页、登录页、历史详情、
  模型标签、工作流导入等处一并治理。

## Added

- `~/components/ui/use-reentrancy-lock`（`useReentrancyLock` / `createReentrancyLock`）——
  「同一时刻只跑一件」的同步重入闸门（规范 16 §16.2.4.69）。收口前四份自建闸门
  各写一遍同一段样板（`use-copy-feedback` / `use-external-action` /
  `use-encapsulation-test-run` / `use-character-portrait`），而其余落点靠读
  state 判重入（`setState` 是异步的，同一次事件循环里的两次点击都读到旧值）。
- `~/components/ui/use-refresh-ticket`（`useRefreshTicket`）—— 「按需求重新跑一遍取数」的
  刷新票据（规范 16 §16.2.4.70）；顺手删掉 `workspace/page.tsx` 里那个
  **声明了却从不自增**的 `recentsKey`。
- `~/components/ui/use-busy-action`（`useBusyAction`）—— 一块界面的忙碌位出口。
- 判据 **P65**（忙碌位复位写在成功路径上）/ **P66**（自建重入闸门），
  两条都是硬闸：`pnpm ui:primitives` 当前 **0 处 / 0 个文件**。
