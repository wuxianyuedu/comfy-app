## Fixed

- **队列面板「最近结果」里的「输出目录」点了没反应**：该按钮此前只调 `task.openFolder`，并把返回值里的 `comfyappUrl` 拿到就丢（从不导航），于是任何环境下都只弹一句「已交给系统打开输出目录」而资源管理器一动不动 —— 成功路径没有任何用例，所以没人发现。改为走仓库既有的「在文件管理器里定位」出口 `setting.revealPath`（本机 `explorer /select`，与日志面板点路径同一条）：`src/lib/history-detail-actions.ts` 新增 `revealTaskFolder()`，产物目录由 `taskOutputDir()` 算自 `<cwd>/generated`，天然落在该端点的检出目录闸门内，不再需要用户先装 `comfyapp://` 协议助手。同时把服务端返回的 `error: "directory missing"` 翻成「该任务尚未生成文件目录」（此前这句英文会原样弹给用户）。证据：`src/components/studio/queue/hooks/use-queue-monitor.ts`、`src/lib/history-detail-actions.ts`。
