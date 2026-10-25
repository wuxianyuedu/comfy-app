## Changed

视频队列弹窗的「批量提交」草稿页签**整格撤掉**（ISSUE #2169，2026-10-25 业主拍板；
单内三选一的「只读/撤掉」档）。这条通路从来没成功过：每条草稿只有提示词、没有
必填的 `workflow`（#2159 之后在本地就被拒），而生产挂载从不播种草稿——
新视频的唯一真实入口一直是创作台「视频」模式。

- `VideoQueueModal` 收成队列只读视图：撤掉草稿页签（radiogroup / 草稿行 /
  导入 txt/csv / 提交按钮），空队列指引改指创作台；`draftItems` prop 移除。
- `video-queue-client.ts` 的 `submitGeneration` 一并移除——它是那条通路的
  客户端出口，页签撤掉后成为零消费导出（§12.16 硬闸会拦）；判据本体
  （`generateInputSchema` 的必填列）仍在 `workflow-generate-input` 与服务端。
- `tests/task-list-wire-contract.test.ts` 的 `submitGeneration` 一组随通路退役
  （文件里留了退役说明）；`VideoQueueModal.test.tsx` 改钉撤掉后的形态
  （无批量提交入口 / 队列照常渲染 / 空态指创作台）。
