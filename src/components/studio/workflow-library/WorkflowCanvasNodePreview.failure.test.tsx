/* 工作流库画布预览的失败态 UX 回归。
 *
 * 用户两条口径：
 *   · 「实际使用」页签执行失败后，按钮要能再次点击重新执行；
 *   · 「编辑对外参数」页签是配置界面，不应展示上一次运行的执行错误。
 *
 * 这里把运行相关的副作用（生成 / SSE / 日志弹窗）打桩，用 startLocalGenerate
 * 抛错来模拟失败终态，再断言失败态在两种视图模式下的展示与清除行为。 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/* 模式契约注册表（工坊封装 / 画布节点共读的那一份）打桩。 */
vi.mock("~/components/workshop/mode-contract/hooks/use-mode-contracts", () => ({
  useModeContracts: () => ({ contracts: [], loading: false, save: vi.fn() }),
}));
vi.mock("~/lib/workshop/generation-client", () => ({
  startLocalGenerate: vi.fn().mockRejectedValue(new Error("工作流校验未通过")),
  watchTask: vi.fn(),
}));
vi.mock("~/lib/workflow/workflow-run-store", () => {
  const snapshot = { runs: [] };
  return {
    appendWorkflowRunLog: vi.fn(),
    getWorkflowRunStoreSnapshot: () => snapshot,
    latestRunForWorkflow: () => null,
    patchWorkflowRun: vi.fn(),
    registerWorkflowRun: vi.fn(),
    subscribeWorkflowRunStore: () => () => undefined,
  };
});

import type { WorkflowIOMap } from "~/components/studio/workflow-io";
import { WorkflowCanvasNodePreview } from "./WorkflowCanvasNodePreview";

/* 预览卡片挂在 React Flow 画布上，jsdom 里没有 ResizeObserver。 */
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  },
);

afterEach(cleanup);

/** 只有一个可改数值参数的工作流：运行失败后用户改它，失败态应被清空。 */
const io: WorkflowIOMap = {
  "7::widget::steps": {
    direction: "input",
    kind: "widget",
    nodeId: "7",
    name: "steps",
    label: "步数",
    type: "INT",
    defaultValue: 20,
  },
};

function renderPreview(viewMode: "edit" | "use" = "use") {
  const onPatch = vi.fn();
  const view = render(
    <WorkflowCanvasNodePreview
      workflowId="wf-1"
      workflowName="测试工作流"
      taskType="t2i"
      workflowIO={io}
      paramMap={{}}
      usable
      defaultMode="T2I"
      viewMode={viewMode}
      onPatchParamMap={onPatch}
    />,
  );
  return { ...view, onPatch };
}

/** 表单行没有 <label> 关联，按渲染顺序取第一个数值输入框。 */
function stepsInput(): HTMLInputElement {
  return screen.getAllByRole<HTMLInputElement>("textbox")[0]!;
}

describe("WorkflowCanvasNodePreview — 失败态 UX", () => {
  it("实际使用页签运行失败后显示错误提示", async () => {
    renderPreview("use");
    const runBtn = screen.getByRole("button", { name: /用此工作流生成/ });
    await userEvent.click(runBtn);

    expect(screen.getByText(/工作流校验未通过/)).toBeInTheDocument();
  });

  it("编辑对外参数页签不显示执行错误，也不显示失败状态", async () => {
    const { rerender } = renderPreview("use");
    const runBtn = screen.getByRole("button", { name: /用此工作流生成/ });
    await userEvent.click(runBtn);
    expect(screen.getByText(/工作流校验未通过/)).toBeInTheDocument();

    rerender(
      <WorkflowCanvasNodePreview
        workflowId="wf-1"
        workflowName="测试工作流"
        taskType="t2i"
        workflowIO={io}
        paramMap={{}}
        usable
        defaultMode="T2I"
        viewMode="edit"
        onPatchParamMap={vi.fn()}
      />,
    );

    expect(screen.queryByText(/工作流校验未通过/)).not.toBeInTheDocument();
    expect(screen.queryByText("失败")).not.toBeInTheDocument();
  });

  it("修改输入值后失败态清空，按钮可再次点击", async () => {
    renderPreview("use");
    const runBtn = screen.getByRole("button", { name: /用此工作流生成/ });
    await userEvent.click(runBtn);
    expect(screen.getByText(/工作流校验未通过/)).toBeInTheDocument();
    /* 失败后按钮应保持可点击，方便用户直接再次执行（不需要先切页签刷新）。 */
    expect(runBtn).not.toBeDisabled();

    await userEvent.clear(stepsInput());
    await userEvent.type(stepsInput(), "30");
    /* NumberField 用本地 draft 回显，按 tab 提交到外部 onChange 才会触发
     * 失败态清空。 */
    await userEvent.tab();

    /* 用户改输入后，失败提示自动清空，按钮仍保持可点击。 */
    expect(screen.queryByText(/工作流校验未通过/)).not.toBeInTheDocument();
    expect(runBtn).not.toBeDisabled();
  });
});
