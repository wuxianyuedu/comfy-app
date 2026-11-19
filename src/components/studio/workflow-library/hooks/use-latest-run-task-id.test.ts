// useLatestRunTaskId 的回归契约（#4466）：
//  1) 没跑过 → null；
//  2) 登记表变化即重算 —— 第二次运行登记后指向最新一次（旧实现用 useMemo 读
//     模块级登记表、依赖只有 workflowId，第二次运行后仍指向旧运行）；
//  3) 按 workflowId 与 source 过滤。
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { clearAllWorkflowRuns, registerWorkflowRun } from "~/lib/workflow/workflow-run-store";

import { useLatestRunTaskId } from "./use-latest-run-task-id";

beforeEach(() => {
  clearAllWorkflowRuns();
});

afterEach(() => {
  clearAllWorkflowRuns();
});

describe("useLatestRunTaskId（#4466）", () => {
  it("没跑过 → null", () => {
    const { result } = renderHook(() => useLatestRunTaskId("wf-1", "encapsulation-test"));
    expect(result.current).toBeNull();
  });

  it("登记表变化即重算：第二次运行后指向最新一次（回归：旧 memo 指向旧运行）", () => {
    const { result } = renderHook(() => useLatestRunTaskId("wf-1", "encapsulation-test"));
    act(() => {
      registerWorkflowRun({
        taskId: "t1",
        workflowId: "wf-1",
        workflowName: "n",
        taskType: "t2i",
        startedAt: 1,
        status: "running",
        source: "encapsulation-test",
      });
    });
    expect(result.current).toBe("t1");
    act(() => {
      registerWorkflowRun({
        taskId: "t2",
        workflowId: "wf-1",
        workflowName: "n",
        taskType: "t2i",
        startedAt: 2,
        status: "running",
        source: "encapsulation-test",
      });
    });
    expect(result.current).toBe("t2");
  });

  it("按 workflowId 与 source 过滤", () => {
    const { result } = renderHook(() => useLatestRunTaskId("wf-1", "encapsulation-test"));
    act(() => {
      registerWorkflowRun({
        taskId: "other-wf",
        workflowId: "wf-2",
        workflowName: "n",
        taskType: "t2i",
        startedAt: 3,
        source: "encapsulation-test",
      });
      registerWorkflowRun({
        taskId: "other-src",
        workflowId: "wf-1",
        workflowName: "n",
        taskType: "t2i",
        startedAt: 4,
        source: "canvas-node",
      });
      registerWorkflowRun({
        taskId: "mine",
        workflowId: "wf-1",
        workflowName: "n",
        taskType: "t2i",
        startedAt: 5,
        source: "encapsulation-test",
      });
    });
    expect(result.current).toBe("mine");
  });
});
