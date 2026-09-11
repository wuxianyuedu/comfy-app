// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";

import type { WorkflowIOMap } from "~/components/studio/shared/workflow-io";
import { useParamMappingSummary } from "./use-param-mapping-summary";

/* 两个节点：分辨率选择器（宽高比 / 像素量 / 倍数）+ 提示词节点。
 * 复用编辑器侧 use-param-mapping 的聚类口径，这里验证「库里读到的映射」
 * 与「编辑器里连的线」是同一份事实。 */
const io: WorkflowIOMap = {
  "5::widget::aspect_ratio": {
    direction: "input",
    kind: "widget",
    nodeId: "5",
    nodeTitle: "分辨率选择器",
    name: "aspect_ratio",
    label: "宽高比",
    type: "COMBO",
    defaultValue: "1:1",
  },
  "5::widget::megapixels": {
    direction: "input",
    kind: "widget",
    nodeId: "5",
    nodeTitle: "分辨率选择器",
    name: "megapixels",
    label: "百万像素",
    type: "COMBO",
    defaultValue: "1.0",
  },
  "9::widget::text": {
    direction: "input",
    kind: "widget",
    nodeId: "9",
    nodeTitle: "Text to Image",
    name: "text",
    label: "提示词",
    type: "STRING",
    defaultValue: "a very long positive prompt used by the workflow author",
  },
};

describe("useParamMappingSummary", () => {
  it("按节点归类出对外参数，并把目标端口翻译成作者写的端口名", () => {
    const { result } = renderHook(() =>
      useParamMappingSummary({ io, paramMap: {}, mode: "T2I" })
    );
    const labels = result.current.rows.map((row) => row.entry.label);
    expect(labels).toContain("宽高比");
    expect(labels).toContain("提示词");
    const aspect = result.current.rows.find((row) => row.entry.label === "宽高比")!;
    /* 端口名取作者写的 label/name，与表单里那一行的显示名一致。 */
    expect(aspect.targetName).toBe("宽高比");
    expect(aspect.manual).toBe(false);
  });

  it("从 paramMap.source 还原作者手工改过的连线并标为手工", () => {
    const { result } = renderHook(() =>
      useParamMappingSummary({
        io,
        paramMap: { source: { "5|size-aspect": "5::widget::megapixels" } },
        mode: null,
      })
    );
    const aspect = result.current.rows.find((row) => row.entry.id === "5|size-aspect")!;
    expect(aspect.targetName).toBe("百万像素");
    expect(aspect.manual).toBe(true);
  });

  it("显式断开的线如实显示未连线", () => {
    const { result } = renderHook(() =>
      useParamMappingSummary({
        io,
        paramMap: { source: { "9|prompt": null } },
        mode: null,
      })
    );
    const prompt = result.current.rows.find((row) => row.entry.id === "9|prompt")!;
    expect(prompt.targetName).toBeNull();
    expect(prompt.manual).toBe(true);
  });

  it("按模式的连线只在对应模式下生效", () => {
    const paramMap = {
      source: { "mode:T2I": { "5|size-aspect": "5::widget::megapixels" } },
    };
    const t2i = renderHook(() =>
      useParamMappingSummary({ io, paramMap, mode: "T2I" })
    );
    const other = renderHook(() =>
      useParamMappingSummary({ io, paramMap, mode: "T2V" })
    );
    expect(
      t2i.result.current.rows.find((row) => row.entry.id === "5|size-aspect")!.targetName
    ).toBe("百万像素");
    const fallback = other.result.current.rows.find(
      (row) => row.entry.id === "5|size-aspect"
    )!;
    expect(fallback.manual).toBe(false);
    expect(fallback.targetName).toBe("宽高比");
  });

  it("byPort 把映射挂到端口上，供表单行尾展示", () => {
    const { result } = renderHook(() =>
      useParamMappingSummary({ io, paramMap: {}, mode: null })
    );
    expect(result.current.byPort["9::widget::text"]?.entry.label).toBe("提示词");
    expect(result.current.byPort["5::widget::aspect_ratio"]?.targetName).toBe("宽高比");
  });

  it("没有任何对外参数时不产出任何行", () => {
    const { result } = renderHook(() =>
      useParamMappingSummary({ io: {}, paramMap: {}, mode: null })
    );
    expect(result.current.rows).toEqual([]);
    expect(result.current.byPort).toEqual({});
  });

  it("未连线的对外参数排在已连线之后", () => {
    const { result } = renderHook(() =>
      useParamMappingSummary({
        io,
        paramMap: { source: { "9|prompt": null } },
        mode: null,
      })
    );
    expect(result.current.rows[result.current.rows.length - 1]!.targetName).toBeNull();
  });
});
