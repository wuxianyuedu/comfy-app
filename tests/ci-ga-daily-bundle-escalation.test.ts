/**
 * `scripts/ci-ga-daily-bundle-escalation.mjs` 的契约：GA 每日档的预算账陈旧度触发器取数链。
 *
 * 与 CNB 侧 `fetchBundleRedStreak` 同一族，差异只在平台 API：workflow_runs 列表 →
 * 失败 job → job 日志 → 判决行。本组钉住三个容易骗人的形态：
 *   ① 「没红」与「没结论」不许混成一句（green 断、cancelled unknown）；
 *   ② 上一跑不在 completed runs 里 / 列表取不到 ⇒ unknown，不冒充「没到门限」；
 *   ③ 当前跑复用立案那一跳已取到的正文，不发第二遍日志请求。
 */
import { describe, expect, it } from "vitest";

import {
  dailyRunsUrl,
  fetchGaBundleRedStreak,
  stripAnsi,
} from "../scripts/ci/ci-ga-daily-bundle-escalation.mjs";

/** 应答用真 `Response`：`requestJson` / `requestText` 只需要 `ok` / `status` / 正文两个读法。 */
function res(status: number, body: unknown): Response {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(text, { status });
}

type FetchLike = typeof fetch;

const GH_REPO = "wuxianyuedu/comfy-app";
const RUN_ID = "1234567890";
const PREV_ID = "1234567111";

const ENFORCED_LOG = [
  "[bundle-budget] 违规（阻断）：",
  "  gzip 总量 +17.4 KB",
  "  基线修订号：dd8d4647（其后本检出上有 35 次提交）——",
].join("\n");

const SUSPENDED_LOG = "[bundle-budget] 读数（不参与判定）：\n  gzip 总量 +17.4 KB";

/** 一整套 GA 应答：runs 列表 → 每个 run 的 jobs → 每个失败 job 的日志。 */
function gaWorld(opts: {
  jobsByRun?: Record<string, unknown>;
  logByJob?: Record<string, string>;
  runs: Array<{ conclusion?: string; id: number | string; status?: string }>;
}) {
  const calls: string[] = [];
  const fetchImpl: FetchLike = (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(url).pathname;
    calls.push(path);
    if (path.endsWith("/actions/workflows/daily.yml/runs")) {
      return Promise.resolve(
        res(200, {
          workflow_runs: opts.runs.map((r) => ({
            conclusion: r.conclusion ?? "failure",
            id: typeof r.id === "string" ? Number(r.id) : r.id,
            status: r.status ?? "completed",
          })),
        }),
      );
    }
    const jobsMatch = /\/actions\/runs\/(?<id>\d+)\/jobs$/.exec(path);
    if (jobsMatch) {
      const jobs = opts.jobsByRun?.[jobsMatch.groups?.id ?? ""] ?? {
        jobs: [{ conclusion: "failure", id: 9, name: "daily" }],
      };
      return Promise.resolve(res(200, jobs));
    }
    const logMatch = /\/actions\/jobs\/(?<id>\d+)\/logs$/.exec(path);
    if (logMatch) {
      const log = opts.logByJob?.[logMatch.groups?.id ?? ""] ?? ENFORCED_LOG;
      return Promise.resolve(res(200, log));
    }
    return Promise.resolve(res(404, { message: `unexpected ${path}` }));
  };
  return { calls, fetchImpl };
}

describe("dailyRunsUrl / stripAnsi", () => {
  it("runs 列表指向 Daily (mirror)，per_page 由调用方给", () => {
    expect(dailyRunsUrl(GH_REPO, 9)).toBe(
      `https://api.github.com/repos/${GH_REPO}/actions/workflows/daily.yml/runs?per_page=9`,
    );
  });

  it("stripAnsi 剥掉转义序列、保留正文", () => {
    expect(stripAnsi("\u001b[31m[bundle-budget] 违规（阻断）\u001b[0m\n  一行")).toBe(
      "[bundle-budget] 违规（阻断）\n  一行",
    );
    expect(stripAnsi(null)).toBe("");
  });
});

