## Fixed

- **下拉弹层位置随选中项上下移动，选中末尾项时上半截出屏**：base-ui Select 的
  `alignItemWithTrigger` **默认为 true**（`SelectPositioner.js`），它把「已选项」
  对齐到触发器上 —— 即原生 `<select>` 的观感。`SelectMenu` 未显式关闭，于是工作流
  库页头的筛选下拉每换一次选中项就挪一次位置。现在 `SelectMenu` 显式传
  `alignItemWithTrigger={false}`，弹层恒从触发器下方展开、位置与选中项无关。

  回归护栏：`src/components/ui/select-menu.test.tsx`（弹层带
  `data-align-trigger="false"`）。

## Changed

- `ui/select` 的 `SelectContent` 默认 `alignItemWithTrigger` 由 `true` 改为
  **`false`**：不再把「已选项」对齐到触发器，弹层位置因此与选中项无关，其余
  `SelectContent` 消费点不会复现同款漂移。需要原生观感（弹层盖住触发器）的调用处
  显式传 `true`；`LogPanelOriginSelect` 本来就是显式 `false`，不受影响。
  日志面板那份口径（规范 07 §7.21.4）与此一致，故文档无需改。
