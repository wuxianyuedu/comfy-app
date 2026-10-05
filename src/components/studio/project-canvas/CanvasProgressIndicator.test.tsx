import { describe, expect, it } from "vitest";

import {
  CanvasProgressIndicator,
  stageProgressPct,
} from "./CanvasProgressIndicator";

// 单测在纯函数（stageProgressPct）与纯展示组件上，render 由 testing-library。

describe("stageProgressPct", () => {
  it("rendered=true 恒满格", () => {
    expect(stageProgressPct({ stage: "script", rendered: true })).toBe(100);
  });

  it("未合成时按阶段序递增；末段 render 记满", () => {
    const script = stageProgressPct({ stage: "script", rendered: false });
    const shots = stageProgressPct({ stage: "shots", rendered: false });
    const render = stageProgressPct({ stage: "render", rendered: false });
    expect(script).toBeGreaterThan(0);
    expect(shots).toBeGreaterThan(script);
    expect(shots).toBeLessThan(100);
    expect(render).toBe(100);
  });
});

describe("CanvasProgressIndicator", () => {
  it("渲染进度条与文案", async () => {
    const { render } = await import("@testing-library/react");
    const { getByRole } = render(
      <CanvasProgressIndicator
        progress={{ stage: "storyboard", rendered: false }}
      />,
    );
    expect(getByRole("progressbar")).toBeTruthy();
  });
});
