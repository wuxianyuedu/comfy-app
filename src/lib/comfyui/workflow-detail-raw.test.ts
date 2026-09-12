import { describe, expect, it } from "vitest";

import { buildRawInputs, buildInnerNodeInputs } from "@/lib/comfyui/workflow-detail-raw";
import type { RawWorkflow } from "@/lib/comfyui/raw";

const WRAPPER = "aaaaaaaa-1111-2222-3333-444444444444";

/** ComfyUI 导出的子工作流封装节点：wrapper 本层槽位名是自动编号的别名
 *  （`value_1`），业务语义在内部节点上，靠 `properties.proxyWidgets`
 *  （[内部节点 id, 内部字段名]）关联。 */
const wrapperWorkflow = {
  last_node_id: 12,
  nodes: [
    {
      id: 1,
      type: WRAPPER,
      pos: [0, 0],
      size: [300, 200],
      properties: { proxyWidgets: [["12", "seed"], ["12", "steps"]] },
      widgets_values: [],
      inputs: [
        { name: "value_1", type: "INT", link: null, widget: { name: "value_1" }, idx: 0 },
        { name: "value_2", type: "INT", link: null, widget: { name: "value_2" }, idx: 1 },
      ],
      outputs: [{ name: "LATENT", type: "LATENT", links: [] }],
    },
  ],
  links: [],
  definitions: {
    subgraphs: [
      {
        id: WRAPPER,
        name: "Sampler",
        nodes: [
          {
            id: 12,
            type: "KSampler",
            inputs: [
              { name: "model", type: "MODEL" },
              { name: "seed", type: "INT", widget: { name: "seed" }, label: "随机种子" },
              { name: "steps", type: "INT", widget: { name: "steps" }, localized_name: "步数" },
            ],
            widgets_values: [12345, "fixed", 20],
            outputs: [{ name: "LATENT", type: "LATENT", links: [] }],
          },
        ],
        links: [],
        inputs: [
          { id: "pin-a", name: "value_1", type: "INT", pos: [0, 0], linkIds: [] },
          { id: "pin-b", name: "value_2", type: "INT", pos: [0, 50], linkIds: [] },
        ],
        outputs: [],
      },
    ],
  },
} as unknown as RawWorkflow;

async function noCombo(): Promise<undefined> {
  return undefined;
}

describe("buildRawInputs — 子工作流封装节点的 proxyField 暂存", () => {
  it("按 proxyWidgets 记下内部真实字段（label / localized 一并带上）", async () => {
    const { rawInputsById } = await buildRawInputs(wrapperWorkflow, noCombo);
    const entries = rawInputsById["1"]!;
    expect(entries).toHaveLength(2);
    expect(entries[0]!.name).toBe("value_1");
    expect(entries[0]!.proxyField).toEqual({
      nodeId: "12",
      field: "seed",
      label: "随机种子",
    });
    expect(entries[1]!.name).toBe("value_2");
    expect(entries[1]!.proxyField).toEqual({
      nodeId: "12",
      field: "steps",
      localized: "步数",
    });
    /* 暴露口的值仍是内部节点的真实控件值（proxyWidgets 配对没被破坏）。 */
    expect(entries[0]!.widgetValue).toBe(12345);
    expect(entries[1]!.widgetValue).toBe(20);
  });

  it("普通（非封装）节点不带 proxyField", async () => {
    const plain = {
      last_node_id: 1,
      nodes: [
        {
          id: 7,
          type: "KSampler",
          pos: [0, 0],
          inputs: [{ name: "seed", type: "INT", link: null, widget: { name: "seed" } }],
          widgets_values: [42],
        },
      ],
      links: [],
    } as unknown as RawWorkflow;
    const { rawInputsById } = await buildRawInputs(plain, noCombo);
    expect(rawInputsById["7"]![0]!.proxyField).toBeUndefined();
  });

  it("proxyWidgets 指向的内部节点缺失时仍记下字段名（比别名有信息量）", async () => {
    const broken = JSON.parse(JSON.stringify(wrapperWorkflow)) as unknown as RawWorkflow;
    const subs = broken.definitions!.subgraphs!;
    const key = Object.keys(subs)[0]!;
    subs[key]!.nodes = [];
    const { rawInputsById } = await buildRawInputs(broken, noCombo);
    expect(rawInputsById["1"]![0]!.proxyField).toEqual({ nodeId: "12", field: "seed" });
  });
});

