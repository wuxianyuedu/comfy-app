import { describe, it, expect } from "vitest";
import { markdownToHtml, renderMarkdown } from "./markdown";

describe("markdownToHtml", () => {
  it("渲染标题（# 起始，## 渲染为 h3）", () => {
    expect(markdownToHtml("## Hello")).toContain("<h3");
    expect(markdownToHtml("### Sub")).toContain("<h4");
  });

  it("渲染粗体 / 斜体", () => {
    expect(markdownToHtml("**bold**")).toContain("<strong>bold</strong>");
    expect(markdownToHtml("*em*")).toContain("<em>em</em>");
  });

  it("渲染行内代码与代码块", () => {
    expect(markdownToHtml("`x`")).toContain("<code");
    expect(markdownToHtml("```\nconst a = 1;\n```")).toContain("<pre");
  });

  it("渲染列表与引用", () => {
    expect(markdownToHtml("- a\n- b")).toContain("<ul");
    expect(markdownToHtml("> quote")).toContain("<blockquote");
  });

  it("安全链接：http(s)/mailto 放行", () => {
    const html = markdownToHtml("[link](https://example.com)");
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('target="_blank"');
  });

  it("XSS：javascript: 链接被拦截", () => {
    const html = markdownToHtml("[x](javascript:alert(1))");
    expect(html).not.toContain('href="javascript:');
  });

  it("XSS：原始 script 标签被转义", () => {
    const html = markdownToHtml("<script>alert(1)</script>");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("XSS：事件属性所在标签被整体转义", () => {
    const html = markdownToHtml('<img src=x onerror=alert(1)>');
    // 整个 <img> 被转义为文本，不产生可执行标签
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});

describe("renderMarkdown", () => {
  it("空输入返回空串", () => {
    expect(renderMarkdown("")).toBe("");
  });
});
