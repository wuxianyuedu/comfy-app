/**
 * 「ComfyUI 忙不忙」的全页单点（ISSUE #1351）。
 *
 * 这条 store 的意义是让系统指标的持有者能按阶段降压（出图档 30s）——
 * 所以用例钉的是两件事：**黏滞后只对「忙 → 闲」生效**（闲 → 忙必须立刻
 * 生效，否则高峰头几秒仍在高频探它），以及订阅语义（不做引用去重）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  COMFY_BUSY_HOLD_MS,
  getComfyBusy,
  noteComfyBusy,
  resetComfyBusyStoreForTest,
  subscribeComfyBusy,
} from "./comfy-busy-store";

beforeEach(() => {
  resetComfyBusyStoreForTest();
});

describe("noteComfyBusy", () => {
  it("闲 → 忙立即生效（高峰期头几秒就该降压）", () => {
    expect(getComfyBusy()).toBe(false);
    noteComfyBusy(true, 1_000);
    expect(getComfyBusy()).toBe(true);
  });

  it("忙 → 闲要过黏滞窗口：出图间隙的反复切换被压平", () => {
    noteComfyBusy(true, 1_000);
    noteComfyBusy(false, 1_000 + COMFY_BUSY_HOLD_MS - 1);
    expect(getComfyBusy()).toBe(true);
    noteComfyBusy(false, 1_000 + COMFY_BUSY_HOLD_MS);
    expect(getComfyBusy()).toBe(false);
  });

  it("黏滞窗口从「开始忙」起算：连续喂 true 不会把窗口一直往后推", () => {
    noteComfyBusy(true, 1_000);
    noteComfyBusy(true, 4_000);
    noteComfyBusy(true, 5_500);
    noteComfyBusy(false, 1_000 + COMFY_BUSY_HOLD_MS);
    expect(getComfyBusy()).toBe(false);
  });

  it("幂等：重复喂同一个值不重复通知", () => {
    const onChange = vi.fn();
    subscribeComfyBusy(onChange);
    noteComfyBusy(false);
    noteComfyBusy(true, 1_000);
    noteComfyBusy(true, 1_100);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe("subscribeComfyBusy", () => {
  it("退订即不再收到通知", () => {
    const onChange = vi.fn();
    const off = subscribeComfyBusy(onChange);
    noteComfyBusy(true, 1_000);
    off();
    noteComfyBusy(false, 1_000 + COMFY_BUSY_HOLD_MS);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
