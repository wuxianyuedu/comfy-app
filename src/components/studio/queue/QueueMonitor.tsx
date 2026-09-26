"use client";

import { useQueueMonitor } from "./hooks/use-queue-monitor";
import { QueueMonitorView } from "./QueueMonitorView";

/**
 * 队列与运行 · 第④层（容器）：取 controller → 传给视图。
 * 不含任何业务规则（规范 17 §17.2）；`onOpenSettings` 是它唯一对外要的回调，
 * 由工作区页面给（离线时把用户送到能启动 ComfyUI 的那一处）。
 */
export function QueueMonitor({
  onOpenSettings,
}: {
  onOpenSettings: () => void;
}) {
  const c = useQueueMonitor();
  return <QueueMonitorView c={c} onOpenSettings={onOpenSettings} />;
}
