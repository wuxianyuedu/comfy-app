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
import {
  WorkflowParamWires,
  rectInContainer,
  wireScale,
} from "./WorkflowParamWires";
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

/** 钉住元素的**布局**尺寸（jsdom 不做布局，`offsetWidth/Height` 恒为 0）——
 *  缩放换算靠「视觉 rect / 布局尺寸」，测试必须能把布局尺寸桩进去。 */
function layoutSize(el: Element, width: number, height: number) {
  Object.defineProperty(el, "offsetWidth", {
    value: width,
    configurable: true,
  });
  Object.defineProperty(el, "offsetHeight", {
    value: height,
    configurable: true,
  });
}

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
      .querySelector('[data-testid="wflib-param-wire-param:size?megapixels"]')!
      .getAttribute("d")!;
    /* 起点 = 圆点**朝终点的那条外缘**（终点在右侧 → 取圆点右缘 200 + 12 = 212，
       y 取圆心 66）；终点 = 那一行端点的圆心 (488 + 6, 105 + 6) = (494, 111)。
       （此前写死「右缘 + 半颗点」= 218：多算 6px，输出卡片那侧更会把起点算到
       光标的另一侧，读作「线飘向左侧」。） */
    expect(path.startsWith("M 212 66")).toBe(true);
    expect(path.endsWith("494 111")).toBe(true);
  });
});

describe("视口缩放下的连线量测（缩放不改变线的落点）", () => {
  /* 库内画布是可缩放视口（内容层贴 `scale(z)`），而连线层是绝对定位的 SVG、
   *  坐标写在容器自己的坐标系里；`getBoundingClientRect()` 给的却是被祖先
   *  scale 过的屏幕像素。两者混用，缩放不是 100% 时线立刻与圆点错位 —— 用户
   *  口径：「改了缩放，后线的位置错乱」「拖动的线直接飘向左侧」（ISSUE #355）。
   *
   *  算式在 `wireScale`（容器自己的「屏幕尺寸 / 布局尺寸」之比）与
   *  `rectInContainer`（把屏幕 rect 换回容器局部坐标）里，两者都是纯函数，直接
   *  断言；JSX 几何的「量哪两个元素」由本文件上面两条用例覆盖（jsdom 不做布局，
   *  缩放路径在这里用纯函数钉住）。 */
  it("缩放比取自容器自己的「屏幕尺寸 / 布局尺寸」之比", () => {
    const content = document.createElement("div");
    document.body.appendChild(content);
    /* 布局宽 200，视觉宽 400 → 这一层被 CSS 缩放了 2 倍。 */
    content.getBoundingClientRect = () =>
      ({ width: 400, height: 300 }) as DOMRect;
    layoutSize(content, 200, 150);
    expect(wireScale(content)).toBe(2);
    content.remove();
  });

  it("**连线层的容器与其父级都在缩放层之内**：父级之比恒为 1，必须走布局尺寸", () => {
    /* 这是「线飘向左侧」的根因：容器（`relative w-fit`）与它的父级（视口内容层）
     *  同在 `scale(z)` 之内，两个 rect 同比缩放、比值永远是 1 —— 缩放测不出来，
     *  线就按屏幕像素画在局部坐标系里，放大一倍偏一倍。 */
    const frame = document.createElement("div");
    const content = document.createElement("div");
    frame.appendChild(content);
    document.body.appendChild(frame);
    /* 两者都被放大 2 倍：父级 rect 800 / 容器 rect 400 = 2（看上去像 2 倍），
     *  但容器的布局宽是 200 —— 真实缩放是 400 / 200 = 2，而父级之比是
     *  800 / 400 = 2 …… 关键在下面这条：父级与容器同宽时比值恒为 1。 */
    frame.getBoundingClientRect = () =>
      ({ width: 400, height: 300 }) as DOMRect;
    content.getBoundingClientRect = () =>
      ({ width: 400, height: 300 }) as DOMRect;
    layoutSize(content, 200, 150);
    /* 父级与容器同宽（都是被缩放的同一层），父级之比 = 1；真实缩放 = 2。 */
    expect(wireScale(content)).toBe(2);
    frame.remove();
  });

  it("量不到布局尺寸时不假装有缩放（退回 1，不把线画到天边）", () => {
    const content = document.createElement("div");
    document.body.appendChild(content);
    content.getBoundingClientRect = () => ({ width: 0, height: 0 }) as DOMRect;
    layoutSize(content, 0, 0);
    expect(wireScale(content)).toBe(1);
    content.remove();
  });

  it("rect 换算回容器局部坐标：屏幕坐标除以缩放，再减容器屏幕原点", () => {
    const content = document.createElement("div");
    const dot = document.createElement("span");
    content.appendChild(dot);
    document.body.appendChild(content);
    /* 容器屏幕原点 (10, 20)（被平移），布局宽 450、视觉宽 900 → 缩放 2 倍。 */
    content.getBoundingClientRect = () =>
      ({ width: 900, height: 600, left: 10, top: 20 }) as DOMRect;
    layoutSize(content, 450, 300);
    /* 圆点在屏幕上的位置：容器原点 + 局部 (100, 50) × 缩放 2 = (210, 120)。 */
    dot.getBoundingClientRect = () =>
      ({ width: 24, height: 24, left: 210, top: 120 }) as DOMRect;
    const box = rectInContainer(dot, content, wireScale(content));
    expect(box.left).toBe(100);
    expect(box.top).toBe(50);
    expect(box.width).toBe(12);
    expect(box.height).toBe(12);
    content.remove();
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
        <div
          data-port-dot="9::output::IMAGE"
          style={{ position: "absolute" }}
        />
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
        '[data-testid="wflib-param-wire-output:9::output::IMAGE?images"]',
      )!
      .getAttribute("d")!;
    /* 两端各取**朝向对方**的那条外缘：宿主输出行圆点朝右 → 右缘 (400 + 12, 66) =
       (412, 66)；卡片圆点朝左（骑跨卡片左缘）→ 左缘 (700, 100 + 6) = (700, 106)。
       写死「右缘 + 半颗点」会把终点算到圆点右缘的 712 —— 线切进卡片里。 */
    expect(path.startsWith("M 412 66")).toBe(true);
    expect(path.endsWith("700 106")).toBe(true);
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
      container.querySelector(
        '[data-testid="wflib-param-wire-output:9::output::IMAGE?images"]',
      ),
    ).toBeNull();
  });
});
