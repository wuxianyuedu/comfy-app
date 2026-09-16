import { describe, it, expect } from "vitest";
import { enrichWorkflowIO } from "./workflow-detail-io";
import type { WorkflowIOEnrichParams } from "./workflow-detail-io";
import { buildRawInputs } from "./workflow-detail-raw";
import type { RawWorkflow } from "./raw";

/** Minimal valid params; individual tests override the fields they need. */
function makeParams(
  workflowIORaw: Record<string, unknown>,
  extra?: Partial<WorkflowIOEnrichParams>,
): WorkflowIOEnrichParams {
  return {
    workflowIORaw:
      workflowIORaw as unknown as WorkflowIOEnrichParams["workflowIORaw"],
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
        },
      ),
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
        },
      ),
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
        },
      ),
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
      }),
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
      }),
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
      }),
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
      }),
    );
    const entry = result["94::widget::aspect_ratio"]!;
    expect(entry.value).toBe("16:9 (Widescreen)");
    expect(
      (entry.modes as Record<string, { defaultValue?: unknown }>).T2I!
        .defaultValue,
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
      }),
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
      }),
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
        },
      ),
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
        { graph: { "21": { class_type: "LoadImageLastFrame", inputs: {} } } },
      ),
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
      }),
    );
    expect(result["22::widget::image"]!.classType).toBeUndefined();
  });
});

