// @vitest-environment jsdom
/* 工作流库「画布节点」预览的只读映射连线 —— ISSUE #355 复审
 *
 * 卡片右侧的圆点端口与宿主卡片上被落到的那一行之间要画一条线，否则圆点只是
 * 一颗装饰点（作者答不出「提示词这个口连到哪一行」）。线是量出来的：卡片高度
 * 随端口行数变化、宿主行高度随控件类型变化，只有量出来的才对得上。
 *
 * jsdom 不做布局（`getBoundingClientRect` 全 0），所以这里给锚点打桩来测
 * `measureWires` 的几何规则，而不是断言真实像素。 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

import {
  WorkflowParamWires,
  measureWires,
  type ParamWire,
} from "./WorkflowParamWires";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** 造一个容器 + 两个锚点，锚点的 rect 由调用方给出。 */
function makeContainer(
  box: { left: number; top: number },
  from: { left: number; top: number; width: number; height: number },
  to: { left: number; top: number; width: number; height: number },
) {
  const container = document.createElement("div");
  const dot = document.createElement("span");
  dot.setAttribute("data-wire-anchor", "prompt?9::widget::text");
  const row = document.createElement("div");
  row.setAttribute("data-io-key", "9::widget::text");
  container.append(dot, row);
  container.getBoundingClientRect = () =>
    ({ left: box.left, top: box.top, width: 0, height: 0 }) as DOMRect;
  dot.getBoundingClientRect = () =>
    ({
      ...from,
      right: from.left + from.width,
      bottom: from.top + from.height,
    }) as DOMRect;
  row.getBoundingClientRect = () =>
    ({
      ...to,
      right: to.left + to.width,
      bottom: to.top + to.height,
    }) as DOMRect;
  return container;
}

const wire: ParamWire = {
  entryId: "prompt",
  targetIoKey: "9::widget::text",
  handleId: "9::widget::text",
  grouped: false,
  manual: false,
};

describe("measureWires", () => {
  it("起点是圆点**外侧边缘**、终点是宿主行左沿中心（相对容器）", () => {
    const container = makeContainer(
      { left: 100, top: 50 },
      { left: 200, top: 70, width: 8, height: 12 },
      { left: 400, top: 120, width: 300, height: 40 },
    );
    const [segment] = measureWires(container, [wire]);
    /* 容器原点 (100, 50)。圆点锚点（left 200, top 70, 8 宽 12 高）的**外侧
     * 边缘**相对容器 = (100 + 8 + 4, 26) = (112, 26)（与画布上 React Flow 的
     * 连线口径一致：线从端点外缘出发，不切进卡片）；宿主行（left 400, top 120,
     * 40 高）左沿中心 = (300, 90)。 */
    expect(segment!.d.startsWith("M 112 26")).toBe(true);
    expect(segment!.d.endsWith("300 90")).toBe(true);
  });

  it("端口键含 `::` 也量得到（不做选择器转义）", () => {
    /* 端口名本身可能带分隔符，ioKey 里因此会有 `::`。此前用选择器拼字符串
     * 匹配，遇到这类键要么语法出错、要么匹配到别的元素 —— 表现是「线不画」。 */
    const container = makeContainer(
      { left: 0, top: 0 },
      { left: 100, top: 10, width: 12, height: 12 },
      { left: 300, top: 40, width: 200, height: 20 },
    );
    container.querySelector('[data-io-key="9::widget::text"]')!
      .setAttribute("data-io-key", "1::widget::a::b");
    const [segment] = measureWires(container, [
      { ...wire, targetIoKey: "1::widget::a::b" },
    ]);
    expect(segment).toBeTruthy();
    expect(segment!.d.endsWith("300 50")).toBe(true);
  });

  it("终点落在宿主行**端点圆点的圆心**上（不是整行的左沿中线）", () => {
    /* 折叠成逐行参数之后一行是「标签行 + 控件行」两段结构，圆点锁在标签行中线；
     * 按整行 50% 量会把线画到圆心下方十几像素处 —— 用户看到的正是「线没有连接
     * 到端点上」（ISSUE #355）。 */
    const container = document.createElement("div");
    const dot = document.createElement("span");
    dot.setAttribute("data-wire-anchor", "prompt?9::widget::text");
    const portDot = document.createElement("span");
    portDot.setAttribute("data-port-dot", "9::widget::text");
    const row = document.createElement("div");
    row.setAttribute("data-io-key", "9::widget::text");
    container.append(dot, portDot, row);
    container.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 0, height: 0 }) as DOMRect;
    dot.getBoundingClientRect = () =>
      ({ left: 100, top: 10, width: 12, height: 12 }) as DOMRect;
    /* 整行很高（标签 + 控件），而其圆心（圆点）在上方。 */
    row.getBoundingClientRect = () =>
      ({ left: 300, top: 40, width: 240, height: 80 }) as DOMRect;
    portDot.getBoundingClientRect = () =>
      ({ left: 294, top: 42, width: 12, height: 12 }) as DOMRect;
    const [segment] = measureWires(container, [wire]);
    /* 终点 = 圆点圆心 (294 + 6, 42 + 6) = (300, 48)，不是整行中线 (300, 80)。 */
    expect(segment!.d.endsWith("300 48")).toBe(true);
  });

  it("任一端不在就整条不画（不留悬空线头）", () => {
    const container = document.createElement("div");
    const dot = document.createElement("span");
    dot.setAttribute("data-wire-anchor", "prompt?9::widget::text");
    container.append(dot);
    expect(measureWires(container, [wire])).toEqual([]);
  });

  it("卡片与宿主行重叠（间距为负）也不画出反向的控制点", () => {
    const container = makeContainer(
      { left: 0, top: 0 },
      { left: 300, top: 0, width: 8, height: 12 },
      { left: 200, top: 0, width: 100, height: 20 },
    );
    const [segment] = measureWires(container, [wire]);
    /* 终点在起点左侧时，控制点仍按间距的一半（绝对值）外扩，线是平滑的 S 形
     * 而不是被负半径拗出的尖角。起点 = 圆点锚点 (300, 0, 8 宽) 的外缘 312。 */
    expect(segment!.d).toBe("M 312 6 C 368 6 144 10 200 10");
  });

  it("组合参数（宽/高、比例/像素）的落点锚在整块控件上", () => {
    /* 这类口子由同一个控件录入，没有独立的一行可以连 —— 只认 `data-io-key`
     * 就会整条线都不画，「尺寸」这张卡看起来就没连上。 */
    const container = document.createElement("div");
    const dot = document.createElement("span");
    dot.setAttribute("data-wire-anchor", "size?5::widget::height");
    const group = document.createElement("div");
    group.setAttribute("data-io-pins", "5::widget::width,5::widget::height");
    container.append(dot, group);
    container.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 0, height: 0 }) as DOMRect;
    dot.getBoundingClientRect = () =>
      ({ left: 100, top: 10, width: 12, height: 12 }) as DOMRect;
    group.getBoundingClientRect = () =>
      ({ left: 300, top: 40, width: 200, height: 60 }) as DOMRect;
    const [segment] = measureWires(container, [
      {
        entryId: "size",
        targetIoKey: "5::widget::height",
        handleId: "5::widget::height",
        grouped: true,
        manual: false,
      },
    ]);
    expect(segment).toBeTruthy();
    expect(segment!.d.endsWith("300 70")).toBe(true);
  });

  it("量不到任何线时整层不渲染", () => {
    const { container } = render(<WorkflowParamWires wires={[]} />);
    expect(
      container.querySelector('[data-testid="wflib-param-wires"]'),
    ).toBeNull();
  });
});
