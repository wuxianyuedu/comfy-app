/**
 * `scripts/ci-ga-failure-logs.mjs` 的契约（#3584）：立案正文里的「红的那部分日志」。
 *
 * 这一族最贵的失效不是「没贴」，而是**把取不到写成没有**（§13.6.2）、**把凭据贴进单子**
 * （硬规则 17）、**正文顶穿平台硬上限被拒还以为建成了**（ISSUE #2248）。三形都有反面锚：
 *   ① 取不到 ⇒ 正文写「取不到」+ 可粘贴命令，且不出现「没有失败行」那类结论；
 *   ② 令牌 / env / JSON 形状一律 `<redacted>`；
 *   ③ 任意大小的日志，`renderLogReadout` 的字节数都不超过 `LOG_BODY_BUDGET`，
 *      且红色窗口（注解 / 失败行）**始终在正文里** —— 降级只许降「完整日志」那一节。
 */
import { describe, expect, it } from "vitest";

import {
  ERROR_BUDGET,
  LOG_BODY_BUDGET,
  MAX_ERROR_LINES,
  WINDOW_BUDGET,
  capLogWindow,
  collectFailureLogReading,
  failedJobsFromJson,
  failureLines,
  renderLogReadout,
} from "../scripts/ci-ga-failure-logs.mjs";
import { FAILED_JOB_CONCLUSIONS } from "../scripts/ci-ga-logs-relay.mjs";

const GH_REPO = "wuxianyuedu/comfy-app";
const RUN_ID = "43014176820";
const JOB = { conclusion: "failure", id: 130_501_000_674, name: "daily" };

/** 一份贴 GA 真实形状的日志：group / error 注解 / 尾部。 */
function gaLog(extra: string[] = []) {
  return [
    "2026-11-11T11:00:00.000Z ##[group]Run node scripts/full-suite-run.mjs",
    "node scripts/full-suite-run.mjs",
    "Test Files  1 failed | 99 passed (100)",
    "##[error]FAIL  tests/full-suite-run.test.ts > 全量单测预算",
    "##[error]AssertionError: expected 1 to be 0",
    "GITHUB_TOKEN=ghs_leak_me_not",
    "##[endgroup]",
    ...extra,
  ].join("\n");
}

/** 真实 `Response` 的替身：`requestJson` / `requestText` 只需要 `ok` / `status` / 正文两个读法。 */
function res(status: number, body: unknown): Response {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(text, { status });
}

/** 假 fetch：jobs 端点给清单，/actions/jobs/{id}/logs 给正文，其余 404。 */
function gaFetch(opts: { jobs?: unknown; log?: string; logStatus?: number } = {}): {
  calls: string[];
  fetchImpl: typeof fetch;
} {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    await Promise.resolve();
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    if (url.includes("/actions/runs/") && url.endsWith("/jobs?per_page=100")) {
      return res(200, opts.jobs ?? { jobs: [JOB] });
    }
    if (url.includes("/actions/jobs/")) {
      return res(opts.logStatus ?? 200, opts.log ?? gaLog());
    }
    return res(404, { message: "no handler" });
  };
  return { calls, fetchImpl };
}

function readout(overrides: Record<string, unknown> = {}) {
  return renderLogReadout({
    ghRepo: GH_REPO,
    jobs: [JOB],
    ok: true,
    runId: RUN_ID,
    text: gaLog(),
    ...overrides,
  });
}

