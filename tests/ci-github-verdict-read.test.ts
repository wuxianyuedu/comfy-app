/** `ci-github-verdict-read.mjs` 的用例（ISSUE #3051 期望第 3 条的前置：回读格先按读数档上线）。
 *
 *  双路径版：主路径 runs API（`event=repository_dispatch` 拉触发表，再用 display_title
 *  里的目标 sha 认领本跑）认不到本跑的 run 时回落兜底 checks API。
 *  假件按 URL 分流（`/actions/runs` → 主路径，其余 → 兜底），两条路径的回话可以分别编排。
 *
 *  全部走注入面：fetch / git / sleep / now 都是假件，**一次真网络请求都不发、
 *  一次真墙钟都不付**；令牌脱敏那条是硬规则 17 在这一格的落点。 */
import { describe, expect, it } from "vitest";
import {
  CHECK_RUNS_TIMEOUT_MS,
  POLL_BUDGET_MS,
  POLL_INTERVAL_MS,
  REQUEST_MAX_ATTEMPTS,
  checkRunsUrl,
  isRetryableRequestFailure,
  matchesTargetSha,
  runVerdict,
  summarizeCheckRuns,
  summarizeWorkflowRuns,
  workflowRunsUrl,
} from "../scripts/ci-github-verdict-read.mjs";
import { CODE, RETRY_BACKOFF_MS, exitCodeFor } from "../scripts/ci-github-mirror-push.mjs";

const TOKEN = "gh-token-secret-value";
const SHA = "26a3c3ed06deb679974200d68005ff583178d63f";
const REPO = "wuxianyuedu/comfy-app";

const okEnv = {
  GITHUB_MIRROR_TOKEN: TOKEN,
  CNB_PULL_REQUEST_IID: "2649",
};

/** 假条目（workflow run / check-run 的判定最小面同构；display_title 是主路径
 *  认领本跑的锚点 —— pr-gate.yml 的 run-name 把 payload 的 head_sha 写进标题）。 */
const run = (name: string, status: string, conclusion: string | null = null) => ({
  conclusion,
  display_title: `PR #2649 · ${SHA}`,
  name,
  status,
});

/** 主路径假 200 回话体（runs API）。 */
const runsBodyOf = (runs: Array<unknown>) =>
  JSON.stringify({ total_count: runs.length, workflow_runs: runs });

/** 兜底路径假 200 回话体（check-runs API）。 */
const checksBodyOf = (runs: Array<unknown>) =>
  JSON.stringify({ check_runs: runs, total_count: runs.length });

const ALL_GREEN = [
  run("static-gates", "completed", "success"),
  run("heavy-gates", "completed", "neutral"),
  run("affected-tests", "completed", "skipped"),
];

const gitOk = (args: Array<string>) => {
  if (args[0] === "rev-parse") {
    return { code: 0, stdout: `${SHA}\n`, stderr: "" };
  }
  return { code: 0, stdout: "", stderr: "" };
};

