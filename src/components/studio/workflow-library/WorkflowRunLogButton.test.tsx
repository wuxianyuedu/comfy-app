// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import {
  clearAllWorkflowRuns,
  registerWorkflowRun,
} from "~/lib/workflow/workflow-run-store";
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

  it("两边的运行共用同一扇门：登记表里有谁在跑都看得到", () => {
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

  it("alwaysVisible：没跑过也显示入口，状态说「暂无运行」（详情头部那扇固定门）", () => {
    /* 入口位置不随「有没有跑过」变化 —— 头部这扇门要随时点得开，弹窗里
       自己给空态文案。 */
    render(
      <WorkflowRunLogButton
        workflowId="wf1"
        alwaysVisible
        onOpen={() => undefined}
      />,
    );
    expect(screen.getByTestId("wflib-log-open").textContent).toContain(
      "暂无运行",
    );
  });

  it("running 缺省时按登记表自己判定：还有没收尾的运行就亮呼吸点", () => {
    run();
    render(<WorkflowRunLogButton workflowId="wf1" onOpen={() => undefined} />);
    expect(
      screen.getByTestId("wflib-log-open").querySelector(".animate-pulse"),
    ).toBeTruthy();
  });

  it("都收尾了就不亮呼吸点（缺省判定不会一直闪）", () => {
    run({ status: "done" });
    render(<WorkflowRunLogButton workflowId="wf1" onOpen={() => undefined} />);
    expect(
      screen.getByTestId("wflib-log-open").querySelector(".animate-pulse"),
    ).toBeNull();
  });

  it("只看该工作流的运行（别的工作流不显示）", () => {
    run({ workflowId: "wf2" });
    const { container } = render(
      <WorkflowRunLogButton workflowId="wf1" onOpen={() => undefined} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
