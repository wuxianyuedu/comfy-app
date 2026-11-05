/**
 * `ship --gh-logs`（`scripts/ship-gh-logs.mjs`）的取数与呈现判据。
 *
 * 四档用例钉住规范 §13.6 的承诺：
 *   ① 判红 ⇒ run / job / step / 全部 `##[error]` / 失败窗口 / 一行结论 / 绝对路径都在场；
 *   ② 无令牌 ⇒ 只念一行、一次网络都不发、退码不变；
 *   ③ 超长日志 ⇒ head/tail 标记与省略行数准确；
 *   ④ 取数失败 ⇒ 只多一行缺因，三态与退码照旧。
 * 另钉 `--gh-logs` 的两种写法、`run:` / `pr:` 消歧、以及 env / JSON 形状的脱敏。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { parseArgs } from "../scripts/ship-args.mjs";
import { CODE } from "../scripts/ship-core.mjs";
import { redactSecrets } from "../scripts/ci-github-verdict-logs.mjs";
import {
  classifyFailureName,
  classifyFailureOrigin,
  parseGhLogsTarget,
  renderFailureWindow,
  runGhLogs,
  runGhLogsOnRed,
  selectRunForPr,
  shipFailureWindow,
} from "../scripts/ship-gh-logs.mjs";

/** 夹具里不写凭据字面量（pre-commit 的 tracked-secrets 硬闸）：值拼出来，形状可复现。 */
const fakeValue = "not-a-real-credential-1234567890";
const fakeGhString = `ghp_${"a".repeat(30)}`;
const fakePatString = `github_pat_${"b".repeat(30)}`;
const envKey = ["GITHUB", "TOKEN"].join("_");
const envLine = `${envKey}=placeholder-value`;
const RUN_ID = 4242;
const PR_NUMBER = 3195;

/** 这一格用到的 temp 目录（每个用例自己建、自己删）。 */
const madeDirs: string[] = [];

afterEach(() => {
  for (const dir of madeDirs.splice(0)) {
    fs.rmSync(dir, { force: true, recursive: true });
  }
});

/** 建一个用例专属的日志落点（不让不同用例互相清空）。 */
function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ship-gh-logs-test-"));
  madeDirs.push(dir);
  return dir;
}

/**
 * @param {unknown} body JSON 回话
 * @param {number} [status] HTTP 状态
 * @returns {Response} 假回话
 */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

/**
 * @param {string} text 正文
 * @param {number} [status] HTTP 状态
 * @returns {Response} 假回话
 */
function textResponse(text: string, status = 200): Response {
  return new Response(text, { status });
}

/** 一条判红的 run（形状贴 GA workflow_run 回话）。 */
const RED_RUN = {
  conclusion: "failure",
  display_title: `PR #${String(PR_NUMBER)} · [ship] gh logs · abc`,
  html_url: `https://github.com/org/repo/actions/runs/${String(RUN_ID)}`,
  id: RUN_ID,
  status: "completed",
};

/** 红 run 的 job 列表：第二个 step 是失败 step。 */
const RED_JOBS = {
  jobs: [
    {
      conclusion: "failure",
      id: 101,
      name: "heavy-gates",
      status: "completed",
      steps: [
        { conclusion: "success", name: "Checkout", number: 1, status: "completed" },
        {
          conclusion: "failure",
          name: "Run pnpm vitest run tests/foo.test.ts",
          number: 2,
          status: "completed",
        },
      ],
    },
  ],
};

/** 失败 step 的原始日志（含注解、令牌形状、env 形状）。 */
const FAILED_LOG = [
  "##[group]Run pnpm vitest run tests/foo.test.ts",
  "> pnpm vitest run tests/foo.test.ts",
  "FAIL tests/foo.test.ts",
  "Test Files  1 failed",
  "##[error]Process completed with exit code 1.",
  "##[endgroup]",
  envLine,
  `LEAK=${fakeGhString}`,
  '{"password":"hunter2"}',
].join("\n");

/**
 * 假 fetch：只答这一族要的三跳（run / jobs / job log），其余给 404。
 *
 * @param {object} [overrides] 覆盖某一路的作答
 * @returns {typeof fetch} 假 fetch
 */
