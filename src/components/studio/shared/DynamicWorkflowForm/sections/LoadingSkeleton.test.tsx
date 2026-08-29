// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { LoadingSkeleton } from "./LoadingSkeleton";

// vitest globals: false 下 RTL 不会自动 cleanup,需手动注册
afterEach(cleanup);

describe("LoadingSkeleton", () => {
  it("渲染 3 组骨架,每组为标题条 + 内容条,共 6 条且全部带 pulse 动画", () => {
    const { container } = render(<LoadingSkeleton />);
    // 源码固定渲染 [0, 1, 2] 三组
    const pulses = container.querySelectorAll(".animate-pulse");
    expect(pulses).toHaveLength(6);
    // 标题条:窄矮的 h-2.5;内容条:整行 h-8
    expect(container.querySelectorAll("div.h-2\\.5")).toHaveLength(3);
    expect(container.querySelectorAll("div.h-8")).toHaveLength(3);
  });
});