describe("纯函数", () => {
  it("workflowRunsUrl：主路径按 event=repository_dispatch 拉 dispatch 触发表，单页 100 条（不用 ?head_sha= —— dispatch 触发的 run 其 head_sha 落默认分支 HEAD，按它过滤恒得零条）", () => {
    expect(workflowRunsUrl(REPO)).toBe(
      `https://api.github.com/repos/${REPO}/actions/runs?event=repository_dispatch&per_page=100`,
    );
  });

  it("matchesTargetSha：display_title 里带目标 sha 才算本跑（run-name 认领锚点）", () => {
    expect(matchesTargetSha({ display_title: `PR #2649 · ${SHA}` }, SHA)).toBe(true);
    expect(matchesTargetSha({ display_title: `PR #2649 · ${"c".repeat(40)}` }, SHA)).toBe(false);
    expect(matchesTargetSha({ display_title: "manual" }, SHA)).toBe(false);
    expect(matchesTargetSha({}, SHA)).toBe(false);
    expect(matchesTargetSha(null, SHA)).toBe(false);
  });

  it("checkRunsUrl：兜底路径按同一笔 sha 读 check-runs，单页 100 条", () => {
    expect(checkRunsUrl(REPO, SHA)).toBe(
      `https://api.github.com/repos/${REPO}/commits/${SHA}/check-runs?per_page=100`,
    );
  });

  it("isRetryableRequestFailure：网络类认、其余不认", () => {
    expect(isRetryableRequestFailure(new Error("fetch failed"))).toBe(true);
    expect(isRetryableRequestFailure(new Error("主路径（runs API）读数超时（>30000 ms）"))).toBe(true);
    expect(isRetryableRequestFailure(new Error("Connection reset by peer"))).toBe(true);
    expect(
      isRetryableRequestFailure(Object.assign(new Error("boom"), { cause: { code: "ENOTFOUND" } })),
    ).toBe(true);
    /* HTTP 层的拒（401/403/422）不是异常、不走这一判；这里钉的是「普通错误不重试」。 */
    expect(isRetryableRequestFailure(new Error("HTTP 403"))).toBe(false);
    expect(isRetryableRequestFailure(new Error("Invalid username or token"))).toBe(false);
  });

  it("summarizeWorkflowRuns：success/neutral/skipped 算绿；零条 ⇒ 不算跑完", () => {
    const s = summarizeWorkflowRuns(ALL_GREEN);
    expect(s.completed).toBe(true);
    expect(s.failing).toHaveLength(0);
    expect(s.total).toBe(3);
    /* 零条是「GitHub 侧还没起跑」，不是「全绿」—— 必须继续等。 */
    expect(summarizeWorkflowRuns([]).completed).toBe(false);
  });

  it("summarizeWorkflowRuns：failure/timed_out/cancelled/action_required/startup_failure 才算红，还在跑的不算完", () => {
    const red = summarizeWorkflowRuns([
      run("static-gates", "completed", "success"),
      run("fixed-structural-tests", "completed", "failure"),
      run("heavy-gates", "completed", "timed_out"),
      run("affected-tests", "completed", "cancelled"),
      run("typecheck-db-format", "completed", "action_required"),
      /* startup_failure：GitHub 侧连起跑都没起成 —— 平台侧的事故，也算红（主路径词表比兜底多这一条）。 */
      run("pr-gate", "completed", "startup_failure"),
    ]);
    expect(red.completed).toBe(true);
    expect(red.failing).toHaveLength(5);
    const pending = summarizeWorkflowRuns([run("static-gates", "in_progress"), run("heavy-gates", "queued")]);
    expect(pending.completed).toBe(false);
    expect(pending.pending).toHaveLength(2);
  });

  it("summarizeCheckRuns：兜底词表不变（不含 startup_failure）；零条 ⇒ 不算跑完", () => {
    const s = summarizeCheckRuns(ALL_GREEN);
    expect(s.completed).toBe(true);
    expect(s.failing).toHaveLength(0);
    expect(s.total).toBe(3);
    expect(summarizeCheckRuns([]).completed).toBe(false);
    const red = summarizeCheckRuns([run("heavy-gates", "completed", "failure")]);
    expect(red.failing).toHaveLength(1);
  });

  it("预算与节奏：间隔 × 轮数压在 45m 预算内，单次请求上限与镜像格探活同量级", () => {
    expect(POLL_INTERVAL_MS).toBe(30_000);
    expect(POLL_BUDGET_MS).toBe(45 * 60_000);
    expect(CHECK_RUNS_TIMEOUT_MS).toBe(30_000);
    /* 最坏一轮（一条路径 3 次请求 + 退避）远在轮询间隔量级之内 ⇒ 节奏不会被重试自己打乱。 */
    const worstRound = REQUEST_MAX_ATTEMPTS * CHECK_RUNS_TIMEOUT_MS + RETRY_BACKOFF_MS[0]! + RETRY_BACKOFF_MS[1]!;
    expect(worstRound).toBeLessThan(POLL_BUDGET_MS);
  });
});

