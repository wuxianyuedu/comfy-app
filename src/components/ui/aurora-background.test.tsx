// @vitest-environment jsdom
/* 为何**不**用 DOM 档默认的 happy-dom（本档例外，规范 §11.17）：本档断言行内 style 里的
 * `color-mix()`，而 happy-dom 的 CSSOM 不认识它，赋给 `style.background` 时整条声明被丢掉
 * （实测读回空串）；jsdom 原样保留该函数（不做 CSS 值合法性校验）。这是断言值**保真度**差异，
 * 不是组件行为差异。 */
/**
 * `AuroraGlow` 色相映射回归（规范 03 §3.6.1.1「拼接 token 名」判据的配套用例）：组件刚由 `var(--color-aurora-${tone})` 改成「整名 → 字面量」表，表化唯一可能引入的新错是抄错色相（运行时字符串仍合法）。
 * 「有没有拼名字」不由本用例守，由 `scripts/check-theme-colors.cjs` 静态判据守（Tailwind v4 按**字面名**决定是否保留 `@theme` 变量，拼出来的名字连编译产物都进不去）。
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";

import { AuroraGlow } from "./aurora-background";

afterEach(cleanup);

/** 取渲染出的内联 background（jsdom 会原样序列化 `color-mix()`，实测不丢值）。 */
function glowBackground(tone: "violet" | "cyan" | "magenta", alpha: number) {
  const { container } = render(<AuroraGlow alpha={alpha} tone={tone} />);
  /* SAFETY: 类型断言已复核 */
  return (container.firstElementChild as HTMLElement).style.background;
}

describe("AuroraGlow", () => {
  it("三个 tone 各自映射到同名的整颗 token", () => {
    /* SAFETY: 类型断言已复核 */
    for (const tone of ["violet", "cyan", "magenta"] as const) {
      expect(glowBackground(tone, 0.5)).toContain(`var(--color-aurora-${tone})`);
    }
  });

  it("强度按这一层的 alpha 取整成百分比", () => {
    expect(glowBackground("cyan", 0.42)).toContain(
      "color-mix(in srgb, var(--color-aurora-cyan) 42%, transparent)",
    );
    expect(glowBackground("violet", 0.425)).toContain("var(--color-aurora-violet) 43%");
  });

  it("只吃这一层的强度，不影响别的 tone", () => {
    const cyan = glowBackground("cyan", 0.6);
    expect(cyan).toContain("var(--color-aurora-cyan) 60%");
    expect(cyan).not.toContain("aurora-violet");
    expect(cyan).not.toContain("aurora-magenta");
  });
});
