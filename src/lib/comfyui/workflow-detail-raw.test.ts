import { describe, expect, it } from "vitest";

import { buildRawInputs } from "@/lib/comfyui/workflow-detail-raw";
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
