/**
 * `queue-signal.server` —— 全局队列变化的**服务端 diff** 循环（事件为主、轮询兜底）。
 *
 * 判三件事：
 *   · 首个订阅者拉起共享 diff 循环，状态相对上一拍变化时才通知（空闲不刷屏）；
 *   · 状态没变时同一订阅者不被重复通知；
 *   · 最后一个订阅者退订即停循环（不再打 ComfyUI）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* `vi.mock` 会被 hoist 到文件顶部，工厂里引用的 `collect` 必须同样 hoist，否则
 * 模块求值阶段（导入被测模块 → 触发 mock 工厂）会撞上 `const collect` 的 TDZ。 */
const { collect } = vi.hoisted(() => ({ collect: vi.fn() }));
vi.mock("~/lib/comfyui/queue-status.server", () => ({
  collectComfyQueueStatus:
    /* SAFETY: 类型断言已复核 */ collect as unknown as () => Promise<unknown>,
}));

import { subscribeQueueChanged, resetQueueChangedSignalForTest } from "./queue-signal.server";

const SAME = {
  online: true,
  comfy: { running: 0, pending: 0 },
  running: null,
  queued: 0,
};

beforeEach(() => {
  vi.useFakeTimers();
  collect.mockReset();
  collect.mockResolvedValue(SAME);
  resetQueueChangedSignalForTest();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("queue-signal.server", () => {
  it("首个订阅者拉起循环，首拍（无基线）即视为变化并通知", async () => {
    const listener = vi.fn();
    const off = subscribeQueueChanged(listener);
    await vi.advanceTimersByTimeAsync(2000);
    expect(collect).toHaveBeenCalled();
    expect(listener).toHaveBeenCalledTimes(1);
    off();
  });

  it("状态未变时不重复通知", async () => {
    const listener = vi.fn();
    const off = subscribeQueueChanged(listener);
    await vi.advanceTimersByTimeAsync(2000);
    expect(listener).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000); // 第二拍值相同
    expect(listener).toHaveBeenCalledTimes(1);
    off();
  });

  it("状态变了才再通知", async () => {
    const listener = vi.fn();
    const off = subscribeQueueChanged(listener);
    await vi.advanceTimersByTimeAsync(2000);
    expect(listener).toHaveBeenCalledTimes(1);
    collect.mockResolvedValue({ ...SAME, queued: 3 }); // 队列数变了
    await vi.advanceTimersByTimeAsync(2000);
    expect(listener).toHaveBeenCalledTimes(2);
    off();
  });

  it("最后一个退订即停循环（不再调 collect）", async () => {
    const off = subscribeQueueChanged(vi.fn());
    await vi.advanceTimersByTimeAsync(2000);
    off();
    collect.mockClear();
    await vi.advanceTimersByTimeAsync(4000);
    expect(collect).not.toHaveBeenCalled();
  });
});
