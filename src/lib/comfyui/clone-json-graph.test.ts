import { describe, expect, it } from "vitest";

import { isRecord } from "~/lib/is-record";
import { cloneJsonGraph } from "./clone-json-graph";

type NodeGraph = { nodes: Array<{ id: number }> };

/** 把 `unknown` 克隆结果收窄成测试断言用的形状（与调用点同口径）。 */
function isNodeGraph(value: unknown): value is NodeGraph {
  return isRecord(value) && Array.isArray(value.nodes);
}

function asNodeGraph(value: unknown): NodeGraph {
  if (!isNodeGraph(value)) {
    throw new Error("期望的图形状不成立");
  }
  return value;
}

describe("cloneJsonGraph", () => {
  it("深拷贝嵌套结构，且返回值与原对象无共享引用", () => {
    const graph = {
      nodes: [{ id: 1, inputs: { seed: 42 } }],
      links: [[1, 0, 2, 0]],
    };
    const cloned = cloneJsonGraph(graph);

    expect(cloned).toEqual(graph);
    expect(cloned).not.toBe(graph);
    // 内层也不共享引用：改写副本不影响原图（下一条用例正面验证）。
    expect(asNodeGraph(cloned).nodes).not.toBe(graph.nodes);
  });

  it("净化掉 undefined / 函数 / 符号字段，保留其余 JSON 结构", () => {
    const graph = {
      keep: "yes",
      undef: undefined,
      fn: () => 1,
      sym: Symbol("x"),
      nested: { alsoUndef: undefined, value: 7 },
    };
    const cloned = cloneJsonGraph(graph);

    expect(cloned).toEqual({
      keep: "yes",
      nested: { value: 7 },
    });
  });

  it("数组中的 undefined 归一成 null，NaN/Infinity 归一成 null（JSON 语义）", () => {
    const cloned = cloneJsonGraph([undefined, Number.NaN, Number.POSITIVE_INFINITY, 1]);
    expect(cloned).toEqual([null, null, null, 1]);
  });

  it("不修改原对象（改写副本不污染入参）", () => {
    const graph: NodeGraph = { nodes: [{ id: 1 }] };
    const cloned = asNodeGraph(cloneJsonGraph(graph));
    cloned.nodes[0]!.id = 999;

    expect(graph.nodes[0]!.id).toBe(1);
  });

  it("标量输入按 JSON 语义克隆", () => {
    expect(cloneJsonGraph(42)).toBe(42);
    expect(cloneJsonGraph("x")).toBe("x");
    expect(cloneJsonGraph(null)).toBeNull();
    expect(cloneJsonGraph(undefined)).toBeUndefined();
  });
});
