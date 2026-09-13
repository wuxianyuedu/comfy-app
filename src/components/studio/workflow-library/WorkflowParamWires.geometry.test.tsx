// @vitest-environment jsdom
/* 组合控件的映射连线几何 —— ISSUE #355
 *
 * 画布 / 库内的组合控件不再摊成逐行参数：它是**一整块**（比例 / 像素 / 倍数由
 * 同一个下拉录入），所以覆盖到的端口在这块控件上共用一个落点锚点，映射线收在
 * 整块控件的矩形上（不是某一行的端点圆点 —— 那些行已经不存在了）。
 *
 * 线两端都靠**量**（不是固定坐标），因此锚点在、量出来的就是对的。这条测试钉住
 * 这一点：线从卡片圆点出发，收在组合控件那一格的边界上。
 *
 * jsdom 不做布局，所以 rect 全部打桩；这里验证的是「量哪两个元素」，不是像素。 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

import type { WorkflowIOMap } from "~/components/studio/shared/workflow-io";
import { inferGroups } from "~/components/studio/shared/workflow-io";
import { buildParamEntries } from "~/lib/workflow-param-mapping";
import { GroupedControls } from "~/components/studio/shared/GroupedControls";
import { WorkflowParamCardColumn } from "./WorkflowParamCardColumn";
import { WorkflowParamWires } from "./WorkflowParamWires";

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  },
);

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

function rect(
  el: Element,
  r: { left: number; top: number; width: number; height: number },
) {
  (el as HTMLElement).getBoundingClientRect = () =>
    ({
      ...r,
      right: r.left + r.width,
      bottom: r.top + r.height,
    }) as DOMRect;
}

describe("组合卡回来之后的连线几何", () => {
  it("线从卡片圆点出发，收在组合控件那一格的左沿（整块是同一格落点）", async () => {
    const widgets = Object.entries(io).map(([ioKey, entry]) => ({
      ...entry,
      ioKey,
      control:
        entry.type === "COMBO"
          ? ("select" as const)
          : entry.type === "INT"
            ? ("int" as const)
            : ("float" as const),
    }));
    const groups = inferGroups(widgets);
    const entries = buildParamEntries(io, undefined, { mode: "T2I" });
    const size = entries.find((entry) => entry.id === "size")!;

    const { container } = render(
      <div>
        <WorkflowParamCardColumn
          entries={entries}
          resolved={{ [size.id]: "5::widget::megapixels" }}
          io={io}
        />
        <GroupedControls
          dimension={groups.dimension}
          video={groups.video}
          values={{}}
          onChange={() => undefined}
          compact
          collapseGrouped
        />
        <WorkflowParamWires
          wires={[
            {
              entryId: size.id,
              targetIoKey: "5::widget::megapixels",
              handleId: "megapixels",
              grouped: false,
              manual: false,
            },
          ]}
        />
      </div>,
    );

    const root = container.firstElementChild!;
    rect(root, { left: 0, top: 0, width: 0, height: 0 });
    /* 卡片那颗圆点（起点）。 */
    const dot = root.querySelector('[data-wire-anchor="size?megapixels"]')!;
    rect(dot, { left: 200, top: 60, width: 12, height: 12 });
    /* 组合控件那一格（终点）：比例/像素/倍数由同一块控件录入，映射线落在这块
     *  控件上 —— 量的是它的矩形，线收在它左沿中线。 */
    const anchor = root.querySelector("[data-io-pins]")!;
    rect(anchor, { left: 494, top: 100, width: 180, height: 70 });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    const path = container
      .querySelector('[data-testid="wflib-param-wire-size"]')!
      .getAttribute("d")!;
    /* 起点 = 圆点外缘 (200 + 12 + 6, 66) = (218, 66)；
       终点 = 组合控件左沿中线 (494, 100 + 70 / 2) = (494, 135)。 */
    expect(path.startsWith("M 218 66")).toBe(true);
    expect(path.endsWith("494 135")).toBe(true);
  });
});