describe("fetchGaBundleRedStreak", () => {
  it("当前跑 + 上一跑都判红 ⇒ 连续 2 天（当前跑复用 known.text，不发它的 jobs/logs）", async () => {
    const { calls, fetchImpl } = gaWorld({
      runs: [
        { conclusion: "failure", id: RUN_ID },
        { conclusion: "failure", id: PREV_ID },
      ],
      logByJob: { "9": ENFORCED_LOG },
    });
    const { days, note } = await fetchGaBundleRedStreak({
      ghRepo: GH_REPO,
      ghToken: "t",
      runId: RUN_ID,
      known: { runId: RUN_ID, text: ENFORCED_LOG },
      fetchImpl,
    });
    expect(days).toBe(2);
    expect(note).toContain("逐日回看");
    /* 当前跑不许发 jobs / logs 请求（known.text 复用）；上一跑各一跳。 */
    expect(calls.filter((c) => c.includes(`/runs/${RUN_ID}/jobs`))).toEqual([]);
    expect(calls.filter((c) => c.includes(`/runs/${PREV_ID}/jobs`)).length).toBe(1);
    expect(calls.filter((c) => c.includes("/jobs/9/logs")).length).toBe(1);
  });

  it("上一跑是 success ⇒ 连续在这里断，返回已数的天数", async () => {
    const { fetchImpl } = gaWorld({
      runs: [
        { conclusion: "failure", id: RUN_ID },
        { conclusion: "success", id: PREV_ID },
      ],
    });
    const { days, note } = await fetchGaBundleRedStreak({
      ghRepo: GH_REPO,
      ghToken: "t",
      runId: RUN_ID,
      known: { runId: RUN_ID, text: ENFORCED_LOG },
      fetchImpl,
    });
    expect(days).toBe(1);
    expect(note).toContain(PREV_ID);
  });

  it("上一跑被取消 ⇒ unknown（取消 ≠ 红，也 ≠ 绿）", async () => {
    const { fetchImpl } = gaWorld({
      runs: [
        { conclusion: "failure", id: RUN_ID },
        { conclusion: "cancelled", id: PREV_ID },
      ],
    });
    const { days, note } = await fetchGaBundleRedStreak({
      ghRepo: GH_REPO,
      ghToken: "t",
      runId: RUN_ID,
      known: { runId: RUN_ID, text: ENFORCED_LOG },
      fetchImpl,
    });
    expect(days).toBe("unknown");
    expect(note).toContain("cancelled");
  });

  it("上一跑在列表里但 job 日志取不到 ⇒ unknown", async () => {
    const { fetchImpl } = gaWorld({
      runs: [
        { conclusion: "failure", id: RUN_ID },
        { conclusion: "failure", id: PREV_ID },
      ],
      jobsByRun: { [PREV_ID]: { jobs: [{ conclusion: "failure", id: 9, name: "daily" }] } },
    });
    const failing: FetchLike = (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/logs")) {
        return Promise.resolve(res(500, "boom"));
      }
      return fetchImpl(input, init);
    };
    const { days, note } = await fetchGaBundleRedStreak({
      ghRepo: GH_REPO,
      ghToken: "t",
      runId: RUN_ID,
      known: { runId: RUN_ID, text: ENFORCED_LOG },
      fetchImpl: failing,
    });
    expect(days).toBe("unknown");
    expect(note).toContain("job 日志取不到");
  });

  it("runs 列表取不到 ⇒ unknown（不是「没到门限」）", async () => {
    const fetchImpl: FetchLike = () => Promise.resolve(res(403, { message: "forbidden" }));
    const { days, note } = await fetchGaBundleRedStreak({
      ghRepo: GH_REPO,
      ghToken: "t",
      runId: RUN_ID,
      known: { runId: RUN_ID, text: ENFORCED_LOG },
      fetchImpl,
    });
    expect(days).toBe("unknown");
    expect(note).toContain("runs 列表取不到");
  });

  it("当前跑不在 completed runs 列表里 ⇒ unknown", async () => {
    const { fetchImpl } = gaWorld({
      runs: [{ conclusion: "failure", id: PREV_ID }],
    });
    const { days, note } = await fetchGaBundleRedStreak({
      ghRepo: GH_REPO,
      ghToken: "t",
      runId: RUN_ID,
      known: { runId: RUN_ID, text: ENFORCED_LOG },
      fetchImpl,
    });
    expect(days).toBe("unknown");
    expect(note).toContain("completed runs 列表");
  });

  it("in_progress 的历史跑被过滤，不当成一天", async () => {
    const { fetchImpl } = gaWorld({
      runs: [
        { conclusion: "failure", id: RUN_ID },
        { conclusion: "failure", id: PREV_ID, status: "in_progress" },
      ],
    });
    const { days, note } = await fetchGaBundleRedStreak({
      ghRepo: GH_REPO,
      ghToken: "t",
      runId: RUN_ID,
      known: { runId: RUN_ID, text: ENFORCED_LOG },
      fetchImpl,
    });
    /* 过滤后只剩当前这一跑，回看不够 need ⇒ unknown（不是 1、也不是「连续红 N 天」）。 */
    expect(days).toBe("unknown");
    expect(note).toContain("只有 1 跑");
  });

  it("历史跑预算闸没有判红（marker=none）⇒ 连续在这里断", async () => {
    const { fetchImpl } = gaWorld({
      runs: [
        { conclusion: "failure", id: RUN_ID },
        { conclusion: "failure", id: PREV_ID },
      ],
      logByJob: { "9": "##[error]单元测试超时\n没有预算闸读数" },
    });
    const { days, note } = await fetchGaBundleRedStreak({
      ghRepo: GH_REPO,
      ghToken: "t",
      runId: RUN_ID,
      known: { runId: RUN_ID, text: ENFORCED_LOG },
      fetchImpl,
    });
    expect(days).toBe(1);
    expect(note).toContain("没有判红");
  });

  it("历史跑是暂撤（suspended）⇒ 连续在这里断，不冒充红", async () => {
    const { fetchImpl } = gaWorld({
      runs: [
        { conclusion: "failure", id: RUN_ID },
        { conclusion: "failure", id: PREV_ID },
      ],
      logByJob: { "9": SUSPENDED_LOG },
    });
    const { days, note } = await fetchGaBundleRedStreak({
      ghRepo: GH_REPO,
      ghToken: "t",
      runId: RUN_ID,
      known: { runId: RUN_ID, text: ENFORCED_LOG },
      fetchImpl,
    });
    expect(days).toBe(1);
    expect(note).toContain("没有判红");
  });
});
