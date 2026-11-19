## Fixed

- **工坊封装 / 画布节点页签的「执行日志」按钮摘要指向旧一次运行**（#4466）：
  两处用 `useMemo` 读模块级运行登记表、依赖只有 `workflowId` —— 第二次流程测试
  登记后摘要不重算，仍显示旧运行的「上次已完成」，与旁边新运行的呼吸点自相矛盾
  （日志弹窗打开才纠正）。新增 `useLatestRunTaskId` 钩子经 `useSyncExternalStore`
  订阅运行登记表（与 `WorkflowRunLogButton` 同口径），登记表一变即重算；两处
  调用点同批替换，过滤逻辑仍走既有出口 `latestRunForWorkflow`。
