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
  LIB_NODE_BACKDROP,
  LIB_NODE_HOST,
  LIB_NODE_OUTPUTS,
  LIB_NODE_PARAMS,
  libraryBackdropSize,
  libraryContentExtent,
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
  };
  const outputWire: ParamCardWire = {
    entryId: "5::output::IMAGE",
    targetIoKey: "5::output::IMAGE",
    handleId: "images",
    grouped: false,
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

  it("库里的线一律实线（未连过的不画线，见 param-cards 的用例）", () => {
    /* 用户口径：这里是编辑对外参数的界面，「未连过就不要连」—— 所以库里没有
     *  「默认线」这一档样式，两条边都按实线画。 */
    for (const edge of [
      buildInputEdge(inputWire),
      buildOutputEdge(outputWire),
    ]) {
      expect(
        (edge.style as { strokeDasharray?: string }).strokeDasharray,
      ).toBeUndefined();
      expect(edge.style).toMatchObject({ strokeWidth: 2.5, opacity: 1 });
    }
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

  it("尺寸子口 → 宽高比：放行（候选按类型收，形态由子口声明）", () => {
    const sizeEntry = entries.find((entry) => entry.id === "size-aspect")!;
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
      envelopeHeight: 720,
      fillHeight: 720,
    });
    expect(at[LIB_NODE_PARAMS]!.x).toBeLessThan(at[LIB_NODE_HOST]!.x);
    expect(at[LIB_NODE_HOST]!.x).toBeLessThan(at[LIB_NODE_OUTPUTS]!.x);
    expect(at[LIB_NODE_HOST]!.x - at[LIB_NODE_PARAMS]!.x).toBe(220 + 96);
    expect(at[LIB_NODE_OUTPUTS]!.x - at[LIB_NODE_HOST]!.x).toBe(380 + 96);
  });

  it("背景板与三列同起于左上角（位置不影响包围盒）", () => {
    const at = layoutLibraryNodes(SIZING);
    expect(at[LIB_NODE_BACKDROP]).toEqual(at[LIB_NODE_PARAMS]);
  });
});

/* 背景板尺寸 —— ISSUE #596「全屏时，下方区域有空白却不是画布」。
 *
 * 画布的缩放由 `fitView` 按节点包围盒算：内容比视口矮时它只会放大到内容高度，
 * 画布底边以下就落回面板底色。背景板把包围盒撑到「视口与内容取大」，于是最优
 * 缩放永远是「等比铺满视口」的那个值。
 *
 * 两个方向都要取大，缺一都会退回某种「没铺满」：
 *   · 只按内容算高 → 面板高时下方留白（用户报的就是这个）；
 *   · 只按内容算宽 → 面板窄时右列（对外输出参数）被挤出视野。 */
const SIZING = {
  paramsWidth: 220,
  outputsWidth: 200,
  hostWidth: 380,
  columnGap: 96,
  originX: 0,
  originY: 0,
  envelopeHeight: 720,
  fillHeight: 720,
};

describe("背景板尺寸：视口与内容取大", () => {
  it("面板比内容高时按视口给高（这才是不留白的那一条）", () => {
    const size = libraryBackdropSize(SIZING, { width: 800, height: 1400 });
    expect(size.height).toBeGreaterThanOrEqual(1400);
    expect(size.width).toBeGreaterThanOrEqual(800);
  });

  it("面板比内容矮时按内容给（画不出比内容更小的画布，否则右列看不见）", () => {
    const content = libraryContentExtent(SIZING);
    const size = libraryBackdropSize(SIZING, { width: 100, height: 100 });
    expect(size.width).toBeGreaterThanOrEqual(content.width);
    expect(size.height).toBeGreaterThanOrEqual(content.height);
  });

  it("量不到视口（0 / 负数 / 首帧）时不退化成零尺寸", () => {
    const size = libraryBackdropSize(SIZING, { width: 0, height: 0 });
    expect(size.width).toBeGreaterThan(0);
    expect(size.height).toBeGreaterThan(0);
    expect(Number.isFinite(size.width)).toBe(true);
  });

  it("内容包围盒把列宽与列间距都算进去（右列不能被漏掉）", () => {
    const content = libraryContentExtent(SIZING);
    expect(content.width).toBe(220 + 380 + 200 + 96 * 2);
  });
});
