## Fixed

- **暗色下温度行「↺ 恢复推荐默认」按钮背景看不清（ISSUE #3495 追评，指认的是
  本地模型配置温度这一处，而非模型弹窗）**：outline 基元在暗色的
  `bg-input/30` + `border-input` 落在行底（surface-row）上比行底还暗、边界
  ≈1.03:1。补 `dark:bg-ink/25` 填充 + `dark:border-ink/40` 描边 + `dark:text-ink`
  文字，与模型弹窗「重置」按钮同一处理。上一轮误改了模型弹窗的重置按钮
  （该按钮的可见性提升保留）。
