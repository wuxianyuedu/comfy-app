## Fixed

- **修字面字号棘轮的一处涨幅（合并 master 时带出来的）**：`MessageCenterPanel.tsx` 里那枚 runId 的等宽小字写了 `text-[10px]`，把 `tests/design-md-contract-sync.test.ts` 的字面字号存量从 140 推到 141。`--text-3xs` 就是 `10px` 那一档（globals.css 注释写着「角标 / 极小徽标」），改用类名是逐字节同值、零像素变化，且回到棘轮之内。改的是别人在 master 上加的一行 —— 该棘轮在 master 上没被拦住（#623 之后无 CI 兜底），由本次合并首次触达。
