// update-check store 的 single-flight（#4241）：30s 轮询与手动触发并发时，
// 布尔标志会让先结束的一方把 checking 提前熄灭。钉三件事：并发复用同一在跑
// promise（第二个的 action 不再执行）、两路都拿到同一结果、全部结束后 checking
// 才复位。
import { describe, expect, it, vi } from "vitest";

import { useUpdateCheckStore } from "./update-check-store";

describe("runChecking 的 single-flight（#4241）", () => {
  it("并发触发复用在跑的 promise：第二个 action 不执行，两路拿同一结果", async () => {
    const store = useUpdateCheckStore.getState();
    let release!: (value: boolean) => void;
    const firstAction = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          release = resolve;
        }),
    );
    const secondAction = vi.fn(() => Promise.resolve(true));

    const p1 = store.runChecking(firstAction);
    const p2 = store.runChecking(secondAction);

    expect(firstAction).toHaveBeenCalledTimes(1);
    expect(secondAction).not.toHaveBeenCalled();
    expect(useUpdateCheckStore.getState().checking).toBe(true);

    release(true);
    await expect(p1).resolves.toBe(true);
    await expect(p2).resolves.toBe(true);
    expect(useUpdateCheckStore.getState().checking).toBe(false);
  });

  it("全部结束后 checking 才复位；空闲时逐次执行", async () => {
    const store = useUpdateCheckStore.getState();
    const first = store.runChecking(async () => "a");
    const second = store.runChecking(async () => "b");
    await Promise.all([first, second]);
    expect(useUpdateCheckStore.getState().checking).toBe(false);

    const third = await store.runChecking(async () => "c");
    expect(third).toBe("c");
    expect(useUpdateCheckStore.getState().checking).toBe(false);
  });
});
