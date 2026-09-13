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
import { wireAnchorValue } from "./WorkflowParamCardColumn";

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
  it("线从卡片圆点出发，收在组合控件覆盖的那一行自己的圆点上", async () => {
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
    /* 组合控件覆盖的那一行（终点）：比例/像素/倍数在画布上是各自成行的参数行
     *  （框外的左侧），各带自己的大端点 —— 线收在这一行端点的**圆心**上。 */
    const row = root.querySelector<HTMLElement>(
      '[data-io-key="5::widget::megapixels"]',
    )!;
    rect(row, { left: 494, top: 100, width: 180, height: 22 });
    const rowDot = row.querySelector(
      '[data-port-dot="5::widget::megapixels"]',
    )!;
    rect(rowDot, { left: 488, top: 105, width: 12, height: 12 });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    /* 线按「条目 + 被接的端口」取 id：一个对外参数默认可以一对多（尺寸 =
     *  三个端口各一条线），只用条目 id 会让三条线共用同一个 testid。 */
    const path = container
      .querySelector('[data-testid="wflib-param-wire-size?megapixels"]')!
      .getAttribute("d")!;
    /* 起点 = 圆点外缘 (200 + 12 + 6, 66) = (218, 66)；
       终点 = 那一行端点的圆心 (488 + 12 / 2, 105 + 12 / 2) = (494, 111)。 */
    expect(path.startsWith("M 218 66")).toBe(true);
    expect(path.endsWith("494 111")).toBe(true);
  });
});

describe("对外输出参数的连线几何", () => {
  it("线从宿主输出行的圆点出发，收在右侧输出卡片的圆点上", async () => {
    /* 输出侧方向相反：起点是**宿主卡片输出行的圆点**（`data-port-dot`），终点是
     *  **对外输出卡片上的圆点**（`data-wire-anchor`，骑跨卡片左缘）。两处共用
     *  同一套量测（起点取圆点外缘、终点取圆心），不会一边收在圆心上、一边停在
     *  行边。 */
    const { container } = render(
      <div>
        <div data-port-dot="9::output::IMAGE" style={{ position: "absolute" }} />
        <span
          data-wire-anchor={wireAnchorValue("9::output::IMAGE", "images")}
          style={{ position: "absolute" }}
        />
        <WorkflowParamWires
          wires={[
            {
              entryId: "9::output::IMAGE",
              targetIoKey: "9::output::IMAGE",
              handleId: "images",
              grouped: false,
              manual: false,
              kind: "hostToParam",
            },
          ]}
        />
      </div>,
    );
    const root = container.firstElementChild!;
    rect(root, { left: 0, top: 0, width: 0, height: 0 });
    rect(root.querySelector('[data-port-dot="9::output::IMAGE"]')!, {
      left: 400,
      top: 60,
      width: 12,
      height: 12,
    });
    rect(root.querySelector("[data-wire-anchor]")!, {
      left: 700,
      top: 100,
      width: 12,
      height: 12,
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const path = container
      .querySelector(
        '[data-testid="wflib-param-wire-9::output::IMAGE?images"]',
      )!
      .getAttribute("d")!;
    /* 起点 = 输出行圆点的外缘 (400 + 12 + 6, 66) = (418, 66)；
       终点 = 卡片圆点的圆心 (700 + 6, 100 + 6) = (706, 106)。 */
    expect(path.startsWith("M 418 66")).toBe(true);
    expect(path.endsWith("706 106")).toBe(true);
  });

  it("两端缺一个就不画线（输出行或卡片列没渲染时不留悬空线头）", async () => {
    const { container } = render(
      <div>
        <span
          data-wire-anchor={wireAnchorValue("9::output::IMAGE", "images")}
          style={{ position: "absolute" }}
        />
        <WorkflowParamWires
          wires={[
            {
              entryId: "9::output::IMAGE",
              targetIoKey: "9::output::IMAGE",
              handleId: "images",
              grouped: false,
              manual: false,
              kind: "hostToParam",
            },
          ]}
        />
      </div>,
    );
    const root = container.firstElementChild!;
    rect(root, { left: 0, top: 0, width: 0, height: 0 });
    rect(root.querySelector("[data-wire-anchor]")!, {
      left: 700,
      top: 100,
      width: 12,
      height: 12,
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(
      container.querySelector('[data-testid="wflib-param-wire-9::output::IMAGE?images"]'),
    ).toBeNull();
  });
});