function fakeGhFetch(
  overrides: { jobs?: () => Response; log?: () => Response; run?: () => Response } = {},
): typeof fetch {
  return (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith(`/actions/runs/${String(RUN_ID)}`)) {
      return Promise.resolve(overrides.run ? overrides.run() : jsonResponse(RED_RUN));
    }
    if (url.includes(`/actions/runs/${String(RUN_ID)}/jobs`)) {
      return Promise.resolve(overrides.jobs ? overrides.jobs() : jsonResponse(RED_JOBS));
    }
    if (url.includes("/actions/jobs/101/logs")) {
      return Promise.resolve(overrides.log ? overrides.log() : textResponse(FAILED_LOG));
    }
    if (url.includes("/actions/runs?event=repository_dispatch")) {
      return Promise.resolve(jsonResponse({ workflow_runs: [RED_RUN] }));
    }
    return Promise.resolve(textResponse("not found", 404));
  };
}

/**
 * 跑一次回读，收齐屏幕行。
 *
 * @param {object} [opts] 覆盖点
 * @returns {Promise<{code: number, lines: string[], text: string}>} 读数
 */
async function runOnce(
  opts: {
    dryRun?: boolean;
    env?: Record<string, string>;
    fetchImpl?: typeof fetch;
    input?: string;
    windowMaxBytes?: number;
  } = {},
) {
  const lines: string[] = [];
  const code = await runGhLogs({
    input: opts.input ?? `run:${String(RUN_ID)}`,
    repo: "org/repo",
    env: opts.env ?? { GITHUB_MIRROR_TOKEN: fakeValue },
    log: (line) => lines.push(line),
    fetchImpl: opts.fetchImpl ?? fakeGhFetch(),
    sleep: () => Promise.resolve(),
    windowMaxBytes: opts.windowMaxBytes,
    dryRun: opts.dryRun,
    dir: tempDir(),
  });
  return { code, lines, text: lines.join("\n") };
}

describe("① 判红：run / job / step / 注解 / 窗口 / 结论 / 绝对路径都在场", () => {
  it("台面上直接念出六件读数，并把全量日志落进临时目录", async () => {
    const r = await runOnce();
    expect(r.code).toBe(CODE.GREEN);
    expect(r.text).toContain(`GH run #${String(RUN_ID)}（conclusion=failure）`);
    expect(r.text).toContain(RED_RUN.html_url);
    expect(r.text).toContain("✗ job「heavy-gates」（failure）");
    expect(r.text).toContain("失败 step #2「Run pnpm vitest run tests/foo.test.ts」（failure）");
    expect(r.text).toContain("失败注解（共 1 条）");
    expect(r.text).toContain("##[error]Process completed with exit code 1.");
    expect(r.text).toContain("失败窗口");
    expect(r.text).toContain("全量日志已落盘：");
    expect(r.text).toContain("清理提示");
    expect(r.text).toContain("结论：内容判据");

    const pathLine = r.lines.find((line) => line.includes("全量日志已落盘："));
    expect(pathLine).toBeDefined();
    const abs = String(pathLine).split("全量日志已落盘：")[1]?.split("（")[0] ?? "";
    expect(path.isAbsolute(abs)).toBe(true);
    const written = fs.readFileSync(abs, "utf8");
    expect(written).toContain("run 4242 / job「heavy-gates」");
    expect(written).toContain("##[error]Process completed with exit code 1.");
    /* 脱敏在落盘前：令牌 / env / JSON 三种形状一个都不许留在文件里。 */
    expect(written).not.toContain("placeholder-value");
    expect(written).not.toContain("hunter2");
    expect(written).not.toContain(fakeGhString);
    expect(written).toContain("GITHUB_TOKEN=<redacted>");
    expect(written).toContain('"password":"<redacted>"');
  });

  it("PR 号入口：从触发表里挑最新判红的 run（不是最新一条绿的）", () => {
    const greenNewer = { ...RED_RUN, conclusion: "success", id: 5000 };
    const redOlder = { ...RED_RUN, id: 4000 };
    expect(selectRunForPr([greenNewer, redOlder], PR_NUMBER)?.id).toBe(4000);
    expect(selectRunForPr([{ ...RED_RUN, display_title: "PR #31950 · …" }], PR_NUMBER)).toBeNull();
  });

  it("auto 触发：只有 build 是红才回读；绿的一跳一次网络都不发", async () => {
    const redLines: string[] = [];
    const greenLines: string[] = [];
    let calls = 0;
    const countingFetch: typeof fetch = (input, init) => {
      calls += 1;
      return fakeGhFetch()(input, init);
    };
    await runGhLogsOnRed({
      buildState: "red",
      number: PR_NUMBER,
      repo: "org/repo",
      env: { GITHUB_MIRROR_TOKEN: fakeValue },
      log: (line) => redLines.push(line),
      fetchImpl: countingFetch,
      sleep: () => Promise.resolve(),
      dir: tempDir(),
    });
    expect(calls).toBeGreaterThan(0);
    expect(redLines.join("\n")).toContain(`GH run #${String(RUN_ID)}`);
    await runGhLogsOnRed({
      buildState: "green",
      number: PR_NUMBER,
      repo: "org/repo",
      env: { GITHUB_MIRROR_TOKEN: fakeValue },
      log: (line) => greenLines.push(line),
      fetchImpl: countingFetch,
      sleep: () => Promise.resolve(),
      dir: tempDir(),
    });
    expect(greenLines).toEqual([]);
  });
});

