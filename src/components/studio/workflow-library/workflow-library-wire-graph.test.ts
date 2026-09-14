/* 工作流库画布预览的**连线图派生**与**类型闸门** —— ISSUE #529
 *
 * 库里那三列现在是 React Flow 画布：连线是真正的 edge、端点是真正的 <Handle>，
 * 于是「这条线连的是哪两口」「这一行收不收这个口子」第一次成为**可直接断言的
 * 纯函数**（旧实现里它们埋在量 rect 的手势层，只能靠打桩几何来测）。
 *
 * 这里断言两件事：
 *   ① 边的两端与 handle 取值（两个键空间不能混，混了边就量不到 handleBounds）；
 *   ② 闸门与自动落点同一份判据（`pinAcceptsEntry`）—— 不过闸门就会连出
 *      「提示词 → 宽高比」这种运行期取不到值的假线。
 */

import { describe, expect, it } from "vitest";
import type { Edge } from "@xyflow/react";

import type { WorkflowIOMap } from "~/components/studio/shared/workflow-io";
import { buildParamEntries } from "~/lib/workflow-param-mapping";
import {
  LIB_NODE_HOST,
  LIB_NODE_OUTPUTS,
  LIB_NODE_PARAMS,
  libraryEdgeId,
  libraryEdgeOwner,
  layoutLibraryNodes,
} from "./workflow-library-wire-graph";
import {
  buildInputEdge,
  buildOutputEdge,
  deriveLibraryEdges,
  libraryConnectionAllowed,
} from "./hooks/use-library-wire-flow";
import type { ParamCardWire } from "./workflow-library-param-cards";

const io: WorkflowIOMap = {
  "9::widget::positive_prompt": {
    direction: "input",
    kind: "widget",
    nodeId: "9",
    name: "positive_prompt",
    type: "STRING",
    defaultValue: "一只猫在喝山泉的完整描述词，足够长到被判定成提示词口",
  },
  "5::widget::aspect_ratio": {
    direction: "input",
    kind: "widget",
    nodeId: "5",
    name: "aspect_ratio",
    type: "COMBO",
    defaultValue: "16:9",
  },
  "5::output::IMAGE": {
    direction: "output",
    kind: "output",
    nodeId: "5",
    name: "images",
    type: "IMAGE",
  },
};

const entries = buildParamEntries(io, undefined, { mode: "T2I" });

describe("边的身份（libraryEdgeId / libraryEdgeOwner）", () => {
  it("带 handle 的 id 可反查出「点的是哪个口的哪颗圆点」", () => {
    const id = libraryEdgeId("param", "size", "aspect_ratio");
    expect(libraryEdgeOwner(id)).toEqual({
      namespace: "param",
      entryId: "size",
      handleId: "aspect_ratio",
    });
  });

  it("一个对外参数摊成多条线时 id 不撞车（尺寸 = 宽高比 / 像素量 / 倍数）", () => {
    /* 只用条目 id 会让三条线共用同一个 key —— React 重复 key，且 React Flow 的
     *  edgeLookup 互相覆盖（点选高亮张冠李戴）。 */
    const ids = ["aspect_ratio", "megapixels", "multiple"].map((handle) =>
      libraryEdgeId("param", "size", handle),
    );
    expect(new Set(ids).size).toBe(3);
  });

  it("不是库内映射线的 id 一律不认", () => {
    expect(libraryEdgeOwner("e1-2")).toBeNull();
    expect(libraryEdgeOwner("libwire:param:size")).toBeNull();
    expect(libraryEdgeOwner("libwire:nope:size?width")).toBeNull();
  });
});

describe("边的两端与 handle 取值", () => {
  const inputWire: ParamCardWire = {
    entryId: "prompt",
    targetIoKey: "9::widget::positive_prompt",
    handleId: "positive_prompt",
    grouped: false,
    manual: false,
  };
  const outputWire: ParamCardWire = {
    entryId: "5::output::IMAGE",
    targetIoKey: "5::output::IMAGE",
    handleId: "images",
    grouped: false,
    manual: true,
    kind: "hostToParam",
  };

  it("输入侧：卡片圆点（source handle）→ 宿主行（target handle = ioKey）", () => {
    const edge = buildInputEdge(inputWire);
    expect(edge.source).toBe(LIB_NODE_PARAMS);
    expect(edge.target).toBe(LIB_NODE_HOST);
    expect(edge.sourceHandle).toBe("positive_prompt");
    expect(edge.targetHandle).toBe("9::widget::positive_prompt");
  });

  it("输出侧方向相反：宿主输出行 → 右列卡片圆点", () => {
    const edge = buildOutputEdge(outputWire);
    expect(edge.source).toBe(LIB_NODE_HOST);
    expect(edge.target).toBe(LIB_NODE_OUTPUTS);
    expect(edge.sourceHandle).toBe("5::output::IMAGE");
    expect(edge.targetHandle).toBe("images");
  });

  it("两套键空间不混：落点是 ioKey，卡片端是 handle id", () => {
    /* 输入侧的 handle id 是**端口名**（库里按端口名给圆点定位），落点是 ioKey
     *  （运行期与落库的键）—— 混了边就量不到 handleBounds（线画不出来）。 */
    const edge = buildInputEdge({
      ...inputWire,
      targetIoKey: "9::widget::negative_prompt",
    });
    expect(edge.targetHandle).toBe("9::widget::negative_prompt");
    expect(edge.sourceHandle).not.toContain("::");
  });

  it("自动线画虚线、作者改过的画实线（与编辑器画布同一套语义）", () => {
    const auto = buildInputEdge(inputWire);
    const manual = buildInputEdge({ ...inputWire, manual: true });
    expect((auto.style as { strokeDasharray?: string }).strokeDasharray).toBe("6 4");
    expect((manual.style as { strokeDasharray?: string }).strokeDasharray).toBeUndefined();
  });

  it("两侧一起派生：几条 wire 就几条边", () => {
    const edges = deriveLibraryEdges(
      [inputWire, { ...inputWire, entryId: "size", handleId: "width" }],
      [outputWire],
    );
    expect(edges).toHaveLength(3);
    expect(new Set(edges.map((e: Edge) => e.id)).size).toBe(3);
  });
});

