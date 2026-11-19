// 工作流更新时 IO 连线保持 / 断线报告的契约（#4377）：
//  1) 新图里仍存在的端口：连线与逐口编辑原样保留；
//  2) 新图里消失的端口：连线摘除并逐条上报（source / output）；
//  3) 作者显式断开（null）保持原样；子图内部口（旧图顶层没有的节点）不误报；
//  4) 其余历史键空间原样透传 —— 装载绑定只含预设 id、不含图连线（#4547 起
//     追加端口已移除），整列不参与断线摘除，存量旧键原样保留。
import { describe, expect, it } from "vitest";

import { isRecord } from "~/lib/is-record";

import { collectRawPorts, remapForUpdate } from "./workflow-update-remap";

/** unknown → 宽松对象（测试断言的收窄助手，isRecord 守卫不触发棘轮）。 */
const asRecord = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {});

/** 旧图：节点 1（KSampler，含 widget 化的 seed 入口）、节点 4（子图 wrapper）、
 *  节点 9（新版里被删掉的节点）。 */
const OLD_RAW = {
  nodes: [
    {
      id: 1,
      type: "KSampler",
      inputs: [
        { name: "model", type: "MODEL", link: 1 },
        { name: "seed", type: "INT", widget: { name: "seed" }, link: null },
      ],
      outputs: [{ name: "LATENT", type: "LATENT", links: [2] }],
    },
    { id: 4, type: "ec8d4e1c-3", inputs: [], outputs: [] },
    {
      id: 9,
      type: "SaveImage",
      inputs: [{ name: "images", type: "IMAGE", link: 3 }],
      outputs: [],
    },
  ],
  links: [[1, 2, 0, 1, 0, "MODEL"]],
};

/** 新图：节点 1 还在但 model 入口没了（断），seed 仍在；节点 4 仍在。 */
const NEW_RAW = {
  nodes: [
    {
      id: 1,
      type: "KSampler",
      inputs: [{ name: "seed", type: "INT", widget: { name: "seed" }, link: null }],
      outputs: [{ name: "LATENT", type: "LATENT", links: null }],
    },
    { id: 4, type: "ec8d4e1c-3", inputs: [], outputs: [] },
  ],
  links: [],
};

describe("collectRawPorts", () => {
  it("收集顶层节点的连线口 / 部件口 / 输出口", () => {
    const ports = collectRawPorts(OLD_RAW);
    expect(ports.has("1::param::model")).toBe(true);
    expect(ports.has("1::widget::seed")).toBe(true);
    expect(ports.has("1::output::LATENT")).toBe(true);
    expect(ports.has("4::param::x")).toBe(false);
  });

  it("非对象输入 → 空集合", () => {
    expect(collectRawPorts(null).size).toBe(0);
    expect(collectRawPorts("x").size).toBe(0);
  });
});

describe("remapForUpdate", () => {
  const PARAM_MAP = {
    source: {
      "mode:T2I": {
        prompt: "1::param::model",
        seed: "1::widget::seed",
        negative: null,
      },
    },
    output: {
      "mode:T2I": { images: "1::output::LATENT" },
    },
    referenceLoaders: {
      "mode:T2I": {
        "reference-image": { presetId: "p1", extraTargets: ["1::param::model", "1::widget::seed"] },
      },
    },
  };
  const WORKFLOW_IO = {
    "1::param::model": { nodeId: "1", name: "model", kind: "param", direction: "input" },
    "1::widget::seed": { nodeId: "1", name: "seed", kind: "widget", direction: "input" },
    "9::widget::gone": { nodeId: "9", name: "gone", kind: "widget", direction: "input" },
  };

  it("存活端口原样保留；消失端口摘除并逐条上报", () => {
    const res = remapForUpdate({
      paramMap: PARAM_MAP,
      workflowIO: WORKFLOW_IO,
      oldRawJson: OLD_RAW,
      newRawJson: NEW_RAW,
    });
    /* 存活的 seed 线保留；断掉的 model 线摘除并上报（source）。 */
    const source = asRecord(asRecord(res.paramMap).source);
    const t2i = asRecord(source["mode:T2I"]);
    expect(t2i.seed).toBe("1::widget::seed");
    expect(t2i.negative).toBeNull();
    expect("prompt" in t2i).toBe(false);
    expect(res.broken).toEqual([
      { namespace: "mode:T2I", entryId: "prompt", ioKey: "1::param::model" },
    ]);
    /* 装载绑定不含图连线（#4547 起追加端口已移除）：整列原样透传，
     * 存量 extraTargets 旧键保留（读取端按「没配」忽略）。 */
    expect(asRecord(res.paramMap).referenceLoaders).toEqual(PARAM_MAP.referenceLoaders);
    /* workflowIO：存活保留，消失的摘掉并计数。 */
    expect(Object.keys(asRecord(res.workflowIO))).toEqual(["1::widget::seed"]);
    expect(res.droppedIOKeys).toEqual(["1::param::model", "9::widget::gone"]);
  });

  it("输出取值行同样保持 / 摘除", () => {
    const paramMap = {
      ...PARAM_MAP,
      output: {
        "mode:T2I": {
          latent: "1::output::LATENT",
          images: "1::output::VAE",
        },
      },
    };
    const res = remapForUpdate({
      paramMap,
      workflowIO: {},
      oldRawJson: OLD_RAW,
      newRawJson: NEW_RAW,
    });
    const output = asRecord(asRecord(res.paramMap).output);
    /* 存活的输出取值行保留；指向不存在端口的行摘除并上报
     * （source 里那条 prompt 断线由上一用例覆盖）。 */
    const outTable = asRecord(output["mode:T2I"]);
    expect(outTable.latent).toBe("1::output::LATENT");
    expect("images" in outTable).toBe(false);
    expect(res.broken).toContainEqual({
      namespace: "mode:T2I",
      entryId: "images",
      ioKey: "1::output::VAE",
    });
  });

  it("子图内部口（旧图顶层没有的节点 id）不误报、原样保留", () => {
    const paramMap = {
      source: { "mode:T2I": { inner: "4:1::param::x" } },
    };
    const res = remapForUpdate({
      paramMap,
      workflowIO: {},
      oldRawJson: OLD_RAW,
      newRawJson: NEW_RAW,
    });
    expect(res.broken).toEqual([]);
    expect(asRecord(res.paramMap).source).toEqual(paramMap.source);
  });

  it("paramMap 其余历史键原样透传", () => {
    const paramMap = { ...PARAM_MAP, positiveNode: "1", legacy: 3 };
    const res = remapForUpdate({
      paramMap,
      workflowIO: {},
      oldRawJson: OLD_RAW,
      newRawJson: NEW_RAW,
    });
    expect(asRecord(res.paramMap).positiveNode).toBe("1");
    expect(asRecord(res.paramMap).legacy).toBe(3);
  });
});
