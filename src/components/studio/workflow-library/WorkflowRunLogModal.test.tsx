// 工作流库执行日志弹窗的两个兜底契约（ISSUE #4469）：
// ① 运行被登记表（上限 32）挤掉后 run === null，不能再兜底成 running —— 否则头部挂
//    「运行中」、取消按钮指向已消失的任务、raw-cli 每 1.5s 永久轮询查不到的 id。
// ② 取消失败（网络断 / 404）必须写进弹窗顶部横幅，不再静默吞掉。
//
// 子组件（Dialog / 时间线 / raw-cli）与 IO hook 全部替身化，只留被测的状态兜底与
// 取消失败通道；这样断言的是用户可见结果（徽标文案 / 按钮 / 横幅 / 传给 raw-cli 的
// running），不依赖真实 SSE 或服务端。

import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { clearAllWorkflowRuns, registerWorkflowRun } from "~/lib/workflow/workflow-run-store";

/* useCancelTask：把 onFailed 存到模块级变量，cancel() 模拟失败并回调它。
 * 测试里点「取消」即可驱动失败横幅，无需真实 /cancel 请求。 */
let capturedOnFailed: ((reason: string) => void) | null = null;
let cancelCalls = 0;
vi.mock("../project-canvas/hooks/use-cancel-task", () => ({
  useCancelTask: ({ onFailed }: { onFailed: (reason: string) => void }) => {
    capturedOnFailed = onFailed;
    return {
      cancelling: false,
      cancel: () => {
        cancelCalls += 1;
        onFailed("取消请求异常：网络中断");
        return Promise.resolve();
      },
    };
  },
}));

/* raw-cli 弹窗：把 running 透到 DOM 上，直接断言「是否还在轮询」。 */
vi.mock("./WorkflowRunRawCliModal", () => ({
  WorkflowRunRawCliModal: ({ running }: { running: boolean }) => (
    <div data-running={String(running)} data-testid="raw-cli-stub" />
  ),
}));

/* 时间线：topSlot / emptySlot 原样渲染，便于断言顶部横幅与空态文案。 */
vi.mock("~/components/studio/logs/TaskLogTimeline", () => ({
  TaskLogTimeline: ({ emptySlot, topSlot }: { emptySlot: ReactNode; topSlot: ReactNode }) => (
    <div data-testid="timeline-stub">
      {topSlot}
      {emptySlot}
    </div>
  ),
  TaskLogEmptyHint: ({ message }: { message: string }) => <div>{message}</div>,
}));

/* Dialog：去掉 portal / 焦点锁，保留可查询节点。 */
vi.mock("~/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

import { WorkflowRunLogModal } from "./WorkflowRunLogModal";

beforeEach(() => {
  clearAllWorkflowRuns();
  capturedOnFailed = null;
  cancelCalls = 0;
});
afterEach(() => {
  cleanup();
  clearAllWorkflowRuns();
});

function makeRun(over: Partial<Parameters<typeof registerWorkflowRun>[0]> = {}) {
  registerWorkflowRun({
    taskId: "task-1",
    workflowId: "wf-1",
    workflowName: "测试工作流",
    taskType: "t2i",
    startedAt: 1,
    status: "running",
    ...over,
  });
}

function renderModal(viewTaskId: string | null) {
  return render(
    <WorkflowRunLogModal
      onClose={() => undefined}
      onViewTaskIdChange={() => undefined}
      open
      viewTaskId={viewTaskId}
      workflowId="wf-1"
    />,
  );
}

describe("WorkflowRunLogModal — 运行查不到时的中性兜底（#4469）", () => {
  it("viewTaskId 指向被挤掉的运行（run === null）→ 不挂运行中、无取消按钮、raw-cli 停止轮询", () => {
    // 登记表里没有 task-1：模拟它被上限 32 挤掉，但弹窗仍指着它。
    renderModal("task-1");

    expect(screen.getByText("记录已清理")).toBeTruthy();
    expect(screen.queryByText("运行中")).toBeNull();
    expect(screen.queryByTestId("wflib-log-cancel")).toBeNull();
    expect(screen.getByTestId("raw-cli-stub").dataset.running).toBe("false");
    expect(screen.getByText("该运行的记录已清理，日志不可再取")).toBeTruthy();
  });

  it("登记在且明确 running → 保留运行中徽标、取消按钮、raw-cli 继续轮询", () => {
    makeRun({ status: "running" });
    renderModal("task-1");

    expect(screen.getByText("运行中")).toBeTruthy();
    expect(screen.getByTestId("wflib-log-cancel")).toBeTruthy();
    expect(screen.getByTestId("raw-cli-stub").dataset.running).toBe("true");
  });

  it("登记在但 status 未到（刚登记）仍按运行中处理，不误判为已清理", () => {
    makeRun({ status: undefined });
    renderModal("task-1");

    expect(screen.getByText("运行中")).toBeTruthy();
    expect(screen.queryByText("记录已清理")).toBeNull();
  });
});

describe("WorkflowRunLogModal — 取消失败可见（#4469）", () => {
  it("点取消失败 → 顶部横幅显示失败原因，不再静默", () => {
    makeRun({ status: "running" });
    renderModal("task-1");

    fireEvent.click(screen.getByTestId("wflib-log-cancel"));

    expect(cancelCalls).toBe(1);
    expect(screen.getByTestId("wflib-log-cancel-error").textContent).toContain("取消请求异常");
  });

  it("onFailed 通道确实接到本弹窗（不是空函数）", () => {
    renderModal("task-1");
    expect(capturedOnFailed).not.toBeNull();
  });
});
