/**
 * `--find-issues` 的收口判据（ISSUE #5167）：取不满就是没取到，不念「没有同类单」。
 */
import { describe, expect, it } from "vitest";

import { parseArgs } from "../scripts/ship/ship-args.mjs";
import { issueRows, runFindIssues } from "../scripts/ship/ship-find-issues.mjs";

type Exec = { error: null; status: number; stderr: string; stdout: string };

function harness(opts: {
  empty?: boolean;
  fail?: boolean;
  incomplete?: boolean;
  merged?: boolean;
}) {
  const lines: Array<string> = [];
  const calls: Array<Array<string>> = [];
  const run = (cmd: string, args: Array<string>): Exec => {
    calls.push([cmd, ...args]);
    if (cmd !== "cnb") {
      return { error: null, status: 0, stderr: "", stdout: "{}" };
    }
    if (opts.fail) {
      return { error: null, status: 0, stderr: "", stdout: "not json" };
    }
    return {
      error: null,
      status: 0,
      stderr: "",
      stdout: JSON.stringify({
        status: 200,
        data: opts.empty
          ? []
          : [
              {
                number: 5170,
                title: "工具: pnpm test:affected",
                state: "open",
                labels: [{ name: "P2" }],
              },
            ],
        ...(opts.incomplete ? { has_more: true } : {}),
      }),
    };
  };
  return { run, lines, calls, log: (s: string) => lines.push(s) };
}

describe("issueRows", () => {
  it("从平台形状里取号、标题、状态、标签，按号倒序", () => {
    const rows = issueRows([
      { number: 10, title: "旧", state: "closed", labels: ["bug"] },
      { number: 20, title: "新", state: "open", labels: [{ name: "P2" }] },
    ]);
    expect(rows.map((r) => r.number)).toEqual([20, 10]);
    expect(rows[0]?.labels).toEqual(["P2"]);
  });
});

describe("runFindIssues", () => {
  it("窗口取满且命中 ⇒ 逐条念出，退 0", () => {
    const h = harness({});
    expect(runFindIssues({ ...h, slug: "org/repo", keyword: "test:affected" })).toBe(0);
    expect(h.lines.join("\n")).toContain("#5170");
    expect(h.calls.some((c) => c.includes("--keyword"))).toBe(true);
  });
  it("空但取满 ⇒ 明说确实没查到，退 0", () => {
    const h = harness({ empty: true });
    expect(runFindIssues({ ...h, slug: "org/repo", keyword: "无此单" })).toBe(0);
    expect(h.lines.join("\n")).toContain("确实没查到");
  });
  it("平台说还有但给空页 ⇒ 没取到，退 2", () => {
    const h = harness({ empty: true, incomplete: true });
    expect(runFindIssues({ ...h, slug: "org/repo", keyword: "x" })).toBe(2);
    expect(h.lines.join("\n")).not.toContain("确实没查到");
  });
  it("cnb 响应不是 JSON ⇒ 没结论，退 2", () => {
    const h = harness({ fail: true });
    expect(runFindIssues({ ...h, slug: "org/repo", keyword: "x" })).toBe(2);
  });
  it("没给关键词 / slug ⇒ 退 2，不冒充「没有」", () => {
    const h = harness({});
    expect(runFindIssues({ ...h, slug: null, keyword: "x" })).toBe(2);
    expect(runFindIssues({ ...h, slug: "org/repo", keyword: "" })).toBe(2);
  });
});

describe("--find-issues 的命令行形状", () => {
  it("关键词是自由文本，空格与等号都能解析", () => {
    expect(parseArgs(["--find-issues", "工具", "test:affected"]).findIssues).toBe(
      "工具 test:affected",
    );
    expect(parseArgs(["--find-issues=关键词"]).findIssues).toBe("关键词");
  });
  it("状态与标签旗标可解析", () => {
    const opt = parseArgs(["--find-issues", "x", "--state", "open", "--label", "P2"]);
    expect(opt.findState).toBe("open");
    expect(opt.findLabel).toBe("P2");
  });
});
