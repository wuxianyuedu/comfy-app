// @vitest-environment jsdom
/* 默认值刷新（保覆盖）回归 —— ISSUE #288
 *
 * 场景：在 IO 编辑里改了某个参数的默认值并保存，回到工作流库的「画布样式
 * 预览」后，未被用户动过的参数要显示新默认值，用户已经改过的参数保持原值。
 *
 * 本文件只覆盖这一条数据流（IO 变化 → 表单值），故把运行相关的副作用
 * （生成 / SSE / 日志弹窗）与外部模块打桩，避免在 jsdom 里真发请求。 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/workshop/generation-client", () => ({
  startLocalGenerate: vi.fn().mockResolvedValue("task-1"),
  watchTask: vi.fn(),
}));
vi.mock("@/lib/workflow-run-store", () => {
  /* 快照必须引用稳定：每次返回新对象会让 useSyncExternalStore 判定「一直在
   * 变」，触发无限重渲染（"Maximum update depth exceeded"）。 */
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
import { buildParamEntries } from "~/lib/workflow-param-mapping";
import { WorkflowCanvasNodePreview } from "./WorkflowCanvasNodePreview";

/* 预览卡片现在挂在 React Flow 画布上（ISSUE #355），React Flow 挂载时会自行
 * 测量容器尺寸 —— jsdom 没有 ResizeObserver，需要这个桩。 */
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  }
);

afterEach(cleanup);

/** steps=20 / cfg=7 两个 widget 参数。 */
function ioWith(steps: number, cfg: number): WorkflowIOMap {
  return {
    "7::widget::steps": {
      direction: "input",
      kind: "widget",
      nodeId: "7",
      name: "steps",
      label: "步数",
      type: "INT",
      defaultValue: steps,
    },
    "7::widget::cfg": {
      direction: "input",
      kind: "widget",
      nodeId: "7",
      name: "cfg",
      label: "引导系数",
      type: "FLOAT",
      defaultValue: cfg,
    },
  };
}

function renderPreview(io: WorkflowIOMap) {
  return render(
    <WorkflowCanvasNodePreview
      workflowId="wf-1"
      workflowName="测试工作流"
      taskType="t2i"
      workflowIO={io}
      usable
    />,
  );
}

/** 表单行没有 <label> 关联，按渲染顺序取两个数值输入框（步数 → 引导系数）。 */
function inputs(): HTMLInputElement[] {
  return screen.getAllByRole<HTMLInputElement>("textbox");
}
const stepsInput = () => inputs()[0]!;
const cfgInput = () => inputs()[1]!;

describe("WorkflowCanvasNodePreview — 默认值刷新", () => {
  it("初次挂载按默认值播种", () => {
    renderPreview(ioWith(20, 7));
    expect(stepsInput().value).toBe("20");
    expect(cfgInput().value).toBe("7.0");
  });

  it("IO 默认值变化时，未覆盖的参数刷新、已覆盖的保持", async () => {
    const { rerender } = renderPreview(ioWith(20, 7));
    expect(stepsInput().value).toBe("20");

    /* 用户把 steps 改成 8 —— 这是一次覆盖。走 userEvent 而非直接写
     * input.value：React 19 会跟踪 value setter，裸写 DOM 不会触发 onChange，
     * state 不更新，后面的断言就会拿到假的「已覆盖」。 */
    await userEvent.clear(stepsInput());
    await userEvent.type(stepsInput(), "8");
    expect(stepsInput().value).toBe("8");

    /* 作者在 IO 编辑里把 steps 默认改成 30、cfg 默认改成 9 并保存。 */
    rerender(
      <WorkflowCanvasNodePreview
        workflowId="wf-1"
        workflowName="测试工作流"
        taskType="t2i"
        workflowIO={ioWith(30, 9)}
        usable
      />,
    );

    expect(stepsInput().value).toBe("8"); // 已覆盖 → 保持用户的值
    expect(cfgInput().value).toBe("9.0"); // 未覆盖 → 跟随新默认值
  });

  it("换工作流时整表重播（不做保覆盖比较）", async () => {
    const { rerender } = renderPreview(ioWith(20, 7));
    await userEvent.clear(stepsInput());
    await userEvent.type(stepsInput(), "8");
    expect(stepsInput().value).toBe("8");
    /* NumberField 聚焦期间用本地 draft 回显（保证能顺畅打字），外部值变化
     * 会被 draft 挡住，直到 blur 提交。用户改完点别处就是这个时序。 */
    await userEvent.tab();

    rerender(
      <WorkflowCanvasNodePreview
        workflowId="wf-2"
        workflowName="另一个工作流"
        taskType="t2i"
        workflowIO={ioWith(50, 3)}
        usable
      />,
    );
    expect(stepsInput().value).toBe("50");
    expect(cfgInput().value).toBe("3.0");
  });
});


/* ── 对外参数卡片列 + 行尾归属徽标（ISSUE #355）──
 *
 * 库里要看得见「对外参数」，且它与宿主卡片的表单行不重复表达同一件事：
 *   卡片列 = 这个对外参数由哪些端口组成；
 *   表单行尾徽标 = 这一行属于哪个对外参数。
 * 两者都从同一份 paramMap（`source.mode:<模式>`）派生。 */
describe("WorkflowCanvasNodePreview — 对外参数卡片列", () => {
  it("有对外参数时并排渲染只读卡片列，卡片头是参数名", () => {
    const { container } = render(
      <WorkflowCanvasNodePreview
        workflowId="wf-1"
        workflowName="测试工作流"
        taskType="t2i"
        workflowIO={ioWith(20, 7)}
        paramMap={{}}
        usable
      />,
    );
    expect(container.querySelector('[data-testid="workflow-param-card-column"]')).toBeTruthy();
  });

  it("被对外参数落到的那一行，行尾标出它属于哪个对外参数", () => {
    const { container } = render(
      <WorkflowCanvasNodePreview
        workflowId="wf-1"
        workflowName="测试工作流"
        taskType="t2i"
        workflowIO={ioWith(20, 7)}
        paramMap={{}}
        usable
      />,
    );
    /* steps 与 cfg 是同一个节点上的两个口 —— 按「节点 + 分类」聚合成**一个**
     * 对外参数「步数」，自动判定落到 steps 那一行；因此有且只有那一行带徽标。 */
    const tags = [...container.querySelectorAll('[data-testid="wflib-param-owner"]')];
    expect(tags.map((tag) => tag.textContent)).toEqual(["步数"]);
  });

  it("作者显式断开的那一条不再标徽标", () => {
    const stepsEntry = buildParamEntries(ioWith(20, 7)).find(
      (entry) => entry.label === "步数",
    )!;
    const { container } = render(
      <WorkflowCanvasNodePreview
        workflowId="wf-1"
        workflowName="测试工作流"
        taskType="t2i"
        workflowIO={ioWith(20, 7)}
        paramMap={{ source: { "mode:t2i": { [stepsEntry.id]: null } } }}
        usable
        defaultMode="t2i"
      />,
    );
    expect(container.querySelectorAll('[data-testid="wflib-param-owner"]').length).toBe(0);
  });

  it("没有对外参数时不渲染卡片列（空 IO）", () => {
    const { container } = render(
      <WorkflowCanvasNodePreview
        workflowId="wf-1"
        workflowName="测试工作流"
        taskType="t2i"
        workflowIO={{}}
        paramMap={{}}
        usable
      />,
    );
    expect(container.querySelector('[data-testid="workflow-param-card-column"]')).toBeNull();
  });
});
