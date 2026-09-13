// @vitest-environment jsdom
/* 工作流库「画布节点」右侧的**对外输出参数卡片列** —— ISSUE #355
 *
 * 用户口径：「红框中的输出端口也要有端口圆点，然后工作流节点右侧需要显示对外
 * 输出参数」。这里钉住两件事：
 *   ① 卡片在**右侧**那一列、圆点骑跨卡片**左**缘（线从宿主输出行进来）；
 *   ② 只读 —— 没有拖拽手势、没有「恢复默认」，输出不参与映射。
 *
 * 像素级几何（圆点是否真的骑跨边缘）在 WorkflowParamWires 的几何用例里量，
 * 这里只断言「有哪些元素、锚点是什么」。 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import type { WorkflowIOEntry } from "~/components/studio/shared/workflow-io";
import { WorkflowOutputParamCardColumn } from "./WorkflowOutputParamCardColumn";
import { wireAnchorValue } from "./WorkflowParamCardColumn";
import { outputWireDotId } from "./workflow-library-param-cards";

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

  it("圆点在卡片**左**缘（线从宿主输出行进来），并带连线锚点", () => {
    const { container } = render(
      <WorkflowOutputParamCardColumn outputs={outputs} />,
    );
    const dot = container.querySelector(
      `[data-wire-anchor="${wireAnchorValue("9::output::IMAGE", "images")}"]`,
    )!;
    expect(dot).toBeTruthy();
    /* 端点槽位在名字与类型**之前**（DOM 顺序 = 视觉顺序，圆点在左）。 */
    const row = screen.getByTestId("param-node-out-9::output::IMAGE-0");
    expect(row.firstElementChild).toBe(dot);
    /* 左侧定位：不是输入卡片的 `right`。 */
    expect(dot.getAttribute("style")).toContain("left:");
  });

  it("只读：不渲染「恢复默认」，也不给拖拽提示", () => {
    const { container } = render(
      <WorkflowOutputParamCardColumn outputs={outputs} />,
    );
    expect(
      screen.queryByTestId("param-node-reset-9::output::IMAGE"),
    ).toBeNull();
    const dot = container.querySelector("[data-wire-anchor]")!;
    expect(dot.getAttribute("title")).toBeNull();
  });

  it("没有输出时整列不渲染", () => {
    const { container } = render(
      <WorkflowOutputParamCardColumn outputs={[]} />,
    );
    expect(container.firstElementChild).toBeNull();
  });

  it("圆点带**只读**标记：拖它不起手（输出不参与映射，拖了也落不下来）", () => {
    /* 此前这颗圆点会起手拖线，而它的圆心在卡片左缘 —— 手势一拖就朝反方向画，
     *  读作「往右拖线却飘向左侧」，且松手什么也不会发生（ISSUE #355）。连线层
     *  按这个属性把它排除在拖拽起手之外。 */
    const { container } = render(
      <WorkflowOutputParamCardColumn outputs={outputs} />,
    );
    const dot = container.querySelector("[data-wire-anchor]")!;
    expect(dot.hasAttribute("data-wire-readonly")).toBe(true);
  });

  it("端口名为空 / 带空白时锚点退回「输出」—— 与连线派生的 handle 同口径", () => {
    /* 锚点值与导线两端各算一遍：任何一处漏了 trim / 兜底，线就量不到锚点、整条
     *  不画（用户口径：「images 和对外输出参数之间无法连线」，ISSUE #355）。 */
    const nameless = [
      { ...outputs[0]!, name: "   ", ioKey: "9::output::EMPTY" },
    ];
    const { container } = render(
      <WorkflowOutputParamCardColumn outputs={nameless} />,
    );
    const dot = container.querySelector("[data-wire-anchor]")!;
    expect(dot.getAttribute("data-wire-anchor")).toBe(
      wireAnchorValue("9::output::EMPTY", outputWireDotId(nameless[0]!)),
    );
    expect(outputWireDotId(nameless[0]!)).toBe("输出");
  });
});
