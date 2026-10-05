/* `useParamWiring` 的本地 overlay 覆盖范围 —— 回归：右列（输出落点）也曾延迟。
 *
 * 左列（`source`）一直有 overlay：拖完线立刻画出来。右列的输出落点写在
 * `output` 命名空间，但 `mergeParamMaps` 只合并 `source`，且输出侧此前直接
 * `onPatchParamMap` 落库 —— 于是输出线要等一次 PATCH + 查询重拉（约 2s）才出现。
 * 这里钉住修复后的口径：`commitParamMap` 提交后，`effectiveParamMap` **立刻**
 * 含 output 改动（不等落库回调返回）。 */

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  applyOutputBindingEdit,
  manualOutputSource,
} from "~/lib/workflow/workflow-output-binding";
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
    act(() => result.current.commitParamMap(next));
    /* 不 await onPatch：本地即可见。 */
    expect(
      manualOutputSource(
        result.current.effectiveParamMap,
        "5::output::IMAGE",
        "T2I",
      ),
    ).toBe("5::output::IMAGE");
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
    act(() => result.current.commitParamMap(next));
    /* 左上（source）与右列（output）都经同一份 overlay，互不覆盖。 */
    expect(
      manualOutputSource(
        result.current.effectiveParamMap,
        "5::output::IMAGE",
        "T2I",
      ),
    ).toBe("5::output::IMAGE");
    expect(result.current.effectiveParamMap).toHaveProperty("output");
  });
});
