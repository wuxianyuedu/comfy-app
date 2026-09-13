// @vitest-environment jsdom
/* 画布 / 库内的组合参数控件 —— ISSUE #355 复审
 *
 * 用户在画布节点上要的是**原来那块带下拉的组合控件**，不是摊成逐行参数的清单：
 *   · 「组合参数不要现在这种样式」「改回之前的样式」「改成之前带有下拉菜单的
 *     样式」—— 控件本体照旧画出来（`MultiSegmentPopover` 那一下拉）；
 *   · 「让你减小宽度的也是这个控件」—— 收窄的是**它**，不是把它换掉；
 *   · 红框里那三段（宽高比下拉 / 百万像素步进器 / 倍数步进器）不再摊成独立
 *     参数行。
 *
 * 因此本文件的断言是：紧凑版式里控件**在**（带下拉触发器）、宽度**按内容收窄**、
 * 且不再出现「逐行参数清单」那种形态。
 *
 * 宽版表单（`collapseGrouped={false}`）保留整块录入，本文件不涉及。
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";

import type { EnrichedWidget, WorkflowIOMap } from "./workflow-io";
import { inferGroups } from "./workflow-io";
import { WIRE_PINS_ATTR } from "~/lib/workflow-io-types";
import { GroupedControls } from "./GroupedControls";

afterEach(cleanup);

const io: WorkflowIOMap = {
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
    label: "百万像素",
    type: "FLOAT",
    defaultValue: 1,
  },
  "5::widget::multiple": {
    direction: "input",
    kind: "widget",
    nodeId: "5",
    name: "multiple",
    label: "倍数",
    type: "INT",
    defaultValue: 8,
  },
};

function widgets(): EnrichedWidget[] {
  return Object.entries(io).map(([ioKey, entry]) => ({
    ...entry,
    ioKey,
    control: entry.type === "COMBO" ? "select" : entry.type === "INT" ? "int" : "float",
  }));
}

function renderCompact() {
  const groups = inferGroups(widgets());
  const { container } = render(
    <GroupedControls
      dimension={groups.dimension}
      video={groups.video}
      values={{}}
      onChange={() => undefined}
      compact
      collapseGrouped
    />,
  );
  return container;
}

describe("画布 / 库内的组合参数控件", () => {
  it("组合控件照旧画出来（带下拉菜单），并带落点锚点", () => {
    /* 用户口径：「改回之前的样式」「改成之前带有下拉菜单的样式」—— 控件本体
     *  必须还在，且是那块带下拉的控件（触发器 + 下拉面板）。 */
    const column = renderCompact();
    expect(column.querySelector('[aria-label="选择比例、像素与倍数"]')).toBeTruthy();
    expect(column.querySelector('[aria-haspopup="listbox"]')).toBeTruthy();
    expect(column.querySelector(`[${WIRE_PINS_ATTR}]`)).toBeTruthy();
  });

  it("落点锚点覆盖该控件录入的全部端口（线量得到这一格）", () => {
    const column = renderCompact();
    const anchor = column.querySelector(`[${WIRE_PINS_ATTR}]`)!;
    expect(anchor.getAttribute(WIRE_PINS_ATTR)).toBe(
      "5::widget::aspect_ratio,5::widget::megapixels,5::widget::multiple",
    );
  });

  it("不再摊成逐行参数清单（红框那三段不再各占一行）", () => {
    /* 上一轮把这三个端口摊成了独立参数行 + 一张只报名称/类型的展示卡，用户指着
     *  那份清单说「不要现在这种样式」。现在这三行都不该在。 */
    const column = renderCompact();
    expect(column.querySelector('[data-testid="grouped-collapsed-rows"]')).toBeNull();
    expect(column.querySelector('[data-testid="grouped-card"]')).toBeNull();
    for (const ioKey of Object.keys(io)) {
      expect(
        column.querySelector(`[data-io-key="${ioKey}"]`),
        `${ioKey} 不该再摊成独立参数行`,
      ).toBeNull();
    }
  });

  it("控件按内容收窄，不占满整行", () => {
    /* 「组合控件的宽度缩小，现在占满了空间」：`w-fit` + 上限，宽度跟随内容；
     *  下拉触发器另给一档固定宽度，不再拽满整行。 */
    const column = renderCompact();
    const card = column.querySelector(".w-fit");
    expect(card).toBeTruthy();
    expect(card!.className).toContain("max-w-full");
    const triggerBox = column.querySelector('[aria-label="选择比例、像素与倍数"]')!
      .closest("div.w-\\[168px\\]");
    expect(triggerBox).toBeTruthy();
  });
});
