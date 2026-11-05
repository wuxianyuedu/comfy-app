/** `ci-github-verdict-logs.mjs` 用例（ISSUE #3051 之后的「判红回读完整日志」一拍）。
 * 全部走注入面（fetch / sleep / writeLogFile 都是假件）：一次真网络、一次真墙钟、一次真磁盘都不付；
 * 令牌脱敏与「日志取不到不改判决」是这一拍的两条硬边界，各有用例钉着。
 *
 * 另有一条**契约断言**：`.cnb.yml` 里必须有一个附件 stage，路径与脚本落盘路径同源 ——
 * 否则落盘的文件没人上传，等于白落。 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  JOB_LOGS_DIR_REL,
  JOB_LOGS_FILE_NAME,
  STAGE_WINDOW_MAX_BYTES,
  capStageWindow,
  dumpFailingRunLogs,
  extractFailureWindow,
  jobLogUrl,
  redactSecrets,
  runJobsUrl,
  truncateJobLog,
} from "../scripts/ci-github-verdict-logs.mjs";
import { CODE } from "../scripts/ci-github-mirror-push.mjs";
import { runVerdict } from "../scripts/ci-github-verdict-read.mjs";

/* 占位形状（§12.13）：**不用**能被当成真凭据的字面量来拼 —— 与
 * `check-tracked-secrets.test.ts` 同一写法（前缀与随机段分开拼）。 */
const TOKEN = "ghp_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8";
const EXACT_TOKEN = "gh-token-secret-value";
const FINE_GRAINED = "github_pat_" + "11ABCDEFG0123456789abcdef";
const SHA = "26a3c3ed06deb679974200d68005ff583178d63f";
const REPO = "wuxianyuedu/comfy-app";
const RED = new Set(["action_required", "cancelled", "failure", "startup_failure", "timed_out"]);

/** 把「按 URL 回话」的假件包成 fetch 的形状（不写 `as unknown as` 这类不安全的断言）。 */
const fakeFetch =
  (handler: (url: string) => Response | Promise<Response>): typeof fetch =>
  (input) =>
    Promise.resolve(
      handler(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      ),
    );

const runOf = (overrides: Record<string, unknown> = {}) => ({
  conclusion: "failure",
  display_title: `PR #2649 · ${SHA}`,
  id: 123,
  name: "pr-gate",
  status: "completed",
  ...overrides,
});

const jobsBodyOf = (jobs: Array<unknown>) => JSON.stringify({ jobs, total_count: jobs.length });

const jobOf = (overrides: Record<string, unknown> = {}) => ({
  conclusion: "failure",
  id: 456,
  name: "static-gates",
  status: "completed",
  steps: [
    { conclusion: "success", name: "Set up job", number: 1 },
    { conclusion: "failure", name: "Run pnpm lint", number: 2 },
  ],
  ...overrides,
});

