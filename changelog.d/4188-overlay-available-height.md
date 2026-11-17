## Fixed

- **下拉菜单 / 弹层统一按「真实可用空间」限高，不再超出窗口**（#4188）：锚定浮层各族
  （popover / segment-popover / hover-card / select-menu / tooltip，连同已有的
  dropdown-menu / select / context-menu / multi-mode-select）的 Popup 一律
  `max-h-(--available-height)` + 纵向滚动——高度由 base-ui 定位器按触发点现场算出，
  取代「60vh / 85vh / 固定档」这类与触发位置无关的写死比例；触发点靠下时浮层自动
  收紧（必要时的翻转照旧）并在面板内滚动，不再压到状态栏 / 溢出窗口。