describe("enrichWorkflowIO — 图内语义角色 role（ISSUE #611）", () => {
  it("顶层正 / 反向文本编码节点按 paramMap 投影出 role", async () => {
    /* 同一对 CLIPTextEncode 的 pin 名与显示名完全一样（都叫 text / 「文本」），
     * 名字层面分不出正负 —— 角色只能来自导入图沿 KSampler 的 positive /
     * negative 连线链推出的 paramMap。 */
    const result = await enrichWorkflowIO(
      makeParams(
        {
          "6::widget::text": {
            direction: "input",
            kind: "widget",
            nodeId: "6",
            name: "text",
          },
          "7::widget::text": {
            direction: "input",
            kind: "widget",
            nodeId: "7",
            name: "text",
          },
          "5::widget::width": {
            direction: "input",
            kind: "widget",
            nodeId: "5",
            name: "width",
          },
        },
        { paramMap: { positiveNode: "6", negativeNode: "7" } },
      ),
    );
    expect(result["6::widget::text"]!.role).toBe("positive");
    expect(result["7::widget::text"]!.role).toBe("negative");
    /* 不在正 / 反向节点上的条目不下发 role（宁可不显示，也不猜错）。 */
    expect(result["5::widget::width"]!.role).toBeUndefined();
  });

  it("paramMap 的 id 是 UUID 形态时按前缀宽容匹配（与 canonicalNodeId 同源）", async () => {
    const result = await enrichWorkflowIO(
      makeParams(
        {
          "7::widget::text": {
            direction: "input",
            kind: "widget",
            nodeId: "7",
            name: "text",
          },
        },
        {
          paramMap: {
            positiveNode: "6",
            negativeNode: "7-abcdef00-1111-2222-3333-444444444444",
          },
        },
      ),
    );
    expect(result["7::widget::text"]!.role).toBe("negative");
  });

  it("没有 paramMap（老数据 / API-only 未判定）时不下发 role", async () => {
    const result = await enrichWorkflowIO(
      makeParams({
        "6::widget::text": {
          direction: "input",
          kind: "widget",
          nodeId: "6",
          name: "text",
        },
      }),
    );
    expect(result["6::widget::text"]!.role).toBeUndefined();
  });

  it("输出条目不带 role（角色只对输入口有意义）", async () => {
    const result = await enrichWorkflowIO(
      makeParams(
        {
          "9::output::images": {
            direction: "output",
            kind: "output",
            nodeId: "9",
            name: "images",
          },
        },
        { paramMap: { positiveNode: "9", negativeNode: "9" } },
      ),
    );
    expect(result["9::output::images"]!.role).toBeUndefined();
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
      },
    );

  it("用内部真实字段的业务名，而不是本层别名 value_1", async () => {
    const result = await enrichWorkflowIO(
      wrapperParams({
        proxyField: { nodeId: "12", field: "seed", label: "随机种子" },
      }),
    );
    expect(result["1::widget::value_1"]!.label).toBe("随机种子");
    expect(result["1::widget::value_1"]!.type).toBe("INT");
    expect(result["1::widget::value_1"]!.defaultValue).toBe(12345);
  });

  it("内部字段没有 label 时退到 localized，再退到字段名（不是别名）", async () => {
    const byLocalized = await enrichWorkflowIO(
      wrapperParams({
        proxyField: { nodeId: "12", field: "seed", localized: "种子" },
      }),
    );
    expect(byLocalized["1::widget::value_1"]!.label).toBe("种子");

    const byField = await enrichWorkflowIO(
      wrapperParams({ proxyField: { nodeId: "12", field: "seed" } }),
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
        },
      ),
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
        },
      ),
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
        },
      ),
    );
    expect(result["7::widget::seed"]!.label).toBe("seed");
  });

  it("没有 proxyField（普通节点 / 未解析出代理）时行为与旧版一致", async () => {
    const result = await enrichWorkflowIO(wrapperParams({ label: "Steps" }));
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
        },
      ),
    );
    expect(result["1::widget::seed"]!.label).toBe("随机种子");
    expect(result["1::widget::seed"]!.defaultValue).toBe(7);
  });

  it("proxyWidgets 缺失（被导出隔离）时，仍按本层作者 label 清掉存量别名", async () => {
    /* 真实工作流形状：`properties.proxyWidgets` 因导出缺失被 ComfyUI 隔离
     *  （`proxyWidgetErrorQuarantine`），proxyField 无从解析，但 wrapper 本层
     *  inputs[] 仍带作者写的 label（"Seed"），槽位名是别名 value_1。
     *  存量库里勾选时把别名写进了 label——不能让别名把作者名压回去。 */
    const result = await enrichWorkflowIO(
      makeParams(
        {
          "9::widget::value_1": {
            direction: "input",
            kind: "widget",
            nodeId: "9",
            name: "value_1",
            label: "value_1",
          },
        },
        {
          rawInputsById: {
            "9": [
              {
                name: "value_1",
                label: "Seed",
                type: "INT",
                isConnection: false,
                widget: { name: "value_1" },
                widgetValue: 42,
              },
            ],
          },
          graph: { "9": { class_type: WRAPPER, inputs: {} } },
          nodeTypeById: { "9": WRAPPER },
        },
      ),
    );
    expect(result["9::widget::value_1"]!.label).toBe("Seed");
    expect(result["9::widget::value_1"]!.type).toBe("INT");
    expect(result["9::widget::value_1"]!.defaultValue).toBe(42);
  });

  it("proxyWidgets 缺失时，作者手写的非别名 label 不受影响", async () => {
    const result = await enrichWorkflowIO(
      makeParams(
        {
          "9::widget::value_1": {
            direction: "input",
            kind: "widget",
            nodeId: "9",
            name: "value_1",
            label: "我的种子",
          },
        },
        {
          rawInputsById: {
            "9": [
              {
                name: "value_1",
                label: "Seed",
                type: "INT",
                isConnection: false,
                widget: { name: "value_1" },
                widgetValue: 42,
              },
            ],
          },
          graph: { "9": { class_type: WRAPPER, inputs: {} } },
          nodeTypeById: { "9": WRAPPER },
        },
      ),
    );
    expect(result["9::widget::value_1"]!.label).toBe("我的种子");
  });

  it("普通节点：作者手写的名字与 pin 名逐字相同时原样保留", async () => {
    /* 机器名判定要求「存在一个与槽位名不同的作者可见名」——raw 条目
     *  label 与 pin 名逐字相同时无从判定，此时信任存量 label（作者确实
     *  可以把它改名成与 pin 名一样的字）。 */
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
                label: "seed",
                type: "INT",
                isConnection: false,
                widget: { name: "seed" },
                widgetValue: 42,
              },
            ],
          },
          graph: { "7": { class_type: "KSampler", inputs: {} } },
          nodeTypeById: { "7": "KSampler" },
        },
      ),
    );
    expect(result["7::widget::seed"]!.label).toBe("seed");
  });

  it("普通节点：存量 label 是 pin 名时让位给作者的 label（ISSUE #349）", async () => {
    /* LoadImage 的 image 槽：作者写的 label 是 "Last Frame Image"，而存量
     *  workflowIO 里躺着的是勾选那一刻的原始 pin 名 `image`（旧版画布在拿
     *  不到 meta 时会这么写）。IO 面板必须显示作者名，与画布逐字一致。 */
    const result = await enrichWorkflowIO(
      makeParams(
        {
          "24::widget::image": {
            direction: "input",
            kind: "widget",
            nodeId: "24",
            name: "image",
            label: "image",
          },
        },
        {
          rawInputsById: {
            "24": [
              {
                name: "image",
                label: "Last Frame Image",
                localized: "图像",
                type: "COMBO",
                isConnection: false,
                widget: { name: "image" },
                widgetValue: "last.png",
              },
            ],
          },
          graph: { "24": { class_type: "LoadImage", inputs: {} } },
          nodeTypeById: { "24": "LoadImage" },
        },
      ),
    );
    expect(result["24::widget::image"]!.label).toBe("Last Frame Image");
  });

  it("普通节点：作者手写的其它名字不受影响（不误伤）", async () => {
    const result = await enrichWorkflowIO(
      makeParams(
        {
          "24::widget::image": {
            direction: "input",
            kind: "widget",
            nodeId: "24",
            name: "image",
            label: "尾帧图",
          },
        },
        {
          rawInputsById: {
            "24": [
              {
                name: "image",
                label: "Last Frame Image",
                type: "COMBO",
                isConnection: false,
                widget: { name: "image" },
                widgetValue: "last.png",
              },
            ],
          },
          graph: { "24": { class_type: "LoadImage", inputs: {} } },
          nodeTypeById: { "24": "LoadImage" },
        },
      ),
    );
    expect(result["24::widget::image"]!.label).toBe("尾帧图");
  });
});

