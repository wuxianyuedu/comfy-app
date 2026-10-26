## Fixed

- 退役路由 `/create/[id]` 的最后两处跳转点改回在役入口（#2422）：工作区页
  `handleOpenProject` 的真实项目分支改为「设为活跃 + 落项目主页」（与
  `handleOpenCanvasProject` 并轨）；视频队列弹窗 `onOpenTask` 改为切到历史视图
  （任务详情弹层 `HistoryDetailModal` 挂在那里）。四条仍把该路由当在役出口的
  注释（HomePage / HistoryList / HomePage.projects.test）同步改口径。
