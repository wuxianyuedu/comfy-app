/**
 * `--edit-issue` 的写 + 独立回读（ISSUE #5165）：正文只从文件进、写后逐字回读，
 * 平台吃掉末尾换行不许被读成「没改上」；回读取不到不许念「已改」。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { parseArgs } from "../scripts/ship/ship-args.mjs";
import { classifyEditReadback, runEditIssue } from "../scripts/ship/ship-issue-edit.mjs";

const tmpDirs: Array<string> = [];
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function mkCtx(bodyText = "## 症状\n\n正文里有中文和换行。\n") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ship-edit-issue-"));
  tmpDirs.push(dir);
  const bodyFile = path.join(dir, "body.md");
  fs.writeFileSync(bodyFile, bodyText, "utf8");
  const calls: Array<Array<string>> = [];
  let sentBody = "";
  let backBody: string | null = null;
  let writeOk = true;
  let readOk = true;
  const mkTmp = (name: string, text: string) => {
    const file = path.join(dir, `${name}.md`);
    fs.writeFileSync(file, text, "utf8");
    return file;
  };
  const run = (_cmd: string, args: Array<string>) => {
    calls.push(args);
    if (args[1] === "update-issue") {
      const at = args.indexOf("--body-file");
      sentBody = fs.readFileSync(String(args[at + 1]), "utf8");
      if (!writeOk) {
        return { status: 0, stdout: "not json", stderr: "", error: null };
      }
      return {
        status: 0,
        stdout: JSON.stringify({ status: 200, data: {} }),
        stderr: "",
        error: null,
      };
    }
    if (args[1] === "get-issue") {
      if (!readOk) {
        return { status: 0, stdout: "no json", stderr: "", error: null };
      }
      return {
        status: 0,
        stdout: JSON.stringify({
          status: 200,
          data: {
            number: 5165,
            state: "open",
            title: "t",
            priority: "P1",
            /* 平台吃掉末尾换行（#2719 的 ⑤）。 */
            body: backBody ?? sentBody.replace(/\r?\n$/, ""),
            labels: [],
          },
        }),
        stderr: "",
        error: null,
      };
    }
    return { status: 0, stdout: "{}", stderr: "", error: null };
  };
  const lines: Array<string> = [];
  const ctx = {
    run,
    log: (s: string) => lines.push(s),
    slug: "org/repo",
    number: 5165,
    root: dir,
    handle: "d-win",
    mkTmp,
    opt: { issueBodyFile: bodyFile } as Record<string, unknown>,
  };
  return {
    ctx,
    calls,
    lines,
    bodyFile,
    control: {
      setBackBody: (v: string | null) => (backBody = v),
      setWriteOk: (v: boolean) => (writeOk = v),
      setReadOk: (v: boolean) => (readOk = v),
      sentBody: () => sentBody,
    },
  };
}

describe("classifyEditReadback（ISSUE #5165）", () => {
  it("平台吃掉末尾换行仍算同一份正文", () => {
    expect(
      classifyEditReadback({
        body: "a\nb\n",
        priority: null,
        back: { body: "a\nb", priority: "" },
        length: 5,
      }),
    ).toBe("green");
  });
  it("正文不同或优先级不同落红", () => {
    expect(
      classifyEditReadback({
        body: "a\nb\n",
        priority: null,
        back: { body: "a\nc\n", priority: "" },
        length: 5,
      }),
    ).toBe("red");
    expect(
      classifyEditReadback({
        body: "a\n",
        priority: "P1",
        back: { body: "a", priority: "P2" },
        length: 2,
      }),
    ).toBe("red");
  });
  it("回读取不到落「没结论」而不是「没改上」", () => {
    expect(classifyEditReadback({ body: "a", priority: null, back: null, length: 1 })).toBe(
      "no-run",
    );
  });
});

describe("--edit-issue 的写与回读", () => {
  it("正文只从文件进，写后 get-issue 逐字回读，退 0", () => {
    const { ctx, lines, calls, control } = mkCtx();
    expect(runEditIssue(ctx)).toBe(0);
    expect(calls[0]).toContain("update-issue");
    expect(calls[0]).toContain("5165");
    expect(calls[0]).toContain("--body-file");
    expect(calls[1]).toContain("get-issue");
    expect(control.sentBody()).toContain("## 症状");
    expect(lines.join("\n")).toContain("正文已回读（get-issue，逐字相同）");
  });

  it("给了 --priority 就一并写并回读", () => {
    const { ctx, lines, calls } = mkCtx();
    ctx.opt = { ...ctx.opt, priority: "P1" };
    expect(runEditIssue(ctx)).toBe(0);
    expect(calls[0]).toContain("P1");
    expect(lines.join("\n")).toContain("优先级=P1");
  });

  it("写那一步没跑起来退 2，不念「已改」", () => {
    const { ctx, lines, control } = mkCtx();
    control.setWriteOk(false);
    expect(runEditIssue(ctx)).toBe(2);
    expect(lines.join("\n")).not.toContain("已回读");
  });

  it("回读正文与发出的不同退 1", () => {
    const { ctx, lines, control } = mkCtx();
    control.setBackBody("单子被别人同时改了");
    expect(runEditIssue(ctx)).toBe(1);
    expect(lines.join("\n")).toContain("不是同一份");
  });

  it("回读取不到退 2，不冒充成功也不冒充红", () => {
    const { ctx, lines, control } = mkCtx();
    control.setReadOk(false);
    expect(runEditIssue(ctx)).toBe(2);
    expect(lines.join("\n")).toContain("回读没跑起来");
  });

  it("没给 --issue-body-file 当场停 2", () => {
    const { ctx, lines } = mkCtx();
    ctx.opt = {};
    expect(runEditIssue(ctx)).toBe(2);
    expect(lines.join("\n")).toContain("--issue-body-file");
  });
});

describe("--edit-issue 的命令行形状", () => {
  it("空格与等号两种写法都能解析", () => {
    expect(parseArgs(["--edit-issue", "5165"]).editIssue).toBe(5165);
    expect(parseArgs(["--edit-issue=5165"]).editIssue).toBe(5165);
  });
  it("不像号 / 重复给号不当作没要这个动作", () => {
    expect(parseArgs(["--edit-issue", "abc"]).editIssueBad).toHaveLength(1);
    expect(parseArgs(["--edit-issue", "5165", "--edit-issue", "5166"]).editIssueBad).toHaveLength(
      1,
    );
  });
});
