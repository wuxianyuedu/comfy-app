// @vitest-environment jsdom
/* 工作流库「画布节点」的只读对外参数卡片列 + 宿主卡片行尾徽标 —— ISSUE #355
 *
 * 库里要看得见「对外参数」，但它不是画布节点：卡片列与宿主卡片并排，卡片说
 * 「这个对外参数由哪些端口组成」，表单行尾的徽标说「这一行属于哪个对外参数」。
 * jsdom 里只断言两处的「有无」与文案，不断言像素。 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import type { WorkflowIOMap } from "~/components/studio/shared/workflow-io";
import { buildParamEntries, autoMapEntries } from "~/lib/workflow-param-mapping";
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
      expect(container.querySelector(`[data-testid="param-node-${entry.id}"]`)).toBeTruthy();
    }
    expect(screen.getByText("提示词")).toBeTruthy();
    expect(screen.getByText("高度")).toBeTruthy();
  });

  it("端口行在卡片里，单端口条目还在行尾标出落点那一行", () => {
    const { container } = render(
      <WorkflowParamCardColumn
        entries={entries}
        resolved={autoMapEntries(entries, io)}
        io={io}
      />,
    );
    const promptCard = entries.find((entry) => entry.cls === "prompt")!;
    const card = container.querySelector(`[data-testid="param-node-${promptCard.id}"]`)!;
    expect(card.textContent).toContain("positive_prompt");
    expect(card.textContent).toContain("→ positive_prompt");
  });

  it("没有对外参数时不渲染卡片列", () => {
    const { container } = render(
      <WorkflowParamCardColumn entries={[]} resolved={{}} io={io} />,
    );
    expect(container.querySelector('[data-testid="workflow-param-card-column"]')).toBeNull();
  });
});

describe("ParamOwnerTag", () => {
  it("有归属时标出对外参数名", () => {
    render(<ParamOwnerTag label="提示词" />);
    expect(screen.getByTestId("wflib-param-owner").textContent).toBe("提示词");
  });

  it("没有归属时不渲染任何东西", () => {
    const { container } = render(<ParamOwnerTag />);
    expect(container.querySelector('[data-testid="wflib-param-owner"]')).toBeNull();
  });
});