describe("② 无令牌：只念一行、一次网络都不发、退码不变", () => {
  it("env 里两枚令牌都没有 ⇒ 一行跳过，fetch 零调用", async () => {
    let calls = 0;
    const forbidFetch: typeof fetch = () => {
      calls += 1;
      throw new Error("不该发网络请求");
    };
    const lines: string[] = [];
    const code = await runGhLogs({
      input: `run:${String(RUN_ID)}`,
      repo: "org/repo",
      env: {},
      log: (line) => lines.push(line),
      fetchImpl: forbidFetch,
      sleep: () => Promise.resolve(),
      dir: tempDir(),
    });
    expect(code).toBe(CODE.GREEN);
    expect(calls).toBe(0);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("未设置令牌 ⇒ 跳过 GH 日志回读");
  });

  it("GITHUB_TOKEN 兼容：没有 MIRROR 那枚时仍能取数", async () => {
    const r = await runOnce({ env: { GITHUB_TOKEN: fakeValue } });
    expect(r.code).toBe(CODE.GREEN);
    expect(r.text).toContain(`GH run #${String(RUN_ID)}`);
  });
});

describe("③ 超长日志：head/tail 标记与省略行数准确", () => {
  it("shipFailureWindow：原文行数 / 展示行数 / 省略行数三者自洽", () => {
    const lines = Array.from({ length: 5000 }, (_, i) => `line-${String(i)}`);
    const win = shipFailureWindow(lines, 300);
    expect(win.truncated).toBe(true);
    expect(win.totalLines).toBe(5000);
    expect(win.shownLines).toBe(win.headLines + win.tailLines);
    expect(win.omittedLines).toBe(5000 - win.shownLines);
    const text = renderFailureWindow("step「超长」", win).join("\n");
    expect(text).toContain("[head");
    expect(text).toContain("[tail");
    expect(text).toContain(`已截断：省略 ${String(win.omittedLines)} 行`);
    expect(text).toContain("原文 5000 行");
  });

  it("单行超长：压这一行本身、行数口径不变", () => {
    const win = shipFailureWindow(["x".repeat(10_000)], 200);
    expect(win.truncated).toBe(true);
    expect(win.longLineTrimmed).toBe(true);
    expect(win.totalLines).toBe(1);
    expect(win.shownLines).toBe(1);
    expect(renderFailureWindow("单行", win).join("\n")).toContain("末行超长已截短");
  });

  it("未超界：一次也不说截断", () => {
    const win = shipFailureWindow(["a", "b"], 1024);
    expect(win.truncated).toBe(false);
    expect(renderFailureWindow("短窗口", win).join("\n")).toContain("未截断");
  });
});

