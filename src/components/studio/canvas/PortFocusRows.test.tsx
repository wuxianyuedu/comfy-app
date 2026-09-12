// @vitest-environment jsdom
// 选中节点 → 端口行的关注级别：渲染层测试（用户唯一能看见的那一半）。
//
// 判据（哪一行属于上游 / 下游 / 无关）已由 flow-focus-ports.test.ts 覆盖；这里验的
// 是「级别真的落到了 DOM 上」——判据算得再对，样式没落到行上也等于没做：
//   1. 有连线落到的那一行：标签提亮加粗 + 行背景提亮 + 端口圆点放大；
//   2. 没有连线落到的行：选中态下整行压暗（否则「相关的行」跳不出来）；
//   3. 没有选中任何节点：全图原样（不该因为一次误点让整张节点发灰）。

import { afterEach, describe, expect, it } from "vitest";
import { cleanup } from "@testing-library/react";
import { renderWithFlow } from "../../../../tests/helpers/react-flow";
import { FlowNode } from "./WorkflowNode";
import {
  WFStoresProvider,
  createIOEditStore,
  createRgthreeGroupsStore,
  createNodeJsonViewerStore,
  type WFStores,
} from "../workflow-editor/WorkflowStores";
import {
  NODE_PORT_FOCUS_ACTIVE_KEY,
  NODE_PORT_FOCUS_DATA_KEY,
} from "./hooks/use-related-edges-highlight";
import type { WorkflowNodeData } from "../workflow-types";

afterEach(cleanup);

/* 两类行：
 *  - `model`：纯连接行（TOP PINS），target Handle id = 端口名；
 *  - `seed` ：widget 行（参数行），target Handle id = 端口名。 */
const RAW_INPUTS = [
  { name: "model", type: "MODEL", isConnection: true },
  {
    name: "seed",
    type: "INT",
    isConnection: false,
    widget: { name: "seed" },
    widgetValue: 42,
  },
];

function nodeData(overrides: Partial<WorkflowNodeData> = {}): WorkflowNodeData {
  return {
    nodeId: "9",
    classType: "KSampler",
    title: "主采样器",
    inputs: {},
    assignedRole: null,
    inputSources: {},
    rawInputs: RAW_INPUTS,
    ...overrides,
  };
}

/* FlowNode 内的 NodeIdChip / IoCheckbox 经 useIOEditContext 读 WFStoresProvider
 * 下发的 store（与 WorkflowNode.test.tsx 同款包装：真实 store 工厂 + Provider）。 */
function makeStores(): WFStores {
  return {
    io: createIOEditStore("wf-test"),
    rgthree: createRgthreeGroupsStore({ workflowId: "wf-test", detail: null }),
    viewer: createNodeJsonViewerStore({
      detail: null,
      rawMetaById: {},
      positions: null,
      subgraphRawContext: null,
      subgraphStackLength: 0,
    }),
  };
}

/** 挂上端口关注标记渲染（模拟 useRelatedEdgesHighlight 写回节点 data 的结果）。 */
function renderWithPortFocus(
  portFocus: Record<string, string> | undefined,
  active: boolean,
) {
  const data = nodeData();
  if (portFocus !== undefined) {
    (data as unknown as Record<string, unknown>)[NODE_PORT_FOCUS_DATA_KEY] = portFocus;
  }
  (data as unknown as Record<string, unknown>)[NODE_PORT_FOCUS_ACTIVE_KEY] = active;
  return renderWithFlow(
    <WFStoresProvider stores={makeStores()}>
      <FlowNode data={data} />
    </WFStoresProvider>,
  );
}

function pinRow(handle: string): HTMLElement {
  const row =
    document.querySelector<HTMLElement>(`[data-pin-input="${handle}"]`) ??
    document.querySelector<HTMLElement>(`[data-input-key="${handle}"]`);
  expect(row).not.toBeNull();
  return row!;
}

function labelColor(row: HTMLElement): string {
  const span = row.querySelector<HTMLElement>("span[title]");
  expect(span).not.toBeNull();
  return span!.style.color;
}

function portHandle(row: HTMLElement): HTMLElement {
  const handle = row.querySelector<HTMLElement>("[data-handleid]");
  expect(handle).not.toBeNull();
  return handle!;
}

describe("端口行关注级别渲染", () => {
  it("上游行（有连线落到）：行提亮、标签提亮加粗、端口放大", () => {
    renderWithPortFocus({ model: "upstream" }, true);
    const row = pinRow("model");
    expect(row.style.background).not.toBe("");
    expect(labelColor(row)).toContain("ink-bright");
    expect(portHandle(row).style.width).toBe("12px");
  });

  it("下游行同样提亮（方向只影响语义，不影响可见性）", () => {
    renderWithPortFocus({ model: "downstream" }, true);
    const row = pinRow("model");
    expect(row.style.background).not.toBe("");
    expect(portHandle(row).style.width).toBe("12px");
  });

  it("选中态下没连线的行压暗，相关行才跳得出来", () => {
    renderWithPortFocus({ model: "upstream" }, true);
    const unrelated = pinRow("seed");
    /* 整行压暗（标签与端点一起）：线条的「亮」要靠周围的「暗」托出来。 */
    expect(unrelated.style.opacity).toBe("0.45");
    expect(unrelated.style.background).toBe("");
  });

  it("related（两端都选中）不强加提亮，只说「这一行有连线」", () => {
    renderWithPortFocus({ model: "related" }, true);
    const row = pinRow("model");
    expect(row.style.background).toBe("");
    expect(row.style.opacity).toBe("");
    expect(portHandle(row).style.width).toBe("10px");
  });

  it("没有选中任何节点：整张节点保持原样（不因一次误点发灰）", () => {
    renderWithPortFocus(undefined, false);
    for (const handle of ["model", "seed"]) {
      const row = pinRow(handle);
      expect(row.style.opacity).toBe("");
      expect(row.style.background).toBe("");
    }
  });

  it("输出侧的标记按 `out:<名字>` 落在同一行（TOP PINS 共享行）", () => {
    renderWithPortFocus({ "out:LATENT": "downstream" }, true);
    const row = document.querySelector<HTMLElement>('[data-pin-output="LATENT"]')!;
    expect(row).not.toBeNull();
    expect(row.style.background).not.toBe("");
    const handle = row.querySelector<HTMLElement>('[data-handleid="out:LATENT"]')!;
    expect(handle.style.width).toBe("12px");
  });
});
