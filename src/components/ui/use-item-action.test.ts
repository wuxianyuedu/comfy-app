// @vitest-environment jsdom
/**
 * `~/components/ui/use-item-action` 的契约（ISSUE #672 / 规范 16 §16.2.4.40）。
 *
 * 这条账的实质是「哪一条在忙」的执行态各写一份，且四个落点**没有一个**防了
 * 「同一条重复点」（`setBusyId` 是异步落状态的）。用例因此按**时间轴**写：
 * 忙标记什么时候落、`finally` 什么时候清、连点会不会发第二次请求。
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useItemAction } from "./use-item-action";

describe("useItemAction", () => {
  it("跑动作时落忙标记，结束后清掉", async () => {
    const { result } = renderHook(() => useItemAction());
    let resolve!: () => void;
    const gate = new Promise<void>((r) => {
      resolve = r;
    });

    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current.run("a", () => gate);
    });
    expect(result.current.busyId).toBe("a");
    expect(result.current.isBusy("a")).toBe(true);
    expect(result.current.anyBusy).toBe(true);

    await act(async () => {
      resolve();
      await pending;
    });
    expect(result.current.busyId).toBeNull();
    expect(result.current.isBusy("a")).toBe(false);
  });

  it("动作抛异常时忙标记也要清（finally 口径）", async () => {
    const { result } = renderHook(() => useItemAction());
    await act(async () => {
      await expect(
        result.current.run("a", async () => {
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");
    });
    expect(result.current.busyId).toBeNull();
  });

  it("同一条重复点只发一次请求（同步判重入，不等 setState）", async () => {
    const { result } = renderHook(() => useItemAction());
    const action = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 5));
      return "done";
    });

    let first!: Promise<unknown>;
    let second!: Promise<unknown>;
    await act(async () => {
      first = result.current.run("a", action);
      /* 同一次事件循环里再点一下：`busyId` 还没提交，只有同步 ref 判得出。 */
      second = result.current.run("a", action);
      await Promise.all([first, second]);
    });
    expect(action).toHaveBeenCalledTimes(1);
    expect(await second).toBeUndefined();
  });

  it("不同条之间不互斥（互斥是调用处看 anyBusy 的域判据）", async () => {
    const { result } = renderHook(() => useItemAction());
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const action = vi.fn(() => gate);

    let first!: Promise<unknown>;
    let second!: Promise<unknown>;
    act(() => {
      first = result.current.run("a", action);
      second = result.current.run("b", action);
    });
    expect(action).toHaveBeenCalledTimes(2);
    expect(result.current.anyBusy).toBe(true);
    await act(async () => {
      release();
      await Promise.all([first, second]);
    });
  });

  it("条目被删掉后忙标记随之消失（收敛生命周期）", async () => {
    const { result, rerender } = renderHook(
      ({ keys }: { keys: string[] }) => useItemAction(keys),
      { initialProps: { keys: ["a", "b"] } },
    );
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current.run("a", () => gate);
    });
    expect(result.current.busyId).toBe("a");

    /* 条目 a 被删掉 —— 若忙标记不收敛，`anyBusy` 会永远为真、
     * 整表动作再也点不动。 */
    rerender({ keys: ["b"] });
    expect(result.current.busyId).toBeNull();
    expect(result.current.anyBusy).toBe(false);

    await act(async () => {
      release();
      await pending;
    });
  });

  it("clear 可以手动清忙标记（动作被外部取消）", async () => {
    const { result } = renderHook(() => useItemAction());
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current.run("a", () => gate);
    });
    act(() => result.current.clear());
    expect(result.current.busyId).toBeNull();
    await act(async () => {
      release();
      await pending;
    });
  });

  it("传 keys 且内容未变时不重建错误表（按内容指纹比较）", () => {
    const { result, rerender } = renderHook(
      ({ keys }: { keys: string[] }) => useItemAction(keys),
      { initialProps: { keys: ["a", "b"] } },
    );
    const before = result.current.isBusy;
    /* 每次渲染都是新数组：按引用比较会让 isBusy 每轮换引用、级联重渲染。 */
    rerender({ keys: ["a", "b"] });
    expect(result.current.isBusy).toBe(before);
  });
});
