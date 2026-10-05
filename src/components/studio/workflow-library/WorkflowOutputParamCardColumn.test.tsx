/* 工作流库「画布节点」右侧的**对外输出参数卡片列** —— ISSUE #355
 *
 * 用户口径：「红框中的输出端口也要有端口圆点，然后工作流节点右侧需要显示对外
 * 输出参数」。这里钉住三件事：
 *   ① 卡片在**右侧**那一列、圆点骑跨卡片**左**缘（线从宿主输出行进来）；
 *   ② 线上显示的取值行由 `resolved` 给（默认 = 该输出自己那一行）；
 *   ③ **可拖**（ISSUE #355 复审：「需要可拖」）—— 有模式 + 给了落库回调时圆点
 *      带拖拽提示与「恢复默认」；只读消费方（没给回调）时两样都不出现。
 *
 * 端点几何由 `PortHandle`（消费方注入）负责，这里只断言「有哪些元素、
 * 端点槽位挂在哪一行、handle id 是什么」。 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import type { WorkflowIOEntry } from "~/components/studio/workflow-io";
import { WorkflowOutputParamCardColumn } from "./WorkflowOutputParamCardColumn";
import { outputPortLabel } from "./workflow-library-param-cards";

/* vitest globals: false 下 RTL 不会自动 cleanup，需手动注册。 */
afterEach(cleanup);

const outputs: (WorkflowIOEntry & { ioKey: string })[] = [
  {
    direction: "output",
    kind: "output",
    nodeId: "9",
    name: "images",
    label: "images",
    type: "IMAGE",
    ioKey: "9::output::IMAGE",
  },
];

describe("WorkflowOutputParamCardColumn", () => {
  it("每个对外输出一张卡片，卡片体是该端口的名字与类型", () => {
    const { container } = render(
      <WorkflowOutputParamCardColumn outputs={outputs} />,
    );
    expect(screen.getByTestId("workflow-output-param-column")).toBeTruthy();
    const card = container.querySelector(
      '[data-testid="param-node-9::output::IMAGE"]',
    )!;
    expect(card).toBeTruthy();
    expect(card.textContent).toContain("images");
    expect(
      screen.getByTestId("param-node-out-type-9::output::IMAGE-0").textContent,
    ).toBe("IMAGE");
  });

  it("卡片头不把端口名再抄一遍（作者没改名时退回类别名）", () => {
    /* 卡片头写「images」、卡片体又写「images IMAGE」= 同一句话两处各说一遍
     *  —— 这是用户反复圈出来的毛病（「红框内那段没用，之前就让去掉了」）。
     *  作者改了名（label ≠ name）才用作者的名字当标题。 */
    const { container } = render(
      <WorkflowOutputParamCardColumn outputs={outputs} />,
    );
    const card = container.querySelector(
      '[data-testid="param-node-9::output::IMAGE"]',
    )!;
    const header = card.firstElementChild!;
    expect(header.textContent).toContain("输出");
    expect(header.textContent).not.toContain("images");
  });

  it("作者改过名的输出用作者的名字当标题", () => {
    const renamed = [{ ...outputs[0]!, label: "生成图" }];
    render(<WorkflowOutputParamCardColumn outputs={renamed} />);
    expect(screen.getByText("生成图")).toBeTruthy();
  });

  it("端点在卡片**左**缘（线从宿主输出行进来），handle id 是输出的 ioKey", () => {
    const { container } = render(
      <WorkflowOutputParamCardColumn
        outputs={outputs}
        endpoint={(port) => (
          <span
            data-testid="probe-endpoint"
            data-endpoint-handle={port.handleId}
          />
        )}
      />,
    );
    const dot = container.querySelector(
      '[data-endpoint-handle="9::output::IMAGE"]',
    )!;
    expect(dot).toBeTruthy();
    /* 端点槽位在名字与类型**之前**（DOM 顺序 = 视觉顺序，圆点在左）。 */
    const row = screen.getByTestId("param-node-out-9::output::IMAGE-0");
    expect(row.firstElementChild).toBe(dot);
  });

  it("只读消费（没给落库回调）：不渲染「恢复默认」，也不给拖拽提示", () => {
    const { container } = render(
      <WorkflowOutputParamCardColumn outputs={outputs} />,
    );
    expect(
      screen.queryByTestId("param-node-reset-9::output::IMAGE"),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="probe-endpoint"]'),
    ).toBeNull();
  });

  it("可拖 + 作者改过：端点槽位在，「恢复默认」可用", () => {
    render(
      <WorkflowOutputParamCardColumn
        outputs={outputs}
        resolved={{ "9::output::IMAGE": "9::output::IMAGE" }}
        canWire
        isManual={() => true}
        onReset={() => undefined}
        endpoint={(port) => <span data-endpoint-handle={port.handleId} />}
      />,
    );
    expect(
      screen
        .getByTestId("param-node-reset-9::output::IMAGE")
        .hasAttribute("disabled"),
    ).toBe(false);
  });

  it("没改过时「恢复默认」不可用（点了不会有变化）", () => {
    render(
      <WorkflowOutputParamCardColumn
        outputs={outputs}
        canWire
        isManual={() => false}
        onReset={() => undefined}
      />,
    );
    expect(
      screen
        .getByTestId("param-node-reset-9::output::IMAGE")
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  it("没有输出时整列不渲染", () => {
    const { container } = render(
      <WorkflowOutputParamCardColumn outputs={[]} />,
    );
    expect(container.firstElementChild).toBeNull();
  });

  it("可拖：上层给了注入端点时槽位就在（方向由 handle 自己声明）", () => {
    /* 方向的合法性不再由自绘手势层的 `data-wire-kind` 表达，而是 handle 自身的
     *  source / target 类型 —— 由 `WorkflowLibraryCanvasNodes` 注入（ISSUE #529）。 */
    const { container } = render(
      <WorkflowOutputParamCardColumn
        outputs={outputs}
        canWire
        endpoint={(port) => <span data-endpoint-handle={port.handleId} />}
      />,
    );
    expect(
      container.querySelector('[data-endpoint-handle="9::output::IMAGE"]'),
    ).toBeTruthy();
  });

  it("端口名为空 / 带空白时**显示名**退回「输出」，锚点仍是输出的 ioKey", () => {
    /* 显示名与锚点是两件事：名字可以是空 / 带空白（作者没给 name 的旧数据），
     *  锚点必须是唯一的 ioKey —— 用名字当锚点会在两个口同名时撞车，线量不到
     *  handleBounds 就整条不画（用户口径：「images 和对外输出参数之间无法连线」，
     *  ISSUE #355）。 */
    const nameless = [
      { ...outputs[0]!, name: "   ", ioKey: "9::output::EMPTY" },
    ];
    const { container } = render(
      <WorkflowOutputParamCardColumn
        outputs={nameless}
        endpoint={(port) => <span data-endpoint-handle={port.handleId} />}
      />,
    );
    const dot = container.querySelector("[data-endpoint-handle]")!;
    expect(dot.getAttribute("data-endpoint-handle")).toBe("9::output::EMPTY");
    expect(outputPortLabel(nameless[0]!)).toBe("输出");
    expect(
      screen.getByTestId("param-node-out-9::output::EMPTY-0").textContent,
    ).toContain("输出");
  });
});
