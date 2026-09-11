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

function render(paramMap: Record<string, unknown> = {}, mode: string | null = "T2I") {
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
    expect(result.current.hasManual).toBe(false);
  });

  it("连一条线覆盖默认连线状态，且标记为「已改过」", () => {
    const { result } = render();
    act(() => result.current.connect("5|size-width", "5::widget::resolution"));
    expect(result.current.resolved["5|size-width"]).toBe("5::widget::resolution");
    expect(result.current.isManual("5|size-width")).toBe(true);
    expect(result.current.hasManual).toBe(true);
  });

  it("单个「恢复默认」回到默认连线状态", () => {
    const { result } = render();
    act(() => result.current.connect("5|size-width", "5::widget::resolution"));
    act(() => result.current.resetToAuto("5|size-width"));
    expect(result.current.resolved["5|size-width"]).toBe("5::widget::width");
    expect(result.current.isManual("5|size-width")).toBe(false);
  });

  it("整模式的「恢复默认」清掉当前模式的全部线", () => {
    const { result } = render();
    act(() => result.current.connect("5|size-width", "5::widget::resolution"));
    act(() => result.current.connect("9|prompt", null));
    expect(result.current.hasManual).toBe(true);
    act(() => result.current.resetAll());
    expect(result.current.hasManual).toBe(false);
    expect(result.current.resolved["5|size-width"]).toBe("5::widget::width");
    /* 显式断开的线也一起撤销，参数回到默认线，而不是一直「没连上」。 */
    expect(result.current.resolved["9|prompt"]).toBe("9::widget::text");
  });

  it("没有模式时禁止连线（canWire=false，connect 是空操作）", () => {
    const { result } = render({}, null);
    expect(result.current.canWire).toBe(false);
    act(() => result.current.connect("5|size-width", "5::widget::resolution"));
    expect(result.current.isManual("5|size-width")).toBe(false);
    expect(result.current.resolved["5|size-width"]).toBe("5::widget::width");
  });

  it("从已落库的 paramMap.source（mode:<模式>）恢复作者的线", () => {
    const { result } = render({
      source: { "mode:T2I": { "5|size-width": "5::widget::resolution" } },
    });
    expect(result.current.resolved["5|size-width"]).toBe("5::widget::resolution");
    expect(result.current.isManual("5|size-width")).toBe(true);
  });

  it("按模式的线只在该模式下生效", () => {
    const paramMap = { source: { "mode:T2I": { "5|size-width": "5::widget::resolution" } } };
    const t2i = renderHook(() => useParamMapping({ workflowId: "wf", io, mode: "T2I", paramMap }));
    const i2i = renderHook(() => useParamMapping({ workflowId: "wf", io, mode: "I2I", paramMap }));
    expect(t2i.result.current.resolved["5|size-width"]).toBe("5::widget::resolution");
    expect(i2i.result.current.resolved["5|size-width"]).toBe("5::widget::width");
  });

  it("withMapping 把线写进 paramMap.source.mode:<模式>，且保留原有键", () => {
    const { result } = render({ positiveNode: "9" });
    act(() => result.current.connect("5|size-width", "5::widget::resolution"));
    const merged = result.current.withMapping({ positiveNode: "9" });
    expect(merged.positiveNode).toBe("9");
    expect(merged.source).toMatchObject({
      "mode:T2I": { "5|size-width": "5::widget::resolution" },
    });
  });

  it("显式断开写 null（运行期据此如实回报「没落值」）", () => {
    const { result } = render();
    act(() => result.current.connect("5|size-width", null));
    expect(result.current.resolved["5|size-width"]).toBeNull();
    expect(result.current.isManual("5|size-width")).toBe(true);
    const merged = result.current.withMapping({});
    expect(merged.source).toMatchObject({ "mode:T2I": { "5|size-width": null } });
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
      { manualByMode: { T2I: { a: "5::widget::width", b: "5::widget::width" } } },
      "T2I"
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
      { manualByMode: { T2I: { a: "5::widget::ghost" } } },
      "T2I"
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
      { manualByMode: { T2I: { a: "5::widget::width" } } },
      "T2I"
    );
    expect(result).toEqual({ ok: true, problems: [] });
  });
});
