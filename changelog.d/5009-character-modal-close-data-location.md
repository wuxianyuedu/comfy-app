## Fixed

- **角色库详情弹窗关不掉**（ISSUE #5009 现场反馈）：弹层的 open 由 `detailId`
  派生，但关闭入口没有清 `detailId`，点 X / 遮罩 / Esc 都关不掉。补上
  `closeDetail`（与资产库同一套接线）。
- **角色库 / 资产库补登记「数据存放位置」**：两类数据各自登记库表
  （`characterProfile` / `asset`）与磁盘落点（`generated/character-library/<id>/`、
  `generated/assets/<id>/`）两条，设置页「数据存放位置」清单与徽标据此显示。
