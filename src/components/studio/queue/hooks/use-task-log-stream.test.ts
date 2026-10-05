// 队列执行日志流（第②层）的行为单测。
//
// 真正会坏掉的行为在这里锁住：
//   · **换任务要重置** —— 上一个任务的日志/终态漏进下一个弹窗，比空着更误导；
//   · **累积要有上限** —— 长任务的 progress 行能到几千条，不截尾就是把 state 撑大；
//   · **卸载后到达的回调不许 setState** —— EventSource 关闭是异步的，closer 之后的
//     迟到帧会把 React 打出「卸载后更新」警告。
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as GenerationClient from "~/lib/workshop/generation-client";
import type {
  TaskLogEntry,
  TaskWatchHandlers,
} from "~/lib/workshop/generation-client";

const watchTaskMock = vi.hoisted(() => vi.fn());

vi.mock("~/lib/workshop/generation-client", async (importOriginal) => {
  const actual = await importOriginal<typeof GenerationClient>();
  return { ...actual, watchTask: watchTaskMock };
});

import { useTaskLogStream } from "./use-task-log-stream";

function logEntry(msg: string): TaskLogEntry {
  return { t: Date.now(), level: "info", msg };
}

/** 当前订阅的 handlers 与 closer：用例直接对它们注入帧。 */
let handlers: TaskWatchHandlers;
const closer = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  watchTaskMock.mockImplementation((_taskId: string, h: TaskWatchHandlers) => {
    handlers = h;
    return closer;
  });
});

afterEach(cleanup);

describe("useTaskLogStream", () => {
  it("打开即订阅，onLog 逐条累积", () => {
    const { result } = renderHook(() => useTaskLogStream("t-1"));
    expect(watchTaskMock).toHaveBeenCalledTimes(1);
    expect(watchTaskMock).toHaveBeenCalledWith("t-1", expect.anything());
    /* 订阅要带落定回调：没有它，弹窗徽标永远停在打开那一刻的状态。 */
    expect(handlers?.onSettled).toBeTypeOf("function");
    act(() => {
      handlers.onLog?.(logEntry("第一行"));
      handlers.onLog?.(logEntry("第二行"));
    });
    expect(result.current.logs.map((l) => l.msg)).toEqual(["第一行", "第二行"]);
    expect(result.current.settled).toBeNull();
  });

  it("累积有上限：只保留最近 300 条", () => {
    const { result } = renderHook(() => useTaskLogStream("t-1"));
    act(() => {
      for (let i = 0; i < 305; i++) {
        handlers.onLog?.(logEntry(`行 ${String(i)}`));
      }
    });
    expect(result.current.logs).toHaveLength(300);
    expect(result.current.logs[0]?.msg).toBe("行 5");
    expect(result.current.logs.at(-1)?.msg).toBe("行 304");
  });

  it("收到进度帧 → started；终态帧 → settled 落定一次", () => {
    const { result } = renderHook(() => useTaskLogStream("t-1"));
    expect(result.current.started).toBe(false);
    act(() => {
      handlers.onProgress?.(42);
    });
    expect(result.current.started).toBe(true);
    act(() => {
      handlers.onSettled?.({ ok: false, message: "CUDA out of memory" });
    });
    expect(result.current.settled).toEqual({
      ok: false,
      message: "CUDA out of memory",
    });
  });

  it("换 taskId：旧订阅断开、日志与终态全部重置", () => {
    const { result, rerender } = renderHook(({ id }) => useTaskLogStream(id), {
      initialProps: { id: "t-1" },
    });
    act(() => {
      handlers.onLog?.(logEntry("旧任务的日志"));
      handlers.onSettled?.({ ok: true });
    });
    expect(result.current.logs).toHaveLength(1);

    closer.mockClear();
    rerender({ id: "t-2" });
    expect(closer).toHaveBeenCalledTimes(1);
    expect(watchTaskMock).toHaveBeenLastCalledWith("t-2", expect.anything());
    expect(result.current.logs).toEqual([]);
    expect(result.current.settled).toBeNull();
    expect(result.current.started).toBe(false);
  });

  it("taskId 变 null：断开并清空（弹窗关掉后再打开不能残留）", () => {
    /* props 类型用变量显式钉住（而不是「t-1」上做断言）：rerender 要传 null，
     * 从 initialProps 推导成 { id: string } 会在调用处报错。 */
    const initial: { id: string | null } = { id: "t-1" };
    const { result, rerender } = renderHook(
      (props: { id: string | null }) => useTaskLogStream(props.id),
      { initialProps: initial },
    );
    act(() => {
      handlers.onLog?.(logEntry("日志"));
    });
    closer.mockClear();
    rerender({ id: null });
    expect(closer).toHaveBeenCalledTimes(1);
    expect(result.current.logs).toEqual([]);
    expect(watchTaskMock).toHaveBeenCalledTimes(1);
  });

  it("卸载断开；closer 之后迟到的帧不再 setState（不报警、不崩）", () => {
    const { unmount } = renderHook(() => useTaskLogStream("t-1"));
    closer.mockClear();
    unmount();
    expect(closer).toHaveBeenCalledTimes(1);
    expect(() => {
      handlers.onLog?.(logEntry("迟到的帧"));
      handlers.onSettled?.({ ok: true });
    }).not.toThrow();
  });
});
