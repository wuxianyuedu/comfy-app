import { describe, expect, it } from "vitest";
import {
  buildInputEdge,
  buildOutputEdge,
  deriveLibraryEdges,
} from "./hooks/use-library-wire-flow";
import { libraryEdgeOwner } from "./workflow-library-wire-graph";

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