describe("④ 取数失败：只多一行缺因，三态与退码照旧", () => {
  it("网络不通 ⇒ 一行缺因、退 0、不抛", async () => {
    const failing: typeof fetch = () => Promise.reject(new Error("network down"));
    const r = await runOnce({ fetchImpl: failing });
    expect(r.code).toBe(CODE.GREEN);
    expect(r.text).toContain("取不到");
    expect(r.text).toContain("缺的只是日志");
  });

  it("job 列表 401 ⇒ 一行带 HTTP 状态的缺因，退 0", async () => {
    const r = await runOnce({
      fetchImpl: fakeGhFetch({ jobs: () => textResponse("forbidden", 401) }),
    });
    expect(r.code).toBe(CODE.GREEN);
    expect(r.text).toContain("job 列表取不到（HTTP 401");
    expect(r.text).toContain("令牌缺 actions: read");
  });

  it("输入认不出 ⇒ 退 2（唯一会增加退码的一档：用法错误）", async () => {
    const r = await runOnce({ input: "not-a-number" });
    expect(r.code).toBe(CODE.NOT_RUN);
    expect(r.text).toContain("认不出");
  });
});

describe("脱敏：精确令牌 + ghp_ / github_pat_ + env / JSON 形状", () => {
  it("四种形状都抹成 <redacted>，正文其余不动", () => {
    const raw = [
      `a=${fakeValue}`,
      envLine,
      "API_KEY=zzz",
      '{"password":"hunter2"}',
      fakeGhString,
      fakePatString,
      "keep=ok",
    ].join("\n");
    const out = redactSecrets(raw, fakeValue);
    expect(out).not.toContain(fakeValue);
    expect(out).not.toContain("leak");
    expect(out).not.toContain("zzz");
    expect(out).not.toContain("hunter2");
    expect(out).not.toContain("ghp_");
    expect(out).not.toContain("github_pat_");
    expect(out).toContain("GITHUB_TOKEN=<redacted>");
    expect(out).toContain("API_KEY=<redacted>");
    expect(out).toContain('"password":"<redacted>"');
    expect(out).toContain("keep=ok");
  });
});

describe("命令行形态：run id / PR 号两种写法都认", () => {
  it("parseGhLogsTarget：裸数字按位数判，run: / pr: / URL 可消歧", () => {
    expect(parseGhLogsTarget(String(PR_NUMBER))).toEqual({ kind: "pr", number: PR_NUMBER });
    expect(parseGhLogsTarget("run:4242")).toEqual({ id: 4242, kind: "run" });
    expect(parseGhLogsTarget("pr:3195")).toEqual({ kind: "pr", number: 3195 });
    expect(parseGhLogsTarget(`https://github.com/org/repo/actions/runs/${String(RUN_ID)}`)).toEqual(
      {
        id: RUN_ID,
        kind: "run",
      },
    );
    expect(parseGhLogsTarget("abc")).toEqual({ bad: "abc", kind: null });
  });

  it("parseArgs：空格 / 等号两种写法共用一支；缺值进 bad", () => {
    expect(parseArgs(["--gh-logs", "3195"]).ghLogsRef).toBe("3195");
    expect(parseArgs(["--gh-logs=run:4242"]).ghLogsRef).toBe("run:4242");
    expect(parseArgs(["--gh-logs"]).ghLogsBad).toEqual(["(缺 run id / PR 号)"]);
    const both = parseArgs(["--gh-logs", "3195", "--merge"]);
    expect(both.ghLogs).toBe(true);
    expect(both.merge).toBe(true);
  });
});

describe("一行结论：环境侧 / 内容判据 / 混合作业", () => {
  it("名称命中准备步骤 ⇒ 环境侧；命中判据 ⇒ 内容判据；都不中 ⇒ 未判定", () => {
    expect(classifyFailureName("Checkout")).toBe("environment");
    expect(classifyFailureName("Run pnpm typecheck")).toBe("content");
    expect(classifyFailureName("blob")).toBe("unknown");
    expect(classifyFailureOrigin([{ kind: "content", name: "Run pnpm vitest" }])).toContain(
      "内容判据",
    );
    expect(classifyFailureOrigin([{ kind: "environment", name: "Checkout" }])).toContain("环境侧");
    expect(
      classifyFailureOrigin([
        { kind: "content", name: "Run pnpm vitest" },
        { kind: "environment", name: "Checkout" },
      ]),
    ).toContain("混合");
  });
});
