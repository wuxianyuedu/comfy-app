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

describe("enrichWorkflowIO — legacy param 自迁移", () => {
  it("widget-backed param（raw input 带 widget 标记）迁移为 widget，key 同步改写", async () => {
    const result = await enrichWorkflowIO(
      makeParams(
        {
          "7::param::seed": {
            direction: "input",
            kind: "param",
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
    const entry = result["7::widget::seed"];
    expect(entry).toBeDefined();
    expect(entry.kind).toBe("widget");
    expect(entry.type).toBe("INT");
    expect(result["7::param::seed"]).toBeUndefined();
  });

  it("type 可编辑但无 raw input 的 param 迁移为 widget", async () => {
    const result = await enrichWorkflowIO(
      makeParams(
        {
          "7::param::steps": {
            direction: "input",
            kind: "param",
            nodeId: "7",
            name: "steps",
          },
        },
        {
          graph: {
            "7": {
              inputs: { steps: 20 },
            },
          },
        }
      )
    );
    const entry = result["7::widget::steps"];
    expect(entry).toBeDefined();
    expect(entry.kind).toBe("widget");
    expect(entry.type).toBe("INT");
    expect(result["7::param::steps"]).toBeUndefined();
  });

  it("link 类型 param（MODEL）不迁移，保持 param", async () => {
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
    const entry = result["7::param::model"];
    expect(entry).toBeDefined();
    expect(entry.kind).toBe("param");
    expect(result["7::widget::model"]).toBeUndefined();
  });

  it("output 方向条目不受迁移影响", async () => {
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
    const entry = result["7::output::image"];
    expect(entry).toBeDefined();
    expect(entry.kind).toBe("output");
  });

  it("已存在正确 widget 条目时不去重覆盖（保留后到者数据）", async () => {
    const result = await enrichWorkflowIO(
      makeParams({
        "7::param::seed": {
          direction: "input",
          kind: "param",
          nodeId: "7",
          name: "seed",
          label: "旧标签",
        },
        "7::widget::seed": {
          direction: "input",
          kind: "widget",
          nodeId: "7",
          name: "seed",
          label: "新标签",
        },
      })
    );
    const entry = result["7::widget::seed"];
    expect(entry).toBeDefined();
    expect(entry.kind).toBe("widget");
    expect(entry.label).toBe("新标签");
  });
});