describe("红色失败窗口（至少贴红的那部分）", () => {
  it("正文含 `##[error]` 注解与失败 step 窗口，且带行号读数", () => {
    const body = readout();
    expect(body).toContain("##[error]FAIL  tests/full-suite-run.test.ts");
    expect(body).toContain("AssertionError: expected 1 to be 0");
    expect(body).toContain("Run node scripts/full-suite-run.mjs");
    expect(body).toContain("红的那部分");
  });

  it("完整日志装得下就整份贴（读者不用跳 GA 页面）", () => {
    const body = readout();
    expect(body).toContain("完整日志（装得下，整份贴在这里）");
    expect(body).toContain("99 passed (100)");
  });

  it("装不下就给窗口 + 下载端点 + 可粘贴命令，红色那部分仍在", () => {
    const big = gaLog(
      Array.from({ length: 4000 }, (_, i) => `line ${String(i)} padding padding padding`),
    );
    const body = readout({ text: big });
    expect(body).toContain("超出正文预算");
    expect(body).toContain(
      `https://api.github.com/repos/${GH_REPO}/actions/jobs/${String(JOB.id)}/logs`,
    );
    expect(body).toContain(`gh run view ${RUN_ID} --repo ${GH_REPO} --log-failed`);
    expect(body).toContain("##[error]FAIL  tests/full-suite-run.test.ts");
  });

  it("任意大小的日志都不顶穿正文预算（平台硬上限，ISSUE #2248 同一量纲）", () => {
    const huge = `##[error]${"x".repeat(2_000_000)}`;
    const body = readout({ text: huge });
    expect(Buffer.byteLength(body, "utf8")).toBeLessThanOrEqual(LOG_BODY_BUDGET);
    expect(body).toContain("红的那部分");
    /* 超长单行先被形状归一（标出截断），窗口预算再压一次 —— 两种明示都要在。 */
    expect(body).toContain("本行已截到");
    expect(body).not.toContain("undefined");
  });

  it("超长单行先做形状归一（标出截断），再按窗口预算压短", () => {
    const long = `##[error]${"x".repeat(200_000)}`;
    const win = failureLines(long, 4096);
    expect(Buffer.byteLength(win.lines.join("\n"), "utf8")).toBeLessThanOrEqual(4096);
    expect(win.lines.join("\n")).toContain("本行已截到");
  });

  it("clampLongLines 幂等：渲染层与窗口层各过一次不会二次截短", async () => {
    const { clampLongLines, MAX_LINE_CHARS } = await import("../scripts/ci-ga-failure-logs.mjs");
    const once = clampLongLines(`x`.repeat(200_000));
    expect(once.length).toBe(MAX_LINE_CHARS);
    expect(clampLongLines(once)).toBe(once);
  });

  it("注解按条数与字节双封顶：省掉的条数念出来，不静默丢", () => {
    const many = Array.from(
      { length: MAX_ERROR_LINES + 12 },
      (_, i) => `##[error]boom ${String(i)}`,
    );
    const win = failureLines(many.join("\n"));
    expect(win.errors.length).toBeLessThanOrEqual(MAX_ERROR_LINES);
    expect(win.omittedErrors).toBeGreaterThan(0);
  });

  it("预算常量不自相矛盾：窗口 + 注解留得下完整日志之外的余量", () => {
    expect(WINDOW_BUDGET).toBeGreaterThan(1024);
    expect(WINDOW_BUDGET + ERROR_BUDGET).toBeLessThan(LOG_BODY_BUDGET);
    expect(capLogWindow({ errors: [], lines: ["x"], startLine: 1 }, 64).maxBytes).toBe(64);
  });
});

describe("取不到 ≠ 没有失败行（§13.6.2）", () => {
  it("ok=false 时正文写「取不到」+ 原因 + 出口，且不冒充结论", () => {
    const body = renderLogReadout({
      ghRepo: GH_REPO,
      jobs: [JOB],
      ok: false,
      reason: "job 清单 HTTP 403（令牌缺 actions: read）",
      runId: RUN_ID,
      text: "",
    });
    expect(body).toContain("取不到");
    expect(body).toContain("HTTP 403");
    expect(body).toContain("这一跳没拿到读数");
    expect(body).toContain(`gh run view ${RUN_ID} --repo ${GH_REPO} --log-failed`);
  });

  it("job 清单取不到时 collectFailureLogReading 给 ok=false，不据空数组说没有日志", async () => {
    const bad = gaFetch({ jobs: { notJobs: true }, log: gaLog() });
    const reading = await collectFailureLogReading({
      fetchImpl: bad.fetchImpl,
      ghRepo: GH_REPO,
      ghToken: "ghs_fake",
      jobsJson: { notJobs: true },
      log: () => undefined,
      runId: RUN_ID,
      sleep: () => Promise.resolve(),
    });
    expect(reading.ok).toBe(false);
    expect(reading.reason).toContain("job 清单");
    expect(reading.text).toBe("");
  });

  it("调用方递了 jobsJson 就不再问第二遍清单（立案那一跳已经问过）", async () => {
    const f = gaFetch({ log: gaLog() });
    const reading = await collectFailureLogReading({
      fetchImpl: f.fetchImpl,
      ghRepo: GH_REPO,
      ghToken: "ghs_fake",
      jobsJson: { jobs: [JOB] },
      log: () => undefined,
      runId: RUN_ID,
      sleep: () => Promise.resolve(),
    });
    expect(reading.ok).toBe(true);
    expect(reading.jobs).toEqual([JOB]);
    /* 清单只问一次（共享的 `collectFailedJobLogs` 自己那一跳）；本模块的
     * `failedJobsFromJson` 是纯函数，不再叠加第二次 jobs 请求。 */
    expect(f.calls.filter((u) => u.includes("/actions/runs/"))).toHaveLength(1);
    expect(failedJobsFromJson({ jobs: [JOB] }).ok).toBe(true);
    expect(failedJobsFromJson({}).ok).toBe(false);
  });

  it("日志端点 403 时给 ok=false，且带出失败 job 清单供下载端点那一节用", async () => {
    const bad = gaFetch({ logStatus: 403 });
    const reading = await collectFailureLogReading({
      fetchImpl: bad.fetchImpl,
      ghRepo: GH_REPO,
      ghToken: "ghs_fake",
      log: () => undefined,
      runId: RUN_ID,
      sleep: () => Promise.resolve(),
    });
    expect(reading.ok).toBe(false);
    expect(reading.jobs).toEqual([JOB]);
    expect(renderLogReadout(reading)).toContain("取不到");
  });
});

