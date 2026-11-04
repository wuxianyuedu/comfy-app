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
  NO_RUN_WINDOW_MS,
  dispatchBranchFilter,
  repoUrl,
  workflowFileUrl,
  workflowsUrl,
} from "../scripts/ci-github-verdict-chain.mjs";
import {
  CHECK_RUNS_TIMEOUT_MS,
  CLAIM_MISS_STREAK_TO_ABORT,
  POLL_BUDGET_MS,
  POLL_INTERVAL_MS,
  REQUEST_MAX_ATTEMPTS,
  checkRunsUrl,
  isRetryableRequestFailure,
  isUnclaimedNonEmpty,
  matchesTargetSha,
  readDispatchState,
  renderTitleSamples,
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

/* ── ISSUE #3153 的结构判定假件：默认给「三件正证据都在」的合形态 ──────────
 * 零条 run 的用例都会先走一次结构判定；默认合形态让老用例保持「判不出 ⇒ 短窗口」
 * 那一形，只有显式编排 `chainSteps` 的用例才落进「结构上不会有 run」。 */
const WORKFLOW_PATH = ".github/workflows/pr-gate.yml";

const PR_GATE_WORKFLOW = [
  "name: pr-gate",
  "on:",
  "  repository_dispatch:",
  "    types: [pr-gate]",
  "jobs:",
  "  gate:",
  "    runs-on: ubuntu-latest",
].join("\n");

const repoBodyOf = (defaultBranch = "main") =>
  JSON.stringify({ default_branch: defaultBranch });

const workflowsBodyOf = (state = "active") =>
  JSON.stringify({
    total_count: 1,
    workflows: [{ id: 1, name: "pr-gate", path: WORKFLOW_PATH, state }],
  });

const workflowFileBodyOf = (text = PR_GATE_WORKFLOW) =>
  JSON.stringify({
    content: Buffer.from(text, "utf8").toString("base64"),
    encoding: "base64",
    path: WORKFLOW_PATH,
  });

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
    expect(isRetryableRequestFailure(new Error("主路径（runs API）读数超时（>30000 ms）"))).toBe(
      true,
    );
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
    const pending = summarizeWorkflowRuns([
      run("static-gates", "in_progress"),
      run("heavy-gates", "queued"),
    ]);
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
    const worstRound =
      REQUEST_MAX_ATTEMPTS * CHECK_RUNS_TIMEOUT_MS + RETRY_BACKOFF_MS[0]! + RETRY_BACKOFF_MS[1]!;
    expect(worstRound).toBeLessThan(POLL_BUDGET_MS);
  });

  it("renderTitleSamples：念出触发表里的标题原值，截断超长项，空表给「零条」", () => {
    expect(renderTitleSamples([])).toBe("触发表里零条 run");
    const line = renderTitleSamples([
      { display_title: "PR #2649 · abc" },
      { display_title: "" },
      { display_title: "x".repeat(200) },
    ]);
    expect(line).toContain("触发表 3 条");
    expect(line).toContain("PR #2649 · abc");
    expect(line).toContain("(无标题)");
    /* 长标题截断并标注省略号（日志里刷一整页没有意义）。 */
    expect(line).toContain("…");
    expect(line).not.toContain("x".repeat(120));
    /* 超过 5 条只念 5 条，余数单独交代（样本要够判形，但不能把日志淹掉）。 */
    const many = renderTitleSamples(
      Array.from({ length: 8 }, (_, i) => ({ display_title: `PR #${String(i)}` })),
    );
    expect(many).toContain("另有 3 条未念");
  });

  it("isUnclaimedNonEmpty：只有「读到过非空触发表、且一条都认不上」才算", () => {
    expect(
      isUnclaimedNonEmpty({ items: [{ display_title: "PR #9999 · 别个 sha" }], state: "empty" }),
    ).toBe(true);
    /* 零条 run（GitHub 侧还没起跑）是真·等待，不属于提前夭折那一形。 */
    expect(isUnclaimedNonEmpty({ items: [], state: "empty" })).toBe(false);
    expect(isUnclaimedNonEmpty({ state: "empty" })).toBe(false);
    /* 认上了走 data 态，不计入连击。 */
    expect(
      isUnclaimedNonEmpty({ runs: [{ display_title: `PR #2649 · ${SHA}` }], state: "data" }),
    ).toBe(false);
    expect(isUnclaimedNonEmpty({ state: "auth", status: 403 })).toBe(false);
  });

  it("readDispatchState：读得到就返回，读不到 / 形状不对一律 null（增益而非判据）", () => {
    const read = (raw: string) => readDispatchState(() => raw, "/repo");
    expect(read(JSON.stringify({ dispatched: false, reason: "推送失败" }))).toEqual({
      dispatched: false,
      reason: "推送失败",
    });
    expect(read(JSON.stringify({ dispatched: true, reason: "已派发" }))?.dispatched).toBe(true);
    /* 缺字段 / 不是 JSON / 文件不在：都返回 null，让调用方退回老行为。 */
    expect(read(JSON.stringify({ reason: "没有 dispatched" }))).toBeNull();
    expect(read("not json")).toBeNull();
    expect(
      readDispatchState(() => {
        throw new Error("ENOENT");
      }, "/repo"),
    ).toBeNull();
  });

  it("结构判定的三个读数目标：仓库身份 / workflow 清单 / 默认分支上的 workflow 文件（#3153）", () => {
    expect(repoUrl(REPO)).toBe(`https://api.github.com/repos/${REPO}`);
    expect(workflowsUrl(REPO)).toBe(
      `https://api.github.com/repos/${REPO}/actions/workflows?per_page=100`,
    );
    expect(workflowFileUrl(REPO, "main")).toBe(
      `https://api.github.com/repos/${REPO}/contents/${WORKFLOW_PATH}?ref=main`,
    );
  });

  it("dispatchBranchFilter：没有 branches / 块状列表 / 行内数组三种写法都读得出（只作读数，不判死）", () => {
    expect(dispatchBranchFilter(PR_GATE_WORKFLOW)).toBeNull();
    expect(
      dispatchBranchFilter(
        ["on:", "  repository_dispatch:", "    branches:", "      - main", "      - cnb-pr-2649"].join(
          "\n",
        ),
      ),
    ).toEqual(["main", "cnb-pr-2649"]);
    expect(
      dispatchBranchFilter(
        ["on:", "  repository_dispatch:", "    branches: [main, 'cnb-pr-2649']"].join("\n"),
      ),
    ).toEqual(["main", "cnb-pr-2649"]);
  });

  it("NO_RUN_WINDOW_MS：短窗口 5 分钟，且大于 4 分钟的迟到用例（#3153）", () => {
    expect(NO_RUN_WINDOW_MS).toBe(5 * 60_000);
    expect(NO_RUN_WINDOW_MS).toBeGreaterThan(4 * 60_000);
    expect(NO_RUN_WINDOW_MS).toBeLessThan(POLL_BUDGET_MS);
  });
});