describe("纯函数：脱敏 / 截断 / 失败窗口", () => {
  it("redactSecrets：精确令牌值与 ghp_ / github_pat_ 形状都抹成 <redacted>，正文其余不动", () => {
    const text = `a=${EXACT_TOKEN} b=${TOKEN} c=${FINE_GRAINED} d=keep`;
    const out = redactSecrets(text, EXACT_TOKEN);
    expect(out).not.toContain(EXACT_TOKEN);
    expect(out).not.toContain(TOKEN);
    expect(out).not.toContain(FINE_GRAINED);
    expect(out).toContain("a=<redacted>");
    expect(out).toContain("b=<redacted>");
    expect(out).toContain("c=<redacted>");
    expect(out).toContain("d=keep");
  });

  it("truncateJobLog：恰好上限不截断；上限 +1 字节保留首尾并标省略", () => {
    const line = "x".repeat(99);
    /* 10 行 × 99 字符 + 9 个换行 = 999 字节；上限 999 ⇒ 原样。 */
    const exact = Array.from({ length: 10 }, () => line).join("\n");
    expect(Buffer.byteLength(exact, "utf8")).toBe(999);
    expect(truncateJobLog(exact, 999).truncated).toBe(false);
    const over = `${exact}\n`;
    expect(Buffer.byteLength(over, "utf8")).toBe(1000);
    const cut = truncateJobLog(over, 999);
    expect(cut.truncated).toBe(true);
    expect(cut.text).toContain("中间省略");
    /* 首尾都留着（排障要的头与退码要的尾都不丢）。 */
    expect(cut.text.startsWith("xxxx")).toBe(true);
    expect(cut.text.trimEnd().endsWith("xxxx")).toBe(true);
  });

  it("truncateJobLog：含超长单行时该行被压到 4000 字符，整体仍遵守上限读数", () => {
    const huge = `${"y".repeat(20000)}\n`;
    const cut = truncateJobLog(huge, 1000);
    expect(cut.truncated).toBe(true);
    expect(cut.text).toContain("本行已截到 4000 字符");
    expect(cut.text).not.toContain("y".repeat(4001));
  });

  it("extractFailureWindow：拿 ##[error] 所在的 ##[group] 段（失败 step 的原始窗口），并单独给注解", () => {
    const text = [
      "##[group]Run pnpm lint",
      "pnpm lint",
      "##[error]Process completed with exit code 1.",
      "##[endgroup]",
      "after",
    ].join("\n");
    const win = extractFailureWindow(text);
    expect(win.errors).toEqual(["##[error]Process completed with exit code 1."]);
    expect(win.lines[0]).toBe("##[group]Run pnpm lint");
    expect(win.lines.at(-1)).toBe("##[endgroup]");
    expect(win.startLine).toBe(1);
  });

  it("capStageWindow：恰好 60 KiB 不截；+1 字节截到首尾并写「全量见附件」", () => {
    const exact = "z".repeat(STAGE_WINDOW_MAX_BYTES);
    const win = { errors: [], lines: [exact], startLine: 1 };
    expect(capStageWindow(win).truncated).toBe(false);
    const big = Array.from({ length: 1000 }, () => "z".repeat(100)).join("\n");
    const capped = capStageWindow({ errors: [], lines: big.split("\n"), startLine: 1 });
    expect(capped.truncated).toBe(true);
    expect(capped.lines.join("\n")).toContain("全量见附件");
    expect(capped.shownLines).toBeLessThan(capped.totalLines);
  });

  it("capStageWindow：单行超长且只剩一行时硬压该行进预算（不靠行数兜底）", () => {
    const capped = capStageWindow({ errors: [], lines: ["x".repeat(200_000)], startLine: 1 }, 1000);
    expect(capped.truncated).toBe(true);
    expect(capped.lines.at(-1)).toContain("本行已截短");
    expect(Buffer.byteLength(capped.lines.join("\n"), "utf8")).toBeLessThanOrEqual(1300);
  });

  it("URL：job 清单按 run id、日志按 job id（与 GitHub REST 端点同形）", () => {
    expect(runJobsUrl(REPO, 123)).toBe(
      `https://api.github.com/repos/${REPO}/actions/runs/123/jobs?per_page=100`,
    );
    expect(jobLogUrl(REPO, 456)).toBe(`https://api.github.com/repos/${REPO}/actions/jobs/456/logs`);
  });
});

