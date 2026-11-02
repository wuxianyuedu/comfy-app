/** `ci-github-verdict-read.mjs` 的用例（ISSUE #3051 期望第 3 条的前置：回读格先按读数档上线）。
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
  runVerdict,
  summarizeCheckRuns,
} from "../scripts/ci-github-verdict-read.mjs";
import { CODE, RETRY_BACKOFF_MS, exitCodeFor } from "../scripts/ci-github-mirror-push.mjs";

const TOKEN = "gh-token-secret-value";
const SHA = "26a3c3ed06deb679974200d68005ff583178d63f";

const okEnv = {
  GITHUB_MIRROR_TOKEN: TOKEN,
  CNB_PULL_REQUEST_IID: "2649",
};

/** 假 check-run（GitHub API 形状的最小面）。 */
const run = (name: string, status: string, conclusion: string | null = null) => ({
  conclusion,
  name,
  status,
});

/** 假 200 回话体。 */
const bodyOf = (runs: Array<unknown>) =>
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
  it("checkRunsUrl：按同一笔 sha 读 check-runs，单页 100 条", () => {
    expect(checkRunsUrl("wuxianyuedu/comfy-app", SHA)).toBe(
      `https://api.github.com/repos/wuxianyuedu/comfy-app/commits/${SHA}/check-runs?per_page=100`,
    );
  });

  it("isRetryableRequestFailure：网络类认、其余不认", () => {
    expect(isRetryableRequestFailure(new Error("fetch failed"))).toBe(true);
    expect(isRetryableRequestFailure(new Error("check-runs 读数超时（>30000 ms）"))).toBe(true);
    expect(isRetryableRequestFailure(new Error("Connection reset by peer"))).toBe(true);
    expect(
      isRetryableRequestFailure(Object.assign(new Error("boom"), { cause: { code: "ENOTFOUND" } })),
    ).toBe(true);
    /* HTTP 层的拒（401/403/422）不是异常、不走这一判；这里钉的是「普通错误不重试」。 */
    expect(isRetryableRequestFailure(new Error("HTTP 403"))).toBe(false);
    expect(isRetryableRequestFailure(new Error("Invalid username or token"))).toBe(false);
  });

  it("summarizeCheckRuns：completed 全绿/中立/跳过 ⇒ 没红；零条 ⇒ 不算跑完", () => {
    const s = summarizeCheckRuns(ALL_GREEN);
    expect(s.completed).toBe(true);
    expect(s.failing).toHaveLength(0);
    expect(s.total).toBe(3);
    /* 零条是「GitHub 侧还没起跑」，不是「全绿」—— 必须继续等。 */
    expect(summarizeCheckRuns([]).completed).toBe(false);
  });

  it("summarizeCheckRuns：failure/timed_out/cancelled/action_required 才算红，还在跑的不算完", () => {
    const red = summarizeCheckRuns([
      run("static-gates", "completed", "success"),
      run("fixed-structural-tests", "completed", "failure"),
      run("heavy-gates", "completed", "timed_out"),
      run("affected-tests", "completed", "cancelled"),
      run("typecheck-db-format", "completed", "action_required"),
    ]);
    expect(red.completed).toBe(true);
    expect(red.failing).toHaveLength(4);
    const pending = summarizeCheckRuns([run("static-gates", "in_progress"), run("heavy-gates", "queued")]);
    expect(pending.completed).toBe(false);
    expect(pending.pending).toHaveLength(2);
  });

  it("预算与节奏：间隔 × 轮数压在 45m 预算内，单次请求上限与镜像格探活同量级", () => {
    expect(POLL_INTERVAL_MS).toBe(30_000);
    expect(POLL_BUDGET_MS).toBe(45 * 60_000);
    expect(CHECK_RUNS_TIMEOUT_MS).toBe(30_000);
    /* 最坏一轮（3 次请求 + 退避）远在轮询间隔量级之内 ⇒ 节奏不会被重试自己打乱。 */
    const worstRound = REQUEST_MAX_ATTEMPTS * CHECK_RUNS_TIMEOUT_MS + RETRY_BACKOFF_MS[0]! + RETRY_BACKOFF_MS[1]!;
    expect(worstRound).toBeLessThan(POLL_BUDGET_MS);
  });
});

