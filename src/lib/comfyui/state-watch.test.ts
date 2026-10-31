/**
 * 「ComfyUI 运行态变了」那条通道的服务端一半。
 *
 * 关键契约（任一条错了「事件驱动」就退化成「另一条轮询」）：
 *   · 纪元单调 +1，快照跟着更新；
 *   · 订阅者集合不做引用去重（同一个回调订阅两次要被叫两次 —— 去重会让第一次
 *     退订就把另一个一起摘掉，静默失效）；
 *   · 一个订阅者抛错不得影响其它订阅者与**调用方**（它的下游里有进程退出路径）；
 *   · `waitForComfyStateChange` 的三种出口：已知更新 → 立刻返回、超时 → null、
 *     等到通知 → 返回那一次。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getComfyStateChange,
  noteComfyStateChange,
  resetComfyStateWatchForTest,
  subscribeComfyState,
  waitForComfyStateChange,
} from "./state-watch";

beforeEach(() => {
  resetComfyStateWatchForTest();
  vi.useRealTimers();
});

describe("noteComfyStateChange", () => {
  it("纪元单调递增，快照跟着更新", () => {
    expect(getComfyStateChange()).toEqual({ last: null, seq: 0 });
    const first = noteComfyStateChange("start", "用户启动了 ComfyUI");
    const second = noteComfyStateChange("ready", "ComfyUI 已就绪");
    expect(first.seq).toBe(1);
    expect(second.seq).toBe(2);
    expect(getComfyStateChange()).toEqual({ last: second, seq: 2 });
  });

  it("订阅者拿到变化；退订后不再收到", () => {
    let calls = 0;
    const off = subscribeComfyState(() => {
      calls += 1;
    });
    noteComfyStateChange("exit", "ComfyUI 进程退出");
    off();
    noteComfyStateChange("config", "ComfyUI 配置已更新");
    expect(calls).toBe(1);
  });

  it("同一个回调订阅两次要被叫两次（Set 去重会让第一次退订就静默失效另一个）", () => {
    let calls = 0;
    const same = (): void => {
      calls += 1;
    };
    const offFirst = subscribeComfyState(same);
    const offSecond = subscribeComfyState(same);
    noteComfyStateChange("start", "用户启动了 ComfyUI");
    expect(calls).toBe(2);
    offFirst();
    noteComfyStateChange("start", "用户启动了 ComfyUI");
    expect(calls).toBe(3);
    offSecond();
  });

  it("一个订阅者抛错不影响其它订阅者，也不冒到调用方（下游是进程退出路径）", () => {
    let reached = 0;
    subscribeComfyState(() => {
      throw new Error("订阅者自己炸了");
    });
    subscribeComfyState(() => {
      reached += 1;
    });
    expect(() => noteComfyStateChange("exit", "ComfyUI 进程退出")).not.toThrow();
    expect(reached).toBe(1);
  });
});

describe("waitForComfyStateChange", () => {
  it("已经有更新的变化时立刻返回（不让调用方白等满一个窗口）", async () => {
    noteComfyStateChange("ready", "ComfyUI 已就绪");
    await expect(waitForComfyStateChange(0, 1000)).resolves.toMatchObject({
      kind: "ready",
      seq: 1,
    });
  });

  it("窗口内没有变化 → null（调用方据此回空响应并再发一轮）", async () => {
    vi.useFakeTimers();
    const pending = waitForComfyStateChange(0, 500);
    await vi.advanceTimersByTimeAsync(500);
    await expect(pending).resolves.toBeNull();
  });

  it("等着的期间来了变化 → 拿到那一次，且不必等满窗口", async () => {
    const pending = waitForComfyStateChange(0, 5000);
    noteComfyStateChange("start", "用户启动了 ComfyUI");
    await expect(pending).resolves.toMatchObject({ kind: "start", seq: 1 });
  });

  it("超时即退订：不给订阅表留死回调（这张表只增不减）", async () => {
    vi.useFakeTimers();
    const pending = waitForComfyStateChange(0, 100);
    await vi.advanceTimersByTimeAsync(100);
    await expect(pending).resolves.toBeNull();
    /* 退订了才收不到：这一次变化只该叫醒「此刻还在等」的人。 */
    let called = 0;
    subscribeComfyState(() => {
      called += 1;
    });
    noteComfyStateChange("exit", "ComfyUI 进程退出");
    expect(called).toBe(1);
  });

  it("超时之后到来的变化不再叫醒上一次等待（一次等待只回一次）", async () => {
    vi.useFakeTimers();
    const expired = waitForComfyStateChange(0, 100);
    await vi.advanceTimersByTimeAsync(100);
    await expect(expired).resolves.toBeNull();
    /* 再变化一次：上一次等待已经收口，订阅也摘了 —— 没有「迟到的第二次 resolve」 */
    noteComfyStateChange("exit", "ComfyUI 进程退出");
    await expect(expired).resolves.toBeNull();
  });
});

describe("resetComfyStateWatchForTest", () => {
  it("清干净纪元、最近一次与订阅者", () => {
    noteComfyStateChange("exit", "ComfyUI 进程退出");
    resetComfyStateWatchForTest();
    expect(getComfyStateChange()).toEqual({ last: null, seq: 0 });
    let calls = 0;
    subscribeComfyState(() => {
      calls += 1;
    });
    noteComfyStateChange("start", "用户启动了 ComfyUI");
    expect(calls).toBe(1);
  });
});
