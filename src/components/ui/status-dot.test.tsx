// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { StatusDot, type StatusDotState } from "./status-dot";

afterEach(cleanup);

/**
 * 状态圆点的判据（ISSUE #672 / 规范 16 §16.2.4）。
 *
 * 三件事必须钉住，否则「收口」会退回去：
 *   ① 四态齐全 —— 漏一态时调用方只能自己写三元，重复立刻长回来；
 *   ② 颜色走语义 token，不落 Tailwind 原生调色板（原先三处各写
 *      `bg-emerald-400` / `bg-amber-400` / `bg-rose-400`）；
 *   ③ `pulse` 只在传的时候出现（`animate-pulse` 是 P3 判据的计数对象）。
 */
const STATES: StatusDotState[] = ["up", "busy", "probing", "down"];

function dotOf(props: Parameters<typeof StatusDot>[0]): HTMLElement {
  const { container } = render(<StatusDot {...props} />);
  const el = container.querySelector("[data-slot=status-dot]");
  if (!el) throw new Error("StatusDot 未渲染出 data-slot=status-dot 的元素");
  return el as HTMLElement;
}

describe("StatusDot", () => {
  it.for(STATES)("state=%s 渲染出圆点", (state) => {
    expect(dotOf({ state }).className).toContain("rounded-full");
  });

  it.for(STATES)("state=%s 的颜色是语义 token 类名", (state) => {
    expect(dotOf({ state }).className).toMatch(
      /\bbg-(success|warning|info|destructive)\b/,
    );
  });

  it.for(STATES)("state=%s 不落 Tailwind 原生调色板字面量", (state) => {
    expect(dotOf({ state }).className).not.toMatch(
      /\bbg-(?:violet|red|rose|emerald|amber|cyan|sky|fuchsia|purple|green|blue)-\d/,
    );
  });

  it("四态的颜色互不相同（否则状态不可分辨）", () => {
    const colors = STATES.map(
      (state) => /\bbg-\S+/.exec(dotOf({ state }).className)?.[0] ?? "",
    );
    expect(new Set(colors).size).toBe(STATES.length);
  });

  it("缺省不带脉冲，pulse 才加 animate-pulse", () => {
    expect(dotOf({ state: "up" }).className).not.toContain("animate-pulse");
    expect(dotOf({ state: "up", pulse: true }).className).toContain(
      "animate-pulse",
    );
  });

  it("尺寸类可覆盖（状态行 size-2 / 行内 size-1.5）", () => {
    expect(dotOf({ state: "up" }).className).toContain("size-2");
    expect(dotOf({ state: "up", sizeClass: "size-1.5" }).className).toContain(
      "size-1.5",
    );
  });
});
