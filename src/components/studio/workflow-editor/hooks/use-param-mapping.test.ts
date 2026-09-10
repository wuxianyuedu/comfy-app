// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";

import type { WorkflowIOMap } from "~/lib/workflow-io-types";
import { useParamMapping, validateMapping } from "./use-param-mapping";

const io: WorkflowIOMap = {
  "5::widget::width": {
    direction: "input",
    kind: "widget",
    nodeId: "5",
    name: "width",
    type: "INT",
    defaultValue: 512,
  },
  "5::widget::resolution": {
    direction: "input",
    kind: "widget",
    nodeId: "5",
    name: "resolution",
    type: "COMBO",
    defaultValue: "1024x1024",
  },
  "9::widget::text": {
    direction: "input",
    kind: "widget",
    nodeId: "9",
    name: "text",
    type: "STRING",
    defaultValue: "a very long positive prompt used by the workflow author",
  },
};

function render(paramMap: Record<string, unknown> = {}, mode: string | null = null) {
  return renderHook(() =>
    useParamMapping({ workflowId: "wf", io, mode, paramMap })
  );
}

describe("useParamMapping", () => {
  it("对外参数按节点聚类，默认走自动映射（默认连线状态）", () => {
    const { result } = render();
    expect(result.current.entries.map((entry) => entry.id).sort()).toEqual([
      "5|other",
      "5|size-width",
      "9|prompt",
    ]);
    expect(result.current.resolved["5|size-width"]).toBe("5::widget::width");
    expect(result.current.resolved["9|prompt"]).toBe("9::widget::text");
    expect(result.current.isManual("5|size-width")).toBe(false);
  });

  it("手工连线覆盖自动映射，且标记为手工", () => {
    const { result } = render();
    act(() => result.current.connect("5|size-width", "5::widget::resolution"));
    expect(result.current.resolved["5|size-width"]).toBe("5::widget::resolution");
    expect(result.current.isManual("5|size-width")).toBe(true);
  });

  it("回到自动映射", () => {
    const { result } = render();
    act(() => result.current.connect("5|size-width", "5::widget::resolution"));
    act(() => result.current.resetToAuto("5|size-width"));
    expect(result.current.resolved["5|size-width"]).toBe("5::widget::width");
    expect(result.current.isManual("5|size-width")).toBe(false);
  });

  it("从已落库的 paramMap.source 恢复手工线", () => {
    const { result } = render({ source: { "5|size-width": "5::widget::resolution" } });
    expect(result.current.resolved["5|size-width"]).toBe("5::widget::resolution");
    expect(result.current.isManual("5|size-width")).toBe(true);
  });

  it("按模式的连线只在该模式下生效", () => {
    const { result } = render({}, "T2I");
    act(() => result.current.connect("5|size-width", "5::widget::resolution"));
    expect(result.current.resolved["5|size-width"]).toBe("5::widget::resolution");
    expect(result.current.isManual("5|size-width")).toBe(true);
  });

  it("withMapping 把连线写进 paramMap.source，且保留原有键", () => {
    const { result } = render({ positiveNode: "9" });
    act(() => result.current.connect("5|size-width", "5::widget::resolution"));
    const merged = result.current.withMapping({ positiveNode: "9" });
    expect(merged.positiveNode).toBe("9");
    expect(merged.source).toMatchObject({ "5|size-width": "5::widget::resolution" });
  });
});

describe("validateMapping", () => {
  it("同一端口被两个对外参数占用 → 报错", () => {
    const result = validateMapping(
      [
        {
          id: "a",
          nodeId: "5",
          nodeTitle: "",
          cls: "other",
          label: "A",
          exposedName: "width",
          type: "INT",
          pins: [],
        },
        {
          id: "b",
          nodeId: "5",
          nodeTitle: "",
          cls: "other",
          label: "B",
          exposedName: "width",
          type: "INT",
          pins: [],
        },
      ],
      io,
      { manual: { a: "5::widget::width", b: "5::widget::width" } }
    );
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toContain("同时占用");
  });

  it("连到不存在的端口 → 报错", () => {
    const result = validateMapping(
      [
        {
          id: "a",
          nodeId: "5",
          nodeTitle: "",
          cls: "other",
          label: "A",
          exposedName: "width",
          type: "INT",
          pins: [],
        },
      ],
      io,
      { manual: { a: "5::widget::ghost" } }
    );
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toContain("不存在");
  });

  it("正常映射通过", () => {
    const result = validateMapping(
      [
        {
          id: "a",
          nodeId: "5",
          nodeTitle: "",
          cls: "other",
          label: "A",
          exposedName: "width",
          type: "INT",
          pins: [],
        },
      ],
      io,
      { manual: { a: "5::widget::width" } }
    );
    expect(result).toEqual({ ok: true, problems: [] });
  });
});
