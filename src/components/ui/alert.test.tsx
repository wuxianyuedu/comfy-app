import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { Alert, AlertDescription, AlertTitle } from "./alert";

afterEach(cleanup);

/**
 * `ui/alert` 的判据（ISSUE #672 / 规范 16 §16.2.4）。
 *
 * 基元此前只有 `default` / `destructive` 两支，而视图里六处「语义色边框 +
 * 底色 + 正文」的通知块都在自绘外壳。这里钉住新补的四支语义变体存在、
 * 且**颜色走语义 token 类名**（不落 Tailwind 原生调色板字面量）——
 * 换品牌色 / 状态色时调用处不用改。
 */
const VARIANTS = [
  "default",
  "destructive",
  "warning",
  "info",
  "success",
  "danger",
] as const;

function alertOf(props: Parameters<typeof Alert>[0] = {}): HTMLElement {
  render(<Alert {...props}>内容</Alert>);
  return screen.getByRole("alert");
}

describe("Alert", () => {
  it("渲染 role=alert（承载「有事要告诉用户」的语义）", () => {
    expect(alertOf()).toBeInTheDocument();
  });

  it.for(VARIANTS)("variant=%s 可渲染", (variant) => {
    expect(alertOf({ variant }).className).toContain("rounded-lg");
  });

  it.for(["warning", "info", "success", "danger"] as const)(
    "variant=%s 的边框 / 底色走语义 token",
    (variant) => {
      const cls = alertOf({ variant }).className;
      expect(cls).toMatch(/\bborder-(warning|info|success|destructive)\/30\b/);
      expect(cls).toMatch(/\bbg-(warning|info|success|destructive)\/10\b/);
    },
  );

  it.for(VARIANTS)("variant=%s 不落 Tailwind 原生调色板字面量", (variant) => {
    expect(alertOf({ variant }).className).not.toMatch(
      /\b(?:bg|text|border)-(?:violet|red|rose|emerald|amber|cyan|sky|fuchsia|purple|green|blue)-/,
    );
  });

  it("warning / info / success / danger 的文字档走 -strong token", () => {
    for (const variant of ["warning", "info", "success", "danger"] as const) {
      expect(alertOf({ variant }).className).toMatch(
        /\btext-(warning|info|success|danger)-strong\b/,
      );
      cleanup();
    }
  });

  it("AlertTitle / AlertDescription 带 data-slot，供调用处选择器挂靠", () => {
    render(
      <Alert>
        <AlertTitle>标题</AlertTitle>
        <AlertDescription>正文</AlertDescription>
      </Alert>,
    );
    expect(screen.getByText("标题")).toHaveAttribute(
      "data-slot",
      "alert-title",
    );
    expect(screen.getByText("正文")).toHaveAttribute(
      "data-slot",
      "alert-description",
    );
  });
});
