// @vitest-environment jsdom
// 「强制取消」动作单测。三条关键回归：
//   1. 取消失败必须走到 onFailed（否则按钮会一直挂在 running，用户再点无效）；
//   2. cancelling 态在成功与失败两条路径上都要复位；
//   3. taskId 缺失时**不提前 return**，而是告诉用户没送达 —— 旧实现会吞掉
//      「status: running 已写入、taskId 还没 patch 进来」这段窗口内的点击。

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cancelTask } from "@/lib/task-cancel-client";

import { useCancelTask } from "./use-cancel-task";

vi.mock("@/lib/task-cancel-client", () => ({ cancelTask: vi.fn() }));

const mockedCancel = vi.mocked(cancelTask);

beforeEach(() => {
  mockedCancel.mockReset();
});

afterEach(cleanup);

describe("useCancelTask", () => {
  it("成功：调用一次 /cancel，cancelling 复位，不触发失败回调", async () => {
    mockedCancel.mockResolvedValue(undefined);
    const onFailed = vi.fn();
    const { result } = renderHook(() =>
      useCancelTask({ taskId: "t-1", onFailed }),
    );

    await act(async () => {
      await result.current.cancel();
    });

    expect(mockedCancel).toHaveBeenCalledWith("t-1");
    expect(onFailed).not.toHaveBeenCalled();
    expect(result.current.cancelling).toBe(false);
  });

  it("失败：错误文案带上前缀，cancelling 复位（失败路径必须有可见出口）", async () => {
    mockedCancel.mockRejectedValue(new Error("任务已完成"));
    const onFailed = vi.fn();
    const { result } = renderHook(() =>
      useCancelTask({ taskId: "t-1", onFailed }),
    );

    await act(async () => {
      await result.current.cancel();
    });

    expect(onFailed).toHaveBeenCalledWith("取消请求异常：任务已完成");
    expect(result.current.cancelling).toBe(false);
  });

  it("失败但抛值非 Error：走兜底文案，不渲染 [object Object]", async () => {
    mockedCancel.mockRejectedValue({ code: 500 });
    const onFailed = vi.fn();
    const { result } = renderHook(() =>
      useCancelTask({ taskId: "t-1", onFailed }),
    );

    await act(async () => {
      await result.current.cancel();
    });

    expect(onFailed).toHaveBeenCalledWith("取消请求异常：未知错误");
  });

  it("空 message 的 Error 也走兜底（new Error(\"\") 不该渲染空白提示条）", async () => {
    mockedCancel.mockRejectedValue(new Error(""));
    const onFailed = vi.fn();
    const { result } = renderHook(() =>
      useCancelTask({ taskId: "t-1", onFailed }),
    );

    await act(async () => {
      await result.current.cancel();
    });

    expect(onFailed).toHaveBeenCalledWith("取消请求异常：未知错误");
  });

  it("taskId 缺失：不发请求，但明确告知用户（不静默吞掉点击）", async () => {
    const onFailed = vi.fn();
    const { result } = renderHook(() =>
      useCancelTask({ taskId: null, onFailed }),
    );

    await act(async () => {
      await result.current.cancel();
    });

    expect(mockedCancel).not.toHaveBeenCalled();
    expect(onFailed).toHaveBeenCalledWith("取消请求异常：尚未生成 taskId");
    expect(result.current.cancelling).toBe(false);
  });

  it("异步回调里读到的是最新 taskId（ref 持有，不是闭包快照）", async () => {
    mockedCancel.mockResolvedValue(undefined);
    const onFailed = vi.fn();
    const { result, rerender } = renderHook(
      ({ taskId }: { taskId: string | null }) =>
        useCancelTask({ taskId, onFailed }),
      { initialProps: { taskId: "t-old" } },
    );

    rerender({ taskId: "t-new" });
    await act(async () => {
      await result.current.cancel();
    });

    expect(mockedCancel).toHaveBeenCalledWith("t-new");
  });

  it("取消期间 cancelling 为 true，返回后复位（按钮靠它禁用防重复点击）", async () => {
    let resolve!: () => void;
    mockedCancel.mockImplementation(
      () => new Promise<void>((res) => { resolve = res; }),
    );
    const onFailed = vi.fn();
    const { result } = renderHook(() =>
      useCancelTask({ taskId: "t-1", onFailed }),
    );

    let pending!: Promise<void>;
    await act(async () => {
      pending = result.current.cancel();
    });
    expect(result.current.cancelling).toBe(true);

    await act(async () => {
      resolve();
      await pending;
    });
    expect(result.current.cancelling).toBe(false);
  });
});
