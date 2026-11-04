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
      checksFallback?: Response | (() => Response);
      checksSteps?: Array<Response | Error>;
      env?: Record<string, string | undefined>;
      nowStep?: number;
      runsFallback?: Response | (() => Response);
      runsSteps?: Array<Response | Error>;
    } = {},
  ) {
    const calls: Array<string> = [];
    const heard: Array<string> = [];
    const sleeps: Array<number> = [];
    const runsSteps = opts.runsSteps ? [...opts.runsSteps] : null;
    const checksSteps = opts.checksSteps ? [...opts.checksSteps] : null;
    /* 时钟只被 `sleep` 推进（真实轮次各 30s）：`now()` 是**纯读**。
     *
     * `nowStep` 是额外的读时步长，只给「预算耗尽」那几条用 —— 它们一轮就到点，
     * 不陪它跑 90 轮。⚠️ 缺省**不**给缺省大步长：#3136 那批用例第一次是这么写坏的,
     * 而 `now()` 一轮里会被问两次（算 deadline 一次、循环尾一次），步长挂在读上
     * 就成了「跳一次睡一轮」的错拍，主路径三跳就到点。 */
    const nowStep = opts.nowStep ?? 0;
    let clock = 0;
    const fetchImpl = (async (url: string | URL) => {
      calls.push(String(url));      const isRuns = String(url).includes("/actions/runs");
      const head = (isRuns ? runsSteps : checksSteps)?.shift();
      if (head instanceof Error) {
        throw head;
      }
      /* 缺省形态：两条路径都读通、都读到 0 条（＝ GitHub 侧还没起跑）。**不**把兜底
       * 默认成 200 全绿 —— 那是 #3136 修之前那种「读到 0 条就当作有结论」的替身，
       * 留着它会让每条老用例都被「兜底兜住了」掩盖掉真实的轮询形状。 */
      /* fallback 每次**新造**一份：`Response` 的 body 只能读一次，复用同一个对象
       * 会在第二轮抛「Body has already been read」而被误诊成 egress 故障 ——
       * 「读到 0 条 ⇒ 继续轮询」这条语义恰恰要靠第二轮及以后才测得出。 */
      const fresh = () =>
        isRuns
          ? new Response(runsBodyOf([]), { status: 200 })
          : new Response(checksBodyOf([]), { status: 200 });
      if (head) {
        return head;
      }
      const pick = (fallback: Response | (() => Response) | undefined) =>
        fallback === undefined ? null : typeof fallback === "function" ? fallback() : fallback;
      return pick(isRuns ? opts.runsFallback : opts.checksFallback) ?? fresh();
    }) as unknown as typeof fetch;
    const io = {
      env: opts.env ?? okEnv,
      fetchImpl,
      log: (line: string) => heard.push(line),
      /* 时钟假件：`sleep` 把等待记量并拨钟（真实轮次），`now()` 只额外叠加 `nowStep`
       * —— 预算耗尽那条用 `nowStep` 大跳，一轮就到点，不陪它跑 90 轮。 */
      now: () => {
        const t = clock;
        clock += nowStep;
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
    const { calls, heard, io } = harness({
      nowStep: 0,
      runsFallback: new Response(runsBodyOf(ALL_GREEN), { status: 200 }),
    });
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
      nowStep: 0,
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
      nowStep: 0,
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

  it("主路径零条 run ⇒ 读到 0 条，按 POLL_INTERVAL 继续轮询；迟到的 run 仍被认领 ⇒ 退 0", async () => {
    /* 每一轮都造一份**新的** Response：body 只能读一次，复用同一个对象会当场
     * 「Body has already been read」—— 那会把「读到 0 条」误诊成 egress 故障。 */
    const empty = () => new Response(runsBodyOf([]), { status: 200 });
    const { calls, heard, io, sleeps } = harness({
      nowStep: 0,
      runsSteps: [empty(), empty(), new Response(runsBodyOf(ALL_GREEN), { status: 200 })],
    });
    const code = await runVerdict(io);
    expect(code).toBe(CODE.OK);
    /* 三轮主路径：前两轮 0 条、第三轮认领到本跑（预算为这一段窗口而存在）。 */
    expect(calls.filter((u) => u === workflowRunsUrl(REPO))).toHaveLength(3);
    expect(sleeps).toEqual([POLL_INTERVAL_MS, POLL_INTERVAL_MS]);
    const all = heard.join("\n");
    expect(all).toContain("没认出本跑");
    expect(all).toContain("主路径本身读通了（不是权限问题）");
    expect(all).toContain("全部完成且没有红");
    expect(all).toContain("结论：exit 0");
  });

  it("主路径拉到了别跑的 run（display_title 无本跑 sha）⇒ 认不出本跑，继续轮询而不是读成结论", async () => {
    /* dispatch 触发表是共享的：别个 PR 的 run 也在里面。认领不上 = 本跑还没起，
     * 不是「有 run 就行」—— 这条用例钉住「按 display_title 认领，不是按表非空」。 */
    const { calls, heard, io } = harness({
      /* 每轮额外跳三分之一预算 ⇒ 三轮到点；sleep 每轮也只拨 30s，两者相加必然越线。 */
      nowStep: POLL_BUDGET_MS / 3,
      runsFallback: () =>
        new Response(
          runsBodyOf([
            { conclusion: "failure", display_title: "PR #9999 · 别个 PR 的 sha", name: "static-gates", status: "completed" },
          ]),
          { status: 200 },
        ),
    });
    const code = await runVerdict(io);
    expect(code).toBe(CODE.NO_FACT);
    expect(calls.filter((u) => u === workflowRunsUrl(REPO)).length).toBeGreaterThan(1);
    const all = heard.join("\n");
    expect(all).toContain("没认出本跑");
    /* 别跑的 run 是红的，但它不是本跑的判决 —— 不许折成 exit 1。 */
    expect(all).not.toContain("结论：exit 1");
    /* 耗尽的交账：主路径这一整轮都停在「读到 0 条」那一形。 */
    expect(all).toContain("读到 0 条");
    expect(all).toContain("GitHub 侧没起跑");
  });

  it("主路径 403（缺 actions: read）⇒ 同轮回落兜底，兜底全绿 ⇒ 退 0；日志点名缺的权限", async () => {
    /* 兜底条目只在**主路径被拒**时才承重（那时它是唯一读数）—— 这是它与 #3136 那一形
     * （主路径读到 0 条、兜底读到什么都不改变「还没起跑」）的分界线。 */
    const { calls, heard, io } = harness({
      checksFallback: new Response(checksBodyOf(ALL_GREEN), { status: 200 }),
      nowStep: 0,
      runsFallback: new Response("no", { status: 403 }),
    });
    const code = await runVerdict(io);
    expect(code).toBe(CODE.OK);
    expect(calls).toEqual([workflowRunsUrl(REPO), checkRunsUrl(REPO, SHA)]);
    const all = heard.join("\n");
    expect(all).toContain("令牌没给 actions: read");
    expect(all).toContain("本轮回落兜底（checks API）");
    expect(all).toContain("结论：exit 0");
  });

  it("兜底有红（主路径被拒那一形）⇒ 退 1，红的那几个逐条念出来", async () => {
    const { heard, io } = harness({
      nowStep: 0,
      runsFallback: new Response("no", { status: 403 }),
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

  it("兜底 pending 跨轮询转 completed ⇒ 退 0（主路径被拒那一形：每轮都先试主路径）", async () => {
    const { calls, heard, io, sleeps } = harness({
      nowStep: 0,
      runsFallback: new Response("no", { status: 403 }),
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

  it("两条路径都零条 ⇒ 预算耗尽退 2：原因写「读到 0 条」，不写权限", async () => {
    const { heard, io } = harness({
      checksFallback: new Response(checksBodyOf([]), { status: 200 }),
      nowStep: POLL_BUDGET_MS,
    });
    const code = await runVerdict(io);
    expect(code).toBe(CODE.NO_FACT);
    const all = heard.join("\n");
    expect(all).toContain("读到 0 条");
    expect(all).toContain("预算耗尽");
    expect(all).toContain("结论：exit 2");
    expect(all).not.toContain("moon-read/GITHUB_MIRROR_TOKEN");
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
    /* 主路径被拒（兜底是唯一读数）那一形：抖动落在兜底这一跳上。 */
    const { calls, heard, io, sleeps } = harness({
      checksSteps: [new Error("fetch failed"), new Response(checksBodyOf(ALL_GREEN), { status: 200 })],
      nowStep: 0,
      runsFallback: new Response("no", { status: 403 }),
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

  /* ── ISSUE #3136：`empty` 不许被兜底的 403 吞掉 ────────────────────────── */
  /* 现场：主路径 200 但读到 0 条（令牌够 —— 403 时日志会直接写「被拒」），同一轮兜底
   * checks 403（没有 checks: read）⇒ 旧实现把这两件拼成「两条路径的权限都没够上」，
   * 3.8s 就退掉，45m 预算一秒没用。判据按行为写：不许提前退、不许催补权限。 */

  it("主路径读到 0 条 + 兜底 403 ⇒ 不退，按 POLL_INTERVAL 继续轮询主路径（ISSUE #3136）", async () => {
    const { calls, heard, io, sleeps } = harness({
      checksFallback: new Response("no", { status: 403 }),
      nowStep: POLL_BUDGET_MS / 3,
    });
    const code = await runVerdict(io);
    expect(code).toBe(CODE.NO_FACT);
    const all = heard.join("\n");
    /* 轮询了不止一次：主路径每轮都试（两轮之间 sleep 过 POLL_INTERVAL）。 */
    expect(sleeps).toContain(POLL_INTERVAL_MS);
    expect(calls.filter((u) => u === workflowRunsUrl(REPO)).length).toBeGreaterThan(1);
    /* 兜底 403 只作降级事实记录，不许被读成结论。 */
    expect(all).toContain("仅降级读数");
    expect(all).not.toContain("两条路径的权限这枚令牌都没够上");
    expect(all).not.toContain("前提没落地（权限）");
  });

  it("读到 0 条、兜底 403、预算耗尽 ⇒ exit 2 且原因是「读到 0 条 / GitHub 侧没起跑」，不是权限", async () => {
    const { heard, io } = harness({
      checksFallback: new Response("no", { status: 403 }),
      nowStep: POLL_BUDGET_MS,
    });
    const code = await runVerdict(io);
    expect(code).toBe(CODE.NO_FACT);
    const all = heard.join("\n");
    expect(all).toContain("读到 0 条");
    expect(all).toContain("GitHub 侧没起跑");
    expect(all).toContain("这不是权限问题");
    /* 旧的误催：不许再出现。 */
    expect(all).not.toContain("去补");
    expect(all).not.toContain("两条路径的权限这枚令牌都没够上");
    expect(all).not.toContain("moon-read/GITHUB_MIRROR_TOKEN");
  });

  it("读到 0 条、兜底 403 ⇒ 迟到的 run 仍能认领到（预算内继续轮询，不是一退到底）", async () => {
    /* 第三跳才起跑：主路径两次 0 条、第三次拿到完整结论 —— 正是 45m 预算要买的那段窗口。 */
    const empty = () => new Response(runsBodyOf([]), { status: 200 });
    const { calls, heard, io } = harness({
      checksFallback: () => new Response("no", { status: 403 }),
      nowStep: 0,
      runsSteps: [empty(), empty(), new Response(runsBodyOf(ALL_GREEN), { status: 200 })],
    });
    const code = await runVerdict(io);
    expect(code).toBe(CODE.OK);
    expect(calls.filter((u) => u === workflowRunsUrl(REPO))).toHaveLength(3);
    const all = heard.join("\n");
    expect(all).toContain("全部完成且没有红");
    expect(all).not.toContain("前提没落地（权限）");
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
