## Added

- **日志面板接入壳侧启动日志**：应用运行后在日志面板里现在也能看到双击启动链路最早的两份现场——「壳侧编排」（`log/launcher/shell-launch.log`，启动报告与编排器输出转发）与「壳日志」（`log/shell/shell.log`，壳自己的诊断），新增两个轮询来源并在来源下拉、级别计数与「设置 → 日志」分类开关里同步登记。两路**不下发会话起点**（会话锚点晚于壳的启动报告，裁剪会把「为什么起不来」的头几行误判成历史丢掉），旧运行的行靠行内时间戳区分。证据：`src/app/api/logs/current/route.ts`（`resolveSourceFile`）、`src/components/studio/logs/LogProvider.tsx`。
