// @vitest-environment jsdom
/* 画布节点里的「对外参数映射」回归 —— ISSUE #355
 *
 * 映射跟着节点走：工作流库的画布节点要能看到每个对外参数连到哪个节点端口，
 * 且被映射到的那一行要标出自己属于哪个对外参数。本文件锁定这条只读视图，
 * 运行相关副作用（生成 / SSE / 日志弹窗）同样打桩。 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@/lib/workshop/generation-client", () => ({
  startLocalGenerate: vi.fn().mockResolvedValue("task-1"),
  watchTask: vi.fn(),
}));
vi.mock("@/lib/workflow-run-store", () => {
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
vi.mock("../WorkflowRunLogModal", () => ({ WorkflowRunLogModal: () => null }));

import type { WorkflowIOMap } from "~/components/studio/shared/workflow-io";
import { WorkflowCanvasNodePreview } from "./WorkflowCanvasNodePreview";

afterEach(cleanup);

const io: WorkflowIOMap = {
  "5::widget::aspect_ratio": {
    direction: "input",
    kind: "widget",
    nodeId: "5",
    nodeTitle: "分辨率选择器",
    name: "aspect_ratio",
    label: "宽高比",
    type: "COMBO",
    defaultValue: "1:1",
  },
  "5::widget::megapixels": {
    direction: "input",
    kind: "widget",
    nodeId: "5",
    nodeTitle: "分辨率选择器",
    name: "megapixels",
    label: "百万像素",
    type: "COMBO",
    defaultValue: "1.0",
  },
};

function renderPreview(paramMap: Record<string, unknown> | undefined) {
  return render(
    <WorkflowCanvasNodePreview
      workflowId="wf-1"
      workflowName="测试工作流"
      taskType="t2i"
      workflowIO={io}
      paramMap={paramMap}
      usable
    />
  );
}

describe("WorkflowCanvasNodePreview — 对外参数映射", () => {
  it("列出对外参数并显示默认连线状态", () => {
    renderPreview({});
    expect(screen.getByText("对外参数映射")).toBeTruthy();
    /* 默认（自动映射）：宽高比 → 宽高比、百万像素 → 百万像素。 */
    expect(screen.getAllByText("宽高比").length).toBeGreaterThan(0);
    expect(screen.getAllByText("百万像素").length).toBeGreaterThan(0);
    expect(screen.getAllByText("自动").length).toBe(2);
  });

  it("作者手工改过的线显示目标端口名并标为手工", () => {
    renderPreview({ source: { "5|size-aspect": "5::widget::megapixels" } });
    expect(screen.getByText("手工")).toBeTruthy();
    /* 宽高比这张卡的目标端口变成「百万像素」。 */
    const cards = screen.getAllByText("百万像素");
    expect(cards.length).toBeGreaterThan(0);
  });

  it("显式断开显示「未连线 / 断开」", () => {
    renderPreview({ source: { "5|size-aspect": null } });
    /* 断开的这张卡目标栏写「未连线」，状态徽标写「断开」（两者都只有一处）
     * —— 另一张未受影响的卡仍是「自动」。 */
    expect(screen.getByText("未连线")).toBeTruthy();
    expect(screen.getByText("断开")).toBeTruthy();
    expect(screen.getAllByText("自动").length).toBe(1);
  });

  it("没有对外参数时不渲染整段", () => {
    render(
      <WorkflowCanvasNodePreview
        workflowId="wf-1"
        workflowName="测试工作流"
        taskType="t2i"
        workflowIO={{}}
        usable
      />
    );
    expect(screen.queryByText("对外参数映射")).toBeNull();
  });
});
