import { describe, expect, it } from "vitest";

import { buildWorkflowPreview } from "./workflow-preview";

/** 造一张 >14 节点的图：source/sink 各若干、其余是中间节点。 */
function graphWithNodes(count: number): Record<string, unknown> {
  const graph: Record<string, unknown> = {};
  for (let i = 0; i < count; i += 1) {
    const classType = i < 4 ? "LoadImage" : i >= count - 4 ? "SaveImage" : "KSampler";
    graph[`n${i}`] = { class_type: classType, inputs: {} };
  }
  return graph;
}

describe("buildWorkflowPreview 裁剪（ISSUE #5226）", () => {
  it("大图裁剪时源/汇节点各只保留一次", () => {
    const preview = buildWorkflowPreview(graphWithNodes(20));
    expect(preview.truncated).toBe(true);
    expect(preview.nodes).toHaveLength(14);
    const ids = preview.nodes.map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(preview.nodes.filter((node) => node.kind === "input")).toHaveLength(4);
    expect(preview.nodes.filter((node) => node.kind === "output")).toHaveLength(4);
  });
});
