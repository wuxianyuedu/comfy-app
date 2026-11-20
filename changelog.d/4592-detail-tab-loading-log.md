## Fixed

- 工作流库选中一条工作流后，详情页签内容区不再「卡半天没反应」（#4592）：详情数据查询在飞期间（`workflow.detailFull` 实测可到 4s+），`DetailBody` 原先直接渲染空白，用户停在默认的工坊封装页签上看不到任何反馈。现在这一段显示局部加载态（复用 `TabContentLoading`，文案「加载工作流详情…」），头部与页签条照常显示；IO 预览页签同一口径。后台 refetch（数据已在）不走这一支，不会闪。
- 应用日志补上「子页签打开」这一层耗时（#4592）：原先只记到「子界面打开：工作流详情·<名称>」，详情内部的子页签（工坊封装等）不留痕。现在详情数据落定的同一时刻并排记一条 `子页签打开：工作流详情·<页签名> 耗时 <n>ms`（页签名取自 `DETAIL_TABS`，附 `tab` / `workflowId` / `workflowName` 字段），与「子界面打开」同用点击那一步的时刻——两行并排读，时间花在哪个子页签一目了然。回归：`src/components/studio/subview-open-log.test.ts`、`src/components/studio/workflow-library/sections/DetailBody.test.tsx`。
