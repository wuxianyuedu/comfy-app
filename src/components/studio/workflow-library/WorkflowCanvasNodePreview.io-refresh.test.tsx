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
 *   卡片列 = 这个模式统一对外暴露的参数（提示词 / 尺寸…，与具体工作流无关）；
 *   表单行尾徽标 = 这一行属于哪个对外参数。
 * 两者都从同一份 paramMap（`source.mode:<模式>`）派生。 */

/** 一个「文生图」形状的工作流：提示词口 + 宽高比口。 */
function promptSizeIO(): WorkflowIOMap {
  return {
    "9::widget::positive_prompt": {
      direction: "input",
      kind: "widget",
      nodeId: "9",
      name: "positive_prompt",
      type: "STRING",
      defaultValue: "一只猫在喝山泉的完整描述词，足够长到被判定成提示词口",
    },
    /* 只有「宽高比」一个口 —— 成对的宽/高会被并成同一个控件（组合参数），
     * 没有独立的一行可以标徽标；这里刻意用单口形状测行尾徽标。 */
    "5::widget::aspect_ratio": {
      direction: "input",
      kind: "widget",
      nodeId: "5",
      name: "aspect_ratio",
      label: "宽高比",
      type: "COMBO",
      defaultValue: "16:9",
    },
  };
}

describe("WorkflowCanvasNodePreview — 对外参数卡片列", () => {
  it("卡片头是契约里的统一参数名（提示词 / 尺寸），不是工作流里的端口名", () => {
    const { container } = render(
      <WorkflowCanvasNodePreview
        workflowId="wf-1"
        workflowName="测试工作流"
        taskType="t2i"
        workflowIO={promptSizeIO()}
        paramMap={{}}
        usable
        defaultMode="T2I"
      />,
    );
    expect(container.querySelector('[data-testid="workflow-param-card-column"]')).toBeTruthy();
    expect(screen.getByTestId("param-node-prompt")).toBeTruthy();
    expect(screen.getByTestId("param-node-size")).toBeTruthy();
    /* 工作流内部参数（步数 / CFG…）不再是「对外参数」——契约里没有它们。 */
    expect(screen.queryByTestId("param-node-other")).toBeNull();
  });

  it("节点上已经选了模式时，卡片不再提示「需要选择模式」", () => {
    const { container } = render(
      <WorkflowCanvasNodePreview
        workflowId="wf-1"
        workflowName="测试工作流"
        taskType="I2V"
        workflowIO={promptSizeIO()}
        paramMap={{}}
        usable
        modes={["T2V", "I2V"]}
        defaultMode="I2V"
      />,
    );
    expect(container.textContent).not.toContain("先选模式才能连线");
  });

  it("被对外参数落到的那一行，行尾标出它属于哪个对外参数", () => {
    const { container } = render(
      <WorkflowCanvasNodePreview
        workflowId="wf-1"
        workflowName="测试工作流"
        taskType="t2i"
        workflowIO={promptSizeIO()}
        paramMap={{}}
        usable
        defaultMode="T2I"
      />,
    );
    /* 提示词落到 positive_prompt、尺寸落到宽高比那一行 —— 两行各带一次徽标。 */
    const tags = [...container.querySelectorAll('[data-testid="wflib-param-owner"]')];
    expect(tags.map((tag) => tag.textContent).sort()).toEqual(["尺寸", "提示词"]);
  });

  it("作者显式断开的那一条不再标徽标", () => {
    const promptEntry = buildParamEntries(promptSizeIO(), undefined, {
      mode: "T2I",
    }).find((entry) => entry.id === "prompt")!;
    const { container } = render(
      <WorkflowCanvasNodePreview
        workflowId="wf-1"
        workflowName="测试工作流"
        taskType="t2i"
        workflowIO={promptSizeIO()}
        paramMap={{ source: { "mode:T2I": { [promptEntry.id]: null } } }}
        usable
        defaultMode="T2I"
      />,
    );
    const tags = [...container.querySelectorAll('[data-testid="wflib-param-owner"]')];
    expect(tags.map((tag) => tag.textContent)).toEqual(["尺寸"]);
  });

  it("每张卡片右侧有圆点端口，宿主行是它的连线锚点（ISSUE #355 复审）", () => {
    /* 「对外参数需要右侧有小圆点的端口，可和工作流节点上的参数相连」——
     * 圆点画在卡片的输出端口行上，宿主表单行则是线另一端（`data-io-key`）。 */
    const { container } = render(
      <WorkflowCanvasNodePreview
        workflowId="wf-1"
        workflowName="测试工作流"
        taskType="t2i"
        workflowIO={promptSizeIO()}
        paramMap={{}}
        usable
        defaultMode="T2I"
      />,
    );
    expect(container.querySelector('[data-wire-anchor="prompt"]')).toBeTruthy();
    expect(container.querySelector('[data-wire-anchor="size"]')).toBeTruthy();
    /* 宿主卡片的两行都在（连线另一端量得到）。 */
    expect(
      container.querySelector('[data-io-key="9::widget::positive_prompt"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-io-key="5::widget::aspect_ratio"]'),
    ).toBeTruthy();
  });

  it("组合参数（宽高 / 比例像素）的行也带落点锚点", () => {
    /* 这类口子由同一个控件录入，没有独立的一行可以连 —— 锚点必须挂在整块控件
     *  上，否则映射连线量不到落点，整条线都不画（看起来就是「尺寸这张卡没连」）。 */
    const { container } = render(
      <WorkflowCanvasNodePreview
        workflowId="wf-1"
        workflowName="测试工作流"
        taskType="t2i"
        workflowIO={{
          "5::widget::aspect_ratio": {
            direction: "input",
            kind: "widget",
            nodeId: "5",
            name: "aspect_ratio",
            label: "宽高比",
            type: "COMBO",
            defaultValue: "16:9",
          },
          "5::widget::megapixels": {
            direction: "input",
            kind: "widget",
            nodeId: "5",
            name: "megapixels",
            label: "像素量",
            type: "FLOAT",
            defaultValue: 1,
          },
        }}
        paramMap={{}}
        usable
        defaultMode="T2I"
      />,
    );
    const group = container.querySelector(
      '[data-io-pins*="5::widget::aspect_ratio"]',
    );
    expect(group).toBeTruthy();
    expect(group!.getAttribute("data-io-pins")).toContain("5::widget::megapixels");
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
