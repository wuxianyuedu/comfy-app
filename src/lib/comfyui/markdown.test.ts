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
    const html = markdownToHtml("<img src=x onerror=alert(1)>");
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

describe("行内代码的隔离语义（renderInline 的分步顺序）", () => {
  /* 这一组锁住的是「行内代码正文不会被后续几步二次解释」这个**契约本身**，
   * 而不是某一种占位实现。占位符换成什么（历史上的 NUL、现在的 `<n>`）都不该
   * 让这几条断言变色——换实现时正好用它们确认语义没被改坏。 */

  it("代码里的安全 HTML 保持字面量，不生效", () => {
    const html = markdownToHtml("`<br>`");
    expect(html).toContain("&lt;br&gt;");
    expect(html).not.toContain("<br />");
  });

  it("代码里的粗体 / 斜体标记不被解释", () => {
    const html = markdownToHtml("`**粗** 与 *斜*`");
    expect(html).toContain("**粗** 与 *斜*");
    expect(html).not.toContain("<strong>粗</strong>");
    expect(html).not.toContain("<em>斜</em>");
  });

  it("代码里的链接不被解释", () => {
    const html = markdownToHtml("`[文字](https://example.com)`");
    expect(html).not.toContain("<a ");
    expect(html).toContain("[文字]");
  });

  it("多个代码片段各归各位，且代码外的标记照常生效", () => {
    const html = markdownToHtml("`*a*` 与 **b** 与 `_c_`");
    expect(html).toContain("*a*");
    expect(html).toContain("_c_");
    expect(html).toContain("<strong>b</strong>");
  });

  it("用户正文里的尖括号数字不会被当成占位符吃掉", () => {
    // `<0>` 这类字面量在占位阶段属于「用户内容」：它先被 escapeHtml 转成
    // `&lt;0&gt;`，因此既不会被恢复步骤误认，也不会凭空造出一个代码片段。
    const html = markdownToHtml("`x` 与字面量 <0>");
    expect(html).toContain("&lt;0&gt;");
    expect(html).toContain(">x</code>");
  });
});
