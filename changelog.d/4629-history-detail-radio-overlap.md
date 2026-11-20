## Fixed

- **任务详情弹窗「放大 / 局部重绘」的模式单选文字逐字竖排、互相重叠**：选项文字此前被当作
  children 塞进 `RadioGroupItem`（16px 的单选圆圈）里，装不下就溢出压到相邻选项与下一行标签。
  改回 radio-group 的既定用法（P78 判据，同设置页 CPU 限制档）：`Item` 只渲染单选圈，
  选项文字在圈旁用 `<Label htmlFor>` 关联。
