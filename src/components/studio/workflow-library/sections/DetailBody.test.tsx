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

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { WorkflowRow } from "../workflow-library-config";
import { DetailBody } from "./DetailBody";

/* 工坊封装面板是页签内容的大头（内部还挂懒日志弹窗）：本文件只判「加载态 /
 * 内容」的切换，不拖真面板。源码形状断言在下方，读的仍是真实源文件。 */
vi.mock("./WorkshopEncapsulationPanel", () => ({
  WorkshopEncapsulationPanel: () => <div>封装面板内容桩</div>,
}));

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

/** 详情主体渲染夹具：按真实行形状构造（同 WorkflowLibraryLayout 的 headerRow，
 *  不用 `as unknown as` 把形状检查换成一次断言）。 */
function row(over: Partial<WorkflowRow> = {}): WorkflowRow {
  return {
    id: "wf-1",
    name: "image_z_image_int8_t2i",
    taskType: "T2I",
    source: "local",
    modes: ["T2I"],
    defaultMode: "T2I",
    modelTags: [],
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    paramMap: null,
    sourcePath: null,
    diskDirty: false,
    diskMissing: false,
    diskMtimeSec: null,
    sourceMtimeSec: null,
    diskRenamed: false,
    diskRenamedTo: null,
    ...over,
  };
}

function renderBody(isLoading: boolean) {
  return render(
    <DetailBody
      activeMode="T2I"
      isLoading={isLoading}
      onActiveModeChange={vi.fn()}
      onEdit={vi.fn()}
      paramMap={{}}
      sourceData={null}
      tab="params"
      usable
      workflow={row()}
      workflowIO={null}
    />,
  );
}

/* 详情查询在飞期间页签内容区必须有加载态（ISSUE #4592）：此前 isLoading 时
 * return null，detailFull 跑 4s+ 的那段时间「选中工作流后卡在工坊封装」看起来
 * 像死机。现在给局部加载态：spinner 只占内容区，头部与页签条照常显示。 */
describe("DetailBody 加载态（ISSUE #4592）", () => {
  afterEach(() => {
    cleanup();
  });

  it("详情数据未排空（isLoading）时显示局部加载文案，不渲染页签内容", () => {
    renderBody(true);
    expect(screen.getByText("加载工作流详情…")).not.toBeNull();
    expect(screen.queryByText("封装面板内容桩")).toBeNull();
  });

  it("数据落定后加载态退场、页签内容上屏", () => {
    renderBody(false);
    expect(screen.getByText("封装面板内容桩")).not.toBeNull();
    expect(screen.queryByText("加载工作流详情…")).toBeNull();
  });

  it("加载态复用 TabContentLoading（不另起一套局部加载界面）", () => {
    const src = body();
    expect(src).toMatch(/if \(isLoading\) \{\s*return <TabContentLoading/);
    expect(src).not.toMatch(/if \(isLoading\) \{\s*return null/);
  });
});
