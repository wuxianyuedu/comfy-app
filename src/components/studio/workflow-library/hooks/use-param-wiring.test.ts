/* `useParamWiring` 的本地 overlay 覆盖范围 —— 回归：右列（输出落点）也曾延迟。
 * 左列一直有 overlay（拖完立刻画线）；右列写在 `output` 命名空间，但
 * `mergeParamMaps` 只合并 `source`，且输出侧此前直接落库，于是要等 PATCH + 查询
 * 重拉（约 2s）。这里钉住：`commitParamMap` 提交后 `effectiveParamMap` **立刻**
 * 含 output 改动，不等落库回调返回。 */

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { applyOutputBindingEdit, manualOutputSource } from "~/lib/workflow/workflow-output-binding";
import { useParamWiring } from "./use-param-wiring";

describe("useParamWiring — commitParamMap 的本地 overlay（右列输出落点）", () => {
  it("提交后 effectiveParamMap 立即含 output 改动（不等落库回调）", () => {
    const onPatch = vi.fn();
    const { result } = renderHook(() =>
      useParamWiring({
        paramMap: {},
        mode: "T2I",
        onPatchParamMap: onPatch,
      }),
    );
    const next = applyOutputBindingEdit(result.current.effectiveParamMap, {
      outputIoKey: "5::output::IMAGE",
      ioKey: "5::output::IMAGE",
      mode: "T2I",
    });
    act(() => {
      result.current.commitParamMap(next);
    });
    /* 不 await onPatch：本地即可见。 */
    expect(manualOutputSource(result.current.effectiveParamMap, "5::output::IMAGE", "T2I")).toBe(
      "5::output::IMAGE",
    );
    expect(onPatch).toHaveBeenCalledTimes(1);
  });

  it("source 与 output 两个命名空间的本地改动可以叠加共存", () => {
    const { result } = renderHook(() =>
      useParamWiring({
        paramMap: {},
        mode: "T2I",
        onPatchParamMap: vi.fn(),
      }),
    );
    const next = applyOutputBindingEdit(result.current.effectiveParamMap, {
      outputIoKey: "5::output::IMAGE",
      ioKey: "5::output::IMAGE",
      mode: "T2I",
    });
    act(() => {
      result.current.commitParamMap(next);
    });
    /* 左上（source）与右列（output）都经同一份 overlay，互不覆盖。 */
    expect(manualOutputSource(result.current.effectiveParamMap, "5::output::IMAGE", "T2I")).toBe(
      "5::output::IMAGE",
    );
    expect(result.current.effectiveParamMap).toHaveProperty("output");
  });
});

/* #4458：paramMap 是服务端事实源；更新 JSON / 同步重映射连线并失效缓存后，
 * 本地 overlay 若永不清除，会逐键压过新事实 —— 刚报告「已断开」的线复活。 */
describe("useParamWiring — 服务端事实源刷新后 overlay 重对齐（#4458）", () => {
  it("paramMap 被服务端重映射后：旧 overlay 不复活已断开的线", () => {
    const onPatch = vi.fn();
    const initial: Record<string, unknown> = {
      source: { "mode:T2I": { prompt: "1::widget::prompt" } },
    };
    const { result, rerender } = renderHook(
      ({ paramMap }: { paramMap: Record<string, unknown> }) =>
        useParamWiring({ paramMap, mode: "T2I", onPatchParamMap: onPatch }),
      { initialProps: { paramMap: initial } },
    );

    /* 作者显式断开 prompt（本地 overlay 立即可见 + 落库）。 */
    act(() => {
      result.current.disconnect("prompt");
    });
    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(result.current.isManual("prompt")).toBe(true);

    /* 服务端更新 JSON 重映射：新事实源里 prompt 的手工线已不存在。 */
    const remapped: Record<string, unknown> = { source: { "mode:T2I": {} } };
    rerender({ paramMap: remapped });

    /* 旧 overlay 不复活：生效映射 = 新事实源，prompt 无手工线。 */
    expect(result.current.effectiveParamMap).toEqual(remapped);
    expect(result.current.isManual("prompt")).toBe(false);
  });

  it("paramMap 内容未变（仅引用变化）时不误清 overlay", () => {
    const onPatch = vi.fn();
    const initial: Record<string, unknown> = {
      source: { "mode:T2I": { prompt: "1::widget::prompt" } },
    };
    const { result, rerender } = renderHook(
      ({ paramMap }: { paramMap: Record<string, unknown> }) =>
        useParamWiring({ paramMap, mode: "T2I", onPatchParamMap: onPatch }),
      { initialProps: { paramMap: initial } },
    );
    act(() => {
      result.current.disconnect("prompt");
    });
    /* 同内容的新对象（父组件重算 memo 等）——不应把本地 overlay 抹掉。 */
    const sameContent: Record<string, unknown> = {
      source: { "mode:T2I": { prompt: "1::widget::prompt" } },
    };
    rerender({ paramMap: sameContent });
    expect(result.current.isManual("prompt")).toBe(true);
  });
});