describe("类型闸门（libraryConnectionAllowed）", () => {
  const allowed = (connection: {
    source: string;
    target: string;
    sourceHandle: string;
    targetHandle: string;
  }) => libraryConnectionAllowed(connection, { io, entries });

  it("提示词口 → 提示词行：放行", () => {
    const promptEntry = entries.find((entry) => entry.id === "prompt")!;
    expect(
      allowed({
        source: LIB_NODE_PARAMS,
        target: LIB_NODE_HOST,
        sourceHandle: promptEntry.pins[0]!.name,
        targetHandle: "9::widget::positive_prompt",
      }),
    ).toBe(true);
  });

  it("提示词口 → 宽高比（尺寸行）：拒绝 —— 那是条运行期取不到值的假线", () => {
    const promptEntry = entries.find((entry) => entry.id === "prompt")!;
    expect(
      allowed({
        source: LIB_NODE_PARAMS,
        target: LIB_NODE_HOST,
        sourceHandle: promptEntry.pins[0]!.name,
        targetHandle: "5::widget::aspect_ratio",
      }),
    ).toBe(false);
  });

  it("尺寸口 → 宽高比：放行（尺寸接受宽 / 高 / 宽高比 / 像素量四类）", () => {
    const sizeEntry = entries.find((entry) => entry.id === "size")!;
    expect(
      allowed({
        source: LIB_NODE_PARAMS,
        target: LIB_NODE_HOST,
        sourceHandle: sizeEntry.pins[0]!.name,
        targetHandle: "5::widget::aspect_ratio",
      }),
    ).toBe(true);
  });

  it("输出行 → 右列卡片：放行；右列卡片 → 输出行（反向）：拒绝", () => {
    expect(
      allowed({
        source: LIB_NODE_HOST,
        target: LIB_NODE_OUTPUTS,
        sourceHandle: "5::output::IMAGE",
        targetHandle: "images",
      }),
    ).toBe(true);
    expect(
      allowed({
        source: LIB_NODE_OUTPUTS,
        target: LIB_NODE_HOST,
        sourceHandle: "images",
        targetHandle: "5::output::IMAGE",
      }),
    ).toBe(false);
  });

  it("同列自连 / 缺 handle / 未知端口一律拒绝", () => {
    expect(
      allowed({
        source: LIB_NODE_PARAMS,
        target: LIB_NODE_PARAMS,
        sourceHandle: "prompt",
        targetHandle: "prompt",
      }),
    ).toBe(false);
    expect(
      allowed({
        source: LIB_NODE_PARAMS,
        target: LIB_NODE_HOST,
        sourceHandle: "",
        targetHandle: "9::widget::positive_prompt",
      }),
    ).toBe(false);
    expect(
      allowed({
        source: LIB_NODE_PARAMS,
        target: LIB_NODE_HOST,
        sourceHandle: "不存在的口",
        targetHandle: "9::widget::positive_prompt",
      }),
    ).toBe(false);
  });
});

describe("三列布局", () => {
  it("左 → 宿主 → 右依次排开，列间留出走线的空间", () => {
    const at = layoutLibraryNodes({
      paramsWidth: 220,
      outputsWidth: 200,
      hostWidth: 380,
      columnGap: 96,
      originX: 0,
      originY: 0,
    });
    expect(at[LIB_NODE_PARAMS]!.x).toBeLessThan(at[LIB_NODE_HOST]!.x);
    expect(at[LIB_NODE_HOST]!.x).toBeLessThan(at[LIB_NODE_OUTPUTS]!.x);
    expect(at[LIB_NODE_HOST]!.x - at[LIB_NODE_PARAMS]!.x).toBe(220 + 96);
    expect(at[LIB_NODE_OUTPUTS]!.x - at[LIB_NODE_HOST]!.x).toBe(380 + 96);
  });
});
