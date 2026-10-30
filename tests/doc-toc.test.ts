/**
 * `pnpm doc:toc` —— 规范文档的按节定位入口（ISSUE #2763）。
 *
 * 它治的是「整篇读一遍不现实、grep 猜词读到半句」那一格，所以判据也全是**定位正确性**：
 *   ① 标题树要跳过围栏代码块里的 `# 注释`（bash 示例的第一行就是它）；
 *   ② 列表项里缩进的子标题（`13.6.2.1` 那一层）不能被漏掉 —— 漏了目录照样"完整"；
 *   ③ 小节区间到「下一个同级或更高级标题」为止（父小节不能只剩标题一行）；
 *   ④ 源与生成态镜像必须显式区分（同名两份、行号不同，拿错不会报错）；
 *   ⑤ 「没读成」（退 2）与「关键词 0 命中」（退 0）分开。
 */
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { parseHeadings, resolveDoc, sectionRange } from "../scripts/doc-toc.mjs";

const SCRIPT = join(process.cwd(), "scripts", "doc-toc.mjs");

function run(args: Array<string> = []) {
  try {
    const output = execFileSync(process.execPath, [SCRIPT, ...args], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, output };
  } catch (err) {
    const e = /* SAFETY: 类型断言已复核 */ err as {
      status?: number;
      stdout?: string;
      stderr?: string;
    };
    return {
      code: typeof e.status === "number" ? e.status : 1,
      output: `${e.stdout ?? ""}${e.stderr ?? ""}`,
    };
  }
}

describe("doc-toc —— 标题解析", () => {
  test("跳过围栏代码块，保留列表项里缩进的子标题", () => {
    /* 两种失效都不报错：把 bash 示例的 `# 注释` 当标题 ⇒ 区间算错；
     * 漏掉缩进子标题 ⇒ 目录看起来完整，少的那几层恰好是最常被问的细则。 */
    const md = [
      "# 根",
      "```bash",
      "# 这行是注释，不是标题",
      "```",
      " ##### 1.1.1 细则",
      "    # 缩进代码块里的井号",
      "## 二",
    ].join("\n");
    expect(parseHeadings(md)).toEqual([
      { level: 1, title: "根", line: 1 },
      { level: 5, title: "1.1.1 细则", line: 5 },
      { level: 2, title: "二", line: 7 },
    ]);
  });

  test("ATX 标题的收尾井号是装饰，不算进标题", () => {
    expect(parseHeadings("## 标题 ##\n")).toEqual([{ level: 2, title: "标题", line: 1 }]);
  });
});

describe("doc-toc —— 小节区间", () => {
  test("到下一个**同级或更高级**标题为止（子小节属于父小节）", () => {
    const headings = [
      { level: 1, title: "根", line: 1 },
      { level: 2, title: "1.1", line: 10 },
      { level: 3, title: "1.1.1", line: 20 },
      { level: 2, title: "1.2", line: 30 },
    ];
    expect(sectionRange(headings, 1, 100)).toEqual({
      start: 10,
      end: 29,
      limit: 20,
    });
    /* 子小节同理：它的边界是同级的 1.2，不是父小节。 */
    expect(sectionRange(headings, 2, 100)).toEqual({
      start: 20,
      end: 29,
      limit: 10,
    });
    /* 根标题一直到最后一行。 */
    expect(sectionRange(headings, 0, 100)).toEqual({
      start: 1,
      end: 100,
      limit: 100,
    });
  });
});

describe("doc-toc —— 文档名解析（输入面 = SCOPED_DOCS）", () => {
  test("前缀、完整路径、镜像路径都认，且区分源与镜像", () => {
    const byPrefix = resolveDoc("13");
    expect(byPrefix.ok).toBe(true);
    if (!byPrefix.ok) {
      return;
    }
    expect(byPrefix.src.endsWith("13-提交与-code-review.md")).toBe(true);
    expect(byPrefix.rendered).toBe(false);

    const byPath = resolveDoc("docs/standards/13-提交与-code-review.md");
    expect(byPath.ok && byPath.src === byPrefix.src).toBe(true);

    const byMirror = resolveDoc("docs/generated/13-提交与-code-review.md");
    expect(byMirror.ok).toBe(true);
    if (!byMirror.ok) {
      return;
    }
    expect(byMirror.src).toBe(byPrefix.src);
    expect(byMirror.rendered).toBe(true);
  });

  test("前缀命中多份 ⇒ 拒答并列出候选（挑错的那份也像证据）", () => {
    const got = resolveDoc("guide");
    expect(got.ok).toBe(false);
    if (got.ok) {
      return;
    }
    expect(got.candidates?.length ?? 0).toBeGreaterThan(1);
  });

  test("不在 SCOPED_DOCS 里 ⇒ 拒答，不猜一份同名的文件", () => {
    const got = resolveDoc("nope-not-a-doc");
    expect(got.ok).toBe(false);
    if (got.ok) {
      return;
    }
    expect(got.reason).toContain("SCOPED_DOCS");
  });
});

describe("doc-toc —— 入口三态", () => {
  test("关键词命中：带行号与可直接照抄的 Read 区间", () => {
    const { code, output } = run(["13", "合并前"]);
    expect(code).toBe(0);
    expect(output).toContain("13.6.2.1");
    expect(output).toContain("offset=");
    expect(output).toContain("（源）");
  });

  test("`--rendered` 明确写出「行号属于生成态镜像」", () => {
    const { code, output } = run(["13", "--rendered", "合并前"]);
    expect(code).toBe(0);
    expect(output).toContain("生成态镜像");
    expect(output).toContain("docs/generated/13-");
    expect(output).toContain("与源文档的行号不同");
  });

  test("关键词 0 命中是退 0（文档读到了，只是没有这一节）", () => {
    const { code, output } = run(["13", "这个词不可能出现在标题里"]);
    expect(code).toBe(0);
    expect(output).toContain("0 命中");
  });

  test("认不出的旗标 / 认不出的文档都退 2（没读成 ≠ 没有这一节）", () => {
    expect(run(["--bogus"]).code).toBe(2);
    expect(run(["--bogus"]).output).toContain("--bogus");
    expect(run(["nope-not-a-doc"]).code).toBe(2);
  });

  test("`--list` 列出 SCOPED_DOCS 的可认名字", () => {
    const { code, output } = run(["--list"]);
    expect(code).toBe(0);
    expect(output).toContain("13-提交与-code-review");
    expect(output).toContain("launch-and-build");
  });
});
