## Fixed

- **尺寸配置表的本机覆盖改差集落盘**（#3973）：`saveSizePresetTable` 此前把
  `mergeSizePresetTable(raw, 项目默认)` 的**整份表**写进 `data/size-presets.json`
  —— 项目默认被「保存为项目默认（跟代码走）」改过之后，存过覆盖的机器拿不到
  新默认（覆盖文件把每一格都钉住了）。现在落盘前先对现读的项目默认取差集
  （新增纯函数 `diffSizePresetTable`），只留真改过的格子，与侧栏页签行为
  （`diffSidebarTabConfig`）/ 模式契约（`localOverrideDiff`）同一口径：
  项目默认后续改动能穿透到存过覆盖的机器，「改回默认」= 该格从覆盖里消失。
  存量整份覆盖文件不受影响（读侧合并语义不变）；在本机「恢复默认」或重新
  保存一次即迁移成差集。
