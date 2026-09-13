// @vitest-environment jsdom
/* 组合卡收窄之后，映射连线的几何仍然落在正确的位置 —— ISSUE #355
 *
 * 「组合卡回来」这件事会动布局：卡片列里多了一块 3 行的卡，宿主卡片里组合卡
 * 与逐行参数上下相邻。线两端都靠**量**（不是固定坐标），因此只要锚点还在、
 * 量出来的就还是对的 —— 这条测试就是钉住这一点：组合卡存在时，线仍从卡片
 * 圆点出发、收在**逐行参数的端点圆心**上，而不是收到上面那块组合卡上。
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
  it("线从卡片圆点出发，收在逐行参数的端点圆点上（不是上方那块组合卡）", async () => {
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
          io={io}
          allPins={widgets}
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
    /* 宿主那一行的端点圆点（终点）—— 它才是「这个口落到哪一行」的事实。 */
    const portDot = root.querySelector('[data-port-dot="5::widget::megapixels"]')!;
    rect(portDot, { left: 494, top: 122, width: 12, height: 12 });
    /* 组合卡整块与那一行**都**在（线不该量到组合卡上）。 */
    const groupedCard = root.querySelector('[data-testid="grouped-card"]')!;
    rect(groupedCard, { left: 300, top: 20, width: 180, height: 70 });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    const path = container
      .querySelector('[data-testid="wflib-param-wire-size"]')!
      .getAttribute("d")!;
    /* 起点 = 圆点外缘 (200 + 12 + 6, 66) = (218, 66)；
       终点 = 端点圆点圆心 (494 + 6, 122 + 6) = (500, 128)。
       组合卡（top 20..90）的底边不会成为终点 —— 线收在行上。 */
    expect(path.startsWith("M 218 66")).toBe(true);
    expect(path.endsWith("500 128")).toBe(true);
  });
});
