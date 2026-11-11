/**
 * CodeBlock 分片高亮的失败路径：`codeToTokensBase` 由 setTimeout 回调调用，
 * 它抛出的异常不会自动冒泡回 effect 里那个包住 `await getHighlighter()` 的 catch。
 * 这组用例钉住两件事：不支持的语言要落在「非致命降级」文案上；受支持的语言
 * 仍按 token 渲染并保留行号 —— 修一处时别把另一处一起改坏。
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CodeBlock } from "./code-block";

/* shiki 的载入表只有组件自己声明的那几种语言；桩照这个形状给：bash 抛错（现场
 * 是 ShikiError「Language `bash` not found」），其余返回结构化的单行 token。 */
const { codeToTokensBase } = vi.hoisted(() => ({
  codeToTokensBase: vi.fn((code: string, options: { lang: string }) => {
    if (options.lang === "bash") {
      throw new Error("Language `bash` not found, you may need to load it first");
    }
    return code.split("\n").map((line) => [{ content: line }]);
  }),
}));

vi.mock("shiki/dist/bundle-web.mjs", () => ({
  createHighlighter: () => Promise.resolve({ codeToTokensBase }),
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "dark" }),
}));

afterEach(cleanup);

describe("CodeBlock 分片高亮", () => {
  it("分片回调里 shiki 抛错 → 显示降级文案，而不是未捕获异常", async () => {
    render(<CodeBlock code={"echo hello\necho world"} language="bash" />);

    await expect
      .poll(() => screen.queryByText(/语法高亮失败/) !== null, {
        message: "分片回调抛错应落到组件自己的降级路径",
      })
      .toBe(true);
    expect(screen.getByText(/Language `bash` not found/)).toBeInTheDocument();
  });

  it("受支持的语言仍按 token 渲染，行号保留且没有降级文案", async () => {
    const { container } = render(
      <CodeBlock code={"const first = 1;\nconst second = 2;"} language="typescript" />,
    );

    await expect
      .poll(() => container.querySelectorAll(".cb-code > span").length, {
        message: "高亮结果应落地成 token span",
      })
      .toBeGreaterThan(0);
    expect(screen.queryByText(/语法高亮失败/)).toBeNull();
    expect(container.querySelectorAll(".cb-ln")).toHaveLength(2);
  });
});
