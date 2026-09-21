## Changed

- **全局关闭 React Query 的「窗口聚焦即重取」（性能）**：`src/trpc/query-client.ts`
  的 `createQueryClient` 默认只设了 `staleTime:30s`，`refetchOnWindowFocus` 沿用
  RQ 默认的 `true`。在 Tauri 桌面壳（WebView2）里，每次 alt-tab / 重新获得焦点都会
  把所有已 stale 的查询一次性打回网络（含 `task.list` 带图、`project.outputs`
  等重接口），表现为「切回来就卡一下」。现把全局默认改为 `refetchOnWindowFocus:false`，
  新鲜度交给 30s `staleTime` 与页面/前台时的显式刷新动作。工作流库等个别查询此前
  已就近设 `false`，本改动把该口径收敛为全局一致。
