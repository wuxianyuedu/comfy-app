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

describe("enrichWorkflowIO — classType（产出节点类名）", () => {
  it("raw 导出的节点类名优先下发（工坊靠它区分首帧 / 尾帧槽）", async () => {
    const result = await enrichWorkflowIO(
      makeParams(
        {
          "20::widget::image": {
            direction: "input",
            kind: "widget",
            nodeId: "20",
            name: "image",
          },
        },
        {
          // raw 侧类名（buildNodeTypeMap）与存库 graph 的 class_type 同时存在时，
          // 取 raw 的 —— 它才是 ComfyUI 里真实的 class。
          nodeTypeById: { "20": "LoadImageFirstFrame" },
          graph: { "20": { class_type: "LoadImage", inputs: {} } },
        }
      )
    );
    expect(result["20::widget::image"]!.classType).toBe("LoadImageFirstFrame");
  });

  it("API-only 导入（无 rawJson）退到 graph 的 class_type", async () => {
    const result = await enrichWorkflowIO(
      makeParams(
        {
          "21::widget::image": {
            direction: "input",
            kind: "widget",
            nodeId: "21",
            name: "image",
          },
        },
        { graph: { "21": { class_type: "LoadImageLastFrame", inputs: {} } } }
      )
    );
    expect(result["21::widget::image"]!.classType).toBe("LoadImageLastFrame");
  });

  it("两处都拿不到类名时不下发该字段（消费方按普通参考图降级）", async () => {
    const result = await enrichWorkflowIO(
      makeParams({
        "22::widget::image": {
          direction: "input",
          kind: "widget",
          nodeId: "22",
          name: "image",
        },
      })
    );
    expect(result["22::widget::image"]!.classType).toBeUndefined();
  });
});

describe("enrichWorkflowIO — 子工作流封装节点的暴露口业务名（ISSUE #349）", () => {
  const WRAPPER = "aaaaaaaa-1111-2222-3333-444444444444";
  const wrapperParams = (rawExtra?: Record<string, unknown>) =>
    makeParams(
      {
        "1::widget::value_1": {
          direction: "input",
          kind: "widget",
          nodeId: "1",
          name: "value_1",
        },
      },
      {
        rawInputsById: {
          "1": [
            {
              name: "value_1",
              type: "INT",
              isConnection: false,
              widget: { name: "value_1" },
              widgetValue: 12345,
              ...rawExtra,
            },
          ],
        },
        graph: { "1": { class_type: WRAPPER, inputs: {} } },
        nodeTypeById: { "1": WRAPPER },
        nodeTitleById: { "1": "Sampler" },
      }
    );

  it("用内部真实字段的业务名，而不是本层别名 value_1", async () => {
    const result = await enrichWorkflowIO(
      wrapperParams({
        proxyField: { nodeId: "12", field: "seed", label: "随机种子" },
      })
    );
    expect(result["1::widget::value_1"]!.label).toBe("随机种子");
    expect(result["1::widget::value_1"]!.type).toBe("INT");
    expect(result["1::widget::value_1"]!.defaultValue).toBe(12345);
  });

  it("内部字段没有 label 时退到 localized，再退到字段名（不是别名）", async () => {
    const byLocalized = await enrichWorkflowIO(
      wrapperParams({ proxyField: { nodeId: "12", field: "seed", localized: "种子" } })
    );
    expect(byLocalized["1::widget::value_1"]!.label).toBe("种子");

    const byField = await enrichWorkflowIO(
      wrapperParams({ proxyField: { nodeId: "12", field: "seed" } })
    );
    expect(byField["1::widget::value_1"]!.label).toBe("seed");
  });

  it("作者已命名的本地 label 依旧最高优先（不被内部字段覆盖）", async () => {
    const result = await enrichWorkflowIO(
      makeParams(
        {
          "1::widget::value_1": {
            direction: "input",
            kind: "widget",
            nodeId: "1",
            name: "value_1",
            label: "我的种子",
          },
        },
        {
          rawInputsById: {
            "1": [
              {
                name: "value_1",
                type: "INT",
                isConnection: false,
                widget: { name: "value_1" },
                widgetValue: 1,
                proxyField: { nodeId: "12", field: "seed", label: "随机种子" },
              },
            ],
          },
        }
      )
    );
    expect(result["1::widget::value_1"]!.label).toBe("我的种子");
  });

  it("存量 label 恰好是别名时视为未命名，改由内部字段取名", async () => {
    /* 修复前勾选会把画布显示名（别名 value_1）写进 label 落库，这不是
     * 作者命名，不该把内部字段的业务名压掉。 */
    const result = await enrichWorkflowIO(
      makeParams(
        {
          "1::widget::value_1": {
            direction: "input",
            kind: "widget",
            nodeId: "1",
            name: "value_1",
            label: "value_1",
          },
        },
        {
          rawInputsById: {
            "1": [
              {
                name: "value_1",
                type: "INT",
                isConnection: false,
                widget: { name: "value_1" },
                widgetValue: 1,
                proxyField: { nodeId: "12", field: "seed", label: "随机种子" },
              },
            ],
          },
        }
      )
    );
    expect(result["1::widget::value_1"]!.label).toBe("随机种子");
  });

  it("普通节点上 label 与 pin 名相同仍原样保留（不误判为存量别名）", async () => {
    const result = await enrichWorkflowIO(
      makeParams(
        {
          "7::widget::seed": {
            direction: "input",
            kind: "widget",
            nodeId: "7",
            name: "seed",
            label: "seed",
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
                localized: "随机种",
              },
            ],
          },
        }
      )
    );
    expect(result["7::widget::seed"]!.label).toBe("seed");
  });

  it("没有 proxyField（普通节点 / 未解析出代理）时行为与旧版一致", async () => {
    const result = await enrichWorkflowIO(
      wrapperParams({ label: "Steps" })
    );
    expect(result["1::widget::value_1"]!.label).toBe("Steps");
  });

  it("存库键是内部字段名时按 proxyField.field 回退匹配上同一个暴露口", async () => {
    const result = await enrichWorkflowIO(
      makeParams(
        {
          "1::widget::seed": {
            direction: "input",
            kind: "widget",
            nodeId: "1",
            name: "seed",
          },
        },
        {
          rawInputsById: {
            "1": [
              {
                name: "value_1",
                type: "INT",
                isConnection: false,
                widget: { name: "value_1" },
                widgetValue: 7,
                proxyField: { nodeId: "12", field: "seed", label: "随机种子" },
              },
            ],
          },
          graph: { "1": { class_type: WRAPPER, inputs: {} } },
        }
      )
    );
    expect(result["1::widget::seed"]!.label).toBe("随机种子");
    expect(result["1::widget::seed"]!.defaultValue).toBe(7);
  });
});
