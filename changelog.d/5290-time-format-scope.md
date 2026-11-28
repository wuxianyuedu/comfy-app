## Changed
- 展示时间统一出口补接漏掉的 4 处（ISSUE #5290）：模型测试运行历史（时刻 + aria-label）、执行日志逐行、角色详情历史时间改走 `~/lib/time-format` 的 `formatClock` / `formatDate`，不再裸调 `Date.toLocale*`，输出固定 zh-CN / 24 小时制不随宿主 locale 漂移。两处列表渲染把逐行时刻纳入 `useMemo` 派生，轮询刷新时不再每行重复 `new Date` + `Intl` 格式化；加形态守卫用例（正/负控）与 11 条行为用例。