describe("enrichWorkflowIO — 子图内部节点（下钻视图勾选）的兜底取名", () => {
  it("顶层 rawInputsById 查不到时，用 innerInputsById 补出类型与作者名", async () => {
    /* 下钻到子工作流内部勾选种子：落库 nodeId 是内部节点 1670，顶层
     *  rawInputsById 里没有它。没有兜底表时类型退化成 `*`、显示名退化成
     *  pin 名（ISSUE #349）。 */
    const result = await enrichWorkflowIO(
      makeParams(
        {
          "1670::widget::value": {
            direction: "input",
            kind: "widget",
            nodeId: "1670",
            name: "value",
          },
        },
        {
          rawInputsById: {},
          innerInputsById: {
            "1670": [
              {
                name: "value",
                label: "Seed",
                type: "INT",
                isConnection: false,
                widget: { name: "value" },
                widgetValue: 1234,
              },
            ],
          },
          graph: {},
          nodeTypeById: {},
        },
      ),
    );
    const entry = result["1670::widget::value"]!;
    expect(entry.label).toBe("Seed");
    expect(entry.type).toBe("INT");
    expect(entry.defaultValue).toBe(1234);
  });

  it("顶层能查到时不看兜底表（顶层语义优先）", async () => {
    const result = await enrichWorkflowIO(
      makeParams(
        {
          "1670::widget::value": {
            direction: "input",
            kind: "widget",
            nodeId: "1670",
            name: "value",
          },
        },
        {
          rawInputsById: {
            "1670": [
              {
                name: "value",
                label: "顶层名",
                type: "FLOAT",
                isConnection: false,
                widget: { name: "value" },
              },
            ],
          },
          innerInputsById: {
            "1670": [
              {
                name: "value",
                label: "内层名",
                type: "INT",
                isConnection: false,
                widget: { name: "value" },
              },
            ],
          },
          graph: {},
          nodeTypeById: {},
        },
      ),
    );
    const entry = result["1670::widget::value"]!;
    expect(entry.label).toBe("顶层名");
    expect(entry.type).toBe("FLOAT");
  });
});

