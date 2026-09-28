"use client";

import { useQueueMonitor } from "./hooks/use-queue-monitor";
import { QueueMonitorView } from "./QueueMonitorView";
import { QueueTaskLogModal } from "./QueueTaskLogModal";

/**
 * 队列与运行 · 第④层（容器）：取 controller → 传给视图 → 挂弹层。
 * 不含任何业务规则（规范 17 §17.2）；`onOpenSettings` 是它唯一对外要的回调，
 * 由工作区页面给（离线时把用户送到能启动 ComfyUI 的那一处）。
 */
export function QueueMonitor({
  onOpenSettings,
}: {
  onOpenSettings: () => void;
}) {
  const c = useQueueMonitor();
  return (
    <>
      <QueueMonitorView c={c} onOpenSettings={onOpenSettings} />
      {/* key = 任务 id：换一条查看时整弹窗重挂，流订阅与筛选状态随之重置
       * （logRow 是 openLog 那一刻的快照，身份稳定，不会随 2s 轮询抖动）。 */}
      {c.logRow ? (
        <QueueTaskLogModal
          key={c.logRow.id}
          task={c.logRow}
          onClose={c.closeLog}
        />
      ) : null}
    </>
  );
}
