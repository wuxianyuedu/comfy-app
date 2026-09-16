// @vitest-environment jsdom
// 保存 mutation 的窄接口单测。存在的意义不是测 tRPC，而是锁住两件事：
//   1. 视图层拿到的是 WorkflowSaver（窄接口），不是 tRPC mutation 对象
//      —— 这样 useWorkflowPersistence 可以塞假实现跑测试；
//   2. mutate / mutateAsync 确实转发到同一个底层 mutation。

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useWorkflowSaveMutation } from "./use-workflow-save";

const mutate = vi.fn();
const mutateAsync = vi.fn();

vi.mock("~/trpc/react", () => ({
  api: {
    workflow: {
      update: {
        useMutation: () => ({
          mutate: (...args: unknown[]) => mutate(...args) as never,
          mutateAsync: (...args: unknown[]) => mutateAsync(...args) as never,
          isPending: false,
          isIdle: true,
          isSuccess: false,
          isError: false,
          reset: vi.fn(),
        }),
      },
    },
  },
}));

beforeEach(() => {
  mutate.mockReset();
  mutateAsync.mockReset();
  mutateAsync.mockResolvedValue({ id: "wf-1" });
});

afterEach(cleanup);

describe("useWorkflowSaveMutation", () => {
  it("mutate 转发输入", () => {
    const { result } = renderHook(() => useWorkflowSaveMutation());
    result.current.mutate({ id: "wf-1", positions: { "1": [0, 0] } });
    expect(mutate).toHaveBeenCalledWith(
      { id: "wf-1", positions: { "1": [0, 0] } },
      undefined,
    );
  });

  /* 第二实参不是装饰：`onError` 是「拖拽落盘失败」这类静默写暴露给用户的唯一
   * 通道（useWorkflowPersistence 两处拖拽落盘都在传）。断言写成全参精确匹配，
   * 是为了让「第二参被实现吃掉」也一并暴露 —— 只比第一参等于放过这条通道本身。 */
  it("mutate 透传 options.onError（拖拽落盘失败的用户可见出口）", () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useWorkflowSaveMutation());
    result.current.mutate({ id: "wf-1" }, { onError });
    expect(mutate).toHaveBeenCalledWith({ id: "wf-1" }, { onError });
  });

  it("mutateAsync 转发输入并把结果透出（点「保存」后要据此关弹窗）", async () => {
    const { result } = renderHook(() => useWorkflowSaveMutation());
    await expect(result.current.mutateAsync({ id: "wf-1" })).resolves.toEqual({
      id: "wf-1",
    });
    expect(mutateAsync).toHaveBeenCalledWith({ id: "wf-1" });
  });

  it("mutateAsync 失败向外抛（handleSave 靠它设 error）", async () => {
    mutateAsync.mockRejectedValue(new Error("保存失败"));
    const { result } = renderHook(() => useWorkflowSaveMutation());
    await expect(result.current.mutateAsync({ id: "wf-1" })).rejects.toThrow(
      "保存失败",
    );
  });

  it("只暴露 mutate / mutateAsync —— 视图拿不到 mutation 状态（S3 的目的）", () => {
    const { result } = renderHook(() => useWorkflowSaveMutation());
    expect(Object.keys(result.current).sort()).toEqual([
      "mutate",
      "mutateAsync",
    ]);
  });
});