describe("enrichWorkflowIO — 真实封装节点工作流的端到端取名（ISSUE #349 回归）", () => {
  /* 复刻 issue #349 附件的真实形状：wrapper 节点 class_type 是子图 UUID，
   *  `properties.proxyWidgets` 因导出缺失被隔离（只有 proxyWidgetErrorQuarantine），
   *  槽位名是 ComfyUI 自动编号的别名 value_1，作者 label 写在本层 inputs[] 上
   *  （"Seed" / "Seconds"）。存量库里的 label 已被别名污染。
   *  这条链路要保证 buildRawInputs → enrichWorkflowIO 后仍取到 "Seed"。 */
  const WRAPPER_UUID = "e0940f57-80b2-480e-8a38-36968dc1763d";

  it("buildRawInputs + enrichWorkflowIO：别名槽位取到作者 label", async () => {
    const raw = {
      nodes: [
        {
          id: 1512,
          type: WRAPPER_UUID,
          inputs: [
            {
              name: "image",
              label: "image_first_frame",
              type: "IMAGE",
              link: 4418,
            },
            {
              name: "enabled",
              label: "WAN22: True = Safetensors",
              type: "BOOLEAN",
              widget: { name: "enabled" },
              link: null,
            },
            {
              name: "value_1",
              label: "Seed",
              type: "INT",
              widget: { name: "value_1" },
              link: null,
            },
            {
              name: "value_2",
              label: "Seconds",
              type: "INT",
              widget: { name: "value_2" },
              link: null,
            },
          ],
          outputs: [],
          properties: { cnr_id: "comfy-core", ver: "0.14.1" },
          widgets_values: [],
        },
      ],
      links: [],
      definitions: { subgraphs: [] },
    } as unknown as RawWorkflow;

    const { rawInputsById } = await buildRawInputs(raw, async () => undefined);
    const io = await enrichWorkflowIO(
      makeParams(
        {
          "1512::widget::value_1": {
            direction: "input",
            kind: "widget",
            nodeId: "1512",
            name: "value_1",
            label: "value_1",
          },
        },
        {
          rawInputsById,
          graph: { "1512": { class_type: WRAPPER_UUID, inputs: {} } },
          nodeTypeById: { "1512": WRAPPER_UUID },
        },
      ),
    );
    expect(io["1512::widget::value_1"]!.label).toBe("Seed");
    expect(io["1512::widget::value_1"]!.type).toBe("INT");
  });
});

describe("enrichWorkflowIO — 封装节点作者名整体回收不到时的取名（ISSUE #349）", () => {
  /* 真实复现路径：wrapper 本层只有自动编号的别名 `value_1`，ComfyUI 把
   * `properties.proxyWidgets` 整体隔离掉，子图导出里也没有 `-10` 哨兵边
   * （`proxyAuthorLabels` 于是为空）。上一版的两条判据（富化名不同 / 本层
   * slotLabel）都无从作证，别名被当成「作者命名」，于是「切一次 seed 行为
   * 名字就退回 value_1」。现在作者名从子图边界 pin 回收，且即便回收不到，
   * 封装节点的自动编号槽位也直接按机器名处理。 */
  const WRAPPER_UUID = "e0940f57-80b2-480e-8a38-36968dc1763d";

  const raw = {
    nodes: [
      {
        id: 4,
        type: WRAPPER_UUID,
        inputs: [
          {
            name: "value_1",
            type: "INT",
            widget: { name: "value_1" },
            link: null,
          },
        ],
        outputs: [],
        properties: { proxyWidgetErrorQuarantine: [["1670", "value"]] },
        widgets_values: [],
      },
    ],
    links: [],
    definitions: {
      subgraphs: [
        {
          id: WRAPPER_UUID,
          name: "I2V",
          inputs: [{ name: "value_1", label: "Seed", type: "INT" }],
          nodes: [],
        },
      ],
    },
  } as unknown as RawWorkflow;

  it("存量别名 label 被作者名顶掉，且类型 / 类名随条目下发", async () => {
    const { rawInputsById } = await buildRawInputs(raw, async () => undefined);
    const io = await enrichWorkflowIO(
      makeParams(
        {
          "4::widget::value_1": {
            direction: "input",
            kind: "widget",
            nodeId: "4",
            name: "value_1",
            label: "value_1",
          },
        },
        {
          rawInputsById,
          graph: { "4": { class_type: WRAPPER_UUID, inputs: {} } },
          nodeTypeById: { "4": WRAPPER_UUID },
        },
      ),
    );
    const entry = io["4::widget::value_1"]!;
    expect(entry.label).toBe("Seed");
    expect(entry.slotLabel).toBe("Seed");
    expect(entry.type).toBe("INT");
    /* 类名必须下发 —— 客户端「槽位名是封装节点自动编号别名」的判定靠它。 */
    expect(entry.classType).toBe(WRAPPER_UUID);
  });

  it("子图边界 pin 也没写作者名时，别名判据由 classType 承担", async () => {
    const noLabels = JSON.parse(JSON.stringify(raw)) as unknown as RawWorkflow;
    noLabels.definitions!.subgraphs![0]!.inputs = [
      { name: "value_1", type: "INT" },
    ];
    const { rawInputsById } = await buildRawInputs(
      noLabels,
      async () => undefined,
    );
    const io = await enrichWorkflowIO(
      makeParams(
        {
          "4::widget::value_1": {
            direction: "input",
            kind: "widget",
            nodeId: "4",
            name: "value_1",
            label: "value_1",
          },
        },
        {
          rawInputsById,
          graph: { "4": { class_type: WRAPPER_UUID, inputs: {} } },
          nodeTypeById: { "4": WRAPPER_UUID },
        },
      ),
    );
    expect(io["4::widget::value_1"]!.classType).toBe(WRAPPER_UUID);
  });

  it("作者写在本层的名字优先于子图边界 pin", async () => {
    const own = JSON.parse(JSON.stringify(raw)) as unknown as RawWorkflow;
    own.nodes[0]!.inputs![0]!.label = "我的种子";
    const { rawInputsById } = await buildRawInputs(own, async () => undefined);
    const io = await enrichWorkflowIO(
      makeParams(
        {
          "4::widget::value_1": {
            direction: "input",
            kind: "widget",
            nodeId: "4",
            name: "value_1",
          },
        },
        {
          rawInputsById,
          graph: { "4": { class_type: WRAPPER_UUID, inputs: {} } },
          nodeTypeById: { "4": WRAPPER_UUID },
        },
      ),
    );
    expect(io["4::widget::value_1"]!.label).toBe("我的种子");
  });
});

