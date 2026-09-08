import { describe, it, expect } from "vitest";
import { enrichWorkflowIO } from "./workflow-detail-io";
import type { WorkflowIOEnrichParams } from "./workflow-detail-io";

/** Minimal valid params; individual tests override the fields they need. */
function makeParams(
  workflowIORaw: Record<string, unknown>,
  extra?: Partial<WorkflowIOEnrichParams>
): WorkflowIOEnrichParams {
  return {
    workflowIORaw: workflowIORaw as unknown as WorkflowIOEnrichParams["workflowIORaw"],
    rawInputsById: {},
    rawNodeMeta: [],
    graph: {},
    nodeTitleById: {},
    nodeTypeById: {},
    comboOptionsForClassField: async () => undefined,
    comboOptionsForFieldName: async () => undefined,
    ...extra,
  };
}

describe("enrichWorkflowIO — 存储 kind 透传（新格式）", () => {
  it("widget 条目保持 widget，并补全 type/defaultValue", async () => {
    const result = await enrichWorkflowIO(
      makeParams(
        {
          "7::widget::seed": {
            direction: "input",
            kind: "widget",
            nodeId: "7",
            name: "seed",
          },
        },
        {
          rawInputsById: {
            "7": [
              {
                name: "seed",
                type: "INT",
                isConnection: false,
                widget: { name: "seed" },
                widgetValue: 42,
              },
            ],
          },
        }
      )
    );
    const entry = result["7::widget::seed"]!;
    expect(entry).toBeDefined();
    expect(entry.kind).toBe("widget");
    expect(entry.type).toBe("INT");
    expect(entry.defaultValue).toBe(42);
  });

  it("param（wire 端口）条目不被擅自升级为 widget，保持 param", async () => {
    // 新格式下 param 即 wire-only 端口；enrichment 不再做旧数据迁移
    const result = await enrichWorkflowIO(
      makeParams(
        {
          "7::param::model": {
            direction: "input",
            kind: "param",
            nodeId: "7",
            name: "model",
          },
        },
        {
          rawInputsById: {
            "7": [
              {
                name: "model",
                type: "MODEL",
                isConnection: false,
              },
            ],
          },
        }
      )
    );
    const entry = result["7::param::model"]!;
    expect(entry).toBeDefined();
    expect(entry.kind).toBe("param");
    expect(result["7::widget::model"]).toBeUndefined();
  });

  it("API-only 图回退：按 graph 字面量补 default/type，kind 仍透传", async () => {
    const result = await enrichWorkflowIO(
      makeParams(
        {
          "7::widget::steps": {
            direction: "input",
            kind: "widget",
            nodeId: "7",
            name: "steps",
          },
        },
        {
          graph: {
            "7": { inputs: { steps: 20 } },
          },
        }
      )
    );
    const entry = result["7::widget::steps"]!;
    expect(entry.kind).toBe("widget");
    expect(entry.type).toBe("INT");
    expect(entry.defaultValue).toBe(20);
  });

  it("output 方向条目不受影响", async () => {
    const result = await enrichWorkflowIO(
      makeParams({
        "7::output::image": {
          direction: "output",
          kind: "output",
          nodeId: "7",
          name: "image",
        },
      })
    );
    const entry = result["7::output::image"]!;
    expect(entry).toBeDefined();
    expect(entry.kind).toBe("output");
  });

  it("同 node 不同 kind 的条目各自独立落 key，互不覆盖", async () => {
    const result = await enrichWorkflowIO(
      makeParams({
        "7::param::model": {
          direction: "input",
          kind: "param",
          nodeId: "7",
          name: "model",
        },
        "7::widget::seed": {
          direction: "input",
          kind: "widget",
          nodeId: "7",
          name: "seed",
        },
      })
    );
    expect(result["7::param::model"]?.kind).toBe("param");
    expect(result["7::widget::seed"]?.kind).toBe("widget");
  });
});

describe("enrichWorkflowIO — COMBO 存量值对齐服务器候选表", () => {
  const VALID = [
    "1:1 (Square)",
    "2:3 (Portrait Photo)",
    "3:2 (Photo)",
    "4:3 (Standard)",
    "9:16 (Portrait Widescreen)",
    "16:9 (Widescreen)",
    "21:9 (Ultrawide)",
  ];

  function comboParams(workflowIORaw: Record<string, unknown>) {
    return makeParams(workflowIORaw, {
      rawInputsById: {
        "94": [
          {
            name: "aspect_ratio",
            type: "COMBO",
            isConnection: false,
            widget: { name: "aspect_ratio" },
            widgetValue: "16:9 (Widescreen)",
          },
        ],
      },
      comboOptionsForClassField: async () => VALID,
    });
  }

  it("非法的模式默认值按宽高比数值纠正（16:9 → 16:9 (Widescreen)）", async () => {
    const result = await enrichWorkflowIO(
      comboParams({
        "94::widget::aspect_ratio": {
          direction: "input",
          kind: "widget",
          nodeId: "94",
          name: "aspect_ratio",
          modes: { T2I: { defaultValue: "16:9" } },
        },
      })
    );
    const modes = result["94::widget::aspect_ratio"]!.modes as Record<
      string,
      { defaultValue?: unknown }
    >;
    expect(modes.T2I!.defaultValue).toBe("16:9 (Widescreen)");
  });

  it("合法值原样透传，不产生改写", async () => {
    const result = await enrichWorkflowIO(
      comboParams({
        "94::widget::aspect_ratio": {
          direction: "input",
          kind: "widget",
          nodeId: "94",
          name: "aspect_ratio",
          value: "16:9 (Widescreen)",
          modes: { T2I: { defaultValue: "4:3 (Standard)" } },
        },
      })
    );
    const entry = result["94::widget::aspect_ratio"]!;
    expect(entry.value).toBe("16:9 (Widescreen)");
    expect(
      (entry.modes as Record<string, { defaultValue?: unknown }>).T2I!.defaultValue
    ).toBe("4:3 (Standard)");
  });

  it("候选表匹配不上的覆盖值被丢弃，回退合法 defaultValue", async () => {
    const result = await enrichWorkflowIO(
      comboParams({
        "94::widget::aspect_ratio": {
          direction: "input",
          kind: "widget",
          nodeId: "94",
          name: "aspect_ratio",
          value: "竖版高清",
        },
      })
    );
    const entry = result["94::widget::aspect_ratio"]!;
    /* 「竖版高清」解析不出宽高比、前缀也匹配不上任何候选 → 覆盖被丢弃。 */
    expect(entry.value).toBeUndefined();
  });

  it("候选表缺失（ComfyUI 离线）时不清洗，保留原值", async () => {
    const result = await enrichWorkflowIO(
      makeParams({
        "94::widget::aspect_ratio": {
          direction: "input",
          kind: "widget",
          nodeId: "94",
          name: "aspect_ratio",
          value: "16:9",
        },
      })
    );
    expect(result["94::widget::aspect_ratio"]!.value).toBe("16:9");
  });
});
