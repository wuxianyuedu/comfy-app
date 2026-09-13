// @vitest-environment jsdom
/* 画布 / 库内收窄后的组合参数卡 —— ISSUE #355 复审
 *
 * 用户三条要求在这里同时成立：
 *   ① 「组合控件要显示出来」—— 那块卡还在（不是被整块换成逐行列表）；
 *   ② 「组合控件的宽度缩小……不要显示可编辑参数值部分，就只要这三项
 *      · 宽高比 COMBO / · 百万像素 COMBO / · 倍数 INT」—— 卡内逐行只报
 *      名称 + 类型，值由下面的逐行参数各自录入（同一件事不说两遍）；
 *   ③ 「需要将这几个参数的输入端口显示出来」—— 每个端口在下面各占一行、
 *      各有可连的输入端点与落点锚点。
 *
 * 宽版表单（`collapseGrouped={false}`）保留完整录入能力，本文件不涉及。
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
      io={io}
      allPins={widgets()}
    />,
  );
  return container;
}

describe("画布 / 库内的组合参数卡", () => {
  it("组合卡仍然画出来，且带落点锚点（线量得到这一格）", () => {
    const column = renderCompact();
    const card = column.querySelector('[data-testid="grouped-card"]');
    expect(card).toBeTruthy();
    expect(card!.getAttribute(WIRE_PINS_ATTR)).toBe(
      "5::widget::aspect_ratio,5::widget::megapixels,5::widget::multiple",
    );
  });

  it("卡内三项各一行，只报「名称 + 类型」", () => {
    /* 用户给的就是这个形状：「· 宽高比 COMBO / · 百万像素 COMBO / · 倍数 INT」。 */
    const column = renderCompact();
    const items = [...column.querySelectorAll("[data-grouped-item]")];
    expect(items.map((item) => item.getAttribute("data-grouped-item"))).toEqual([
      "5::widget::aspect_ratio",
      "5::widget::megapixels",
      "5::widget::multiple",
    ]);
    expect(items[0]!.textContent).toBe("·宽高比COMBO");
    expect(items[1]!.textContent).toBe("·百万像素FLOAT");
    expect(items[2]!.textContent).toBe("·倍数INT");
  });

  it("卡里不再出现可编辑的控件（值只在逐行参数上出现一次）", () => {
    /* 卡内若还摊一份可编辑控件，同一件事就有两处录入入口，用户圈出来的「占满
     *  空间」也正是那块控件造成的。 */
    const column = renderCompact();
    const card = column.querySelector('[data-testid="grouped-card"]')!;
    expect(card.querySelector("input")).toBeNull();
    expect(card.querySelector("button")).toBeNull();
  });

  it("每个端口在下面各占一行、各有可连端点与落点锚点", () => {
    /* 「需要将这几个参数的输入端口显示出来」：折叠成逐行参数之后，每一行都是
     *  一个可连的落点（`data-port-dot` 是端点，`data-io-pins` 是落点锚点）。 */
    const column = renderCompact();
    for (const ioKey of Object.keys(io)) {
      expect(
        column.querySelector(`[data-port-dot="${ioKey}"]`),
        `${ioKey} 的输入端点应露出来`,
      ).toBeTruthy();
      expect(
        column.querySelector(`[data-io-pins="${ioKey}"]`),
        `${ioKey} 的落点锚点应露出来`,
      ).toBeTruthy();
    }
  });

  it("组合卡按内容收窄，不占满整行", () => {
    /* 「组合控件的宽度缩小，现在占满了空间」：`w-fit` + 上限，宽度跟随内容。 */
    const column = renderCompact();
    const card = column.querySelector('[data-testid="grouped-card"]')!;
    /* `w-fit` 让宽度跟随内容；上限只是护栏（长名字不撑破卡片列）。 */
    expect(card.className).toContain("w-fit");
    expect(card.className).toContain("max-w-full");
  });
});
