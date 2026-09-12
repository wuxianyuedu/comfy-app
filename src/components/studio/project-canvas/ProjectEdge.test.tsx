// @vitest-environment jsdom
// 项目画布连线渲染的关注态：与工作流编辑器同一套判据，但样式走渐变 + brightness。
//
// 两处画布的边渲染器是分开的（前景曲线算法不同：一个 R 角回折、一个直角圆角），
// 但「选中节点的相关连线要加粗提亮、无关连线要压暗」这条观感必须一致 —— 这个
// 用例就是钉住这一致性的地方。

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { EdgeProps } from "@xyflow/react";
import { ProjectEdge } from "./ProjectEdge";
import { EDGE_FOCUS_ACTIVE_KEY, EDGE_FOCUS_DATA_KEY } from "../canvas/hooks/use-related-edges-highlight";

afterEach(cleanup);

/** 项目画布的连线是渐变描边，样式里带 `filter` 提亮。 */
const GRADIENT_STROKE = "url(#canvas-edge-gradient)";

function makeProps(data: Record<string, unknown> | undefined): EdgeProps {
  return {
    id: "pe-test",
    source: "1",
    target: "2",
    sourceX: 0,
    sourceY: 0,
    targetX: 200,
    targetY: 0,
    sourcePosition: "right",
    targetPosition: "left",
    data,
    style: { stroke: GRADIENT_STROKE, strokeWidth: 2.5 },
  } as unknown as EdgeProps;
}

function wireStyle(data: Record<string, unknown> | undefined) {
  const { container } = render(<ProjectEdge {...makeProps(data)} />);
  const painted = Array.from(
    container.querySelectorAll("path.react-flow__edge-path"),
  ).filter((path) => path.getAttribute("style") !== null);
  expect(painted.length).toBe(1);
  const style = painted[0]!.getAttribute("style") ?? "";
  return {
    style,
    width: Number(/stroke-width:\s*([\d.]+)/.exec(style)?.[1]),
    opacity: Number(/(?:^|;)\s*opacity:\s*([\d.]+)/.exec(style)?.[1] ?? "1"),
  };
}

describe("ProjectEdge 选中态样式", () => {
  it("未选中任何节点：保持画布默认的 2.5px 满不透明渐变", () => {
    const { width, opacity, style } = wireStyle(undefined);
    expect(width).toBe(2.5);
    expect(opacity).toBe(1);
    /* 描边仍是那层渐变（React 会把 url(#x) 序列化成带引号的形式）。 */
    expect(style).toMatch(/stroke:\s*url\(["']?#canvas-edge-gradient["']?\)/);
    expect(style).not.toContain("brightness");
  });

  it("相关连线：加粗到 4px 并提亮，渐变本身不被替换", () => {
    const { width, opacity, style } = wireStyle({ [EDGE_FOCUS_DATA_KEY]: "upstream" });
    expect(width).toBe(4);
    expect(opacity).toBe(1);
    /* 提亮走 filter（对渐变同样生效），而不是换成平面色 —— 画布的品牌观感
     * 与「线在流动」的视觉语义都靠这层渐变承载。 */
    expect(style).toContain("brightness");
    expect(style).not.toContain("#ffffff");
  });

  it("选中态下的无关连线：压暗到 0.3，不再抢视线", () => {
    const { opacity, style } = wireStyle({ [EDGE_FOCUS_ACTIVE_KEY]: true });
    expect(opacity).toBeLessThan(0.5);
    expect(style).not.toContain("brightness");
  });

  it("没有选中项时不压暗：全图保持原样", () => {
    const { opacity } = wireStyle({ [EDGE_FOCUS_ACTIVE_KEY]: false });
    expect(opacity).toBe(1);
  });
});
