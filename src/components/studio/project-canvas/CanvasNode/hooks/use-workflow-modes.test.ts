// @vitest-environment jsdom
// 多模式保存的「乐观更新 + 失败回滚」单测。
// 不回滚会在界面上留下服务端根本没有的模式 chip（zombie chip），
// 刷新后消失，用户会以为数据丢了 —— 这条是本文件存在的理由。

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { patchWorkflow } from "~/lib/workflow/workflow-mutations";

import { useWorkflowModes } from "./use-workflow-modes";

vi.mock("~/lib/workflow/workflow-mutations", () => ({
  patchWorkflow: vi.fn(),
}));

const mockedPatch = vi.mocked(patchWorkflow);

beforeEach(() => {
  mockedPatch.mockReset();
  mockedPatch.mockResolvedValue(undefined);
});

afterEach(cleanup);

describe("useWorkflowModes", () => {
  it("成功：先本地乐观更新，再落库（modes + defaultMode 一起发）", async () => {
    const setModes = vi.fn();
    const onFailed = vi.fn();
    const { result } = renderHook(() =>
      useWorkflowModes({
        workflowId: "wf-1",
        modes: { modes: ["默认"], defaultMode: "默认" },
        setModes,
        onFailed,
      }),
    );

    await act(async () => {
      await result.current.saveModes({
        modes: ["默认", "高清"],
        defaultMode: "高清",
      });
    });

    expect(setModes).toHaveBeenCalledWith({
      modes: ["默认", "高清"],
      defaultMode: "高清",
    });
    expect(mockedPatch).toHaveBeenCalledWith({
      id: "wf-1",
      modes: ["默认", "高清"],
      defaultMode: "高清",
    });
    expect(onFailed).not.toHaveBeenCalled();
  });

  it("失败：回滚到旧 modes，并给节点级错误文案", async () => {
    mockedPatch.mockRejectedValue(new Error("保存模式失败，请重试"));
    const setModes = vi.fn();
    const onFailed = vi.fn();
    const previous = { modes: ["默认"], defaultMode: "默认" };
    const { result } = renderHook(() =>
      useWorkflowModes({
        workflowId: "wf-1",
        modes: previous,
        setModes,
        onFailed,
      }),
    );

    await act(async () => {
      await result.current.saveModes({
        modes: ["默认", "高清"],
        defaultMode: "高清",
      });
    });

    expect(setModes).toHaveBeenLastCalledWith(previous);
    expect(onFailed).toHaveBeenCalledWith("保存模式失败，请重试");
  });

  it("失败且抛值非 Error：走兜底文案（不渲染 [object Object]）", async () => {
    mockedPatch.mockRejectedValue({ code: "INTERNAL" });
    const onFailed = vi.fn();
    const { result } = renderHook(() =>
      useWorkflowModes({
        workflowId: "wf-1",
        modes: null,
        setModes: vi.fn(),
        onFailed,
      }),
    );

    await act(async () => {
      await result.current.saveModes({ modes: ["a"], defaultMode: "a" });
    });

    expect(onFailed).toHaveBeenCalledWith("保存模式失败，请重试");
  });

  it("modes 为 null 时回滚到空模式（不会把 null 写回 state 引发后续判空）", async () => {
    mockedPatch.mockRejectedValue(new Error("网络错误"));
    const setModes = vi.fn();
    const { result } = renderHook(() =>
      useWorkflowModes({
        workflowId: "wf-1",
        modes: null,
        setModes,
        onFailed: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.saveModes({ modes: ["a"], defaultMode: "a" });
    });

    expect(setModes).toHaveBeenLastCalledWith({ modes: [], defaultMode: null });
  });

  it("无 workflowId（节点还没选工作流）：不发请求也不报错", async () => {
    const setModes = vi.fn();
    const onFailed = vi.fn();
    const { result } = renderHook(() =>
      useWorkflowModes({
        workflowId: undefined,
        modes: null,
        setModes,
        onFailed,
      }),
    );

    await act(async () => {
      await result.current.saveModes({ modes: ["a"], defaultMode: "a" });
    });

    expect(mockedPatch).not.toHaveBeenCalled();
    expect(setModes).not.toHaveBeenCalled();
    expect(onFailed).not.toHaveBeenCalled();
  });
});
