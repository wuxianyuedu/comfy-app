// @vitest-environment jsdom
// 连线渲染的关注态：相关连线加粗提亮、无关连线在选中态下压暗、未选中时原样。
//
// 这是用户唯一能看见的东西 —— 判据算得再对，样式没落到 SVG 上也等于没做。
// 断言的是 <path> 的 stroke-width / opacity，也就是肉眼看到的粗细与明暗。

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { EdgeProps, Position } from "@xyflow/react";
import { WorkflowEdge } from "./WorkflowEdge";
import { EDGE_FOCUS_ACTIVE_KEY, EDGE_FOCUS_DATA_KEY } from "./hooks/use-related-edges-highlight";

afterEach(cleanup);

function makeProps(data: Record<string, unknown> | undefined): EdgeProps {
  return {
    id: "e-test",
    source: "1",
    target: "2",
    sourceX: 0,
    sourceY: 0,
    targetX: 200,
    targetY: 0,
    sourcePosition: "right" as Position,
    targetPosition: "left" as Position,
    data,
  };
}

/** 取画出来的两条真实描边：外发光（`{id}-glow`）与前景线（`{id}`）。
 *
 *  画布里还有一条 React Flow 自带的透明「命中区」path（stroke-width 20），
 *  以及 svg 自身的 marker —— 都用 class / id 排除，避免读到它们的尺寸把断言
 *  带偏（第一版就踩了这个坑：拿到的 20 是命中区的宽度）。 */
function wireStyles(data: Record<string, unknown> | undefined) {
  const { container } = render(<WorkflowEdge {...makeProps(data)} />);
  const borders = Array.from(
    container.querySelectorAll("path.react-flow__edge-path"),
  );
  /* 每条描边后面跟着一条同几何的命中区 path（无 style），过滤掉它们。 */
  const painted = borders.filter((path) => path.getAttribute("style") !== null);
  expect(painted.length).toBe(2);
  return painted.map((path) => {
    const style = path.getAttribute("style") ?? "";
    return {
      width: Number(/stroke-width:\s*([\d.]+)/.exec(style)?.[1]),
      opacity: Number(/(?:^|;)\s*opacity:\s*([\d.]+)/.exec(style)?.[1]),
    };
  });
}

describe("WorkflowEdge 选中态样式", () => {
  it("未选中任何节点：默认粗细与不透明度（与改造前一致）", () => {
    const [glow, wire] = wireStyles(undefined);
    expect(wire!.width).toBe(2.5);
    expect(wire!.opacity).toBe(1);
    expect(glow!.opacity).toBe(0.35);
  });

  it("相关连线：加粗到 4px、完全不透明，外发光同步增强", () => {
    const [glow, wire] = wireStyles({ [EDGE_FOCUS_DATA_KEY]: "upstream" });
    expect(wire!.width).toBe(4);
    expect(wire!.opacity).toBe(1);
    expect(glow!.width).toBe(9);
    expect(glow!.opacity).toBe(0.55);
  });

  it("下游连线与上游同样加粗（方向只影响语义，不影响可见性）", () => {
    const [, wire] = wireStyles({ [EDGE_FOCUS_DATA_KEY]: "downstream" });
    expect(wire!.width).toBe(4);
  });

  it("选中态下的无关连线：压暗且略收细，让相关连线跳出来", () => {
    const [glow, wire] = wireStyles({ [EDGE_FOCUS_ACTIVE_KEY]: true });
    expect(wire!.opacity).toBeLessThan(0.6);
    expect(glow!.opacity).toBeLessThan(0.2);
  });

  it("没有选中项时不压暗：只是滚动 / 阅读画布不该让全图发灰", () => {
    const [, wire] = wireStyles({ [EDGE_FOCUS_ACTIVE_KEY]: false });
    expect(wire!.opacity).toBe(1);
  });

  it("related（两端都选中）保持默认粗细 —— 没有单一方向就不该伪造成上下游", () => {
    const [, wire] = wireStyles({ [EDGE_FOCUS_DATA_KEY]: "related" });
    expect(wire!.width).toBe(2.5);
  });

  it("提亮保留色相：IMAGE 线的颜色仍能一眼读出来", () => {
    const { container } = render(
      <WorkflowEdge
        {...makeProps({ [EDGE_FOCUS_DATA_KEY]: "upstream" })}
        style={{ stroke: "#10b981" }}
      />,
    );
    const painted = Array.from(
      container.querySelectorAll("path.react-flow__edge-path"),
    ).filter((path) => path.getAttribute("style") !== null);
    const stroke = painted.at(-1)!.getAttribute("style") ?? "";
    /* 提亮公式把 #10b981 推向白色 —— 亮度升上去，但仍是绿系（G 分量最大），
     * 用户依然能凭颜色读出这条线上流的是 IMAGE。 */
    const rgbPart = /rgb\(([^)]+)\)/.exec(stroke)?.[1];
    expect(rgbPart).toBeTruthy();
    const [r, g, b] = rgbPart!.split(",").map(Number) as [number, number, number];
    expect(g).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(b);
    /* 确实被提亮了：比原色 #10b981（16,185,129）更亮。 */
    expect(g).toBeGreaterThan(185);
  });
});