describe("脱敏（硬规则 17）", () => {
  it("渲染层再抹一次：env / 令牌形状不进单子正文", () => {
    /* 夹具里的凭据一律占位形状（硬规则 17：被跟踪的文字也在扫描面）。
     * 这里要验的是 `redactSecrets` 会不会抹，不是真拿一枚令牌来试。 */
    const body = readout({
      text: gaLog([
        `GITHUB_TOKEN=<token-not-for-production-use>`,
        "ghp_<redacted>",
        `{"password":"pw123"}`,
      ]),
    });
    expect(body).toContain("<redacted>");
    expect(body).not.toContain("ghs_leak_me_not");
    expect(body).not.toContain("super-secret-value");
    expect(body).not.toContain("pw123");
  });
});

describe("复用：判红词表只有一份（与日志搬运同一集合）", () => {
  it("失败 job 的端点按同一词表给，timed_out 也算", () => {
    const jobs = [
      { conclusion: "failure", id: 1, name: "a" },
      { conclusion: "timed_out", id: 2, name: "b" },
      { conclusion: "skipped", id: 3, name: "c" },
    ];
    const body = renderLogReadout({
      ghRepo: GH_REPO,
      jobs,
      ok: true,
      runId: RUN_ID,
      text: "##[error]boom\n".repeat(40_000),
    });
    expect(FAILED_JOB_CONCLUSIONS.has("timed_out")).toBe(true);
    expect(body).toContain(`/actions/jobs/2/logs`);
    expect(body).toContain(`/actions/jobs/1/logs`);
    expect(body).not.toContain(`/actions/jobs/3/logs`);
  });
});

describe("main 与立案脚本接线", () => {
  it("立案正文（composeBody）在给了 logReadout 时把它放进「当场读数」", async () => {
    const { composeBody } = await import("../scripts/ci-ga-daily-failure-issue.mjs");
    const body = composeBody({
      ghRepo: GH_REPO,
      handle: "ci-ga-daily",
      logReadout: "## 失败日志（平台原样摘录，已脱敏）\n\n##[error]boom",
      runId: RUN_ID,
      sha: "8f0223aa280c533325d4abd16590919c63cb0cb7",
      step: "单元测试（排最后）",
    });
    expect(body).toContain("## 当场读数（出处）");
    expect(body).toContain("##[error]boom");
    expect(body).toContain(`https://github.com/${GH_REPO}/actions/runs/${RUN_ID}`);
    expect(body).toContain("根因");
  });

  it("没给 logReadout 时旧正文形状仍成立（纯函数兼容）", async () => {
    const { composeBody } = await import("../scripts/ci-ga-daily-failure-issue.mjs");
    const body = composeBody({
      ghRepo: GH_REPO,
      handle: "ci-ga-daily",
      runId: RUN_ID,
      sha: "8f0223aa",
      step: "全量E2E",
    });
    expect(body).toContain("全量E2E");
    expect(body).toContain("未判定");
  });

  it("立案脚本的 main 接上了日志读数（静态接线，不许悄悄摘掉）", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.resolve(process.cwd(), "scripts", "ci-ga-daily-failure-issue.mjs"),
      "utf8",
    );
    expect(src).toContain("ci-ga-failure-logs.mjs");
    expect(src).toContain("collectFailureLogReading");
    expect(src).toContain("renderLogReadout");
  });
});