describe("runVerdict（fetch / git / sleep / now 全假件，按 URL 分流两条路径）", () => {
  /** 收口假件与量具；`runsSteps` / `checksSteps` 按各自路径的调用次序出假回话/假异常，耗尽后落各自的 `fallback`。 */
  function harness(
    opts: {
      /** 结构判定（#3153）三跳的编排次序：仓库身份 → workflow 清单 → workflow 文件。 */
      chainSteps?: Array<Response | Error>;
      checksFallback?: Response | (() => Response);
      checksSteps?: Array<Response | Error>;
      /** 上游派发形状那份落盘（#3148）：缺省 = 读不到，退回「自己猜」的老行为。 */
      dispatchState?: { dispatched: boolean; reason: string } | null;
      env?: Record<string, string | undefined>;
      nowStep?: number;
      runsFallback?: Response | (() => Response);
      runsSteps?: Array<Response | Error>;
    } = {},
  ) {
    const calls: Array<string> = [];
    const heard: Array<string> = [];
    const sleeps: Array<number> = [];
    const chainSteps = opts.chainSteps ? [...opts.chainSteps] : null;
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
      calls.push(String(url));
      const addr = String(url);
      const isRuns = addr.includes("/actions/runs");
      const isChecks = addr.includes("/check-runs");
      const isWorkflows = addr.includes("/actions/workflows");
      const isContents = addr.includes("/contents/");
      const isChain = isWorkflows || isContents || (!isRuns && !isChecks);
      const head = (isChain ? chainSteps : isRuns ? runsSteps : checksSteps)?.shift();
      if (head instanceof Error) {
        throw head;
      }
      if (head) {
        return head;
      }
      if (isChain) {
        /* 默认合形态：仓库可查、pr-gate active、默认分支上的文件仍监听 repository_dispatch。 */
        if (isWorkflows) {
          return new Response(workflowsBodyOf(), { status: 200 });
        }
        if (isContents) {
          return new Response(workflowFileBodyOf(), { status: 200 });
        }
        return new Response(repoBodyOf(), { status: 200 });
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
      const pick = (fallback: Response | (() => Response) | undefined) =>
        fallback === undefined ? null : typeof fallback === "function" ? fallback() : fallback;
      return pick(isRuns ? opts.runsFallback : opts.checksFallback) ?? fresh();
    }) as unknown as typeof fetch;
    const io = {
      env: opts.env ?? okEnv,
      fetchImpl,
      log: (line: string) => heard.push(line),
      readFile: (file: string, encoding: "utf8") => {
        if (file.includes("mirror-dispatch.json") && opts.dispatchState) {
          return JSON.stringify(opts.dispatchState);
        }
        throw new Error(`ENOENT: ${file}（${encoding}）`);
      },
      root: "/repo",
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
          runsBodyOf([
            run("static-gates", "completed", "success"),
            run("heavy-gates", "in_progress"),
          ]),
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
    expect(all).toContain("零条 run");
    expect(all).toContain("主路径本身读通了（不是权限问题）");
    expect(all).toContain("全部完成且没有红");
    expect(all).toContain("结论：exit 0");
  });

  it("主路径拉到了别跑的 run（display_title 无本跑 sha）⇒ 认领不上连击到门槛就提前收工（#3148）", async () => {
    /* dispatch 触发表是共享的：别个 PR 的 run 也在里面。认领不上 = 本跑还没起，
     * 不是「有 run 就行」—— 这条用例钉住「按 display_title 认领，不是按表非空」，
     * 且钉住「表里有 run 而认不上」不再吃满 45m（run-name 创建时就定死，等不出新事实）。 */
    const { calls, heard, io, sleeps } = harness({
      runsFallback: () =>
        new Response(
          runsBodyOf([
            {
              conclusion: "failure",
              display_title: "PR #9999 · 别个 PR 的 sha",
              name: "static-gates",
              status: "completed",
            },
          ]),
          { status: 200 },
        ),
    });
    const code = await runVerdict(io);
    expect(code).toBe(CODE.NO_FACT);
    /* 门槛轮就收工：一共 CLAIM_MISS_STREAK_TO_ABORT 次主路径读数，睡的门槛-1 次。 */
    expect(calls.filter((u) => u === workflowRunsUrl(REPO))).toHaveLength(
      CLAIM_MISS_STREAK_TO_ABORT,
    );
    expect(sleeps).toHaveLength(CLAIM_MISS_STREAK_TO_ABORT - 1);
    const all = heard.join("\n");
    expect(all).toContain("认领不上本跑");
    expect(all).toContain("提前收工");
    /* 别跑的 run 是红的，但它不是本跑的判决 —— 不许折成 exit 1。 */
    expect(all).not.toContain("结论：exit 1");
    /* 样本要念出来：#3142 正文那两条候选（标题里没 sha / 是别的 sha）靠它当场可分。 */
    expect(all).toContain("PR #9999 · 别个 PR 的 sha");
    /* 这一形不许被念成权限问题。 */
    expect(all).not.toContain("两条路径的权限这枚令牌都没够上");
    /* 认不上时两种下一动作都点名：run-name 没渲染出 sha / 不是同一笔 sha（#3142 候选）。 */
    expect(all).toContain("run-name");
    expect(all).toContain("不是同一笔");
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
        checksBodyOf([
          run("static-gates", "completed", "success"),
          run("heavy-gates", "completed", "failure"),
        ]),
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
          checksBodyOf([
            run("static-gates", "completed", "success"),
            run("heavy-gates", "in_progress"),
          ]),
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

  it("两条路径都零条 + 派发读数缺失 ⇒ 独立一形：短窗口到点退 2，念「上游派发读数不可用」，不写权限（#3153）", async () => {
    const { heard, io } = harness({
      checksFallback: new Response(checksBodyOf([]), { status: 200 }),
      nowStep: POLL_BUDGET_MS,
    });
    const code = await runVerdict(io);
    expect(code).toBe(CODE.NO_FACT);
    const all = heard.join("\n");
    expect(all).toContain("上游派发读数不可用");
    expect(all).toContain("mirror-dispatch.json");
    expect(all).toContain("不判「没找到对应 run」");
    expect(all).toContain("结论：exit 2");
    expect(all).not.toContain("moon-read/GITHUB_MIRROR_TOKEN");
    expect(all).not.toContain("两条路径的权限这枚令牌都没够上");
    /* 它不许把「45m 预算耗尽」当成结论（那一档只给「读到本跑但没到终态」）。 */
    expect(all).not.toContain(`${String(POLL_BUDGET_MS / 60_000)}m 轮询预算耗尽`);
  });

  it("一直 pending ⇒ 45m 预算耗尽退 2（GitHub 侧卡住不许被读成红）", async () => {
    const { heard, io } = harness({
      nowStep: POLL_BUDGET_MS,
      runsFallback: () => new Response(runsBodyOf([run("heavy-gates", "queued")]), { status: 200 }),
    });
    const code = await runVerdict(io);
    expect(code).toBe(CODE.NO_FACT);
    const all = heard.join("\n");
    expect(all).toContain(`${String(POLL_BUDGET_MS / 60_000)}m 轮询预算耗尽`);
    expect(all).toContain("没跑完 ≠ 判红");
  });

  it("读数第一次 egress 抖动、第二次通 ⇒ 退 0：网络类失败消耗一次重试", async () => {
    /* 主路径被拒（兜底是唯一读数）那一形：抖动落在兜底这一跳上。 */
    const { calls, heard, io, sleeps } = harness({
      checksSteps: [
        new Error("fetch failed"),
        new Response(checksBodyOf(ALL_GREEN), { status: 200 }),
      ],
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
    /* 主路径一跳（零条）+ 结构判定三跳（#3153）+ 兜底三次尝试。 */
    expect(calls).toHaveLength(1 + 3 + REQUEST_MAX_ATTEMPTS);
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
      nowStep: 0,
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
    /* #3153 之后：零条那一形按 5m 短窗口收工，仍不许被读成「权限」或「红」。 */
    expect(all).toContain(`${String(NO_RUN_WINDOW_MS / 60_000)}m 内触发表零条 run`);
  });

  it("上游派发格留下「派发没发生」⇒ 一秒不轮询、不退 2 成「还没起跑」，把上游原因念出来（#3148）", async () => {
    /* 用户现场（#3142）：镜像格的 LFS 那一跳失败 ⇒ 刻意不派发 ⇒ 本跑永远不会有 run。
     * 上游自己知道这件事，回读格不该再拿 45m 去猜。 */
    const { calls, heard, io, sleeps } = harness({
      dispatchState: {
        dispatched: false,
        reason: "refs 已推但 LFS 对象没送过去（本地 ref 读取失败（检出形态））⇒ 刻意不派发",
      },
    });
    const code = await runVerdict(io);
    expect(code).toBe(CODE.NO_FACT);
    expect(calls).toHaveLength(0);
    expect(sleeps).toHaveLength(0);
    const all = heard.join("\n");
    expect(all).toContain("派发没发生");
    expect(all).toContain("本地 ref 读取失败");
    expect(all).toContain("一秒不轮询");
    /* 它既不是权限问题，也不是 GitHub 判了红 —— 两种话术都不许出现。 */
    expect(all).not.toContain("两条路径的权限这枚令牌都没够上");
    expect(all).not.toContain("结论：exit 1");
  });

  it("上游派发成功 ⇒ 照常轮询（落盘那一跳只用来掐掉「必然等不到」的那一形）", async () => {
    const { calls, heard, io } = harness({
      dispatchState: {
        dispatched: true,
        reason: "已派发 cnb-pr-sync（wuxianyuedu/comfy-app:refs/heads/cnb-pr-2649 @ 26a3c3ed）",
      },
      runsFallback: new Response(runsBodyOf(ALL_GREEN), { status: 200 }),
    });
    const code = await runVerdict(io);
    expect(code).toBe(CODE.OK);
    expect(calls).toEqual([workflowRunsUrl(REPO)]);
    const all = heard.join("\n");
    expect(all).toContain("上游派发格的读数");
    expect(all).toContain("已派发");
    expect(all).toContain("结论：exit 0");
  });

  it("读到 0 条、派发已确认、短窗口到点 ⇒ exit 2 念「没找到对应 run（不是 run 未到终态）」，不是权限（#3153）", async () => {
    const { heard, io } = harness({
      checksFallback: new Response("no", { status: 403 }),
      dispatchState: { dispatched: true, reason: "镜像格已派发" },
      nowStep: POLL_BUDGET_MS,
    });
    const code = await runVerdict(io);
    expect(code).toBe(CODE.NO_FACT);
    const all = heard.join("\n");
    expect(all).toContain("没找到对应 run（不是 run 未到终态）");
    expect(all).toContain("判定依据：");
    expect(all).toContain("这不是权限问题");
    /* 旧的误判/误催：不许再出现。 */
    expect(all).not.toContain("去补");
    expect(all).not.toContain("两条路径的权限这枚令牌都没够上");
    expect(all).not.toContain("moon-read/GITHUB_MIRROR_TOKEN");
    expect(all).not.toContain(`${String(POLL_BUDGET_MS / 60_000)}m 轮询预算耗尽`);
  });

  it("读到 0 条、兜底 403 ⇒ 迟到的 run 仍能认领到（短窗口内继续轮询，不是一退到底）", async () => {
    /* 第三跳才起跑：主路径两次 0 条、第三次拿到完整结论 —— 正是短窗口要买的那段。 */
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

  it("零条 run + 派发已确认 + 链上证据齐全 ⇒ 5m 短窗口到点退 2，念「没找到对应 run」与判定依据（#3153）", async () => {
    const { calls, heard, io, sleeps } = harness({
      checksFallback: () => new Response(checksBodyOf([]), { status: 200 }),
      dispatchState: { dispatched: true, reason: "镜像格已派发" },
      nowStep: 0,
    });
    const code = await runVerdict(io);
    expect(code).toBe(CODE.NO_FACT);
    const all = heard.join("\n");
    expect(all).toContain("没找到对应 run（不是 run 未到终态）");
    expect(all).toContain("判定依据：");
    expect(all).toContain("dispatched=true");
    /* 结构判定只探一次（11 轮零条里各跳各一条）。 */
    expect(calls.filter((u) => u === repoUrl(REPO))).toHaveLength(1);
    expect(calls.filter((u) => u === workflowsUrl(REPO))).toHaveLength(1);
    expect(calls.filter((u) => u === workflowFileUrl(REPO, "main"))).toHaveLength(1);
    /* 5m / 30s = 10 次 sleep，后按短窗口收工（不吃满 45m）。 */
    expect(sleeps).toHaveLength(10);
    expect(all).not.toContain(`${String(POLL_BUDGET_MS / 60_000)}m 轮询预算耗尽`);
  });

  it("run 晚到 4 分钟仍能等到（短窗口必须大于 4 分钟，别把迟到误判成没 run）（#3153）", async () => {
    const empty = () => new Response(runsBodyOf([]), { status: 200 });
    const { calls, heard, io, sleeps } = harness({
      dispatchState: { dispatched: true, reason: "镜像格已派发" },
      nowStep: 0,
      runsSteps: [
        ...Array.from({ length: 8 }, () => empty()),
        new Response(runsBodyOf(ALL_GREEN), { status: 200 }),
      ],
    });
    const code = await runVerdict(io);
    expect(code).toBe(CODE.OK);
    /* 第 9 跳（t=240s，仍在 300s 窗口内）认领到，随后按常规判绿。 */
    expect(calls.filter((u) => u === workflowRunsUrl(REPO))).toHaveLength(9);
    expect(sleeps).toHaveLength(8);
    expect(heard.join("\n")).toContain("全部完成且没有红");
  });

  it("仓库认不到（HTTP 404）⇒ 结构上不会有 run：不轮询、当场退 2 并念仓库证据（#3153）", async () => {
    const { calls, heard, io, sleeps } = harness({
      chainSteps: [new Response("{}", { status: 404 })],
      dispatchState: { dispatched: true, reason: "镜像格已派发" },
      nowStep: 0,
    });
    const code = await runVerdict(io);
    expect(code).toBe(CODE.NO_FACT);
    const all = heard.join("\n");
    expect(all).toContain("结构上不会有 run");
    expect(all).toContain("认不到");
    expect(all).toContain("404");
    expect(sleeps).toEqual([]);
    expect(calls.filter((u) => u === repoUrl(REPO))).toHaveLength(1);
    expect(calls.filter((u) => u === workflowsUrl(REPO))).toHaveLength(0);
  });

  it("workflow 被禁用 ⇒ 结构上不会有 run：不轮询、当场退 2 并念 state（#3153）", async () => {
    const { calls, heard, io, sleeps } = harness({
      chainSteps: [
        new Response(repoBodyOf(), { status: 200 }),
        new Response(workflowsBodyOf("disabled_manually"), { status: 200 }),
      ],
      dispatchState: { dispatched: true, reason: "镜像格已派发" },
      nowStep: 0,
    });
    const code = await runVerdict(io);
    expect(code).toBe(CODE.NO_FACT);
    const all = heard.join("\n");
    expect(all).toContain("结构上不会有 run");
    expect(all).toContain("disabled_manually");
    expect(sleeps).toEqual([]);
    expect(calls.filter((u) => u === workflowFileUrl(REPO, "main"))).toHaveLength(0);
  });

  it("默认分支上没有 pr-gate.yml（contents 404）⇒ 结构上不会有 run，念默认分支（#3153）", async () => {
    const { heard, io, sleeps } = harness({
      chainSteps: [
        new Response(repoBodyOf(), { status: 200 }),
        new Response(workflowsBodyOf(), { status: 200 }),
        new Response("{}", { status: 404 }),
      ],
      dispatchState: { dispatched: true, reason: "镜像格已派发" },
      nowStep: 0,
    });
    const code = await runVerdict(io);
    expect(code).toBe(CODE.NO_FACT);
    const all = heard.join("\n");
    expect(all).toContain("结构上不会有 run");
    expect(all).toContain("默认分支 main 上没有");
    expect(sleeps).toEqual([]);
  });

  it("workflow 不再监听 repository_dispatch ⇒ 结构上不会有 run，念事件条件（#3153）", async () => {
    const { heard, io, sleeps } = harness({
      chainSteps: [
        new Response(repoBodyOf(), { status: 200 }),
        new Response(workflowsBodyOf(), { status: 200 }),
        new Response(workflowFileBodyOf(["name: pr-gate", "on:", "  push:", "    branches: [main]"].join("\n")), {
          status: 200,
        }),
      ],
      dispatchState: { dispatched: true, reason: "镜像格已派发" },
      nowStep: 0,
    });
    const code = await runVerdict(io);
    expect(code).toBe(CODE.NO_FACT);
    const all = heard.join("\n");
    expect(all).toContain("结构上不会有 run");
    expect(all).toContain("没有 repository_dispatch");
    expect(sleeps).toEqual([]);
  });

  it("派发已确认 + 读到本跑但一直未到终态 ⇒ 仍按 45m 预算（短窗口只管零条那一形）（#3153）", async () => {
    const { heard, io } = harness({
      dispatchState: { dispatched: true, reason: "镜像格已派发" },
      nowStep: POLL_BUDGET_MS,
      runsFallback: () => new Response(runsBodyOf([run("heavy-gates", "queued")]), { status: 200 }),
    });
    const code = await runVerdict(io);
    expect(code).toBe(CODE.NO_FACT);
    const all = heard.join("\n");
    expect(all).toContain(`${String(POLL_BUDGET_MS / 60_000)}m 轮询预算耗尽`);
    expect(all).toContain("读到本跑但没到终态");
    expect(all).not.toContain("没找到对应 run");
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