describe("dumpFailingRunLogs（日志取不到不改判决 / 全量落盘 / 窗口进 stage）", () => {
  /** 假 fetch：按 URL 后缀分流 job 清单与 job 日志。 */
  const harness = (handlers: {
    jobs?: (url: string) => Response | Promise<Response>;
    logs?: (url: string) => Response | Promise<Response>;
    write?: (text: string) => string;
  }) => {
    const heard: string[] = [];
    const written: string[] = [];
    const io = {
      fetchImpl: fakeFetch(async (url: string) => {
        if (url.includes("/actions/runs/")) {
          const res = handlers.jobs
            ? await handlers.jobs(url)
            : new Response(jobsBodyOf([jobOf()]), { status: 200 });
          return res;
        }
        const res = handlers.logs
          ? await handlers.logs(url)
          : new Response(
              [
                "##[group]Run pnpm lint",
                "pnpm lint",
                `LEAK=${TOKEN}`,
                "##[error]Process completed with exit code 1.",
                "##[endgroup]",
                "##[error]Process completed with exit code 1.",
              ].join("\n"),
              { status: 200 },
            );
        return res;
      }),
      log: (line: string) => {
        heard.push(line);
      },
      sleep: () => Promise.resolve(),
      token: EXACT_TOKEN,
      writeLogFile: (text: string) => {
        written.push(text);
        return handlers.write ? handlers.write(text) : `${JOB_LOGS_DIR_REL}/${JOB_LOGS_FILE_NAME}`;
      },
    };
    return { heard, io, written };
  };

  it("失败 job ⇒ step / 注解 / 原始窗口进 stage，全量脱敏落盘且附件路径念出来", async () => {
    const { heard, io, written } = harness({});
    await dumpFailingRunLogs(io, REPO, [runOf()], RED);
    const all = heard.join("\n");
    expect(all).toContain("run 123");
    expect(all).toContain("job「static-gates」（failure）");
    expect(all).toContain("失败 step #2「Run pnpm lint」（failure）");
    expect(all).toContain("失败注解：##[error]Process completed with exit code 1.");
    expect(all).toContain("失败窗口");
    expect(all).toContain("##[group]Run pnpm lint");
    expect(all).toContain(`${JOB_LOGS_DIR_REL}/${JOB_LOGS_FILE_NAME}`);
    /* 落盘正文是全量、已脱敏：令牌形状一个都不许出现。 */
    expect(written).toHaveLength(1);
    expect(written[0]).toContain("job「static-gates」");
    expect(written[0]).not.toContain(TOKEN);
    expect(written[0]).toContain("LEAK=<redacted>");
  });

  it("job 列表 404 ⇒ 只多一行缺因（带 HTTP 状态），不抛、不落盘", async () => {
    const { heard, io, written } = harness({
      jobs: () => new Response("not found", { status: 404 }),
    });
    await dumpFailingRunLogs(io, REPO, [runOf()], RED);
    const all = heard.join("\n");
    expect(all).toContain("job 列表取不到：HTTP 404");
    expect(all).toContain("判决不受影响");
    expect(written).toHaveLength(0);
  });

  it("job 日志 401/403 ⇒ 念「令牌缺 actions: read」，不抛、不落盘", async () => {
    const { heard, io, written } = harness({
      logs: () => new Response("forbidden", { status: 403 }),
    });
    await dumpFailingRunLogs(io, REPO, [runOf()], RED);
    const all = heard.join("\n");
    expect(all).toContain("取不到：HTTP 403（令牌缺 actions: read）");
    expect(written).toHaveLength(0);
  });

  it("日志 200 但正文为空 ⇒ 「取到了但为空（0 行）」，与「取不到」分开念", async () => {
    const { heard, io } = harness({
      logs: () => new Response("", { status: 200 }),
    });
    await dumpFailingRunLogs(io, REPO, [runOf()], RED);
    expect(heard.join("\n")).toContain("日志取到了但为空（0 行）");
    expect(heard.join("\n")).not.toContain("取不到：");
  });

  it("失败窗口超 60 KiB ⇒ 保留首尾并写「已截到 N 行 / 上限 M 字节（全量见附件）」", async () => {
    const huge = [
      "##[group]Run heavy",
      ...Array.from({ length: 5000 }, (_, i) => `line-${String(i)}-${"q".repeat(30)}`),
      "##[error]Process completed with exit code 1.",
      "##[endgroup]",
    ].join("\n");
    const { heard, io } = harness({ logs: () => new Response(huge, { status: 200 }) });
    await dumpFailingRunLogs(io, REPO, [runOf()], RED);
    const all = heard.join("\n");
    expect(all).toMatch(new RegExp("已截到 \\d+ 行 / 上限 \\d+ 字节（全量见附件）", "u"));
    expect(all).toContain("##[error]Process completed with exit code 1.");
  });

  it("两个都超界的失败窗口 ⇒ 第二窗按剩余预算截；stage 正文总量仍不超过上限", async () => {
    const huge = [
      "##[group]Run heavy",
      ...Array.from({ length: 5000 }, (_, i) => `line-${String(i)}-${"q".repeat(30)}`),
      "##[error]Process completed with exit code 1.",
      "##[endgroup]",
    ].join("\n");
    const { heard, io } = harness({
      jobs: () =>
        new Response(
          jobsBodyOf([
            jobOf({ id: 456, name: "a" }),
            jobOf({ id: 789, name: "b" }),
          ]),
          { status: 200 },
        ),
      logs: () => new Response(huge, { status: 200 }),
    });
    await dumpFailingRunLogs(io, REPO, [runOf()], RED);
    /* 窗口正文（不以 `[verdict]` 开头的那些行）合计必须留在 stage 预算内 —— 否则
     * 第二个窗口会把 CNB 的 102400 字节上限顶穿，「全量日志已落盘」那一行先被吞。 */
    const bodyBytes = heard
      .filter((line) => !line.startsWith("[verdict]"))
      .reduce((sum, line) => sum + Buffer.byteLength(line, "utf8") + 1, 0);
    expect(bodyBytes).toBeLessThanOrEqual(STAGE_WINDOW_MAX_BYTES);
    /* 第二窗拿的是**剩余**预算 ⇒ 它的「上限」比第一窗小（而不是各自再拿 60 KiB）。 */
    const caps = [
      ...heard.join("\n").matchAll(/已截到 \d+ 行 \/ 上限 (?<bytes>\d+) 字节/gu),
    ].map((m) => Number(m.groups?.bytes ?? ""));
    expect(caps).toHaveLength(2);
    expect(caps[1]).toBeLessThan(caps[0]);
  });

  it("落盘抛异常也只是少一份附件：不向上抛、判决读数照旧", async () => {
    const { heard, io } = harness({
      write: () => {
        throw new Error(`磁盘满了 ${TOKEN}`);
      },
    });
    await expect(dumpFailingRunLogs(io, REPO, [runOf()], RED)).resolves.toBeUndefined();
    const all = heard.join("\n");
    expect(all).toContain("回读 job 日志时出现异常（不影响判决）");
    expect(all).not.toContain(TOKEN);
  });
});

