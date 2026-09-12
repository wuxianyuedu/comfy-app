// 画布上的「对外参数节点」与映射连线的派生（纯函数）—— ISSUE #355
//
// 卡片是画布上的接线面板：位置跟着宿主节点派生、端点只在有模式时渲染
// （没有模式禁止连线）、被映射到的端口与作者连过的线都要如实呈现。

import { describe, expect, it, vi } from "vitest";

import type { WorkflowIOMap } from "~/lib/workflow-io-types";
import {
  buildParamEntries,
  entryIdFromParamNodeId,
  paramNodeHeight,
  paramNodeId,
  placeParamNodes,
  resolveMapping,
  type ParamEntry,
} from "~/lib/workflow-param-mapping";
import { buildParamEdges } from "./workflow-param-edges";
import { buildParamNodes } from "./workflow-param-nodes";
import type { WorkflowParamNodeData } from "./workflow-param-node-data";

const io: WorkflowIOMap = {
  "5::widget::width": {
    direction: "input",
    kind: "widget",
    nodeId: "5",
    nodeTitle: "分辨率选择器",
    name: "width",
    type: "INT",
    defaultValue: 512,
  },
  "5::widget::height": {
    direction: "input",
    kind: "widget",
    nodeId: "5",
    nodeTitle: "分辨率选择器",
    name: "height",
    type: "INT",
    defaultValue: 512,
  },
  "9::widget::text": {
    direction: "input",
    kind: "widget",
    nodeId: "9",
    nodeTitle: "Text to Image",
    name: "text",
    type: "STRING",
    defaultValue: "a very long positive prompt used by the workflow author",
  },
};

const entries: ParamEntry[] = buildParamEntries(io);
const hostPos = { "5": { x: 400, y: 200 }, "9": { x: 900, y: 640 } };

function dataOf(node: { data: unknown }): WorkflowParamNodeData {
  return node.data as WorkflowParamNodeData;
}

describe("buildParamNodes — 每个对外参数一个可连线节点", () => {
  it("每个对外参数一张卡片，落在宿主节点左侧一列", () => {
    const nodes = buildParamNodes({
      entries,
      hostPosById: hostPos,
      mode: "T2I",
      isManual: () => false,
      onReset: vi.fn(),
    });
    /* 宽高比 / 像素量在同一个节点上，但这是宽 + 高两个分类 → 两张卡。 */
    expect(nodes.map((node) => node.id).sort()).toEqual([
      "pio:5|size-height",
      "pio:5|size-width",
      "pio:9|prompt",
    ]);
    const width = nodes.find((node) => node.id === "pio:5|size-width")!;
    expect(width.position.x).toBeLessThan(hostPos["5"].x);
    /* 宿主节点是同一个 → 卡片纵向错开，不叠在一起。 */
    const height = nodes.find((node) => node.id === "pio:5|size-height")!;
    expect(height.position.y).not.toBe(width.position.y);
    /* 卡片不可拖动（位置由宿主节点派生，拖了也会被下一次派生覆盖）。 */
    expect(width.draggable).toBe(false);
    expect(width.type).toBe("wfParam");
  });

  it("没有模式时不渲染端点（拖不出线 = 禁止连线）", () => {
    const noMode = buildParamNodes({
      entries,
      hostPosById: hostPos,
      mode: null,
      isManual: () => false,
      onReset: vi.fn(),
    });
    expect(noMode.every((node) => dataOf(node).canWire === false)).toBe(true);
    expect(noMode.every((node) => dataOf(node).canReset === false)).toBe(true);

    const withMode = buildParamNodes({
      entries,
      hostPosById: hostPos,
      mode: "T2I",
      isManual: () => false,
      onReset: vi.fn(),
    });
    expect(withMode.every((node) => dataOf(node).canWire === true)).toBe(true);
  });

  it("「恢复默认」只在作者连过的条目上可用，并回调该条目", () => {
    const onReset = vi.fn();
    const nodes = buildParamNodes({
      entries,
      hostPosById: hostPos,
      mode: "T2I",
      isManual: (entryId) => entryId === "5|size-width",
      onReset,
    });
    const width = nodes.find((node) => node.id === "pio:5|size-width")!;
    const height = nodes.find((node) => node.id === "pio:5|size-height")!;
    expect(dataOf(width).canReset).toBe(true);
    expect(dataOf(height).canReset).toBe(false);
    dataOf(width).onReset();
    expect(onReset).toHaveBeenCalledWith("5|size-width");
  });

  it("卡片带**有类型**的输出端口，类型取自真正落到的端口 —— ISSUE #355 复审", () => {
    const nodes = buildParamNodes({
      entries,
      hostPosById: hostPos,
      mode: "T2I",
      resolved: resolveMapping(entries, io, null, "T2I"),
      io,
      isManual: () => false,
      onReset: vi.fn(),
    });
    const prompt = nodes.find((node) => node.id === "pio:9|prompt")!;
    expect(dataOf(prompt).outputPorts).toEqual([
      { name: "text", type: "STRING", connected: true },
    ]);
    const width = nodes.find((node) => node.id === "pio:5|size-width")!;
    expect(dataOf(width).outputPorts[0]!.type).toBe("INT");
  });

  it("没有 resolved / io 时输出端口退到候选并标 *，卡片高度仍留一行", () => {
    const nodes = buildParamNodes({
      entries,
      hostPosById: hostPos,
      mode: "T2I",
      isManual: () => false,
      onReset: vi.fn(),
    });
    const prompt = nodes.find((node) => node.id === "pio:9|prompt")!;
    expect(dataOf(prompt).outputPorts[0]!.connected).toBe(false);
    expect(dataOf(prompt).outputPorts[0]!.name).toBe("text");
    /* 高度计入输出端口区：卡片高度 = 候选端口行 + 输出端口行（多画一行而几何
     * 没跟上 → 卡片互相压住）。 */
    const entry = entries.find((item) => item.id === "9|prompt")!;
    expect((prompt.style as { height: number }).height).toBe(
      paramNodeHeight(entry, 1),
    );
  });

  it("宿主节点没有坐标时跳过（不产出 NaN 位置）", () => {
    const nodes = buildParamNodes({
      entries,
      hostPosById: { "9": hostPos["9"] },
      mode: "T2I",
      isManual: () => false,
      onReset: vi.fn(),
    });
    expect(nodes.map((node) => node.id)).toEqual(["pio:9|prompt"]);
  });

  it("卡片 id 与图节点 id 不撞名（前缀可往返）", () => {
    expect(paramNodeId("5|size-width")).toBe("pio:5|size-width");
    expect(entryIdFromParamNodeId("pio:5|size-width")).toBe("5|size-width");
    /* 纯数字图节点 id 反解必须是 null，否则「宿主节点」会被当成卡片。 */
    expect(entryIdFromParamNodeId("5")).toBeNull();
  });

  it("位置全部由 placeParamNodes 派生（同一宿主节点的卡片成列对齐）", () => {
    const positions = placeParamNodes(entries, hostPos);
    const width = positions["pio:5|size-width"]!;
    const height = positions["pio:5|size-height"]!;
    expect(width.x).toBe(height.x);
    expect(height.y).toBeGreaterThan(width.y);
  });
});

