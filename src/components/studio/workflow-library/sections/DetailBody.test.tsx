// 源文件页签切换工作流不能触发 React Hooks 顺序错误（ISSUE #4406 第 2 条）。
//
// react18-json-view 的 JsonNode 按节点值类型**条件式**调 useState：primitive 分支
// 两个、object/array 分支零个。若切换工作流时复用同一个 JsonViewer 实例，内部
// useState(_src) 会把一棵结构不同的树塞进同一批 JsonNode 位置，节点类型一变就
// 撞上 React「change in the order of Hooks」。契约因此钉在源码：source 页签的
// LazyJsonViewer 必须带 key={workflow.id}，换工作流整棵重建（与同文件另外三处
// 重型内容 key={workflow.id} 同一策略）。

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname);
const body = () => readFileSync(path.join(ROOT, "DetailBody.tsx"), "utf8");

describe("DetailBody 源文件页签", () => {
  it("LazyJsonViewer 带 key={workflow.id}，切工作流时重建 JSON 树实例", () => {
    const src = body();
    const block = /<LazyJsonViewer[\s\S]*?\/>/.exec(src);
    expect(block).not.toBeNull();
    expect(block?.[0]).toMatch(/key=\{workflow\.id\}/);
  });

  it("其余重型内容（画布预览 / 封装面板）同样按工作流重建，策略一致", () => {
    const src = body();
    expect(src).toMatch(/<LazyWorkflowCanvasNodePreview[\s\S]*?key=\{workflow\.id\}/);
    expect(src).toMatch(/<WorkshopEncapsulationPanel[\s\S]*?key=\{workflow\.id\}/);
  });
});
