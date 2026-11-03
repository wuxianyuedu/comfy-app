/* 工作流库画布预览结果图展示规则：「实际使用」成功后展示结果图，「编辑对外
 * 参数」配置页签不展示上一次结果图。通过恢复已完成运行记录注入 URL 后断言显隐。 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

/* 模式契约注册表打桩。 */
vi.mock("~/components/workshop/mode-contract/hooks/use-mode-contracts", () => ({
  useModeContracts: () => ({ contracts: [], loading: false, save: vi.fn() }),
}));

/* 模拟最近一次运行已完成并带结果图，用于验证恢复路径下的显隐规则。
 * `getWorkflowRunStoreSnapshot` 必须返回稳定引用，否则 `useSyncExternalStore`
 *  订阅者会无限重渲染。 */
const mockSnapshot = { runs: [] };
const mockDoneRun = {
  taskId: "task-done",
  workflowId: "wf-1",
  workflowName: "测试工作流",
  taskType: "t2i",
  startedAt: 1,
  source: "canvas-node",
  /* SAFETY: 类型断言已复核 */
  status: "done" as const,
  resultUrl: "blob://fake-result.png",
};
vi.mock("~/lib/workflow/workflow-run-store", () => ({
  appendWorkflowRunLog: vi.fn(),
  getWorkflowRunStoreSnapshot: () => mockSnapshot,
  latestRunForWorkflow: () => mockDoneRun,
  patchWorkflowRun: vi.fn(),
  registerWorkflowRun: vi.fn(),
  subscribeWorkflowRunStore: () => () => undefined,
  failWorkflowRun: vi.fn(),
}));

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

/** 只有一个可改数值参数的工作流。 */
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

function renderPreview(viewMode: "edit" | "use") {
  return render(
    <WorkflowCanvasNodePreview
      defaultMode="T2I"
      onPatchParamMap={vi.fn()}
      paramMap={{}}
      taskType="t2i"
      usable
      viewMode={viewMode}
      workflowId="wf-1"
      workflowIO={io}
      workflowName="测试工作流"
    />,
  );
}

describe("WorkflowCanvasNodePreview — 运行结果图显隐", () => {
  it("实际使用页签展示最近一次运行的结果图", () => {
    renderPreview("use");
    expect(screen.getByText("运行结果")).toBeInTheDocument();
  });

  it("编辑对外参数页签不展示最近一次运行的结果图", () => {
    renderPreview("edit");
    expect(screen.queryByText("运行结果")).not.toBeInTheDocument();
  });
});
