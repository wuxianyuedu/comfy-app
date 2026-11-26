// @vitest-environment happy-dom
/** 共享 ResizeObserver 的接线契约（#5131）：N 个读数点只建 1 个 observer，
 *  同一批尺寸变化只排一次 rAF；注销后不再收到回调。 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Listener = (entries: Array<{ target: Element }>, observer: unknown) => void;

const instances: Array<FakeRO> = [];

class FakeRO {
  cb: Listener;
  observed = new Set<Element>();
  constructor(cb: Listener) {
    this.cb = cb;
    instances.push(this);
  }
  observe(el: Element) {
    this.observed.add(el);
  }
  unobserve(el: Element) {
    this.observed.delete(el);
  }
  disconnect() {
    this.observed.clear();
  }
}

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  instances.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("observeElementResize", () => {
  it("N 个读数点共享 1 个 observer；一批变化只排一次 rAF", async () => {
    const frames: Array<FrameRequestCallback> = [];
    vi.stubGlobal("ResizeObserver", FakeRO);
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => undefined);

    const { observeElementResize } = await import("./shared-resize-observer");
    const a = document.createElement("div");
    const b = document.createElement("div");
    let calls = 0;
    const offA = observeElementResize(a, () => {
      calls += 1;
    });
    const offB = observeElementResize(b, () => {
      calls += 1;
    });

    expect(instances).toHaveLength(1);
    const ro = instances[0];
    if (!ro) {
      throw new Error("observer 没建出来");
    }
    expect(ro.observed.size).toBe(2);

    /* 同一批里两个目标都变了：只排一帧，两个回调都执行。 */
    ro.cb([{ target: a }, { target: b }], ro);
    expect(frames).toHaveLength(1);
    const frame = frames[0];
    if (!frame) {
      throw new Error("没有排帧");
    }
    frame(0);
    expect(calls).toBe(2);

    /* 再一批仍是一帧一次。 */
    ro.cb([{ target: a }, { target: b }], ro);
    expect(frames).toHaveLength(2);

    offA();
    offB();
    expect(ro.observed.size).toBe(0);
  });

  it("无 ResizeObserver 的环境退化成空注销函数，不抛错", async () => {
    vi.stubGlobal("ResizeObserver", undefined);
    const { observeElementResize } = await import("./shared-resize-observer");
    const el = document.createElement("div");
    const off = observeElementResize(el, () => {
      /* 无 observer 时不会被调用 */
    });
    expect(() => {
      off();
    }).not.toThrow();
  });
});
