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
  dot.setAttribute("data-wire-anchor", "prompt");
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
  manual: false,
};

describe("measureWires", () => {
  it("起点是圆点右沿中心、终点是宿主行左沿中心（相对容器）", () => {
    const container = makeContainer(
      { left: 100, top: 50 },
      { left: 200, top: 70, width: 8, height: 12 },
      { left: 400, top: 120, width: 300, height: 40 },
    );
    const [segment] = measureWires(container, [wire]);
    /* 容器原点 (100, 50)。圆点（left 200, top 70, 8 宽 12 高）圆心相对容器
     * = (104, 26)；宿主行（left 400, top 120, 40 高）左沿中心 = (300, 90)。 */
    expect(segment!.d.startsWith("M 104 26")).toBe(true);
    expect(segment!.d.endsWith("300 90")).toBe(true);
  });

  it("任一端不在就整条不画（不留悬空线头）", () => {
    const container = document.createElement("div");
    const dot = document.createElement("span");
    dot.setAttribute("data-wire-anchor", "prompt");
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
     * 而不是被负半径拗出的尖角。 */
    expect(segment!.d).toBe("M 304 6 C 356 6 148 10 200 10");
  });

  it("量不到任何线时整层不渲染", () => {
    const { container } = render(<WorkflowParamWires wires={[]} />);
    expect(
      container.querySelector('[data-testid="wflib-param-wires"]'),
    ).toBeNull();
  });
});
