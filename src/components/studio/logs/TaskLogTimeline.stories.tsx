import { useSyncExternalStore } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs";

import { TaskLogEmptyHint, TaskLogTimeline } from "~/components/studio/logs/TaskLogTimeline";
import {
  getWorkflowRunStoreSnapshot,
  subscribeWorkflowRunStore,
} from "~/lib/workflow/workflow-run-store";
import {
  runSceneError,
  runSceneName,
  type RunSceneName,
} from "../../../../.storybook/workflow-run-sources";

/**
 * 任务执行日志的**时间线主体**（级别页签 + 自动滚动 + 虚拟列表 + 底栏计数）。它是**纯 props** 的；
 * `logs` 真机来自 `workflow-run-store`，story 走 `parameters.runScene` 调真 action 落板，
 * 去重与截尾照常由生产代码算。要看：页签计数、底栏截尾、失败横幅与 error 行成对、空态占位。
 */
const meta = {
  title: "Studio/Logs/TaskLogTimeline",
  component: TaskLogTimeline,
  parameters: { runScene: "completed" },
} satisfies Meta<typeof TaskLogTimeline>;

export default meta;

/* story 的类型取自**适配件**：`logs` 从真 store 快照读，不在文件里手填。 */
type Story = StoryObj<typeof TaskLogTimelineHarness>;

/**
 * 适配件：照 `WorkflowRunLogModal` 的接线读真 store（同一个 `useSyncExternalStore`
 * 三元组），日志从那次运行里取。
 * 不走 `runSceneLogs()` 直接拿数组——那样会绕过 store 的去重与截尾；这里读的是落板后的末态。
 */
function TaskLogTimelineHarness({
  scene = "completed",
  withTopSlot = false,
}: {
  scene?: RunSceneName;
  withTopSlot?: boolean;
}) {
  const snapshot = useSyncExternalStore(
    subscribeWorkflowRunStore,
    getWorkflowRunStoreSnapshot,
    getWorkflowRunStoreSnapshot,
  );
  const run = snapshot.runs.find((r) => r.errorMessage !== undefined) ?? snapshot.runs[0];
  const logs = run?.logs ?? [];
  const errorMessage = runSceneError(scene);
  return (
    <div className="bg-panel-deep border-border-strong flex h-96 w-225 max-w-full flex-col overflow-hidden rounded-md border">
      <div className="border-border-strong text-ink-muted flex h-9 shrink-0 items-center border-b px-4 text-xs">
        {runSceneName(scene)} · {logs.length} 条
      </div>
      <TaskLogTimeline
        emptySlot={<TaskLogEmptyHint message="运行生成后此处会显示执行步骤日志" />}
        listClassName="bg-panel-deep/60"
        logs={logs}
        rowTestId="story-log-line"
        topSlot={
          withTopSlot && errorMessage !== undefined ? (
            <div className="border-destructive/30 bg-destructive/6 text-destructive mb-2 flex-col gap-1 rounded border p-2 text-sm">
              <div className="wrap-break-word whitespace-pre-wrap">{errorMessage}</div>
            </div>
          ) : null
        }
      />
    </div>
  );
}

/** 默认（`completed`）：一次成功运行的完整步骤序列。 */
export const Completed: Story = {
  render: () => <TaskLogTimelineHarness />,
};

/**
 * 失败（`failed`）：顶部横幅与时间线里那条 error 行**成对**出现
 * —— 这正是 `failWorkflowRun()` 把原因同时写两处的原因（用户按级别筛到「错误」
 * 时也要看得到为什么）。
 */
export const FailedWithBanner: Story = {
  parameters: { runScene: "failed" },
  render: () => <TaskLogTimelineHarness scene="failed" withTopSlot />,
};

/** 340 条：一页装不完时的**截尾口**（底栏那行「显示最近 N 条」）。 */
export const LongTask: Story = {
  parameters: { runScene: "longTask" },
  render: () => <TaskLogTimelineHarness scene="longTask" />,
};

/** 只有警告与错误：级别页签上其余几档计数为 0 的那一档现场。 */
export const WarningsOnly: Story = {
  parameters: { runScene: "warnings" },
  render: () => <TaskLogTimelineHarness scene="warnings" />,
};

/** 空态：登记了运行、日志还没来 —— 走消费方给的 `emptySlot`（组件不编文案）。 */
export const Empty: Story = {
  parameters: { runScene: "empty" },
  render: () => <TaskLogTimelineHarness scene="empty" />,
};
