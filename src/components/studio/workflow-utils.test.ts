import { describe, it, expect } from "vitest";
import {
  buildEdges,
  extractNoteTitle,
  isNoteType,
  resolveNodePackage,
  hexToRgba,
  lightenHex,
  mixHex,
} from "./workflow-utils";
import type { WorkflowDetail } from "./workflow-types";

/* buildEdges 只消费 detail 的 nodes / graph / rawNodes，其余字段与连线
 * 解析无关，用 Partial 组装再断言成完整类型，避免为了必填字段编造数据。 */
function detailWith(
  nodes: WorkflowDetail["nodes"],
  graph: WorkflowDetail["graph"],
  rawNodes: WorkflowDetail["rawNodes"],
): WorkflowDetail {
  return { nodes, graph, rawNodes } as unknown as WorkflowDetail;
}

describe("extractNoteTitle", () => {
  it("从 markdown 首个标题提取", () => {
    expect(extractNoteTitle("# 标题\n正文")).toBe("标题");
    expect(extractNoteTitle("## 二级\n正文")).toBe("二级");
    expect(extractNoteTitle("正文\n# 标题")).toBe("标题");
  });

  it("无标题时取首个非空行并截断", () => {
    expect(extractNoteTitle("  hello  ")).toBe("hello");
    const long = "a".repeat(40);
    expect(extractNoteTitle(long)).toBe("a".repeat(30) + "…");
  });

  it("fallback 优先，并剥离 Note: 前缀", () => {
    expect(extractNoteTitle("", "Note: My Note")).toBe("My Note");
    expect(extractNoteTitle("# Body", "Note：正文")).toBe("正文");
    expect(extractNoteTitle("ignored", "fallback")).toBe("fallback");
  });

  it("空输入返回空串", () => {
    expect(extractNoteTitle("", "")).toBe("");
    expect(extractNoteTitle("", undefined)).toBe("");
  });
});

describe("isNoteType", () => {
  it("识别注释节点", () => {
    expect(isNoteType("Note")).toBe(true);
    expect(isNoteType("MarkdownNote")).toBe(true);
  });
  it("非注释节点返回 false", () => {
    expect(isNoteType("KSampler")).toBe(false);
    expect(isNoteType("")).toBe(false);
  });
});

describe("resolveNodePackage", () => {
  it("未知节点回退 ComfyUI", () => {
    expect(resolveNodePackage("TotallyUnknown")).toBe("ComfyUI");
  });
  it("rgthree 后缀识别", () => {
    expect(resolveNodePackage("AnySwitch (rgthree)")).toBe("rgthree-comfy");
  });
  it("cnr_id 属性优先于回退", () => {
    expect(resolveNodePackage("X", { cnr_id: "custom-pack" })).toBe(
      "custom-pack",
    );
    expect(resolveNodePackage("X", { cnr_id: "comfy-core" })).toBe("ComfyUI");
  });
});

describe("buildEdges sourceHandle", () => {
  /* 回归：源节点既不在静态输出表、raw JSON 里也没有 outputs[] 时，画布
   * 一个输出端口都不渲染。此时若把 inferSourceOutNames 从下游输入键反推
   * 出的名字写进 sourceHandle，React Flow 找不到该 handle 会丢弃整条边
   * 并打 error#008 警告（用户看到的 out:width / out:height）。 */
  it("无输出元数据的源节点回落到通用 out handle", () => {
    const detail = detailWith(
      [
        {
          id: "94",
          type: "CustomNoOutputs",
          class_type: "CustomNoOutputs",
          inputs: {},
        },
        {
          id: "76",
          type: "EmptyLatentImage",
          class_type: "EmptyLatentImage",
          inputs: {},
        },
      ] as unknown as WorkflowDetail["nodes"],
      {
        "76": {
          class_type: "EmptyLatentImage",
          inputs: { width_1: ["94", 0], height_1: ["94", 1] },
        },
      },
      [],
    );
    const edges = buildEdges(detail, [], { "94": ["width", "height"] });
    expect(edges).toHaveLength(2);
    expect(edges.map((edge) => edge.sourceHandle)).toEqual(["out", "out"]);
  });

  it("有静态输出表的源节点仍 pin 到精确 handle", () => {
    const detail = detailWith(
      [
        { id: "10", type: "KSampler", class_type: "KSampler", inputs: {} },
        { id: "20", type: "VAEDecode", class_type: "VAEDecode", inputs: {} },
      ] as unknown as WorkflowDetail["nodes"],
      { "20": { class_type: "VAEDecode", inputs: { samples: ["10", 0] } } },
      [],
    );
    const edges = buildEdges(detail, []);
    expect(edges[0]?.sourceHandle).toBe("out:LATENT");
  });

  it("仅有 raw outputs 的源节点按 raw 名字 pin", () => {
    const detail = detailWith(
      [
        {
          id: "30",
          type: "ResolutionSelector",
          class_type: "ResolutionSelector",
          inputs: {},
        },
        {
          id: "40",
          type: "EmptyLatentImage",
          class_type: "EmptyLatentImage",
          inputs: {},
        },
      ] as unknown as WorkflowDetail["nodes"],
      {
        "40": { class_type: "EmptyLatentImage", inputs: { width: ["30", 0] } },
      },
      [
        {
          id: "30",
          widgets_values: [],
          outputs: [{ name: "WIDTH", type: "INT" }],
        },
      ] as unknown as WorkflowDetail["rawNodes"],
    );
    const edges = buildEdges(detail, []);
    expect(edges[0]?.sourceHandle).toBe("out:WIDTH");
  });
});

describe("hex color helpers", () => {
  it("hexToRgba 输出 rgba 字符串", () => {
    expect(hexToRgba("#a855f7", 0.5)).toMatch(/^rgba\(\d+,\d+,\d+,0\.5\)$/);
  });

  it("lightenHex 提高亮度分量", () => {
    const [before, after] = [
      lightenHex("#111111", 0),
      lightenHex("#111111", 0.5),
    ];
    expect(after).not.toBe(before);
  });

  it("mixHex 在两端之间插值（rgb 格式）", () => {
    expect(mixHex("#000000", "#ffffff", 0)).toBe("rgb(0,0,0)");
    expect(mixHex("#000000", "#ffffff", 1)).toBe("rgb(255,255,255)");
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("rgb(128,128,128)");
  });
});
