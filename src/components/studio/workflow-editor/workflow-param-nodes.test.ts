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
import { buildParamEdges, isValidParamConnection } from "./workflow-param-edges";
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

  it("没有模式也连得上：端点照渲染（模式只决定这条线归属哪个命名空间）", () => {
    /* 此前卡片把「有没有模式」当成「能不能连线」，未声明模式的工作流上端点整体
     * 不渲染 —— 用户看到的就是「点击端点拉线出现禁用标记」（ISSUE #355）。 */
    const noMode = buildParamNodes({
      entries,
      hostPosById: hostPos,
      mode: null,
      isManual: () => false,
      onReset: vi.fn(),
    });
    expect(noMode.every((node) => dataOf(node).canWire === true)).toBe(true);
    /* 「恢复默认」仍只在真的画过线时可用（没有模式就没有可撤销的线）。 */
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

  it("候选端点收窄到「宿主卡片真的画得出来、连得上」的行", () => {
    /* 折叠成逐行参数之后露出来的行才是可连行：端点画在一颗落不上去的句柄上，
     *  拖过去只会被闸门判成非法（禁用标记）。 */
    const sizeEntry: ParamEntry = {
      id: "size",
      nodeId: "5",
      hostNodeId: "5",
      nodeTitle: "分辨率选择器",
      cls: "size",
      label: "尺寸",
      pins: [
        { ioKey: "5::widget::width", name: "width", type: "INT", defaultValue: 512 },
        { ioKey: "5::widget::height", name: "height", type: "INT", defaultValue: 512 },
      ],
    };
    const nodes = buildParamNodes({
      entries: [sizeEntry],
      hostPosById: { "5": hostPos["5"] },
      mode: "T2I",
      isManual: () => false,
      onReset: vi.fn(),
      /* 画布上只有 width 这一行露出来。 */
      reachableKeys: new Set(["5::widget::width"]),
    });
    expect(dataOf(nodes[0]!).outputPorts.map((port) => port.ioKey)).toEqual([
      "5::widget::width",
    ]);
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

  it("未连线时按候选逐个给输出端口（尺寸有多颗端点，不是一颗）", () => {
    const nodes = buildParamNodes({
      entries,
      hostPosById: hostPos,
      mode: "T2I",
      isManual: () => false,
      onReset: vi.fn(),
    });
    /* 卡片体不再有「输入端口行」这一段（那是同一批端口的重复表达）——端口
     *  只由输出端口区呈现（一行 = 端点 + 参数名 + 类型）。 */
    expect("inputRows" in dataOf(nodes[0]!)).toBe(false);
    expect(dataOf(nodes[0]!).pins.length).toBeGreaterThan(0);
  });

  it("卡片几何只计入头部 + 输出端口区（没有输入端口行了）", () => {
    const sizeWidth = entries.find((entry) => entry.id === "5|size-width")!;
    const nodes = buildParamNodes({
      entries: [sizeWidth],
      hostPosById: hostPos,
      mode: "T2I",
      isManual: () => false,
      onReset: vi.fn(),
    });
    const card = nodes[0]!;
    expect(dataOf(card).pins.length).toBe(1);
    expect((card.style as { height: number }).height).toBe(
      paramNodeHeight(dataOf(card).outputPorts.length),
    );
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
      {
        name: "text",
        type: "STRING",
        connected: true,
        ioKey: "9::widget::text",
        handleId: "text",
        active: true,
      },
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
    /* `connected` = 端口在工作流里真实存在（候选端口都存在，故为 true）。 */
    expect(dataOf(prompt).outputPorts[0]!.connected).toBe(true);
    expect(dataOf(prompt).outputPorts[0]!.name).toBe("text");
    /* 高度计入输出端口区：卡片高度 = 头部 + 输出端口行（多画一行而几何没跟上
     *  → 卡片互相压住）。 */
    expect((prompt.style as { height: number }).height).toBe(paramNodeHeight(1));
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

  it("卡片端点的 handle id = 该候选端口的 ioKey（与宿主行同名）", () => {
    /* 画布手势拿到的 `connection.targetHandle` 是宿主行的 handle id，写入前要能
     *  对回 ioKey —— 两端必须同一套键。同名 pin 出现在别的节点上时也不会接错行
     * （用 pin 名当 handle id 就会接到同名 handle 的第一处）。 */
    const nodes = buildParamNodes({
      entries,
      hostPosById: hostPos,
      mode: "T2I",
      isManual: () => false,
      onReset: vi.fn(),
      resolved: resolveMapping(entries, io, null, "T2I"),
      io,
    });
    const width = nodes.find((node) => node.id === "pio:5|size-width")!;
    const port = dataOf(width).outputPorts[0]!;
    expect(port.active).toBe(true);
    expect(port.ioKey).toBe("5::widget::width");
    /* 卡片端点 id 取 ioKey（见 WorkflowParamNode 的 <Handle id={port.ioKey}>）。 */
    const edges = buildParamEdges({
      entries,
      resolved: resolveMapping(entries, io, null, "T2I"),
      isManual: () => false,
    });
    expect(edges.find((edge) => edge.id === "pe-5|size-width")!.targetHandle).toBe(
      port.ioKey,
    );
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
    /* 源端点 = 当前落点那一颗（卡片上每个候选一颗 Handle，id 就是 ioKey）——
     * 写死 `pio-out` 会接到一个不存在的 handle，React Flow 直接丢弃整条边。 */
    expect(width.sourceHandle).toBe("5::widget::width");
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

describe("isValidParamConnection — 连线闸门（方向 + 落点）", () => {
  /* ISSUE #355：「对外参数卡片连不了线，点击端点拉线会出现禁用标记」。成因之一是
   * 闸门在**连线过程中**被 React Flow 反复调用（预判悬停处能否落线），而它把
   * 「有没有模式」「targetHandle 是不是 ioKey」当成硬条件 —— 手势在连线画出来
   * 之前就被判非法。这里锁住「哪些连接是合法映射线」。 */
  const sizeEntry = entries.find((entry) => entry.id === "5|size-width")!;

  it("卡片端点 → 该对外参数的宿主端口：合法", () => {
    expect(
      isValidParamConnection(
        {
          source: paramNodeId(sizeEntry.id),
          sourceHandle: "5::widget::width",
          target: "5",
          targetHandle: "5::widget::width",
        },
        entries,
        io,
      ),
    ).toBe(true);
  });

  it("反向拖（宿主端口 → 卡片端点）同样合法", () => {
    expect(
      isValidParamConnection(
        {
          source: "5",
          sourceHandle: "5::widget::width",
          target: paramNodeId(sizeEntry.id),
          targetHandle: "5::widget::width",
        },
        entries,
        io,
      ),
    ).toBe(true);
  });

  it("落点不在该对外参数的宿主节点上 → 拒绝", () => {
    expect(
      isValidParamConnection(
        {
          source: paramNodeId(sizeEntry.id),
          target: "9",
          targetHandle: "9::widget::text",
        },
        entries,
        io,
      ),
    ).toBe(false);
  });

  it("落点端口在 workflowIO 里不存在 → 拒绝（画得出来也落不到值）", () => {
    expect(
      isValidParamConnection(
        {
          source: paramNodeId(sizeEntry.id),
          target: "5",
          targetHandle: "5::widget::nope",
        },
        entries,
        io,
      ),
    ).toBe(false);
  });

  it("图上普通连线（两端都不是卡片）→ 交给画布自己管", () => {
    expect(
      isValidParamConnection(
        { source: "5", target: "9", targetHandle: "9::widget::text" },
        entries,
        io,
      ),
    ).toBe(false);
  });

  it("两张卡片互连 → 不表达任何落点", () => {
    expect(
      isValidParamConnection(
        { source: paramNodeId("5|size-width"), target: paramNodeId("9|prompt") },
        entries,
        io,
      ),
    ).toBe(false);
  });
});

/* ── 契约路径（生产路径）：条目来自对外参数契约，`nodeId` 是空串 ──
 *
 * 契约条目的 `id` 是 `prompt` / `size`（与工作流无关），`nodeId` 为空 —— 画布
 * 卡片的位置、映射线的宿主端、连线的合法性判定都必须走 `hostNodeId`。此前各处
 * 一律读 `nodeId`，于是契约路径下：卡片一张都渲染不出来（查不到宿主坐标）、
 * 映射线指向空节点、连线闸门恒定失败。用户看到的正是「看不到对外参数卡片 /
 * 端点拉不了线」（ISSUE #355）。 */

describe("契约条目的宿主节点（hostNodeId）—— ISSUE #355", () => {
  const contractIo: WorkflowIOMap = {
    "4::widget::positive_prompt": {
      direction: "input",
      kind: "widget",
      nodeId: "4",
      nodeTitle: "image_z_image",
      name: "positive_prompt",
      type: "STRING",
      defaultValue: "3只小猫在喝山泉",
    },
    "4::widget::aspect_ratio": {
      direction: "input",
      kind: "widget",
      nodeId: "4",
      nodeTitle: "ResolutionSelector",
      name: "aspect_ratio",
      type: "COMBO",
      defaultValue: "16:9 (Widescreen)",
      options: ["16:9 (Widescreen)"],
    },
    "4::widget::megapixels": {
      direction: "input",
      kind: "widget",
      nodeId: "4",
      nodeTitle: "ResolutionSelector",
      name: "megapixels",
      type: "FLOAT",
      defaultValue: 1,
    },
    "4::widget::multiple": {
      direction: "input",
      kind: "widget",
      nodeId: "4",
      nodeTitle: "ResolutionSelector",
      name: "multiple",
      type: "INT",
      defaultValue: 8,
    },
  };
  const contractEntries = buildParamEntries(contractIo, undefined, { mode: "T2I" });
  const contractPos = { "4": { x: 600, y: 300 } };

  it("契约条目自带宿主节点 id（nodeId 为空串）", () => {
    const prompt = contractEntries.find((entry) => entry.id === "prompt")!;
    expect(prompt.nodeId).toBe("");
    expect(prompt.hostNodeId).toBe("4");
  });

  it("按 hostNodeId 派生出卡片位置 —— 卡片真的渲染得出来", () => {
    const nodes = buildParamNodes({
      entries: contractEntries,
      hostPosById: contractPos,
      mode: "T2I",
      isManual: () => false,
      onReset: vi.fn(),
      io: contractIo,
    });
    expect(nodes.map((node) => node.id)).toEqual([
      "pio:prompt",
      "pio:size",
    ]);
    for (const node of nodes) {
      expect(Number.isFinite(node.position.x)).toBe(true);
      expect(node.position.x).toBeLessThan(contractPos["4"].x);
    }
  });

  it("映射线的宿主端与源端点都指向真实存在的 handle", () => {
    const edges = buildParamEdges({
      entries: contractEntries,
      resolved: resolveMapping(contractEntries, contractIo, null, "T2I"),
      isManual: () => false,
    });
    const prompt = edges.find((edge) => edge.id === "pe-prompt")!;
    expect(prompt.target).toBe("4");
    expect(prompt.targetHandle).toBe("4::widget::positive_prompt");
    /* 源端点必须与卡片上真实渲染的 <Handle id> 同名（ioKey）。 */
    expect(prompt.sourceHandle).toBe("4::widget::positive_prompt");
  });

  it("连线闸门认契约条目：拖到宿主行即合法（此前恒定拒绝）", () => {
    expect(
      isValidParamConnection(
        {
          source: paramNodeId("prompt"),
          target: "4",
          targetHandle: "4::widget::positive_prompt",
        },
        contractEntries,
        contractIo,
      ),
    ).toBe(true);
    /* 反向拖（宿主行 → 卡片端点）同样成立。 */
    expect(
      isValidParamConnection(
        {
          source: "4",
          sourceHandle: "4::widget::aspect_ratio",
          target: paramNodeId("size"),
        },
        contractEntries,
        contractIo,
      ),
    ).toBe(true);
    /* 拖到别的节点的端口 → 仍然拒绝。 */
    expect(
      isValidParamConnection(
        {
          source: paramNodeId("prompt"),
          target: "9",
          targetHandle: "9::widget::text",
        },
        contractEntries,
        contractIo,
      ),
    ).toBe(false);
  });

  it("尺寸卡片把比例 / 像素 / 倍数三个出口都摆出来（ISSUE #355 复审）", () => {
    const nodes = buildParamNodes({
      entries: contractEntries,
      hostPosById: contractPos,
      mode: "T2I",
      isManual: () => false,
      onReset: vi.fn(),
      io: contractIo,
      resolved: resolveMapping(contractEntries, contractIo, null, "T2I"),
    });
    const size = nodes.find((node) => node.id === "pio:size")!;
    expect(dataOf(size).outputPorts.map((port) => port.name)).toEqual([
      "aspect_ratio",
      "megapixels",
      "multiple",
    ]);
  });
});
