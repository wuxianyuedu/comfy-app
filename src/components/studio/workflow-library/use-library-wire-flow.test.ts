import { describe, expect, it } from "vitest";

import type { WorkflowIOMap } from "~/components/studio/workflow-io";
import {
  buildInputEdge,
  buildLibraryNodes,
  buildOutputEdge,
  deriveLibraryEdges,
  handleInventoryOf,
  LAYOUT_SIZING,
} from "./hooks/use-library-wire-flow";
import {
  deriveLibraryOutputCards,
  deriveLibraryParamCards,
} from "./workflow-library-param-cards";
import {
  LIB_NODE_BACKDROP,
  LIB_NODE_HOST,
  LIB_NODE_OUTPUTS,
  LIB_NODE_PARAMS,
  libraryEdgeOwner,
} from "./workflow-library-wire-graph";

/* 这些只测「边是否可被单独点选 / 删除」这类纯派生逻辑，不渲染 React Flow，
 * 因此很快、也不依赖 jsdom 的 SVG 命中。删除单条线能力（ISSUE：连错某一条线
 * 时不用卡片头 ↺ 整张清）正是靠边可单独选中 + 删除键 / 删除按钮落到
 * `disconnect(entryId)` 实现。 */

const inputWire = {
  entryId: "size-width",
  handleId: "size-width",
  targetIoKey: "node.width",
  grouped: false,
} as const;
const outputWire = {
  entryId: "image",
  handleId: "image",
  targetIoKey: "node.image",
  grouped: false,
} as const;

describe("deriveLibraryEdges — 单条线可单独选中 / 删除", () => {
  it("可交互时：边 selectable + deletable 均为 true", () => {
    const edges = deriveLibraryEdges([inputWire], [outputWire], true);
    expect(edges).toHaveLength(2);
    for (const e of edges) {
      expect(e.selectable).toBe(true);
      expect(e.deletable).toBe(true);
    }
  });

  it("只读（不可交互）时：边被锁定，避免误删", () => {
    const edges = deriveLibraryEdges([inputWire], [outputWire], false);
    for (const e of edges) {
      expect(e.selectable).toBe(false);
      expect(e.deletable).toBe(false);
    }
  });

  it("输入侧与输出侧各自生成一条可定位的边", () => {
    const inEdge = buildInputEdge(inputWire, true);
    const outEdge = buildOutputEdge(outputWire, true);
    expect(inEdge.source).toBe("lib:params");
    expect(inEdge.target).toBe("lib:host");
    expect(outEdge.source).toBe("lib:host");
    expect(outEdge.target).toBe("lib:outputs");

    const inOwner = libraryEdgeOwner(inEdge.id);
    expect(inOwner).toEqual({
      namespace: "param",
      entryId: "size-width",
      handleId: "size-width",
    });
    const outOwner = libraryEdgeOwner(outEdge.id);
    expect(outOwner).toEqual({
      namespace: "output",
      entryId: "image",
      handleId: "image",
    });
  });

  it("点选中的边（selectedIds）在 style 里注入高亮描边", () => {
    const selectedId = "libwire:param:size-width?size-width";
    const edges = deriveLibraryEdges(
      [inputWire],
      [outputWire],
      true,
      new Set([selectedId]),
    );
    const selected = edges.find((e) => e.id === selectedId)!;
    expect(selected.style?.stroke).toBe("#c4b5fd");
    expect(selected.style?.strokeWidth).toBe(4);
    const other = edges.find((e) => e.id === "libwire:output:image?image")!;
    expect(other.style?.stroke).not.toBe("#c4b5fd");
  });
});

/* ── 画布几何的两个前提 ────────────────────────────────────────────────────
 *
 * 下面两条都不是「看着对不对」的观感问题，而是**线能不能接上**的前提：
 *   · `width` / `height` 会把节点 DOM 钉死在声明值上 —— 内容一变（表单随 IO
 *     到位长高、换模式换掉候选口）端点坐标就不再重算，线落在圆点旁边；首帧之后
 *     才出现的端点更是连登记都登记不上，拖不动也落不下，且**全程无提示**；
 *   · 端点清单是「要不要请 React Flow 重算一次」的开关（元素尺寸没变的那种
 *     替换只能靠它兜住）。
 */
describe("buildLibraryNodes — 首帧尺寸的声明方式", () => {
  const nodes = buildLibraryNodes(LAYOUT_SIZING);
  const byId = (id: string) => nodes.find((node) => node.id === id)!;

  it("三列内容节点只用 initialWidth / initialHeight", () => {
    for (const id of [LIB_NODE_PARAMS, LIB_NODE_HOST, LIB_NODE_OUTPUTS]) {
      const node = byId(id);
      /* 首帧几何要有（jsdom / 布局前也算得出落点）。 */
      expect(node.initialWidth, id).toBeGreaterThan(0);
      expect(node.initialHeight, id).toBe(LAYOUT_SIZING.envelopeHeight);
      /* 但**不许**用 `width` / `height`：那会把外框钉死、端点坐标不再重算 ——
       * 见 `buildLibraryNodes` 里那段说明。 */
      expect(node.width, id).toBeUndefined();
      expect(node.height, id).toBeUndefined();
    }
  });

  it("背景板相反：它的尺寸就是声明值（没有内容可量、也没有端点）", () => {
    const backdrop = byId(LIB_NODE_BACKDROP);
    expect(backdrop.width).toBeGreaterThan(0);
    expect(backdrop.height).toBeGreaterThan(0);
    expect(backdrop.initialWidth).toBeUndefined();
    expect(backdrop.initialHeight).toBeUndefined();
  });
});

describe("handleInventoryOf — 什么时候请 React Flow 重算落点", () => {
  const io: WorkflowIOMap = {
    "9::widget::positive_prompt": {
      direction: "input",
      kind: "widget",
      nodeId: "9",
      name: "positive_prompt",
      type: "STRING",
      defaultValue: "一只猫在喝山泉的完整描述词，足够长到被判定成提示词口",
    },
    "5::output::IMAGE": {
      direction: "output",
      kind: "output",
      nodeId: "5",
      name: "images",
      type: "IMAGE",
    },
  };
  const cards = () =>
    deriveLibraryParamCards({ io, paramMap: null, mode: "T2I" });
  const outputs = () => deriveLibraryOutputCards({ io, mode: "T2I" });

  it("同一批口的新对象（纯重渲染）：清单不变，不发重算请求", () => {
    expect(handleInventoryOf(cards(), outputs(), io, true)).toBe(
      handleInventoryOf(cards(), outputs(), io, true),
    );
  });

  it("只读 ↔ 可连线：清单变（同一颗点是否接受拖线由它决定）", () => {
    const base = handleInventoryOf(cards(), outputs(), io, true);
    expect(handleInventoryOf(cards(), outputs(), io, false)).not.toBe(base);
  });

  it("IO 换了行（哪怕行数一样）：清单变", () => {
    /* 只数行数是不够的：工作流改版后同数量、不同键的输入行是另一批端点。 */
    const renamed: WorkflowIOMap = {
      "9::widget::negative_prompt": io["9::widget::positive_prompt"]!,
      "5::output::IMAGE": io["5::output::IMAGE"]!,
    };
    const base = handleInventoryOf(cards(), outputs(), io, true);
    expect(handleInventoryOf(cards(), outputs(), renamed, true)).not.toBe(base);
  });
});
