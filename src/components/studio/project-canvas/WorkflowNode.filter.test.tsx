// WorkflowNode 筛选行为：filteredList 用 useMemo 后仍随 sourceFilter/modelFilter 正确变化（ISSUE #5204）。
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithFlow } from "../../../../tests/helpers/react-flow";
import WorkflowNode from "./WorkflowNode";
import { defaultData } from "~/lib/project-canvas/canvas-types";
import type { WorkflowNodeProps } from "./WorkflowNode";

afterEach(cleanup);

vi.mock("~/trpc/vanilla", () => {
  const pending = <T,>() =>
    // never-resolve 桩：挂载期请求保持 pending，筛选行为不依赖其结果
    // oxlint-disable-next-line typescript/no-empty-function -- never-resolve pending 桩
    new Promise<T>(() => {});
  return {
    vanillaApi: {
      workflow: { list: { query: vi.fn(() => pending()) } },
      workflowModel: { list: { query: vi.fn(() => pending()) } },
    },
  };
});

const list = [
  { id: "w-local-a", name: "本机甲", sourcePath: "/x", modelTags: ["flux"] },
  { id: "w-local-b", name: "本机乙", sourcePath: "/y", modelTags: ["sdxl"] },
  { id: "w-online", name: "在线丙", sourcePath: null, modelTags: ["flux"] },
];

function props(overrides: Partial<WorkflowNodeProps> = {}): WorkflowNodeProps {
  return {
    id: "n1",
    data: { ...defaultData("workflow"), workflowId: "" },
    workflowIO: null,
    workflowIOLoading: false,
    workflowList: list,
    onFormChange: vi.fn(),
    onGenerate: vi.fn(),
    onModesChange: vi.fn(),
    onPatch: vi.fn(),
    onSeedModeChange: vi.fn(),
    onSelectWorkflow: vi.fn(),
    onSourceFilterChange: vi.fn(),
    ...overrides,
  };
}

describe("WorkflowNode filteredList（useMemo 后行为不变）", () => {
  it("sourceFilter=local 只显示本机工作流，all 显示全部", async () => {
    renderWithFlow(<WorkflowNode {...props()} />);
    await userEvent.click(screen.getByTitle("选择工作流"));
    expect(screen.getByText("本机甲")).toBeInTheDocument();
    expect(screen.getByText("在线丙")).toBeInTheDocument();
  });

  it("sourceFilter=local 与 modelFilter=flux 组合过滤正确", async () => {
    renderWithFlow(<WorkflowNode {...props({ sourceFilter: "local", modelFilter: "flux" })} />);
    await userEvent.click(screen.getByTitle("选择工作流"));
    expect(screen.getByText("本机甲")).toBeInTheDocument();
    expect(screen.queryByText("本机乙")).not.toBeInTheDocument();
    expect(screen.queryByText("在线丙")).not.toBeInTheDocument();
  });
});