describe("runVerdict（fetch / git / sleep / now 全假件）", () => {
  /** 收口假件与量具；`steps` 按调用次序出假回话/假异常，耗尽后落 `fallback`。 */
  function harness(
    opts: {
      env?: Record<string, string | undefined>;
      fallback?: Response;
      nowStep?: number;
      steps?: Array<Response | Error>;
    } = {},
  ) {
    const calls: Array<string> = [];
    const heard: Array<string> = [];
    const sleeps: Array<number> = [];
    const steps = opts.steps ? [...opts.steps] : null;
    let clock = 0;
    const fetchImpl = (async (url: string | URL) => {
      calls.push(String(url));
      const head = steps?.shift();
      if (head instanceof Error) {
        throw head;
      }
      return head ?? opts.fallback ?? new Response(bodyOf(ALL_GREEN), { status: 200 });
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

  it("全绿 ⇒ 退 0；读的是同一笔 sha，结论行把账念全", async () => {
    const { calls, heard, io } = harness();
    const code = await runVerdict(io);
    expect(code).toBe(CODE.OK);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe(checkRunsUrl("wuxianyuedu/comfy-app", SHA));
    const all = heard.join("\n");
    expect(all).toContain("cnb-pr-2649");
    expect(all).toContain("全部完成且没有红");
    expect(all).toContain("结论：exit 0");
  });

  it("有红 ⇒ 退 1，红的那几个逐条念出来", async () => {
    const { heard, io } = harness({
      fallback: new Response(
        bodyOf([run("static-gates", "completed", "success"), run("heavy-gates", "completed", "failure")]),
        { status: 200 },
      ),
    });
    const code = await runVerdict(io);
    expect(code).toBe(CODE.FAIL);
    const all = heard.join("\n");
    expect(all).toContain("✗ heavy-gates（failure）");
    expect(all).toContain("结论：exit 1");
    /* `--readout` 折的是对外那一位数，三态原值上面已逐行念过（读数档恒退 0）。 */
    expect(exitCodeFor(code, true)).toBe(0);
    expect(exitCodeFor(code, false)).toBe(1);
  });

  it("pending 跨轮询转 completed ⇒ 退 0：第二轮拿到完整结论，间隔按 POLL_INTERVAL 等", async () => {
    const { calls, heard, io, sleeps } = harness({
      steps: [
        new Response(bodyOf([run("static-gates", "completed", "success"), run("heavy-gates", "in_progress")]), {
          status: 200,
        }),
        new Response(bodyOf(ALL_GREEN), { status: 200 }),
      ],
    });
    const code = await runVerdict(io);
    expect(code).toBe(CODE.OK);
    expect(calls).toHaveLength(2);
    expect(sleeps).toEqual([POLL_INTERVAL_MS]);
    expect(heard.join("\n")).toContain("还在跑");
  });

  it("一直没有 check-run（零条）⇒ 预算耗尽退 2：没跑起来 ≠ 判红", async () => {
    const { heard, io } = harness({
      fallback: new Response(bodyOf([]), { status: 200 }),
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
      fallback: new Response(bodyOf([run("heavy-gates", "queued")]), { status: 200 }),
      nowStep: POLL_BUDGET_MS,
    });
    const code = await runVerdict(io);
    expect(code).toBe(CODE.NO_FACT);
    expect(heard.join("\n")).toContain("预算耗尽");
  });

  it("读数第一次 egress 抖动、第二次通 ⇒ 退 0：网络类失败消耗一次重试", async () => {
    const { calls, heard, io, sleeps } = harness({
      steps: [new Error("fetch failed"), new Response(bodyOf(ALL_GREEN), { status: 200 })],
    });
    const code = await runVerdict(io);
    expect(code).toBe(CODE.OK);
    expect(calls).toHaveLength(2);
    expect(sleeps).toEqual([RETRY_BACKOFF_MS[0]]);
    expect(heard.join("\n")).toContain(`读数第 1/${REQUEST_MAX_ATTEMPTS} 次没通（egress 类）`);
  });

  it("egress 连挂到上限 ⇒ 退 2，重试账留全", async () => {
    const down = new Error("Connection reset by peer");
    const { calls, heard, io, sleeps } = harness({ steps: [down, down, down] });
    const code = await runVerdict(io);
    expect(code).toBe(CODE.NO_FACT);
    expect(calls).toHaveLength(REQUEST_MAX_ATTEMPTS);
    expect(sleeps).toEqual([...RETRY_BACKOFF_MS]);
    expect(heard.join("\n")).toContain("api.github.com 这一跳没通");
  });

  it("401/403 ⇒ 一次就交账（不重试），退 2 并指明下一动作：PAT 加 checks: read 并同步密钥仓库", async () => {
    for (const status of [401, 403]) {
      const { calls, heard, io, sleeps } = harness({ fallback: new Response("no", { status }) });
      const code = await runVerdict(io);
      expect(code).toBe(CODE.NO_FACT);
      /* 「再试一百次也一样」⇒ 一个请求都不许多发。 */
      expect(calls).toHaveLength(1);
      expect(sleeps).toHaveLength(0);
      const all = heard.join("\n");
      expect(all).toContain(`HTTP ${String(status)}`);
      expect(all).toContain("checks: read");
      expect(all).toContain("moon-read/GITHUB_MIRROR_TOKEN");
    }
  });

  it("其余 HTTP 错误（422：sha 没到 / 形状不对）⇒ 不重试，退 2，body 脱敏后回显", async () => {
    const { calls, heard, io, sleeps } = harness({
      fallback: new Response(`{"message":"No commit found for ${TOKEN}"}`, { status: 422 }),
    });
    const code = await runVerdict(io);
    expect(code).toBe(CODE.NO_FACT);
    expect(calls).toHaveLength(1);
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

  it("dry-run ⇒ 退 0，计划打出来，一次请求都不发", async () => {
    const { calls, heard, io } = harness();
    const code = await runVerdict({ ...io, dryRun: true });
    expect(code).toBe(CODE.OK);
    expect(calls).toHaveLength(0);
    const all = heard.join("\n");
    expect(all).toContain("DRY-RUN");
    expect(all).toContain("cnb-pr-2649");
  });
});
