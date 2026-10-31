import { describe, it, expect } from "vitest";
import { enrichWorkflowIO } from "./workflow-detail-io";
import type { WorkflowIOEnrichParams } from "./workflow-detail-io";
import { buildRawInputs } from "./workflow-detail-raw";
import type { RawWorkflow } from "./raw";

/* 最小可用参数；各条用例按需覆盖自己关心的字段。 */
function makeParams(
  workflowIORaw: Record<string, unknown>,
  extra?: Partial<WorkflowIOEnrichParams>,
): WorkflowIOEnrichParams {
  return {
    comboOptionsForClassField: async () => undefined,
    comboOptionsForFieldName: async () => undefined,
    graph: {},
    multilineForClassField: async () => undefined,
    nodeTitleById: {},
    nodeTypeById: {},
    rawInputsById: {},
    rawNodeMeta: [],
    workflowIORaw:
      /* SAFETY: 类型断言已复核 */ workflowIORaw as unknown as WorkflowIOEnrichParams["workflowIORaw"],
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
            name: "seed",
            nodeId: "7",
          },
        },
        {
          rawInputsById: {
            "7": [
              {
                isConnection: false,
                name: "seed",
                type: "INT",
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
            name: "model",
            nodeId: "7",
          },
        },
        {
          rawInputsById: {
            "7": [
              {
                isConnection: false,
                name: "model",
                type: "MODEL",
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
            name: "steps",
            nodeId: "7",
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
          name: "image",
          nodeId: "7",
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
          name: "model",
          nodeId: "7",
        },
        "7::widget::seed": {
          direction: "input",
          kind: "widget",
          name: "seed",
          nodeId: "7",
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
      comboOptionsForClassField: async () => VALID,
      rawInputsById: {
        "94": [
          {
            isConnection: false,
            name: "aspect_ratio",
            type: "COMBO",
            widget: { name: "aspect_ratio" },
            widgetValue: "16:9 (Widescreen)",
          },
        ],
      },
    });
  }

  it("非法的模式默认值按宽高比数值纠正（16:9 → 16:9 (Widescreen)）", async () => {
    const result = await enrichWorkflowIO(
      comboParams({
        "94::widget::aspect_ratio": {
          direction: "input",
          kind: "widget",
          modeOverrides: { T2I: { defaultValue: "16:9" } },
          name: "aspect_ratio",
          nodeId: "94",
        },
      }),
    );
    const modes = /* SAFETY: 类型断言已复核 */ result["94::widget::aspect_ratio"]!
      .modeOverrides as Record<string, { defaultValue?: unknown }>;
    expect(modes.T2I!.defaultValue).toBe("16:9 (Widescreen)");
  });

  it("合法值原样透传，不产生改写", async () => {
    const result = await enrichWorkflowIO(
      comboParams({
        "94::widget::aspect_ratio": {
          direction: "input",
          kind: "widget",
          modeOverrides: { T2I: { defaultValue: "4:3 (Standard)" } },
          name: "aspect_ratio",
          nodeId: "94",
        },
      }),
    );
    const modes = /* SAFETY: 类型断言已复核 */ result["94::widget::aspect_ratio"]!
      .modeOverrides as Record<string, { defaultValue?: unknown }>;
    expect(modes.T2I!.defaultValue).toBe("4:3 (Standard)");
  });

  it("候选表匹配不上的模式默认值被摘掉，回退图内默认值", async () => {
    const result = await enrichWorkflowIO(
      comboParams({
        "94::widget::aspect_ratio": {
          direction: "input",
          kind: "widget",
          modeOverrides: { T2I: { defaultValue: "竖版高清" } },
          name: "aspect_ratio",
          nodeId: "94",
        },
      }),
    );
    const entry = result["94::widget::aspect_ratio"]!;
    /* 「竖版高清」解析不出宽高比、前缀也匹配不上任何候选 → 该模式的
     *  defaultValue 被摘掉；覆盖层里没有别的字段时整条不再下发。 */
    expect(entry.modeOverrides?.T2I).toBeUndefined();
  });

  it("候选表缺失（ComfyUI 离线）时不清洗，保留原值", async () => {
    const result = await enrichWorkflowIO(
      makeParams({
        "94::widget::aspect_ratio": {
          direction: "input",
          kind: "widget",
          modeOverrides: { T2I: { defaultValue: "16:9" } },
          name: "aspect_ratio",
          nodeId: "94",
        },
      }),
    );
    const modes = /* SAFETY: 类型断言已复核 */ result["94::widget::aspect_ratio"]!
      .modeOverrides as Record<string, { defaultValue?: unknown }>;
    expect(modes.T2I!.defaultValue).toBe("16:9");
  });

  it("喂给它的载荷只带 `modeOverrides` —— 历史 `modes` 键的归一不在这里", async () => {
    /* 历史列里那个 `modes` 键由 `parseWorkflowIOMap` 在**列边界**归一
     *（`workflow-detail.ts` 读 `tpl.workflowIO` 的那一步），本函数只认归一后的
     * 名字。这条用例钉住的是「不在这里再读一遍旧键」——两处各读一次的话，
     * 同一个 JSON 列就有两个入口，改一处永远漏一处。
     *
     * 归一本身由 `workflow-detail.test.ts` 从列那侧判（它喂的就是列里的原始值）。 */
    const result = await enrichWorkflowIO(
      comboParams({
        "94::widget::aspect_ratio": {
          direction: "input",
          kind: "widget",
          modes: { T2I: { defaultValue: "4:3 (Standard)" } },
          name: "aspect_ratio",
          nodeId: "94",
        },
      }),
    );
    const entry = result["94::widget::aspect_ratio"]!;
    /* 未归一的载荷在这里读不到覆盖层 —— 这正是「列边界那一步不能省」的证据。 */
    expect(entry.modeOverrides).toBeUndefined();
  });
});

describe("enrichWorkflowIO — 不投影图内语义角色（工坊契约口径）", () => {
  it("产物里没有任何 `role` 字段：正 / 负只由作者画布上的落点决定", async () => {
    /* 同一对 CLIPTextEncode 的 pin 名与显示名完全一样（都叫 text / 「文本」），
     * 名字分不出正负；而**本项目不给「哪一行是负向」做图内推导**：对外参数是
     * 工坊的契约，工作流只决定每一口落到哪一行（作者在库里连线）。 */
    const result = await enrichWorkflowIO(
      makeParams({
        "6::widget::text": {
          direction: "input",
          kind: "widget",
          name: "text",
          nodeId: "6",
        },
        "7::widget::text": {
          direction: "input",
          kind: "widget",
          name: "text",
          nodeId: "7",
        },
      }),
    );
    expect(Object.keys(result["6::widget::text"]!)).not.toContain("role");
    expect(Object.keys(result["7::widget::text"]!)).not.toContain("role");
  });

  it("节点类名只作展示用途，不派生任何「是不是文本编码节点」的标记", async () => {
    const result = await enrichWorkflowIO(
      makeParams(
        {
          "6::widget::text": {
            direction: "input",
            kind: "widget",
            name: "text",
            nodeId: "6",
          },
          "77::widget::value": {
            direction: "input",
            kind: "widget",
            name: "value",
            nodeId: "77",
          },
        },
        {
          nodeTypeById: { "6": "CLIPTextEncode", "77": "PromptEnhancer" },
        },
      ),
    );
    expect(Object.keys(result["6::widget::text"]!)).not.toContain("isTextNode");
    expect(Object.keys(result["77::widget::value"]!)).not.toContain("isTextNode");
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
          name: "value_1",
          nodeId: "1",
        },
      },
      {
        graph: { "1": { class_type: WRAPPER, inputs: {} } },
        nodeTitleById: { "1": "Sampler" },
        nodeTypeById: { "1": WRAPPER },
        rawInputsById: {
          "1": [
            {
              isConnection: false,
              name: "value_1",
              type: "INT",
              widget: { name: "value_1" },
              widgetValue: 12345,
              ...rawExtra,
            },
          ],
        },
      },
    );

  it("用内部真实字段的业务名，而不是本层别名 value_1", async () => {
    const result = await enrichWorkflowIO(
      wrapperParams({
        proxyField: { field: "seed", label: "随机种子", nodeId: "12" },
      }),
    );
    expect(result["1::widget::value_1"]!.label).toBe("随机种子");
    expect(result["1::widget::value_1"]!.type).toBe("INT");
    expect(result["1::widget::value_1"]!.defaultValue).toBe(12345);
  });

  it("内部字段没有 label 时退到 localized，再退到字段名（不是别名）", async () => {
    const byLocalized = await enrichWorkflowIO(
      wrapperParams({
        proxyField: { field: "seed", localized: "种子", nodeId: "12" },
      }),
    );
    expect(byLocalized["1::widget::value_1"]!.label).toBe("种子");

    const byField = await enrichWorkflowIO(
      wrapperParams({ proxyField: { field: "seed", nodeId: "12" } }),
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
            label: "我的种子",
            name: "value_1",
            nodeId: "1",
          },
        },
        {
          rawInputsById: {
            "1": [
              {
                isConnection: false,
                name: "value_1",
                proxyField: { field: "seed", label: "随机种子", nodeId: "12" },
                type: "INT",
                widget: { name: "value_1" },
                widgetValue: 1,
              },
            ],
          },
        },
      ),
    );
    expect(result["1::widget::value_1"]!.label).toBe("我的种子");
  });

  it("存库的 label 按作者命名直读（不再有「像机器名就让位」）", async () => {
    /* `label` 的唯一写入点是面板改名框 —— 勾选不再抄画布显示名进库，因此库
     *  里这串就是作者的显式命名，直读；作者在面板里清空改名即回到富化名
     *  （下一条测的就是清空后的回退）。 */
    const result = await enrichWorkflowIO(
      makeParams(
        {
          "1::widget::value_1": {
            direction: "input",
            kind: "widget",
            label: "value_1",
            name: "value_1",
            nodeId: "1",
          },
        },
        {
          rawInputsById: {
            "1": [
              {
                isConnection: false,
                name: "value_1",
                proxyField: { field: "seed", label: "随机种子", nodeId: "12" },
                type: "INT",
                widget: { name: "value_1" },
                widgetValue: 1,
              },
            ],
          },
        },
      ),
    );
    expect(result["1::widget::value_1"]!.label).toBe("value_1");
  });

  it("普通节点上 label 与 pin 名相同仍原样保留（不误判为存量别名）", async () => {
    const result = await enrichWorkflowIO(
      makeParams(
        {
          "7::widget::seed": {
            direction: "input",
            kind: "widget",
            label: "seed",
            name: "seed",
            nodeId: "7",
          },
        },
        {
          rawInputsById: {
            "7": [
              {
                isConnection: false,
                localized: "随机种",
                name: "seed",
                type: "INT",
                widget: { name: "seed" },
                widgetValue: 42,
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
            name: "seed",
            nodeId: "1",
          },
        },
        {
          graph: { "1": { class_type: WRAPPER, inputs: {} } },
          rawInputsById: {
            "1": [
              {
                isConnection: false,
                name: "value_1",
                proxyField: { field: "seed", label: "随机种子", nodeId: "12" },
                type: "INT",
                widget: { name: "value_1" },
                widgetValue: 7,
              },
            ],
          },
        },
      ),
    );
    expect(result["1::widget::seed"]!.label).toBe("随机种子");
    expect(result["1::widget::seed"]!.defaultValue).toBe(7);
  });

  it("proxyWidgets 缺失（被导出隔离）时，类型 / 默认值照旧解析、label 直读", async () => {
    /* 真实工作流形状：`properties.proxyWidgets` 因导出缺失被 ComfyUI 隔离
     *  （`proxyWidgetErrorQuarantine`），proxyField 无从解析，但 wrapper 本层
     *  inputs[] 仍带作者写的 label（"Seed"），槽位名是别名 value_1。
     *  库里带着 label 时直读（作者命名 / 面板改名），本层作者名照旧下发成
     *  `slotLabel` 供消费方取用。 */
    const result = await enrichWorkflowIO(
      makeParams(
        {
          "9::widget::value_1": {
            direction: "input",
            kind: "widget",
            label: "value_1",
            name: "value_1",
            nodeId: "9",
          },
        },
        {
          graph: { "9": { class_type: WRAPPER, inputs: {} } },
          nodeTypeById: { "9": WRAPPER },
          rawInputsById: {
            "9": [
              {
                isConnection: false,
                label: "Seed",
                name: "value_1",
                type: "INT",
                widget: { name: "value_1" },
                widgetValue: 42,
              },
            ],
          },
        },
      ),
    );
    expect(result["9::widget::value_1"]!.label).toBe("value_1");
    expect(result["9::widget::value_1"]!.type).toBe("INT");
    expect(result["9::widget::value_1"]!.defaultValue).toBe(42);
    expect(result["9::widget::value_1"]!.slotLabel).toBe("Seed");
  });

  it("proxyWidgets 缺失时，作者手写的非别名 label 不受影响", async () => {
    const result = await enrichWorkflowIO(
      makeParams(
        {
          "9::widget::value_1": {
            direction: "input",
            kind: "widget",
            label: "我的种子",
            name: "value_1",
            nodeId: "9",
          },
        },
        {
          graph: { "9": { class_type: WRAPPER, inputs: {} } },
          nodeTypeById: { "9": WRAPPER },
          rawInputsById: {
            "9": [
              {
                isConnection: false,
                label: "Seed",
                name: "value_1",
                type: "INT",
                widget: { name: "value_1" },
                widgetValue: 42,
              },
            ],
          },
        },
      ),
    );
    expect(result["9::widget::value_1"]!.label).toBe("我的种子");
  });

  it("普通节点：作者手写的名字与 pin 名逐字相同时原样保留", async () => {
    /* 库里存的就是作者命名，写什么存什么 —— 作者把参数改名成与 pin 名逐字
     *  相同也照样生效（没有「像机器名所以不让存」的判定）。 */
    const result = await enrichWorkflowIO(
      makeParams(
        {
          "7::widget::seed": {
            direction: "input",
            kind: "widget",
            label: "seed",
            name: "seed",
            nodeId: "7",
          },
        },
        {
          graph: { "7": { class_type: "KSampler", inputs: {} } },
          nodeTypeById: { "7": "KSampler" },
          rawInputsById: {
            "7": [
              {
                isConnection: false,
                label: "seed",
                name: "seed",
                type: "INT",
                widget: { name: "seed" },
                widgetValue: 42,
              },
            ],
          },
        },
      ),
    );
    expect(result["7::widget::seed"]!.label).toBe("seed");
  });

  it("普通节点：存库 label 直读；清掉改名后回到 raw 的作者 label", async () => {
    /* LoadImage 的 image 槽：raw 里作者写的 label 是 "Last Frame Image"。
     *  `label` 只表示作者在面板里的改名 —— 有值就直读（哪怕它等于 pin 名），
     *  清空（label: undefined）就回到 raw 的作者 label。 */
    const params = (label?: string) =>
      makeParams(
        {
          "24::widget::image": {
            direction: "input",
            kind: "widget",
            name: "image",
            nodeId: "24",
            ...(label !== undefined ? { label } : {}),
          },
        },
        {
          graph: { "24": { class_type: "LoadImage", inputs: {} } },
          nodeTypeById: { "24": "LoadImage" },
          rawInputsById: {
            "24": [
              {
                isConnection: false,
                label: "Last Frame Image",
                localized: "图像",
                name: "image",
                type: "COMBO",
                widget: { name: "image" },
                widgetValue: "last.png",
              },
            ],
          },
        },
      );
    const read = async (label?: string) =>
      (await enrichWorkflowIO(params(label)))["24::widget::image"]!.label;
    expect(await read("image")).toBe("image");
    expect(await read()).toBe("Last Frame Image");
  });

  it("普通节点：作者手写的其它名字不受影响（不误伤）", async () => {
    const result = await enrichWorkflowIO(
      makeParams(
        {
          "24::widget::image": {
            direction: "input",
            kind: "widget",
            label: "尾帧图",
            name: "image",
            nodeId: "24",
          },
        },
        {
          graph: { "24": { class_type: "LoadImage", inputs: {} } },
          nodeTypeById: { "24": "LoadImage" },
          rawInputsById: {
            "24": [
              {
                isConnection: false,
                label: "Last Frame Image",
                name: "image",
                type: "COMBO",
                widget: { name: "image" },
                widgetValue: "last.png",
              },
            ],
          },
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
            name: "value",
            nodeId: "1670",
          },
        },
        {
          graph: {},
          innerInputsById: {
            "1670": [
              {
                isConnection: false,
                label: "Seed",
                name: "value",
                type: "INT",
                widget: { name: "value" },
                widgetValue: 1234,
              },
            ],
          },
          nodeTypeById: {},
          rawInputsById: {},
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
            name: "value",
            nodeId: "1670",
          },
        },
        {
          graph: {},
          innerInputsById: {
            "1670": [
              {
                isConnection: false,
                label: "内层名",
                name: "value",
                type: "INT",
                widget: { name: "value" },
              },
            ],
          },
          nodeTypeById: {},
          rawInputsById: {
            "1670": [
              {
                isConnection: false,
                label: "顶层名",
                name: "value",
                type: "FLOAT",
                widget: { name: "value" },
              },
            ],
          },
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
   *  （"Seed" / "Seconds"）。
   *  这条链路要保证 buildRawInputs → enrichWorkflowIO 仍解析得出类型，且库里
   *  没改名时取到本层作者 label（"Seed"）。 */
  const WRAPPER_UUID = "e0940f57-80b2-480e-8a38-36968dc1763d";

  it("buildRawInputs + enrichWorkflowIO：label 直读，清掉改名后取到作者 label", async () => {
    const raw = /* SAFETY: 类型断言已复核 */ {
      definitions: { subgraphs: [] },
      links: [],
      nodes: [
        {
          id: 1512,
          inputs: [
            {
              label: "image_first_frame",
              link: 4418,
              name: "image",
              type: "IMAGE",
            },
            {
              label: "WAN22: True = Safetensors",
              link: null,
              name: "enabled",
              type: "BOOLEAN",
              widget: { name: "enabled" },
            },
            {
              label: "Seed",
              link: null,
              name: "value_1",
              type: "INT",
              widget: { name: "value_1" },
            },
            {
              label: "Seconds",
              link: null,
              name: "value_2",
              type: "INT",
              widget: { name: "value_2" },
            },
          ],
          outputs: [],
          properties: { cnr_id: "comfy-core", ver: "0.14.1" },
          type: WRAPPER_UUID,
          widgets_values: [],
        },
      ],
    } as unknown as RawWorkflow;

    const { rawInputsById } = await buildRawInputs(
      raw,
      async () => undefined,
      async () => undefined,
    );
    const read = async (label?: string) =>
      (
        await enrichWorkflowIO(
          makeParams(
            {
              "1512::widget::value_1": {
                direction: "input",
                kind: "widget",
                name: "value_1",
                nodeId: "1512",
                ...(label !== undefined ? { label } : {}),
              },
            },
            {
              graph: { "1512": { class_type: WRAPPER_UUID, inputs: {} } },
              nodeTypeById: { "1512": WRAPPER_UUID },
              rawInputsById,
            },
          ),
        )
      )["1512::widget::value_1"]!;
    /* 库里存着 label（旧版勾选抄下来的别名）时直读 —— 不再有让位判定。 */
    const poisoned = await read("value_1");
    expect(poisoned.label).toBe("value_1");
    expect(poisoned.type).toBe("INT");
    /* 作者在面板里清掉改名后，显示名回到本层 raw 的作者 label。 */
    const named = await read();
    expect(named.label).toBe("Seed");
    expect(named.slotLabel).toBe("Seed");
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

  const raw = /* SAFETY: 类型断言已复核 */ {
    definitions: {
      subgraphs: [
        {
          id: WRAPPER_UUID,
          inputs: [{ label: "Seed", name: "value_1", type: "INT" }],
          name: "I2V",
          nodes: [],
        },
      ],
    },
    links: [],
    nodes: [
      {
        id: 4,
        inputs: [
          {
            link: null,
            name: "value_1",
            type: "INT",
            widget: { name: "value_1" },
          },
        ],
        outputs: [],
        properties: { proxyWidgetErrorQuarantine: [["1670", "value"]] },
        type: WRAPPER_UUID,
        widgets_values: [],
      },
    ],
  } as unknown as RawWorkflow;

  it("类型 / 类名随条目下发；label 直读、本层作者名作为事实下发", async () => {
    const { rawInputsById } = await buildRawInputs(
      raw,
      async () => undefined,
      async () => undefined,
    );
    const io = await enrichWorkflowIO(
      makeParams(
        {
          "4::widget::value_1": {
            direction: "input",
            kind: "widget",
            label: "value_1",
            name: "value_1",
            nodeId: "4",
          },
        },
        {
          graph: { "4": { class_type: WRAPPER_UUID, inputs: {} } },
          nodeTypeById: { "4": WRAPPER_UUID },
          rawInputsById,
        },
      ),
    );
    const entry = io["4::widget::value_1"]!;
    /* 库里带着 label 就直读（作者命名 / 面板改名），不再有让位判定。 */
    expect(entry.label).toBe("value_1");
    /* 本层作者名作为**事实**随条目下发（消费方要按作者名取名时有它）。 */
    expect(entry.slotLabel).toBe("Seed");
    expect(entry.type).toBe("INT");
  });

  it("作者写在本层的名字优先于子图边界 pin", async () => {
    const own = /* SAFETY: 类型断言已复核 */ JSON.parse(
      JSON.stringify(raw),
    ) as unknown as RawWorkflow;
    own.nodes[0]!.inputs![0]!.label = "我的种子";
    const { rawInputsById } = await buildRawInputs(
      own,
      async () => undefined,
      async () => undefined,
    );
    const io = await enrichWorkflowIO(
      makeParams(
        {
          "4::widget::value_1": {
            direction: "input",
            kind: "widget",
            name: "value_1",
            nodeId: "4",
          },
        },
        {
          graph: { "4": { class_type: WRAPPER_UUID, inputs: {} } },
          nodeTypeById: { "4": WRAPPER_UUID },
          rawInputsById,
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
            hostNodeId: "4",
            kind: "widget",
            name: "value",
            nodeId: "1670",
          },
        },
        {
          innerInputsById: {
            "1670": [
              {
                isConnection: false,
                name: "value",
                type: "INT",
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
          name: "width",
          nodeId: "5",
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
  const raw = /* SAFETY: 类型断言已复核 */ {
    definitions: { subgraphs: [] },
    links: [],
    nodes: [
      {
        id: 9,
        inputs: [
          {
            label: "Seed",
            link: null,
            localized_name: "随机种",
            name: "value_1",
            type: "INT",
            widget: { name: "value_1" },
          },
        ],
        outputs: [],
        properties: { proxyWidgetErrorQuarantine: [["1670", "value"]] },
        type: WRAPPER_UUID,
        widgets_values: [],
      },
    ],
  } as unknown as RawWorkflow;

  it("本层作者名随富化条目下发（供「本地存的是不是机器名」判定）", async () => {
    const { rawInputsById } = await buildRawInputs(
      raw,
      async () => undefined,
      async () => undefined,
    );
    const io = await enrichWorkflowIO(
      makeParams(
        {
          "9::widget::value_1": {
            direction: "input",
            kind: "widget",
            name: "value_1",
            nodeId: "9",
          },
        },
        {
          graph: { "9": { class_type: WRAPPER_UUID, inputs: {} } },
          nodeTypeById: { "9": WRAPPER_UUID },
          rawInputsById,
        },
      ),
    );
    /* 显示名取到作者写在槽位上的 label（"Seed"）—— label 排在现代链的
     *  localized 之前。无论如何，作者名必须随条目下发成 slotLabel。 */
    expect(io["9::widget::value_1"]!.label).toBe("Seed");
    expect(io["9::widget::value_1"]!.slotLabel).toBe("Seed");
  });

  it("普通节点：没有另一个作者名就不塞无信息量的 slotLabel", async () => {
    const plain = /* SAFETY: 类型断言已复核 */ {
      definitions: { subgraphs: [] },
      links: [],
      nodes: [
        {
          id: 24,
          inputs: [
            {
              link: null,
              localized_name: "图像",
              name: "image",
              type: "COMBO",
              widget: { name: "image" },
            },
          ],
          properties: {},
          type: "LoadImage",
          widgets_values: ["a.png"],
        },
      ],
    } as unknown as RawWorkflow;
    const { rawInputsById } = await buildRawInputs(
      plain,
      async () => undefined,
      async () => undefined,
    );
    const io = await enrichWorkflowIO(
      makeParams(
        {
          "24::widget::image": {
            direction: "input",
            kind: "widget",
            name: "image",
            nodeId: "24",
          },
        },
        {
          graph: { "24": { class_type: "LoadImage", inputs: {} } },
          rawInputsById,
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
    isConnection: false,
    name: "value_1",
    proxyField: { field: "1", nodeId: "12" },
    type: "INT",
    widget: { name: "value_1" },
    widgetValue: 1,
  };
  const wrapperParams = (ioKey: string, name: string) =>
    makeParams(
      { [ioKey]: { direction: "input", kind: "widget", name, nodeId: "4" } },
      {
        graph: { "4": { class_type: "uuid-wrapper", inputs: {} } },
        rawInputsById: { "4": [wrapperRow] },
      },
    );

  it("没改过名时显示名由富化链给出（内部字段名）", async () => {
    const result = await enrichWorkflowIO(wrapperParams("4::widget::value_1", "value_1"));
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
            name: "Seed",
            nodeId: "4",
          },
        },
        {
          graph: { "4": { class_type: "uuid-wrapper", inputs: {} } },
          rawInputsById: {
            "4": [
              {
                ...wrapperRow,
                label: "Seed",
                proxyField: { field: "seed", label: "Seed", nodeId: "12" },
              },
            ],
          },
        },
      ),
    );
    const entry = result["4::widget::Seed"]!;
    expect(entry.type).toBe("INT");
    expect(entry.defaultValue).toBe(1);
    expect(entry.label).toBe("Seed");
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
            name: "1",
            nodeId: "7",
          },
        },
        {
          rawInputsById: {
            "7": [
              {
                isConnection: false,
                name: "seed",
                type: "INT",
                widget: { name: "seed" },
                widgetValue: 1,
              },
              {
                isConnection: false,
                name: "steps",
                type: "INT",
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

describe("enrichWorkflowIO — 存档 type/defaultValue/options 作兜底基线（fix 4）", () => {
  it("rawJson/graph 都取不到时沿用存档 type，不退化成 *", async () => {
    const result = await enrichWorkflowIO(
      makeParams({
        "7::widget::scale": {
          defaultValue: 1.2,
          direction: "input",
          kind: "widget",
          name: "scale",
          nodeId: "7",
          type: "FLOAT",
        },
      }),
      // rawInputsById / graph / options 都故意留空：模拟「富化查不到该节点」
    );
    const e = result["7::widget::scale"]!;
    expect(e.type).toBe("FLOAT");
    expect(e.defaultValue).toBe(1.2);
  });

  it("object_info 不可达时复用存档 options，COMBO 不退化成 text", async () => {
    const result = await enrichWorkflowIO(
      makeParams({
        "7::widget::sampler": {
          direction: "input",
          kind: "widget",
          name: "sampler",
          nodeId: "7",
          options: ["euler", "dpmpp_2m"],
          type: "COMBO",
        },
      }),
    );
    const e = result["7::widget::sampler"]!;
    expect(e.type).toBe("COMBO");
    expect(e.options).toEqual(["euler", "dpmpp_2m"]);
  });

  it("rawJson 能解析出来时以解析结果为准，覆盖存档旧值", async () => {
    const result = await enrichWorkflowIO(
      makeParams(
        {
          "7::widget::seed": {
            defaultValue: "old",
            direction: "input",
            kind: "widget",
            name: "seed",
            nodeId: "7",
            type: "STRING", // 存档旧值（已过期）
          },
        },
        {
          rawInputsById: {
            "7": [
              {
                isConnection: false,
                name: "seed",
                type: "INT",
                widget: { name: "seed" },
                widgetValue: 42,
              },
            ],
          },
        },
      ),
    );
    const e = result["7::widget::seed"]!;
    expect(e.type).toBe("INT"); // 解析覆盖存档
    expect(e.defaultValue).toBe(42);
  });
});
