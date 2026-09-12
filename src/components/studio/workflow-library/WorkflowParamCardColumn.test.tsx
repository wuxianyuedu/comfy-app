// @vitest-environment jsdom
/* 工作流库「画布节点」的只读对外参数卡片列 + 宿主卡片行尾徽标 —— ISSUE #355
 *
 * 库里要看得见「对外参数」，但它不是画布节点：卡片列与宿主卡片并排，卡片说
 * 「这个对外参数由哪些端口组成」，表单行尾的徽标说「这一行属于哪个对外参数」。
 * jsdom 里只断言两处的「有无」与文案，不断言像素。 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import type { WorkflowIOMap } from "~/components/studio/shared/workflow-io";
import {
  buildParamEntries,
  autoMapEntries,
} from "~/lib/workflow-param-mapping";
import { WorkflowParamCardColumn } from "./WorkflowParamCardColumn";
import { ParamOwnerTag } from "./ParamOwnerTag";

afterEach(cleanup);

const io: WorkflowIOMap = {
  "9::widget::text": {
    direction: "input",
    kind: "widget",
    nodeId: "9",
    nodeTitle: "Text to Image",
    name: "positive_prompt",
    label: "提示词",
    type: "STRING",
    defaultValue: "3只小猫在喝山泉，一张足够长的描述词用于判定为提示词口",
  },
  "5::widget::height": {
    direction: "input",
    kind: "widget",
    nodeId: "5",
    nodeTitle: "分辨率选择器",
    name: "height",
    label: "高度",
    type: "INT",
    defaultValue: 1024,
  },
};

const entries = buildParamEntries(io);

describe("WorkflowParamCardColumn", () => {
  it("每个对外参数一张卡片，卡片头是它的名字", () => {
    const { container } = render(
      <WorkflowParamCardColumn
        entries={entries}
        resolved={autoMapEntries(entries, io)}
        io={io}
      />,
    );
    for (const entry of entries) {
      expect(
        container.querySelector(`[data-testid="param-node-${entry.id}"]`),
      ).toBeTruthy();
    }
    expect(screen.getByText("提示词")).toBeTruthy();
    expect(screen.getByText("高度")).toBeTruthy();
  });

  it("端口行只列端口本身，落点不再在行尾重复一遍（ISSUE #355 复审）", () => {
    /* 用户圈出「红框内那段没用」：行尾的「→ 落点」与下面那行带类型的输出端口
     * 说的是同一件事（那一行已经写出落点名，还贴着端点圆点）。单端口条目因此
     * 不再在行尾重复标注 —— 只留端口自己的类型。 */
    const { container } = render(
      <WorkflowParamCardColumn
        entries={entries}
        resolved={autoMapEntries(entries, io)}
        io={io}
      />,
    );
    const promptCard = entries.find((entry) => entry.cls === "prompt")!;
    const card = container.querySelector(
      `[data-testid="param-node-${promptCard.id}"]`,
    )!;
    expect(card.textContent).not.toContain("→ positive_prompt");
    /* 落点名走在带类型的输出端口那一行（贴着端点）。 */
    expect(
      screen.getByTestId(`param-node-out-${promptCard.id}-0`).textContent,
    ).toContain("positive_prompt");
  });

  it("多端口条目仍在端口行尾标落点（多行之间要能区分）", () => {
    const { container } = render(
      <WorkflowParamCardColumn
        entries={entries}
        resolved={autoMapEntries(entries, io)}
        io={io}
      />,
    );
    /* 只有「尺寸」是同一个落点覆盖多个候选端口的口子；它把落点标在行尾。 */
    const sizeCard = entries.find((entry) => entry.cls === "size-height")!;
    expect(sizeCard.pins.length).toBe(1);
    const card = container.querySelector(
      `[data-testid="param-node-${sizeCard.id}"]`,
    )!;
    expect(card.textContent).toContain("height");
  });

  it("卡片带**有类型**的输出端口（提示词 → STRING）—— ISSUE #355 复审", () => {
    render(
      <WorkflowParamCardColumn
        entries={entries}
        resolved={autoMapEntries(entries, io)}
        io={io}
      />,
    );
    const promptCard = entries.find((entry) => entry.cls === "prompt")!;
    expect(
      screen.getByTestId(`param-node-out-type-${promptCard.id}-0`).textContent,
    ).toBe("STRING");
    const heightCard = entries.find((entry) => entry.cls === "size-height")!;
    expect(
      screen.getByTestId(`param-node-out-type-${heightCard.id}-0`).textContent,
    ).toBe("INT");
  });

  it("每张卡片右侧有一颗小圆点端口（可与宿主卡片上的参数相连）", () => {
    /* ISSUE #355 复审：卡片右侧此前是无属性的圆点甚至没有圆点，作者看不出
     * 「这个口能和节点上的哪一行连」。现在圆点画在**带类型的输出端口**那一行
     * 的右沿，并带 `data-wire-anchor` 供连线层量出锚点。 */
    const { container } = render(
      <WorkflowParamCardColumn
        entries={entries}
        resolved={autoMapEntries(entries, io)}
        io={io}
      />,
    );
    const promptCard = entries.find((entry) => entry.cls === "prompt")!;
    const dot = container.querySelector(
      `[data-wire-anchor="${promptCard.id}"]`,
    );
    expect(dot).toBeTruthy();
    /* 圆点必须落在输出端口行内（行是 absolute 的锚），而不是卡片上随便一处。 */
    const outputRow = screen.getByTestId(`param-node-out-${promptCard.id}-0`);
    expect(outputRow.contains(dot)).toBe(true);
  });

  it("一个对外参数只有一颗圆点 —— 未连线时列出的候选行不给点", () => {
    /* 未连线时输出端口行会逐个列出候选（尺寸 = 宽/高/宽高比/像素量），那几行
     * 说的是「能接到哪些类型」，不是多个出口。给每行都画点 = 凭空多出端点。 */
    const { container } = render(
      <WorkflowParamCardColumn entries={entries} resolved={{}} io={io} />,
    );
    const sizeCard = entries.find((entry) => entry.cls === "size-height")!;
    const dots = container.querySelectorAll(
      `[data-wire-anchor="${sizeCard.id}"]`,
    );
    expect(dots).toHaveLength(1);
  });

  it("库里没有对外参数时不渲染卡片列", () => {
    const { container } = render(
      <WorkflowParamCardColumn entries={[]} resolved={{}} io={io} />,
    );
    expect(
      container.querySelector('[data-testid="workflow-param-card-column"]'),
    ).toBeNull();
  });
});

describe("ParamOwnerTag", () => {
  it("有归属时标出对外参数名", () => {
    render(<ParamOwnerTag label="提示词" />);
    expect(screen.getByTestId("wflib-param-owner").textContent).toBe("提示词");
  });

  it("没有归属时不渲染任何东西", () => {
    const { container } = render(<ParamOwnerTag />);
    expect(
      container.querySelector('[data-testid="wflib-param-owner"]'),
    ).toBeNull();
  });
});
