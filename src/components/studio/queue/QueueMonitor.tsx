"use client";

import { useQueueMonitor } from "./hooks/use-queue-monitor";
import { useQueueModelTree } from "./hooks/use-queue-model-tree";
import { QueueMonitorView } from "./QueueMonitorView";
import { QueueTaskLogModal } from "./QueueTaskLogModal";

/**
 * 队列与运行 · 第④层（容器）：取 controller → 传给视图 → 挂弹层。不含业务规则（规范 17 §17.2）。
 * `onOpenComfyui` 是唯一对外回调：离线时把用户送到能启动 ComfyUI 的侧栏「ComfyUI」页（ISSUE #1900）。
 * 左树的候选与选中态走独立的 `useQueueModelTree`（ISSUE #5019）：树条目与测试
 * 模型页同一份候选口径，选中一片叶子 = 按模型过滤三段列表。
 */
export function QueueMonitor({ onOpenComfyui }: { onOpenComfyui: () => void }) {
  const c = useQueueMonitor();
  const tree = useQueueModelTree();
  return (
    <>
      <QueueMonitorView c={c} onOpenComfyui={onOpenComfyui} tree={tree} />
      {/* key = 任务 id：换一条查看时整弹窗重挂，流订阅与筛选状态随之重置
       * （logRow 是 openLog 那一刻的快照，身份稳定，不会随 2s 轮询抖动）。 */}
      {c.logRow ? (
        <QueueTaskLogModal key={c.logRow.id} onClose={c.closeLog} task={c.logRow} />
      ) : null}
    </>
  );
}
