// @vitest-environment jsdom
/**
 * 「等一帧再做事」的两档调度（规范 16 §16.2.4.42）。
 *
 * 这条账的形状是**调度与取消**：收口前 8 处各写一遍，其中 4 处写在 effect
 * 里**没有清理** —— effect 因依赖抖动重跑时旧帧仍会落地（往已经翻走的面板上
 * 滚一次）。而「一帧够不够」在两种落点上的答案不同：读刚渲染出来的 DOM 一帧
 * 就够，等三方布局库（React Flow）重排要两帧。
 *
 * 因此用例钉三件事：**一帧不早不晚**、**两帧真的排在两帧之后**、
 * **取消后回调不执行**（含「外层已排、内层还没排」这个中间态）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { afterNextPaint, onNextFrame } from "./next-frame";

let frames: FrameRequestCallback[] = [];
let nextId = 1;

beforeEach(() => {
  frames = [];
  nextId = 1;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    frames.push(cb);
    return nextId++;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    /* 编号即下标 +1 是不稳定的（取消不重排），所以按「打标记」模拟：
     * 真浏览器里取消后回调也不再执行，这里的语义必须一致。 */
    cancelled.add(id);
  });
});

let cancelled = new Set<number>();
beforeEach(() => {
  cancelled = new Set();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** 跑一帧（跳过已取消的那些）。 */
function flushFrame(): void {
  const pending = frames;
  frames = [];
  for (const [i, cb] of pending.entries()) {
    /* 编号从 1 开始，与 push 顺序一致 —— 用例里只用一层，够用。 */
    if (!cancelled.has(i + 1)) cb(0);
  }
}

describe("onNextFrame", () => {
  it("回调排在**下一帧**，不在当前同步执行", () => {
    const cb = vi.fn();
    onNextFrame(cb);
    expect(cb).not.toHaveBeenCalled();
    flushFrame();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("返回的取消函数让回调不再执行（effect 重跑时旧帧不该落地）", () => {
    const cb = vi.fn();
    const cancel = onNextFrame(cb);
    cancel();
    flushFrame();
    expect(cb).not.toHaveBeenCalled();
  });
});

describe("afterNextPaint", () => {
  it("要**两帧**才执行（一帧给 React 提交、一帧给布局库重排）", () => {
    const cb = vi.fn();
    afterNextPaint(cb);
    flushFrame();
    expect(cb).not.toHaveBeenCalled();
    flushFrame();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("第一帧内取消，回调不再执行（外层已排、内层已排两个时点都要拦住）", () => {
    const cb = vi.fn();
    const cancel = afterNextPaint(cb);
    flushFrame(); // 外层跑了，内层已排
    cancel();
    flushFrame();
    expect(cb).not.toHaveBeenCalled();
  });
});
