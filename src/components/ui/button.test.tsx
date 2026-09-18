// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Button, buttonVariants } from "./button";

afterEach(cleanup);

/**
 * 语义变体的判据（ISSUE #672 / 规范 16 §16.2.4）：
 * 视图里 400 处手写 `<button>` 绝大多数是「软底状态色」，批量化替换的前提是
 * `Button` 先有对应的语义变体。这组用例把「有哪些变体、各自落在哪些 token 上」
 * 钉住 —— 变体一旦被删除或改回写死色，这里先失败。
 */
const SEMANTIC_VARIANTS = [
  "primary",
  "danger",
  "success",
  "warning",
  "info",
  "primary-solid",
  "danger-solid",
  "success-solid",
] as const;

describe("Button 语义变体", () => {
  it.each(SEMANTIC_VARIANTS)(
    "variant=%s 产出的类是语义 token 类名",
    (variant) => {
      const cls = buttonVariants({ variant });
      expect(cls).toMatch(
        /\b(bg|text|border)-(primary|destructive|success|warning|info)/,
      );
    },
  );

  it.each(SEMANTIC_VARIANTS)(
    "variant=%s 不落任何 Tailwind 原生调色板字面量",
    (variant) => {
      const cls = buttonVariants({ variant });
      // 原生调色板（violet-500 / red-700 / emerald-400 …）一出现就说明
      // 又绕开了语义 token，改品牌色不会生效（§3.6.2）。
      expect(cls).not.toMatch(
        /\b(?:bg|text|border)-(?:violet|red|rose|emerald|amber|cyan|fuchsia|purple|green|blue)-\d/,
      );
    },
  );

  it("软底变体的文字走 -strong 档，不直接复用原色", () => {
    expect(buttonVariants({ variant: "warning" })).toContain(
      "text-warning-strong",
    );
    expect(buttonVariants({ variant: "success" })).toContain(
      "text-success-strong",
    );
    expect(buttonVariants({ variant: "danger" })).toContain(
      "text-danger-strong",
    );
    expect(buttonVariants({ variant: "info" })).toContain("text-info-strong");
  });

  it("渲染时语义变体生效（default 之外确实换了底色）", () => {
    render(
      <Button variant="danger" data-testid="b">
        删除
      </Button>,
    );
    const el = screen.getByTestId("b");
    expect(el.className).toContain("text-danger-strong");
    expect(el.className).not.toBe(buttonVariants({}));
  });

  it("保留既有的六个变体（批量化替换不得顺手改动存量语义）", () => {
    const EXISTING = [
      "default",
      "outline",
      "secondary",
      "ghost",
      "destructive",
      "link",
    ] as const;
    for (const v of EXISTING) {
      expect(() => buttonVariants({ variant: v })).not.toThrow();
    }
  });
});
