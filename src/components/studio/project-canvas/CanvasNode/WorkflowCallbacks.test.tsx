// 探针：验证 CanvasNode 重渲时传给 WorkflowNode 的回调引用稳定（ISSUE #5204）。
// 手法：vi.mock 掉 WorkflowNode 为记录 props 的探针，渲染 CanvasNode 后 rerender
// （改 selected 触发 CanvasNode 重渲），断言四个回调 + onGenerate 是同一引用。
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import type { NodeProps } from "@xyflow/react";
import { renderWithFlow } from "../../../../../tests/helpers/react-flow";
import { CanvasNode } from "./CanvasNode";
import {
  defaultData,
  type CanvasNodeData,
  type CanvasNodeType,
} from "~/lib/project-canvas/canvas-types";

afterEach(cleanup);

const probe = vi.hoisted(() => ({ captured: [] as Array<Record<string, unknown>> }));
vi.mock("../WorkflowNode", () => ({
  WorkflowNode: (props: Record<string, unknown>) => {
    probe.captured.push(props);
    return null;
  },
}));

vi.mock("~/trpc/vanilla", () => {
  const pending = <T,>() =>
    // oxlint-disable-next-line typescript/no-empty-function -- never-resolve pending 桩
    new Promise<T>(() => {});
  const query = () => vi.fn(() => pending());
  return {
    vanillaApi: {
      workflow: {
        list: { query: query() },
        detail: { query: query() },
        update: { mutate: vi.fn(() => pending()) },
      },
      workflowModel: { list: { query: query() } },
      task: { detail: { query: query() }, cancel: { mutate: vi.fn(() => pending()) } },
    },
  };
});

function makeProps(data: CanvasNodeData, selected = false): NodeProps<CanvasNodeType> {
  return {
    id: "node-under-test",
    data,
    type: "canvasNode",
    selected,
    dragging: false,
    zIndex: 0,
    selectable: true,
    deletable: true,
    draggable: true,
    isConnectable: true,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
  };
}

describe("CanvasNode → WorkflowNode 回调稳定性（ISSUE #5204）", () => {
  it("父重渲（selected 切换）时四个回调与新 onGenerate 引用不变", () => {
    probe.captured.length = 0;
    const data = defaultData("workflow");
    const { rerender } = renderWithFlow(<CanvasNode {...makeProps(data)} />);
    // 等异步 effect 跑完可能带来的额外渲染稳定下来
    const first = probe.captured.at(-1)!;
    rerender(<CanvasNode {...makeProps(data, true)} />);
    const second = probe.captured.at(-1)!;
    for (const key of [
      "onFormChange",
      "onModesChange",
      "onSeedModeChange",
      "onSelectWorkflow",
      "onGenerate",
    ]) {
      expect(second[key], key).toBe(first[key]);
    }
  });
});
