// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { markdownToHtml, renderMarkdown } from "./render";

/* 这一组是**按语法点逐条写的**，迁移自自研渲染器的同名用例（ISSUE #1329）。
 * 「逐条对齐」的用意不是怀旧：它是「换实现前后行为等价」的现成判据 —— 迁移时
 * 哪一条变色，就是一处需要解释的行为变化。
 *
 * 因此本文件里**没有**断言具体的内联 style 串：样式是另一件事（`styles.ts`），
 * 断言它会把「换一次配色」和「换一次解析器」混成同一种红。这里只断言语义结构
 * （哪个标签、什么属性、文本怎么落位）。 */
describe("markdownToHtml：语法点", () => {
  it("渲染标题（# → h1，逐级到 h6）", () => {
    expect(markdownToHtml("## Hello")).toContain("<h2");
    expect(markdownToHtml("### Sub")).toContain("<h3");
    expect(markdownToHtml("# Top")).toContain("<h1");
  });

  it("渲染粗体 / 斜体 / 删除线", () => {
    expect(markdownToHtml("**bold**")).toContain("<strong>bold</strong>");
    expect(markdownToHtml("*em*")).toContain("<em>em</em>");
    expect(markdownToHtml("~~gone~~")).toContain("<del>gone</del>");
  });

  it("渲染行内代码与代码块", () => {
    expect(markdownToHtml("`x`")).toContain("<code");
    expect(markdownToHtml("```\nconst a = 1;\n```")).toContain("<pre");
  });

  it("渲染列表与引用", () => {
    expect(markdownToHtml("- a\n- b")).toContain("<ul");
    expect(markdownToHtml("> quote")).toContain("<blockquote");
  });

  it("渲染水平分隔线", () => {
    expect(markdownToHtml("---")).toContain("<hr");
  });

  it("渲染 GFM 表格（表头进 thead，单元格里的行内语法照常生效）", () => {
    const html = markdownToHtml("| a | b |\n| --- | --- |\n| 1 | **2** |");
    expect(html).toContain("<table");
    expect(html).toContain("<thead>");
    expect(html).toContain("<th");
    expect(html).toContain("<td");
    expect(html).toContain("<strong>2</strong>");
  });

  it("安全链接：http(s) 放行并新开页签", () => {
    const html = markdownToHtml("[link](https://example.com)");
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer"');
  });
});

describe("markdownToHtml：XSS 边界", () => {
  it("javascript: 链接被剥掉 href（DOMPurify 按真实解析器判，不是前缀正则）", () => {
    const html = markdownToHtml("[x](javascript:alert(1))");
    expect(html).not.toContain("javascript:");
    /* 文字不丢：链接降级成纯文本。 */
    expect(html).toContain(">x</a>");
  });

  it("原始 script 标签整段消失（连文本一起 —— 它本来就不该是可见内容）", () => {
    const html = markdownToHtml("<script>alert(1)</script>");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("alert(1)");
  });

  it("事件属性被剥掉：<img src=x onerror=…> 只剩 src", () => {
    const html = markdownToHtml("<img src=x onerror=alert(1)>");
    expect(html).toContain("<img");
    expect(html).not.toContain("onerror");
  });

  it("表单类标签被收掉（用户内容里出现表单只有钓鱼一个用途）", () => {
    const html = markdownToHtml(
      "<form action='https://evil'><button>x</button></form>",
    );
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<button");
  });

  it("用户内容自带的 style 被收掉（position:fixed 能盖住整个应用）", () => {
    const html = markdownToHtml('<p style="position:fixed;top:0">x</p>');
    expect(html).not.toContain("position:fixed");
  });

  it("SVG / MathML 外壳不被保留（历史高发绕过面）", () => {
    expect(
      markdownToHtml("<svg><script>alert(1)</script></svg>"),
    ).not.toContain("<svg");
    expect(markdownToHtml("<math><mi>x</mi></math>")).not.toContain("<math");
  });

  it("data: URI 不被当作内容源（图片也一样）", () => {
    /* DOMPurify 的默认口径放行 `src` 上的 `data:`（它只拦「可执行/可脚本化」的
     * scheme，`data:` 不在其中）—— 而 `data:image/svg+xml,…` 里的 SVG **可以带脚本**。
     * 这条是本仓库在白名单之外**补的第二件事**（协议白名单，见 `sanitize-config.ts`），
     * 所以必须有一条用例钉住它，而不是靠「DOMPurify 应该挡住了吧」。 */
    const img = markdownToHtml(
      "![x](data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=)",
    );
    expect(img).not.toContain("data:");
    expect(img).not.toContain("src=");
    expect(img).toContain("<img");
    const link = markdownToHtml(
      "[x](data:text/html,<script>alert(1)</script>)",
    );
    expect(link).not.toContain("data:");
  });

  it("协议白名单放行相对路径 / 锚点 / http(s) / mailto", () => {
    expect(markdownToHtml("[a](./rel.md)")).toContain('href="./rel.md"');
    expect(markdownToHtml("[a](#anchor)")).toContain('href="#anchor"');
    expect(markdownToHtml("[a](https://e.com/x)")).toContain(
      'href="https://e.com/x"',
    );
    expect(markdownToHtml("[a](mailto:x@e.com)")).toContain(
      'href="mailto:x@e.com"',
    );
  });

  it("协议白名单在 DOMPurify 归一之后跑：java\tscript: 这类绕过同样被剥", () => {
    const html = markdownToHtml("[x](<java\tscript:alert(1)>)");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("alert");
  });
});

