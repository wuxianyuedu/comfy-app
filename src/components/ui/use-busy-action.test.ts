// @vitest-environment jsdom
/**
 * `~/components/ui/use-busy-action` 的契约（ISSUE #672 / 规范 16 §16.2.4.71）。
 *
 * 这条账的实质是「先置忙、跑完复位」的执行态各写一份，而复位写在哪一处
 * 决定了「失败之后按钮还能不能点」：写在 `await` 之后的 9 处只要动作抛错，
 * 忙碌位就永远停在 true。用例因此按**复位时机**写。
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useBusyAction } from "./use-busy-action";

describe("useBusyAction", () => {
  it("初始不忙", () => {
    const { result } = renderHook(() => useBusyAction());
    expect(result.current.busy).toBe(false);
  });

  it("跑动作时置忙，结束后落下，并返回动作的返回值", async () => {
    const { result } = renderHook(() => useBusyAction());
    let resolve!: (v: string) => void;
    const gate = new Promise<string>((r) => {
      resolve = r;
    });

    let pending!: Promise<string>;
    act(() => {
      pending = result.current.run(() => gate);
    });
    expect(result.current.busy).toBe(true);

    let out = "";
    await act(async () => {
      resolve("done");
      out = await pending;
    });
    expect(out).toBe("done");
    expect(result.current.busy).toBe(false);
  });

  it("动作抛错时忙碌位照样落下（finally 口径 —— 这条账的核心）", async () => {
    const { result } = renderHook(() => useBusyAction());
    await act(async () => {
      await expect(
        result.current.run(async () => {
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");
    });
    expect(result.current.busy).toBe(false);
  });

  it("失败不被吞掉（异常原样抛给调用处，由它决定怎么报）", async () => {
    const { result } = renderHook(() => useBusyAction());
    let caught: unknown = null;
    await act(async () => {
      try {
        await result.current.run(async () => {
          throw new Error("保存失败");
        });
      } catch (e) {
        caught = e;
      }
    });
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe("保存失败");
  });

  it("`set` 可以手动置忙 / 复位（跨多段 await 的落点）", () => {
    const { result } = renderHook(() => useBusyAction());
    act(() => result.current.set(true));
    expect(result.current.busy).toBe(true);
    act(() => result.current.set(false));
    expect(result.current.busy).toBe(false);
  });

  it("可传初值（挂载即忙的落点）", () => {
    const { result } = renderHook(() => useBusyAction(true));
    expect(result.current.busy).toBe(true);
  });

  it("卸载之后不再落状态（静默跳过，不改变对外语义）", async () => {
    const { result, unmount } = renderHook(() => useBusyAction());
    let resolve!: () => void;
    const gate = new Promise<void>((r) => {
      resolve = r;
    });
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.run(() => gate);
    });
    unmount();
    /* 卸载后动作才结束：`finally` 里的复位被守卫拦下（不抛、不告警）。 */
    await act(async () => {
      resolve();
      await pending;
    });
    expect(result.current.busy).toBe(true);
  });
});