describe("enrichWorkflowIO — hostNodeId 透传", () => {
  it("子图内部条目的宿主 id 原样往返（GET 重建后仍能拼出运行期 id）", async () => {
    const result = await enrichWorkflowIO(
      makeParams(
        {
          "1670::widget::value": {
            direction: "input",
            kind: "widget",
            nodeId: "1670",
            name: "value",
            hostNodeId: "4",
          },
        },
        {
          innerInputsById: {
            "1670": [
              {
                name: "value",
                type: "INT",
                isConnection: false,
                widget: { name: "value" },
                widgetValue: 1,
              },
            ],
          },
        },
      ),
    );
    const entry = result["1670::widget::value"]!;
    expect(entry.hostNodeId).toBe("4");
    expect(entry.type).toBe("INT");
  });

  it("顶层条目没有宿主 id 时不凭空补一个", async () => {
    const result = await enrichWorkflowIO(
      makeParams({
        "5::widget::width": {
          direction: "input",
          kind: "widget",
          nodeId: "5",
          name: "width",
        },
      }),
    );
    expect(result["5::widget::width"]!.hostNodeId).toBeUndefined();
  });
});

describe("enrichWorkflowIO — slotLabel 下发（别名判定的第二判据）", () => {
  const WRAPPER_UUID = "e0940f57-80b2-480e-8a38-36968dc1763d";

  /* wrapper 槽位别名 value_1，作者把业务名写在本层 inputs[].label 上。
   * 通用翻译（localized_name）也在，且排在前 —— 显示名会停在翻译上，
   * 仅凭显示的 label 无从判断本层是否有作者命名，只有 slotLabel 能作证。 */
  const raw = {
    nodes: [
      {
        id: 9,
        type: WRAPPER_UUID,
        inputs: [
          {
            name: "value_1",
            label: "Seed",
            localized_name: "随机种",
            type: "INT",
            widget: { name: "value_1" },
            link: null,
          },
        ],
        outputs: [],
        properties: { proxyWidgetErrorQuarantine: [["1670", "value"]] },
        widgets_values: [],
      },
    ],
    links: [],
    definitions: { subgraphs: [] },
  } as unknown as RawWorkflow;

  it("本层作者名随富化条目下发（供「本地存的是不是机器名」判定）", async () => {
    const { rawInputsById } = await buildRawInputs(raw, async () => undefined);
    const io = await enrichWorkflowIO(
      makeParams(
        {
          "9::widget::value_1": {
            direction: "input",
            kind: "widget",
            nodeId: "9",
            name: "value_1",
          },
        },
        {
          rawInputsById,
          graph: { "9": { class_type: WRAPPER_UUID, inputs: {} } },
          nodeTypeById: { "9": WRAPPER_UUID },
        },
      ),
    );
    /* 显示名取到作者写在槽位上的 label（"Seed"）—— label 排在现代链的
     *  localized 之前。无论如何，作者名必须随条目下发成 slotLabel。 */
    expect(io["9::widget::value_1"]!.label).toBe("Seed");
    expect(io["9::widget::value_1"]!.slotLabel).toBe("Seed");
  });

  it("普通节点：没有另一个作者名就不塞无信息量的 slotLabel", async () => {
    const plain = {
      nodes: [
        {
          id: 24,
          type: "LoadImage",
          inputs: [
            {
              name: "image",
              localized_name: "图像",
              type: "COMBO",
              widget: { name: "image" },
              link: null,
            },
          ],
          widgets_values: ["a.png"],
          properties: {},
        },
      ],
      links: [],
      definitions: { subgraphs: [] },
    } as unknown as RawWorkflow;
    const { rawInputsById } = await buildRawInputs(
      plain,
      async () => undefined,
    );
    const io = await enrichWorkflowIO(
      makeParams(
        {
          "24::widget::image": {
            direction: "input",
            kind: "widget",
            nodeId: "24",
            name: "image",
          },
        },
        {
          rawInputsById,
          graph: { "24": { class_type: "LoadImage", inputs: {} } },
        },
      ),
    );
    expect(io["24::widget::image"]!.slotLabel).toBeUndefined();
  });
});

