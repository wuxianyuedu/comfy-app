// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import {
  clearAllWorkflowRuns,
  registerWorkflowRun,
} from "~/lib/workflow-run-store";
import { WorkflowRunLogButton } from "./WorkflowRunLogButton";

afterEach(() => {
  cleanup();
  clearAllWorkflowRuns();
});

function run(over: Partial<Parameters<typeof registerWorkflowRun>[0]> = {}) {
  registerWorkflowRun({
    taskId: "t1",
    workflowId: "wf1",
    workflowName: "文生图",
    taskType: "t2i",
    startedAt: 1,
    status: "running",
    ...over,
  });
}

describe("WorkflowRunLogButton", () => {
  it("该工作流没有任何运行时不显示入口", () => {
    const { container } = render(
      <WorkflowRunLogButton workflowId="wf1" onOpen={() => undefined} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("有运行记录即显示入口，点击上抛打开", () => {
    run();
    const onOpen = vi.fn();
    render(<WorkflowRunLogButton workflowId="wf1" onOpen={onOpen} />);
    fireEvent.click(screen.getByTestId("wflib-log-open"));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("两个入口共用同一扇门：工坊封装页也能看到画布节点页发起的运行", () => {
    /* 运行时序互不干扰（ISSUE #611）：登记表同时容纳两边的任务，日志入口
     * 按工作流过一遍就能看到 —— 不会「一个在跑、另一个的执行日志点不出来」。 */
    run({ taskId: "canvas", source: "canvas-node" });
    run({ taskId: "test", startedAt: 2, source: "encapsulation-test" });
    render(
      <WorkflowRunLogButton
        workflowId="wf1"
        taskId="test"
        onOpen={() => undefined}
      />,
    );
    expect(screen.getByTestId("wflib-log-open")).toBeTruthy();
  });

  it("只看该工作流的运行（别的工作流不显示）", () => {
    run({ workflowId: "wf2" });
    const { container } = render(
      <WorkflowRunLogButton workflowId="wf1" onOpen={() => undefined} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
