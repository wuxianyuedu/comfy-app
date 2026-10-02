/**
 * 进程退出事件 → 客户端的那条信号通路的服务端一半（ISSUE #1351）。
 *
 * 这条通路的关键契约有三条，任一条错了「事件为主」就变成「事件白发了」：
 *   · 纪元单调 +1，且**同一个退出只派发一次**（重连补发不该被当成新事件）；
 *   · 订阅者集合不做引用去重（同一个回调订阅两次要被叫两次 —— 去重会让第一次
 *     退订就把另一个一起摘掉，静默失效）；
 *   · 一个订阅者抛错不得影响其它订阅者与退出路径本身。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getLivenessSnapshot,
  noteComfyExit,
  resetComfyLivenessSignalForTest,
  subscribeComfyExit,
} from "./liveness-signal";
import type { ComfyExitReport } from "./lifecycle-exit";

function report(over: Partial<ComfyExitReport> = {}): ComfyExitReport {
  return {
    reason: "异常退出（exit 1）",
    detail: "code=1",
    advice: null,
    ...over,
  };
}

beforeEach(() => {
  resetComfyLivenessSignalForTest();
});

describe("noteComfyExit", () => {
  it("纪元单调递增，快照跟着更新", () => {
    expect(getLivenessSnapshot()).toEqual({ seq: 0, last: null });
    const first = noteComfyExit(report());
    const second = noteComfyExit(report({ reason: "被信号终止（SIGKILL）" }));
    expect(first.seq).toBe(1);
    expect(second.seq).toBe(2);
    expect(getLivenessSnapshot().seq).toBe(2);
    expect(getLivenessSnapshot().last?.reason).toBe("被信号终止（SIGKILL）");
  });

  it("「用户主动关闭」被标出来：客户端据此跳过崩溃复核", () => {
    expect(noteComfyExit(report({ reason: "用户主动关闭" })).userStopped).toBe(
      true,
    );
    expect(noteComfyExit(report()).userStopped).toBe(false);
  });

  it("订阅者拿到这次事件；退订后不再收到", () => {
    const seen: number[] = [];
    const off = subscribeComfyExit((s) => seen.push(s.seq));
    noteComfyExit(report());
    off();
    noteComfyExit(report());
    expect(seen).toEqual([1]);
  });

  it("同一个回调订阅两次要被叫两次（Set 去重会让第一次退订就静默失效另一个）", () => {
    const listener = vi.fn();
    const offA = subscribeComfyExit(listener);
    subscribeComfyExit(listener);
    noteComfyExit(report());
    expect(listener).toHaveBeenCalledTimes(2);
    offA();
    listener.mockClear();
    noteComfyExit(report());
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("一个订阅者抛错不影响其它订阅者，也不影响退出路径本身", () => {
    const good = vi.fn();
    subscribeComfyExit(() => {
      throw new Error("boom");
    });
    subscribeComfyExit(good);
    expect(() => noteComfyExit(report())).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
  });
});
