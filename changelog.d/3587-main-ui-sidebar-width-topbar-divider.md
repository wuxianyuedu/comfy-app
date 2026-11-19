## Changed

- **主界面：侧边栏展开宽收窄到内容实需，顶栏标题左侧的分隔线不再钉在上沿（#3587）**：
  - 展开态导航宽 256px → 160px（`src/lib/layout-budget.ts` 的 `NAV_WIDTH_EXPANDED_PX`，
    全壳单一出处）：一行实需 112px（组内边距 16 + 按钮内边距 16 + 图标 16 + 图文间距 8
    + 四字汉字标签 56），取 160 留一档余量，再宽只是空白、把那部分让给内容区；
    「左轨何时自动收起」的阈值由同一笔账推导（1279px → 1183px），窄窗让位的语义不变。
  - 顶栏「开合按钮 ↔ 页面标题」那根 16px 短竖线此前被钉在顶栏上沿成一截孤线：竖档
    Separator 基元的 `data-vertical:self-stretch` 在显式高度（`h-4`）下按 flexbox
    规则退化为顶对齐；改用**同形变体** `data-vertical:self-center` 覆盖（cn 合并时
    同组同变体会把基类的 stretch 挤掉，覆盖是确定性的），短线回到垂直居中。
  - 用例：TopBar 新增竖线对齐契约（渲染结果带 `self-center`、不带 `self-stretch`）；
    `sidebar-auto-collapse` 的窗宽夹具改从 `layout-budget` 推导（原 1200 字面量在
    新阈值下已落到宽窗侧 —— 写死窗宽正是这种漂移的现场）。
