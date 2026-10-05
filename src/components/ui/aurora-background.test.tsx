/**
 * `AuroraGlow` 的色相映射回归（规范 03 §3.6.1.1「拼接 token 名」判据的配套用例）。
 *
 * 这个组件此前**零覆盖**，而它刚被从 `var(--color-aurora-${tone})` 改成一张
 * 「整名 → 字面量」表。表化唯一可能引入的新错就是**抄错色相**（把 magenta 映到
 * cyan 那颗），运行时字符串照样合法、肉眼只看得出「光晕换了个颜色」，所以钉这条。
 *
 * ⚠️ 说清这条**判不出什么**：拼法与表法产出的字符串逐字相同，所以「有没有拼名字」
 * 不由本用例守，由 `scripts/check-theme-colors.cjs` 的静态判据守 —— 后者治的是
 * Tailwind v4 按**字面名**决定是否保留 `@theme` 变量这件事（拼出来的名字它看不见，
 * 那颗 token 连编译产物都进不去）。
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";

import { AuroraGlow } from "./aurora-background";

afterEach(cleanup);

/** 取渲染出的内联 background（jsdom 会原样序列化 `color-mix()`，实测不丢值）。 */
function glowBackground(tone: "violet" | "cyan" | "magenta", alpha: number) {
  const { container } = render(<AuroraGlow tone={tone} alpha={alpha} />);
  return (container.firstElementChild as HTMLElement).style.background;
}

describe("AuroraGlow", () => {
  it("三个 tone 各自映射到同名的整颗 token", () => {
    for (const tone of ["violet", "cyan", "magenta"] as const) {
      expect(glowBackground(tone, 0.5)).toContain(
        `var(--color-aurora-${tone})`,
      );
    }
  });

  it("强度按这一层的 alpha 取整成百分比", () => {
    expect(glowBackground("cyan", 0.42)).toContain(
      "color-mix(in srgb, var(--color-aurora-cyan) 42%, transparent)",
    );
    expect(glowBackground("violet", 0.425)).toContain(
      "var(--color-aurora-violet) 43%",
    );
  });

  it("只吃这一层的强度，不影响别的 tone", () => {
    const cyan = glowBackground("cyan", 0.6);
    expect(cyan).toContain("var(--color-aurora-cyan) 60%");
    expect(cyan).not.toContain("aurora-violet");
    expect(cyan).not.toContain("aurora-magenta");
  });
});
