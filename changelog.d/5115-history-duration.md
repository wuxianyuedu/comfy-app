## Added

- 历史页生成耗时读数（#5115）：任务卡与详情弹窗头部都显示 `claimedAt → finishedAt`
  的墙钟耗时（旧行无 `claimedAt` 时退 `createdAt`，标题如实说明含排队时间；未完 / 中断不显示）。
  派生复用队列页同一纯函数、格式复用 `formatDurationMs`，三处读数一致。
  同批补纯函数 / 卡片 / 详情三层用例；产品文档 FR-GN-05 / FR-GN-06 同步口径。