describe("buildInnerNodeInputs — 子图内部节点输入索引", () => {
  it("按内部节点 id 索引出 name / label / localized / type 与控件值", () => {
    const inner = buildInnerNodeInputs(wrapperWorkflow);
    const seed = inner["12"]!.find((input) => input.name === "seed");
    expect(seed).toBeDefined();
    expect(seed!.label).toBe("随机种子");
    expect(seed!.type).toBe("INT");
    /* widgets_values[0] 属于 seed；seed 家族多占一个
     *  control_after_generate 槽，故 steps 取到下标 2。 */
    expect(seed!.widgetValue).toBe(12345);
    expect(inner["12"]!.find((input) => input.name === "steps")!.widgetValue).toBe(20);
  });

  it("没有子图定义时返回空表", () => {
    expect(buildInnerNodeInputs({ nodes: [] })).toEqual({});
    expect(buildInnerNodeInputs(null)).toEqual({});
  });

  it("纯连线端口不入控件槽计数", () => {
    const inner = buildInnerNodeInputs(wrapperWorkflow);
    const model = inner["12"]!.find((input) => input.name === "model");
    expect(model).toBeDefined();
    expect(model!.isConnection).toBe(false);
    expect(model!.widget).toBeUndefined();
    expect(model!.widgetValue).toBeUndefined();
  });
});

describe("buildRawInputs — proxyWidgets 的键形态与配对（ISSUE #349）", () => {
  /** 把 wrapper 的 proxyWidgets 换成任意形态，其余保持真实导出形状。 */
  function withProxy(props: Record<string, unknown>): RawWorkflow {
    const clone = structuredClone(wrapperWorkflow) as unknown as {
      nodes: { properties: Record<string, unknown> }[];
    };
    clone.nodes[0]!.properties = props;
    return clone as unknown as RawWorkflow;
  }

  it("对象形态 proxyWidgets（键即槽位名）也能解析出内部字段", async () => {
    const { rawInputsById } = await buildRawInputs(
      withProxy({ proxyWidgets: { value_1: ["12", "seed"], value_2: ["12", "steps"] } }),
      noCombo
    );
    const entries = rawInputsById["1"]!;
    expect(entries[0]!.proxyField?.field).toBe("seed");
    expect(entries[1]!.proxyField?.field).toBe("steps");
  });

  it("槽位名偏离位置序时按名字匹配，不按位置硬塞", async () => {
    /* 私有导出里槽位名不叫 value_N：位置序会把 seed 安到 value_9 上；按名匹配
     *  才能把 value_1 对回它自己的目标（ISSUE #349：value_1 一直是 PrimitiveInt
     *  的 `value`，不是 KSampler 的 seed）。 */
    const { rawInputsById } = await buildRawInputs(
      withProxy({ proxyWidgets: { value_2: ["12", "steps"], value_1: ["12", "seed"] } }),
      noCombo
    );
    const entries = rawInputsById["1"]!;
    expect(entries[0]!.name).toBe("value_1");
    expect(entries[0]!.proxyField?.field).toBe("seed");
    expect(entries[1]!.name).toBe("value_2");
    expect(entries[1]!.proxyField?.field).toBe("steps");
  });

  it("位置序目标撞车时宁可留空，也不把别的槽位的字段名安上", async () => {
    /* 只有一条映射却有两个 widget 槽位：位置 0 命中，位置 1 必须留空 ——
     *  否则第二个槽位会顶着第一个槽位的字段名，显示名彻底错位。 */
    const { rawInputsById } = await buildRawInputs(
      withProxy({ proxyWidgets: [["12", "seed"]] }),
      noCombo
    );
    const entries = rawInputsById["1"]!;
    expect(entries[0]!.proxyField?.field).toBe("seed");
    expect(entries[1]!.proxyField).toBeUndefined();
  });

  it("畸形条目（长度不足 / 键对不上任何槽位）被安全忽略", async () => {
    const { rawInputsById } = await buildRawInputs(
      withProxy({ proxyWidgets: [["12"], ["12", "steps"], ["12", "seed"]].slice(0, 2) }),
      noCombo
    );
    const entries = rawInputsById["1"]!;
    expect(entries[0]!.proxyField?.field).toBe("steps");
    expect(entries[1]!.proxyField).toBeUndefined();
  });

  it("没有 proxyWidgets（被隔离）时行为与旧版一致：只留别名，不猜字段", async () => {
    const { rawInputsById } = await buildRawInputs(
      withProxy({ proxyWidgetErrorQuarantine: [["12", "seed"]] }),
      noCombo
    );
    const entries = rawInputsById["1"]!;
    expect(entries[0]!.proxyField).toBeUndefined();
    expect(entries[0]!.name).toBe("value_1");
  });
});
