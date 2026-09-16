// @vitest-environment jsdom
/* 画布 / 库内的组合参数控件 —— ISSUE #355 复审（第二轮）
 *
 * 用户口径（逐条对照）：
 *   · 「组合参数不要现在这种样式」「改回之前的样式」「改成之前带有下拉菜单的
 *     样式」—— 控件本体照旧画出来（`MultiSegmentPopover` 那一下拉），宽度按内容
 *     收窄的是**它**；
 *   · 「红框部分对齐到右侧，左侧留出的区域放置那三个参数，三个参数要到框外」
 *     —— 组合框整块右对齐，宽高比 / 百万像素 / 倍数以**真正的参数行**形式摆在
 *     框外的左侧区域；
 *   · 「参数左侧的圆点要和其他参数一致……实际上用的端点还是要那种大的」——
 *     这三行左侧是 12px 的大端点（`PortHandle`，与节点上其他输入行同款），
 *     不是框里那排「· 小点 + 名字」。
 *
 * 因此本文件的断言是：紧凑版式里控件**在**（带下拉触发器）、框**右对齐**、
 * 三个参数**在框外各自成行且带大端点**。
 *
 * 宽版表单（`collapseGrouped={false}`）保留整块录入，本文件不涉及。
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";

import type { EnrichedWidget, WorkflowIOMap } from "./workflow-io";
import { inferGroups } from "./workflow-io";
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
    control:
      entry.type === "COMBO"
        ? "select"
        : entry.type === "INT"
          ? "int"
          : "float",
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
  it("组合控件照旧画出来（带下拉菜单）", () => {
    /* 用户口径：「改回之前的样式」「改成之前带有下拉菜单的样式」—— 控件本体
     *  必须还在，且是那块带下拉的控件（触发器 + 下拉面板）。 */
    const column = renderCompact();
    expect(
      column.querySelector('[aria-label="选择比例、像素与倍数"]'),
    ).toBeTruthy();
    expect(column.querySelector('[aria-haspopup="listbox"]')).toBeTruthy();
  });

  it("三个参数摆在组合框**外**，各自成行且带大端点", () => {
    /* 「三个参数要到框外」「参数左侧的圆点要和其他参数一致……端点还是要那种大的」：
     *  宽高比 / 百万像素 / 倍数 各占一行、各带 12px 的 PortHandle 端点（与节点上
     *  其他输入行同款），且**不在**组合框里面（框里只剩表头与下拉）。 */
    const column = renderCompact();
    for (const ioKey of Object.keys(io)) {
      const row = column.querySelector(`[data-io-key="${ioKey}"]`);
      expect(row, `${ioKey} 应当以参数行形态出现在框外`).toBeTruthy();
      /* 行外层的组合框（带圆角的边框那一块）不能是它的祖先。 */
      expect(row!.closest("[data-grouped-box]")).toBeNull();
      const dot = row!.querySelector(`[data-port-dot="${ioKey}"]`);
      expect(dot, `${ioKey} 行左侧应当有大端点`).toBeTruthy();
      expect((dot as HTMLElement).style.width).toBe("12px");
      expect((dot as HTMLElement).style.height).toBe("12px");
    }
  });

  it("组合框整块右对齐，且框内不再重复列这三个参数", () => {
    /* 「红框部分对齐到右侧」：外层的 flex 用 `justify-end` 把框推向右沿；
     *  三个参数既已在框外成行，框里不再重复列一遍名称。 */
    const column = renderCompact();
    const outer = column.querySelector(".flex.justify-end");
    expect(outer).toBeTruthy();
    const box = column.querySelector("[data-grouped-box]");
    expect(box).toBeTruthy();
    /* 框在右、参数行在左：框是外层的第二个子元素。 */
    expect(outer!.lastElementChild).toBe(box);
    expect(box!.textContent).toContain("比例 + 像素");
    /* 框里不再有「· 小点 + 参数名」那排清单（参数已挪到框外成行）。 */
    expect(box!.querySelector("ul")).toBeNull();
    for (const ioKey of Object.keys(io)) {
      expect(box!.querySelector(`[data-io-key="${ioKey}"]`)).toBeNull();
      expect(box!.querySelector(`[data-port-dot="${ioKey}"]`)).toBeNull();
    }
  });

  it("端点圆点与参数名之间留出与节点上其他行同款的间隙", () => {
    /* 「端口圆点和参数名字之间距离太近」（ISSUE #355）：这三行此前是 `pl-[2px]`，
     *  而端点 12px、圆心骑跨卡片左缘（-6）—— 圆点右沿正压在文字起点上，名字被
     *  圆点盖住。节点上其他参数行的左内边距是 14px（`WidgetInputRow` 的
     *  `px-[14px]`），这里必须同款，圆点与名字之间才留得出 8px 的空隙。 */
    const column = renderCompact();
    for (const ioKey of Object.keys(io)) {
      const row = column.querySelector(`[data-io-key="${ioKey}"]`)!;
      expect(row.className, `${ioKey} 行左内边距应与其他参数行一致`).toContain(
        "pl-[14px]",
      );
    }
  });

  it("控件按内容收窄，不占满整行", () => {
    /* 「组合控件的宽度缩小，现在占满了空间」：`w-fit` + 上限，宽度跟随内容；
     *  下拉触发器另给一档固定宽度，不再拽满整行。 */
    const column = renderCompact();
    const box = column.querySelector("[data-grouped-box]");
    expect(box).toBeTruthy();
    expect(box!.className).toContain("w-fit");
    expect(box!.className).toContain("max-w-full");
    const triggerBox = column
      .querySelector('[aria-label="选择比例、像素与倍数"]')!
      .closest("div.w-\\[168px\\]");
    expect(triggerBox).toBeTruthy();
  });
});
