/**
 * `--new-issue` 的留痕话术（ISSUE #2387）。
 *
 * 「标签打不打得上」按**名字在不在**判、回读为准；「取的 / 填的」只管**名字稳不稳**。
 * 旧实现按 source 分支，把「取的」念成「这次建单不带 `提单人:` 标签」—— 而名字非空时
 * 标签明明会按、回读也看得见，两行互相推翻还给出错误指令。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runNewIssue } from "../scripts/ship-issue-new.mjs";

const tmpDirs: Array<string> = [];
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function mkTmpCtx() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ship-issue-new-"));
  tmpDirs.push(dir);
  const bodyFile = path.join(dir, "body.md");
  fs.writeFileSync(bodyFile, "正文四段：症状 / 读数 / 根因 / 期望。\n", "utf8");
  return {
    mkTmp: (name: string, text: string) => {
      const file = path.join(dir, `${name}.md`);
      fs.writeFileSync(file, text, "utf8");
      return file;
    },
    bodyFile,
  };
}

const TITLE = "fix(x): 测试标题";

/** 建单回读的 issue 形状；labels 由用例给。 */
function issueJson(labels: Array<unknown>) {
  return JSON.stringify({
    status: 200,
    data: {
      number: 3001,
      state: "open",
      title: TITLE,
      priority: "P2",
      labels,
    },
  });
}

function harness(opts: {
  /** get-issue 回读里的 labels。 */
  backLabels: Array<unknown>;
}) {
  const log: Array<string> = [];
  const run = (_cmd: string, args: Array<string>) => {
    if (args[1] === "create-issue") {
      return {
        status: 0,
        stdout: JSON.stringify({ status: 200, data: { number: 3001 } }),
        stderr: "",
        error: null,
      };
    }
    if (args[1] === "post-issue-labels") {
      return {
        status: 0,
        stdout: '{"status":200,"data":{}}',
        stderr: "",
        error: null,
      };
    }
    if (args[1] === "get-issue") {
      return {
        status: 0,
        stdout: issueJson(opts.backLabels),
        stderr: "",
        error: null,
      };
    }
    return { status: 0, stdout: "{}", stderr: "", error: null };
  };
  return { run, log };
}

function newIssue(
  run: unknown,
  log: (s: string) => void,
  opts: {
    handle: string | null;
    handleSource?: string | null;
    explicitHandle?: string | null;
  },
) {
  const { mkTmp, bodyFile } = mkTmpCtx();
  return runNewIssue({
    run,
    log,
    slug: "org/repo",
    handle: opts.handle,
    handleSource: opts.handleSource ?? null,
    explicitHandle: opts.explicitHandle ?? null,
    root: process.cwd(),
    opt: { newIssue: TITLE, issueBodyFile: bodyFile, priority: "P2" },
    mkTmp,
  });
}

describe("--new-issue 的留痕话术（ISSUE #2387）", () => {
  it("取的名字 + 回读带标签 ⇒ 念「已补」并点出取自哪里，不再说「这次不带标签」", () => {
    const { run, log } = harness({
      backLabels: [{ name: "提单人:CodeBuddy" }],
    });
    const code = newIssue(run, (s) => log.push(s), {
      handle: "CodeBuddy",
      handleSource: "CNB_NPC_NAME",
      explicitHandle: null,
    });
    expect(code).toBe(0);
    const text = log.join("\n");
    expect(text).toContain("✓ 留痕已补：提单人:CodeBuddy");
    expect(text).toContain("取自 CNB_NPC_NAME");
    expect(text).not.toContain("这次建单不带");
  });

  it("取的名字 + 回读里没有标签 ⇒ 一条 ⚠ 读数（不退 2），出口是 --claim 补上", () => {
    const { run, log } = harness({ backLabels: [] });
    const code = newIssue(run, (s) => log.push(s), {
      handle: "CodeBuddy",
      handleSource: "CNB_NPC_NAME",
      explicitHandle: null,
    });
    expect(code).toBe(0);
    const text = log.join("\n");
    expect(text).toContain("没在回读里");
    expect(text).toContain("--claim 3001");
    expect(text).not.toContain("这次建单不带");
  });

  it("你填的名字 + 回读里没有标签 ⇒ 仍退 2（ISSUE #2355 那一档不变）", () => {
    const { run, log } = harness({ backLabels: [] });
    const code = newIssue(run, (s) => log.push(s), {
      handle: "Me",
      handleSource: ".env",
      explicitHandle: "Me",
    });
    expect(code).toBe(2);
    expect(log.join("\n")).toContain("不念「留痕已补上」");
  });

  it("你填的名字 + 回读带标签 ⇒ 念「已补（你填的）」，不带「换机器会变」", () => {
    const { run, log } = harness({ backLabels: [{ name: "提单人:Me" }] });
    const code = newIssue(run, (s) => log.push(s), {
      handle: "Me",
      handleSource: ".env",
      explicitHandle: "Me",
    });
    expect(code).toBe(0);
    const text = log.join("\n");
    expect(text).toContain("（你填的）");
    expect(text).not.toContain("换机器会变");
  });
});