describe("runVerdict（fetch / git / sleep / now 全假件，按 URL 分流两条路径）", () => {
  /** 收口假件与量具；`runsSteps` / `checksSteps` 按各自路径的调用次序出假回话/假异常，耗尽后落各自的 `fallback`。 */
  function harness(
    opts: {
      checksFallback?: Response;
      checksSteps?: Array<Response | Error>;
      env?: Record<string, string | undefined>;
      nowStep?: number;
      runsFallback?: Response;
      runsSteps?: Array<Response | Error>;
    } = {},
  ) {
    const calls: Array<string> = [];
    const heard: Array<string> = [];
    const sleeps: Array<number> = [];
    const runsSteps = opts.runsSteps ? [...opts.runsSteps] : null;
    const checksSteps = opts.checksSteps ? [...opts.checksSteps] : null;
    let clock = 0;
    const fetchImpl = (async (url: string | URL) => {
      calls.push(String(url));
      const isRuns = String(url).includes("/actions/runs");
      const head = (isRuns ? runsSteps : checksSteps)?.shift();
      if (head instanceof Error) {
        throw head;
      }
      /* 缺省形态：主路径零条（⇒ 回落），兜底全绿 —— 只关心兜底行为的老用例不用改造。 */
      return (
        head ??
        (isRuns
          ? opts.runsFallback ?? new Response(runsBodyOf([]), { status: 200 })
          : opts.checksFallback ?? new Response(checksBodyOf(ALL_GREEN), { status: 200 }))
      );
    }) as unknown as typeof fetch;
    const io = {
      env: opts.env ?? okEnv,
      fetchImpl,
      log: (line: string) => heard.push(line),
      /* 时钟假件：`now` 每被问一次走 `nowStep`，`sleep` 把等待记量并拨钟 ——
       * 预算耗尽那条用 `nowStep` 大跳，一轮就到点，不陪它跑 90 轮。 */
      now: () => {
        const t = clock;
        clock += opts.nowStep ?? 0;
        return t;
      },
      runGit: gitOk,
      sleep: async (ms: number) => {
        sleeps.push(ms);
        clock += ms;
      },
    };
    return { calls, heard, io, sleeps };
  }

  it("主路径全绿 ⇒ 退 0：一跳拿全，根本不发兜底请求", async () => {
    const { calls, heard, io } = harness({ runsFallback: new Response(runsBodyOf(ALL_GREEN), { status: 200 }) });
    const code = await runVerdict(io);
    expect(code).toBe(CODE.OK);
    expect(calls).toEqual([workflowRunsUrl(REPO)]);
    const all = heard.join("\n");
    expect(all).toContain("cnb-pr-2649");
    expect(all).toContain("主路径（runs API）");
    expect(all).toContain("全部完成且没有红");
    expect(all).toContain("结论：exit 0");
  });

  it("主路径有红（含 startup_failure）⇒ 退 1，红的逐条念出来", async () => {
    const { heard, io } = harness({
      runsFallback: new Response(
        runsBodyOf([
          run("static-gates", "completed", "success"),
          run("pr-gate", "completed", "startup_failure"),
          run("heavy-gates", "completed", "failure"),
        ]),
        { status: 200 },
      ),
    });
    const code = await runVerdict(io);
    expect(code).toBe(CODE.FAIL);
    const all = heard.join("\n");
    expect(all).toContain("✗ pr-gate（startup_failure）");
    expect(all).toContain("✗ heavy-gates（failure）");
    expect(all).toContain("结论：exit 1");
    /* `--readout` 折的是对外那一位数，三态原值上面已逐行念过（读数档恒退 0）。 */
    expect(exitCodeFor(code, true)).toBe(0);
    expect(exitCodeFor(code, false)).toBe(1);
  });

  it("主路径 pending 跨轮询转 completed ⇒ 退 0：有 run 就不回落，间隔按 POLL_INTERVAL 等", async () => {
    const { calls, heard, io, sleeps } = harness({
      runsSteps: [
        new Response(
          runsBodyOf([run("static-gates", "completed", "success"), run("heavy-gates", "in_progress")]),
          { status: 200 },
        ),
        new Response(runsBodyOf(ALL_GREEN), { status: 200 }),
      ],
    });
    const code = await runVerdict(io);
    expect(code).toBe(CODE.OK);
    expect(calls).toEqual([workflowRunsUrl(REPO), workflowRunsUrl(REPO)]);
    expect(sleeps).toEqual([POLL_INTERVAL_MS]);
    expect(heard.join("\n")).toContain("还在跑");
  });

  it("主路径零条 run ⇒ 同轮回落兜底，兜底全绿 ⇒ 退 0；日志点名两条路径与回落原因", async () => {
    const { calls, heard, io } = harness();
    const code = await runVerdict(io);
    expect(code).toBe(CODE.OK);
    expect(calls).toEqual([workflowRunsUrl(REPO), checkRunsUrl(REPO, SHA)]);
    const all = heard.join("\n");
    expect(all).toContain("没认出本跑");
    expect(all).toContain("本轮回落兜底（checks API）");
    expect(all).toContain("兜底（checks API）");
    expect(all).toContain("全部完成且没有红");
    expect(all).toContain("结论：exit 0");
  });

  it("主路径拉到了别跑的 run（display_title 无本跑 sha）⇒ 认不出本跑，同轮回落兜底", async () => {
    /* dispatch 触发表是共享的：别个 PR 的 run 也在里面。认领不上 = 本跑还没起，
     * 不是「有 run 就行」—— 这条用例钉住「按 display_title 认领，不是按表非空」。 */
    const { calls, heard, io } = harness({
      runsFallback: new Response(
        runsBodyOf([
          { conclusion: "failure", display_title: "PR #9999 · 别个 PR 的 sha", name: "static-gates", status: "completed" },
        ]),
        { status: 200 },
      ),
    });
    const code = await runVerdict(io);
    expect(code).toBe(CODE.OK);
    expect(calls).toEqual([workflowRunsUrl(REPO), checkRunsUrl(REPO, SHA)]);
    const all = heard.join("\n");
    expect(all).toContain("没认出本跑");
    expect(all).toContain("本轮回落兜底（checks API）");
    expect(all).toContain("结论：exit 0");
  });

  it("主路径 403（缺 actions: read）⇒ 同轮回落兜底，兜底全绿 ⇒ 退 0；日志点名缺的权限", async () => {
    const { calls, heard, io } = harness({ runsFallback: new Response("no", { status: 403 }) });
    const code = await runVerdict(io);
    expect(code).toBe(CODE.OK);
    expect(calls).toEqual([workflowRunsUrl(REPO), checkRunsUrl(REPO, SHA)]);
    const all = heard.join("\n");
    expect(all).toContain("令牌没给 actions: read");
    expect(all).toContain("本轮回落兜底（checks API）");
    expect(all).toContain("结论：exit 0");
  });

  it("兜底有红 ⇒ 退 1，红的那几个逐条念出来", async () => {
    const { heard, io } = harness({
      checksFallback: new Response(
        checksBodyOf([run("static-gates", "completed", "success"), run("heavy-gates", "completed", "failure")]),
        { status: 200 },
      ),
    });
    const code = await runVerdict(io);
    expect(code).toBe(CODE.FAIL);
    const all = heard.join("\n");
    expect(all).toContain("✗ heavy-gates（failure）");
    expect(all).toContain("结论：exit 1");
  });

  it("兜底 pending 跨轮询转 completed ⇒ 退 0：每轮都先试主路径，第二轮拿到完整结论", async () => {
    const { calls, heard, io, sleeps } = harness({
      checksSteps: [
        new Response(
          checksBodyOf([run("static-gates", "completed", "success"), run("heavy-gates", "in_progress")]),
          { status: 200 },
        ),
        new Response(checksBodyOf(ALL_GREEN), { status: 200 }),
      ],
    });
    const code = await runVerdict(io);
    expect(code).toBe(CODE.OK);
    expect(calls).toEqual([
      workflowRunsUrl(REPO),
      checkRunsUrl(REPO, SHA),
      workflowRunsUrl(REPO),
      checkRunsUrl(REPO, SHA),
    ]);
    expect(sleeps).toEqual([POLL_INTERVAL_MS]);
    expect(heard.join("\n")).toContain("还在跑");
  });

  it("两条路径都零条 ⇒ 预算耗尽退 2：没跑起来 ≠ 判红", async () => {
    const { heard, io } = harness({
      checksFallback: new Response(checksBodyOf([]), { status: 200 }),
      nowStep: POLL_BUDGET_MS,
    });
    const code = await runVerdict(io);
    expect(code).toBe(CODE.NO_FACT);
    const all = heard.join("\n");
    expect(all).toContain("还没有任何 check-run");
    expect(all).toContain("预算耗尽");
    expect(all).toContain("结论：exit 2");
  });

  it("一直 pending ⇒ 预算耗尽退 2（GitHub 侧卡住不许被读成红）", async () => {
    const { heard, io } = harness({
      checksFallback: new Response(checksBodyOf([run("heavy-gates", "queued")]), { status: 200 }),
      nowStep: POLL_BUDGET_MS,
    });
    const code = await runVerdict(io);
    expect(code).toBe(CODE.NO_FACT);
    expect(heard.join("\n")).toContain("预算耗尽");
  });

  it("读数第一次 egress 抖动、第二次通 ⇒ 退 0：网络类失败消耗一次重试", async () => {
    const { calls, heard, io, sleeps } = harness({
      checksSteps: [new Error("fetch failed"), new Response(checksBodyOf(ALL_GREEN), { status: 200 })],
    });
    const code = await runVerdict(io);
    expect(code).toBe(CODE.OK);
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([RETRY_BACKOFF_MS[0]]);
    expect(heard.join("\n")).toContain(`读数第 1/${REQUEST_MAX_ATTEMPTS} 次没通（egress 类）`);
  });

  it("兜底 egress 连挂到上限 ⇒ 退 2，重试账留全", async () => {
    const down = new Error("Connection reset by peer");
    const { calls, heard, io, sleeps } = harness({ checksSteps: [down, down, down] });
    const code = await runVerdict(io);
    expect(code).toBe(CODE.NO_FACT);
    /* 主路径一跳（零条）+ 兜底三次尝试。 */
    expect(calls).toHaveLength(1 + REQUEST_MAX_ATTEMPTS);
    expect(sleeps).toEqual([...RETRY_BACKOFF_MS]);
    expect(heard.join("\n")).toContain("api.github.com 这一跳没通");
  });

  it("主路径 egress 连挂到上限 ⇒ 退 2，不回落（节点出网挂了，兜底一样不通）", async () => {
    const down = new Error("Connection reset by peer");
    const { calls, heard, io, sleeps } = harness({ runsSteps: [down, down, down] });
    const code = await runVerdict(io);
    expect(code).toBe(CODE.NO_FACT);
    expect(calls).toHaveLength(REQUEST_MAX_ATTEMPTS);
    expect(sleeps).toEqual([...RETRY_BACKOFF_MS]);
    const all = heard.join("\n");
    expect(all).toContain("主路径（runs API）");
    expect(all).toContain("api.github.com 这一跳没通");
  });

  it("两条路径都 401/403 ⇒ 一次就交账（不重试），退 2 并同时点名两条权限与密钥仓库", async () => {
    for (const status of [401, 403]) {
      const { calls, heard, io, sleeps } = harness({
        checksFallback: new Response("no", { status }),
        runsFallback: new Response("no", { status }),
      });
      const code = await runVerdict(io);
      expect(code).toBe(CODE.NO_FACT);
      /* 每条路径各一跳：「再试一百次也一样」⇒ 一个请求都不许多发。 */
      expect(calls).toEqual([workflowRunsUrl(REPO), checkRunsUrl(REPO, SHA)]);
      expect(sleeps).toHaveLength(0);
      const all = heard.join("\n");
      expect(all).toContain(`HTTP ${String(status)}`);
      expect(all).toContain("actions: read");
      expect(all).toContain("checks: read");
      expect(all).toContain("moon-read/GITHUB_MIRROR_TOKEN");
    }
  });

  it("其余 HTTP 错误（422：sha 没到 / 形状不对）⇒ 不重试、不回落，退 2，body 脱敏后回显", async () => {
    const { calls, heard, io, sleeps } = harness({
      runsFallback: new Response(`{"message":"No commit found for ${TOKEN}"}`, { status: 422 }),
    });
    const code = await runVerdict(io);
    expect(code).toBe(CODE.NO_FACT);
    expect(calls).toEqual([workflowRunsUrl(REPO)]);
    expect(sleeps).toHaveLength(0);
    /* 硬规则 17：任何回显都不许出现令牌原值。 */
    expect(heard.join("\n")).not.toContain(TOKEN);
    expect(heard.join("\n")).toContain("HTTP 422");
  });

  it("令牌缺席 ⇒ 退 2，一次请求都不发", async () => {
    const { calls, heard, io } = harness({ env: { CNB_PULL_REQUEST_IID: "2649" } });
    const code = await runVerdict(io);
    expect(code).toBe(CODE.NO_FACT);
    expect(calls).toHaveLength(0);
    expect(heard.join("\n")).toContain("GITHUB_MIRROR_TOKEN");
  });

  it("dry-run ⇒ 退 0，计划打出两条路径，一次请求都不发", async () => {
    const { calls, heard, io } = harness();
    const code = await runVerdict({ ...io, dryRun: true });
    expect(code).toBe(CODE.OK);
    expect(calls).toHaveLength(0);
    const all = heard.join("\n");
    expect(all).toContain("DRY-RUN");
    expect(all).toContain("cnb-pr-2649");
    expect(all).toContain("runs API");
    expect(all).toContain("checks API");
  });
});
