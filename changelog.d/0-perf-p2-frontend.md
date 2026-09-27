## Fixed
- 三处「只追加不裁剪 / 逐张 setState」的渐进式增长与重渲染（合规债 P2）：
  - `src/app/workspace/page.tsx` 的视图历史栈 `navigateTo` 增加上限裁剪（保留最近 `WORKSPACE_VIEW_HISTORY_MAX = 50`），避免无限增长。
  - `use-workshop-pipeline` 的 `appendLog` 对结构化执行日志 `slice(-EXTRACT_LOG_MAX_ENTRIES = 2000)`，长流程不再无限增长。
  - `use-training-studio` 的数据集逐张上传由「循环内逐张 setState」改为上传完成后一次性并入，避免 N 次重渲染。
- 未改 / 已失效项（说明）：审计中 `ModelCard.tsx` / `WorkflowListItem.tsx` 的 `React.memo` 击穿——当前 `ModelCard` 已无 `React.memo`、`WorkflowListItem.tsx` 已并入 `WorkflowLibraryList.tsx`，按当前代码不适用；`workspace/page.tsx` 与 `use-task-step-log-stream.ts` 的 `set-state-in-effect` 抑制属合法外部同步（sessionStorage 恢复 / EventSource 关闭复位 / store 订阅），保留抑制。`health` 路由直连 db、`repository-user` 逐条写两项属 lib/server 改动，单独 PR 处理以便隔离评审。
