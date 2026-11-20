// useRefitOnFirstRealSize 的判据（ISSUE #4579）：画布在「容器量不到尺寸」时
// （所在视图整棵 display:none 保活）挂载，首帧定向 fitView 按 0×0 视口算出退化
// 变换且此后没人重算 —— 这里钉住「容器**首次**量到真实尺寸才补一次 fitView」，
// 之后的尺寸变化不再抢（用户可能已主动平移 / 缩放）。

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";

import type { ElementBox } from "~/lib/dom-rect";

import { hasRealSize, useRefitOnFirstRealSize } from "./use-refit-on-first-size";
import { libraryFitViewOptions } from "./use-library-wire-flow";

afterEach(cleanup);

function box(width: number, height: number): ElementBox {
  return {
    bottom: height,
    clientHeight: height,
    clientWidth: width,
    height,
    left: 0,
    pageX: 0,
    pageY: 0,
    right: width,
    scrollHeight: height,
    scrollWidth: width,
    top: 0,
    width,
  };
}

function makeRf() {
  return { fitView: vi.fn<(options?: unknown) => Promise<boolean>>().mockResolvedValue(true) };
}

describe("hasRealSize（量不到 = 不算数）", () => {
  it("null（未挂上 / 未量测）与 0×0（display:none）都不是真实尺寸", () => {
    expect(hasRealSize(null)).toBe(false);
    expect(hasRealSize(box(0, 0))).toBe(false);
    expect(hasRealSize(box(685, 0))).toBe(false);
    expect(hasRealSize(box(0, 460))).toBe(false);
    expect(hasRealSize(box(685, 460))).toBe(true);
  });
});

describe("useRefitOnFirstRealSize", () => {
  it("量不到尺寸不 fitView；首次真实尺寸补一次，与首帧同口径", async () => {
    const rf = makeRf();
    const onFitted = vi.fn();
    const { rerender } = renderHook(
      ({ b }) => {
        useRefitOnFirstRealSize(rf, b, onFitted);
      },
      {
        initialProps: { b: null as ElementBox | null },
      },
    );
    expect(rf.fitView, "未量到尺寸（未挂上）时不 fitView").not.toHaveBeenCalled();

    /* 隐藏态（0×0）也不 fitView —— 此时按 0×0 算出来的必然是退化视口。 */
    rerender({ b: box(0, 0) });
    expect(rf.fitView, "0×0（display:none）时不 fitView").not.toHaveBeenCalled();

    /* 首次量到真实尺寸 → 补一次定向 fitView，参数与首帧那条同一份。 */
    rerender({ b: box(685, 460) });
    expect(rf.fitView).toHaveBeenCalledTimes(1);
    expect(rf.fitView.mock.calls[0]![0]).toEqual(libraryFitViewOptions());
    await vi.waitFor(() => {
      expect(onFitted).toHaveBeenCalledTimes(1);
    });

    /* 之后的尺寸变化不再触发 —— 只补 0 → 非 0 的首跳，不抢用户的平移 / 缩放。 */
    rerender({ b: box(900, 600) });
    expect(rf.fitView).toHaveBeenCalledTimes(1);
  });

  it("fitView 落定失败也照常置 fitted（与首帧路径同款：markFitted 双路）", async () => {
    const rf = { fitView: vi.fn<() => Promise<boolean>>().mockRejectedValue(false) };
    const onFitted = vi.fn();
    const { rerender } = renderHook(
      ({ b }) => {
        useRefitOnFirstRealSize(rf, b, onFitted);
      },
      {
        initialProps: { b: null as ElementBox | null },
      },
    );
    rerender({ b: box(685, 460) });
    await vi.waitFor(() => {
      expect(onFitted).toHaveBeenCalledTimes(1);
    });
  });

  it("先量到真实尺寸、再退回 0×0（视图又藏起来）也不重复补", () => {
    const rf = makeRf();
    const onFitted = vi.fn();
    const { rerender } = renderHook(
      ({ b }) => {
        useRefitOnFirstRealSize(rf, b, onFitted);
      },
      {
        initialProps: { b: box(685, 460) },
      },
    );
    expect(rf.fitView).toHaveBeenCalledTimes(1);
    rerender({ b: box(0, 0) });
    rerender({ b: box(685, 460) });
    expect(rf.fitView).toHaveBeenCalledTimes(1);
  });
});