describe("buildParamEdges — 端点之间的映射连线", () => {
  it("自动判定的落点画出虚线（默认就连好）", () => {
    const edges = buildParamEdges({
      entries,
      resolved: resolveMapping(entries, io, null, "T2I"),
      isManual: () => false,
    });
    const width = edges.find((edge) => edge.id === "pe-5|size-width")!;
    expect(width.source).toBe("pio:5|size-width");
    expect(width.sourceHandle).toBe("pio-out");
    expect(width.target).toBe("5");
    expect(width.targetHandle).toBe("5::widget::width");
    expect(width.style?.strokeDasharray).toBeTypeOf("string");
    expect(width.data?.manual).toBe(false);
  });

  it("作者连过的线改实线并标记为手工", () => {
    const resolved = resolveMapping(entries, io, null, "T2I");
    const edges = buildParamEdges({
      entries,
      resolved,
      isManual: (entryId) => entryId === "9|prompt",
    });
    expect(
      edges.find((edge) => edge.id === "pe-9|prompt")?.style?.strokeDasharray,
    ).toBeUndefined();
    expect(edges.find((edge) => edge.id === "pe-9|prompt")?.data?.manual).toBe(
      true,
    );
  });

  it("显式断开（resolved=null）不画线", () => {
    const edges = buildParamEdges({
      entries,
      resolved: { "5|size-width": null, "9|prompt": "9::widget::text" },
      isManual: () => true,
    });
    expect(edges.map((edge) => edge.id)).toEqual(["pe-9|prompt"]);
  });

  it("连线可删除 —— 删掉一条线就是「这个模式下断开」", () => {
    const edges = buildParamEdges({
      entries,
      resolved: resolveMapping(entries, io, null, "T2I"),
      isManual: () => false,
    });
    expect(edges.every((edge) => edge.deletable === true)).toBe(true);
    expect(edges[0]?.data?.paramEntryId).toBeTypeOf("string");
  });

  it("卡片没渲染出来时不画线（子图内部节点在顶层画布上没有宿主）", () => {
    const edges = buildParamEdges({
      entries,
      resolved: resolveMapping(entries, io, null, "T2I"),
      isManual: () => false,
      renderedCardIds: new Set(["pio:9|prompt"]),
    });
    expect(edges.map((edge) => edge.id)).toEqual(["pe-9|prompt"]);
  });
});
