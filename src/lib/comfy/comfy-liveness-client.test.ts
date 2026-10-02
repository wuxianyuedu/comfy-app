// @vitest-environment jsdom
/**
 * 进程退出事件的客户端订阅（ISSUE #1351）。
 *
 * 钉三件事：按 `seq` 去重（断线重连补发不该再触发一次复核）、
 * 主动关闭不派发脉冲（不是崩溃）、坏帧不把订阅拖死。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  resetComfyLivenessClientForTest,
  subscribeComfyCrashes,
} from "./comfy-liveness-client";

/** 最小的 EventSource 替身：只留 `onmessage` / `close`。 */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onmessage: ((ev: MessageEvent<string>) => void) | null = null;
  closed = false;
  url: string;
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  emit(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent<string>);
  }
  emitRaw(data: string): void {
    this.onmessage?.({ data } as MessageEvent<string>);
  }
  close(): void {
    this.closed = true;
  }
}

let last: FakeEventSource;

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  resetComfyLivenessClientForTest();
  subscribeComfyCrashes(() => undefined);
  last = FakeEventSource.instances[FakeEventSource.instances.length - 1]!;
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetComfyLivenessClientForTest();
});

function signal(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    seq: 1,
    at: 1_000,
    reason: "异常退出（exit 1）",
    userStopped: false,
    ...over,
  };
}

describe("subscribeComfyCrashes", () => {
  it("一次退出派发一次脉冲；同一个 seq 补发不再派发", () => {
    const onCrash = vi.fn();
    subscribeComfyCrashes(onCrash);
    last.emit(signal());
    last.emit(signal()); // 重连补发同一个 seq
    expect(onCrash).toHaveBeenCalledTimes(1);
  });

  it("用户主动关闭不派发脉冲：我们自己让它退的，不必再探一次证明它没了", () => {
    const onCrash = vi.fn();
    subscribeComfyCrashes(onCrash);
    last.emit(signal({ userStopped: true }));
    expect(onCrash).not.toHaveBeenCalled();
  });

  it("更大的 seq 是新的一次崩溃", () => {
    const onCrash = vi.fn();
    subscribeComfyCrashes(onCrash);
    last.emit(signal({ seq: 1 }));
    last.emit(signal({ seq: 2 }));
    expect(onCrash).toHaveBeenCalledTimes(2);
  });

  it("坏帧（非法 JSON / 字段不全）不影响后续", () => {
    const onCrash = vi.fn();
    subscribeComfyCrashes(onCrash);
    last.emitRaw("{ 不是 JSON");
    last.emit({ seq: "1", at: 0, reason: "x" }); // seq 不是数字
    last.emit(signal({ seq: 3 }));
    expect(onCrash).toHaveBeenCalledTimes(1);
  });

  it("EventSource 构造失败 / 不存在：静默降级，不抛（存活仍由轮询兜底）", () => {
    resetComfyLivenessClientForTest();
    vi.stubGlobal("EventSource", undefined);
    expect(() => subscribeComfyCrashes(vi.fn())).not.toThrow();

    resetComfyLivenessClientForTest();
    vi.stubGlobal(
      "EventSource",
      class {
        constructor() {
          throw new Error("不支持 SSE");
        }
      },
    );
    expect(() => subscribeComfyCrashes(vi.fn())).not.toThrow();
  });

  it("多个订阅者共用一条连接；最后一个退订即断开", () => {
    /* 本用例自带一份干净状态：`beforeEach` 那条占位订阅会让「最后一个退订」
      永远不成立（listeners 不会归零），断言就测不到断开。 */
    resetComfyLivenessClientForTest();
    const offA = subscribeComfyCrashes(vi.fn());
    const conn =
      FakeEventSource.instances[FakeEventSource.instances.length - 1]!;
    const before = FakeEventSource.instances.length;
    const offB = subscribeComfyCrashes(vi.fn());
    // 订阅者增加不新建连接：`ensureConnected` 幂等。
    expect(FakeEventSource.instances).toHaveLength(before);
    offA();
    expect(conn.closed).toBe(false);
    offB();
    expect(conn.closed).toBe(true);
  });
});