describe("行内代码的隔离语义", () => {
  /* 这一组锁的是「行内代码正文不会被后续步骤二次解释」这个**契约本身**。
   * 旧实现靠「先转义、再把代码正文暂存成占位符」达成的，新实现是 marked 的
   * 分词器语义 —— 占位实现换了两次（NUL → `<n>` → 空无），语义没变。 */
  it("代码里的安全 HTML 保持字面量，不生效", () => {
    const html = markdownToHtml("`<br>`");
    expect(html).toContain("&lt;br&gt;");
    expect(html).not.toContain("<br");
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
    /* 旧实现把代码正文暂存成 `<n>`，于是 `正文里写的 <0>` 与占位符同形；
     * 现在的实现根本没有占位符这一步，这条用例守的是「别再引入一个和用户内容
     * 可伪造的形状」。 */
    const html = markdownToHtml("`x` 与字面量 <0>");
    expect(html).toContain("&lt;0&gt;");
    expect(html).toContain(">x</code>");
  });
});

describe("与迁移前的刻意差异（不是回归，逐条登记）", () => {
  /* 旧实现「先整串 HTML 转义、再按自己认得的语法拼回标签」，以下能力是**转义的
   * 副产品**而不是设计决定 —— 文件头当时把它们列在「不在范围内」。迁移后按 GFM
   * 正常渲染。每一条都在这里显式登记，免得将来有人把它当回归去修回来。 */

  it("图片：旧实现会把 `![]()` 原样漏成文本，现在渲染成 <img>", () => {
    const html = markdownToHtml("![cap](https://e.com/a.png)");
    expect(html).toContain("<img");
    expect(html).toContain('src="https://e.com/a.png"');
  });

  it("有序列表：旧实现不认 `1.`，现在渲染成 <ol>", () => {
    expect(markdownToHtml("1. a\n2. b")).toContain("<ol");
  });

  it("嵌套子列表：旧实现会丢掉缩进层级，现在保留", () => {
    const html = markdownToHtml("- a\n  - b");
    expect(html.match(/<ul/g)).toHaveLength(2);
  });

  it("任务列表：旧实现不认，现在渲染成勾选框", () => {
    const html = markdownToHtml("- [x] done");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("checked");
  });

  it("未闭合的围栏代码块：旧实现会漏出正文，现在 normalizer 会补上闭合", () => {
    const html = markdownToHtml("```\nconst a = 1;");
    expect(html).toContain("<pre");
    expect(html).toContain("const a = 1;");
  });
});

describe("renderMarkdown", () => {
  it("空输入返回空串", () => {
    expect(renderMarkdown("")).toBe("");
  });

  it("与 markdownToHtml 同一条实现（别名，不是第二份）", () => {
    const sample = "# T\n\n- a";
    expect(renderMarkdown(sample)).toBe(markdownToHtml(sample));
  });
});