describe("runVerdict 集成：判红 + job 日志取不到 ⇒ 退码不变", () => {
  const gitOk = (args: Array<string>) =>
    args[0] === "rev-parse" ? { code: 0, stderr: "", stdout: `${SHA}\n` } : { code: 0, stderr: "", stdout: "" };

  const harnessVerdict = (jobResponse: Response) => {
    const heard: string[] = [];
    const calls: Array<string> = [];
    const io = {
      env: { CNB_PULL_REQUEST_IID: "2649", GITHUB_MIRROR_TOKEN: EXACT_TOKEN },
      fetchImpl: fakeFetch((url: string) => {
        calls.push(url);
        if (url.includes("/actions/runs/") && url.includes("/jobs")) {
          return jobResponse;
        }
        if (url.includes("/actions/jobs/")) {
          return new Response("", { status: 200 });
        }
        if (url.includes("/actions/runs")) {
          return new Response(
            JSON.stringify({ total_count: 1, workflow_runs: [runOf({ status: "completed" })] }),
            { status: 200 },
          );
        }
        return new Response("{}", { status: 200 });
      }),
      log: (line: string) => {
        heard.push(line);
      },
      readFile: () => {
        throw new Error("ENOENT");
      },
      root: "/repo",
      runGit: gitOk,
      sleep: () => Promise.resolve(),
      now: () => 1,
      writeLogFile: () => `${JOB_LOGS_DIR_REL}/${JOB_LOGS_FILE_NAME}`,
    };
    return { calls, heard, io };
  };

  it("job 列表 404 ⇒ 仍退 1（日志端点挂了不许把红洗成绿/绿洗成红）", async () => {
    const { heard, io } = harnessVerdict(new Response("nope", { status: 404 }));
    const code = await runVerdict(io);
    expect(code).toBe(CODE.FAIL);
    const all = heard.join("\n");
    expect(all).toContain("job 列表取不到：HTTP 404");
    expect(all).toContain("结论：exit 1");
  });
});

describe("契约：.cnb.yml 的附件 stage 与落盘路径同源", () => {
  it("有「GA 失败日志附件」stage，上传的正是脚本写的那个相对路径", () => {
    const yml = readFileSync(new URL("../.cnb.yml", import.meta.url), "utf8");
    expect(yml).toContain("GA 失败日志附件");
    expect(yml).toContain("cnbcool/attachments");
    expect(yml).toContain(`${JOB_LOGS_DIR_REL}/${JOB_LOGS_FILE_NAME}`);
  });
});