describe("enrichWorkflowIO — 键漂移兜底与别名判定事实源（ISSUE #349）", () => {
  /** 图一那条工作流的形状：wrapper 槽位 `value_1` → 内部 `PrimitiveInt.value`，
   *  富化名只能给到 `1`（内部字段名恰好是数字），作者名藏在 `slotLabel`。 */
  const wrapperRow = {
    name: "value_1",
    type: "INT",
    isConnection: false,
    widget: { name: "value_1" },
    widgetValue: 1,
    proxyField: { nodeId: "12", field: "1" },
  };
  const wrapperParams = (ioKey: string, name: string) =>
    makeParams(
      { [ioKey]: { direction: "input", kind: "widget", nodeId: "4", name } },
      {
        rawInputsById: { "4": [wrapperRow] },
        graph: { "4": { class_type: "uuid-wrapper", inputs: {} } },
      },
    );

  it("随条目下发富化名（enrichedLabel），供客户端做别名判定", async () => {
    const result = await enrichWorkflowIO(
      wrapperParams("4::widget::value_1", "value_1"),
    );
    expect(result["4::widget::value_1"]!.enrichedLabel).toBe("1");
    expect(result["4::widget::value_1"]!.label).toBe("1");
  });

  it("键漂移（name 存的是画布显示名）时仍能解析回真实槽位", async () => {
    /* 修复前某些路径把画布显示名写进了 `name`，存下来就是 `4::widget::Seed`;
     *  它不是 ComfyUI 槽位名，按名字回查必然落空 —— 类型退化成 `*`、显示名
     *  退化成那串脏值（用户截图里的「名字变成 1」）。 */
    const result = await enrichWorkflowIO(
      makeParams(
        {
          "4::widget::Seed": {
            direction: "input",
            kind: "widget",
            nodeId: "4",
            name: "Seed",
          },
        },
        {
          rawInputsById: {
            "4": [
              {
                ...wrapperRow,
                label: "Seed",
                proxyField: { nodeId: "12", field: "seed", label: "Seed" },
              },
            ],
          },
          graph: { "4": { class_type: "uuid-wrapper", inputs: {} } },
        },
      ),
    );
    const entry = result["4::widget::Seed"]!;
    expect(entry.type).toBe("INT");
    expect(entry.defaultValue).toBe(1);
    expect(entry.enrichedLabel).toBe("Seed");
  });

  it("多插槽节点上同样的脏名字不会被误认到别的行", async () => {
    /* KSampler 有 seed / steps / cfg…：脏名字 `1` 与 `value_1` 的行对不上，
     *  宁可这一条少一个名字，也不把别的槽位的 label 安到它头上。 */
    const result = await enrichWorkflowIO(
      makeParams(
        {
          "7::widget::1": {
            direction: "input",
            kind: "widget",
            nodeId: "7",
            name: "1",
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
                widgetValue: 1,
              },
              {
                name: "steps",
                type: "INT",
                isConnection: false,
                widget: { name: "steps" },
                widgetValue: 20,
              },
            ],
          },
        },
      ),
    );
    expect(result["7::widget::1"]!.label).toBe("1");
  });
});
