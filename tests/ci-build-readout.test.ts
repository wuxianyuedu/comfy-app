/**
 * 「被取消」与「真失败」在读数上分得开（ISSUE #2158 第 2 条 / 规范 §13.5.27）。
 *
 * ## 为什么要有这条判据
 *
 * 平台的看板只给一列状态，而那一列把两件**完全不同**的事写成同一个字：
 * 「某一格自己跑挂了」与「这一跑被人为终止 / 被同一把锁上的另一跑顶掉了」。
 * 现场读数（`cnb-lm1-1k5h1otqt`，2026-10-22）：第二格 `单跑构建·同步数据库表结构`
 * 是 `cancel`，第三格 `单跑构建·生产构建` 是 `skipped`（**0 秒，没跑**），而整条
 * 流水线的状态是 `error` —— 看板上它与「生产构建真的失败了」长得一样。
 *
 * ## 样本是**真形状**
 *
 * 三份样本都照着平台 JSON 的原样抄（`get-build-status -v` 的 `data` 那一段），
 * 包括平台自己那几格（`Prepare` / `BeforeEnd` / `DebugDetection` / `End`）——
 * 它们在真实读数里就在那儿，而**不是**本仓配置的那几格，判据要把它们认出来。
 *
 * ## 反向样本（缺了就会静默全绿的那几种）
 *
 * ① 只有信封上的 `status`（`data` 缺席）⇒ **不许**当成绿：那只是 HTTP 200；
 * ② 逐格读数缺席 ⇒ 退回构建级状态，而不是「没发现问题」；
 * ③ 真红的那一格与被取消的那一格同时出现 ⇒ **真红优先**（那一格才是最该被看见的）。
 */
import { describe, expect, it } from "vitest";

import {
  classifyBuildOutcome,
  classifyStages,
  describeFailedStages,
  downstreamSkipped,
  formatOutcome,
  fetchBuildList,
  inFlightStages,
  main,
  normalizeStageContent,
  parseArgs,
  pipelineForStage,
  progressReadout,
  stageLogExcerpt,
} from "../scripts/ci-build-readout.mjs";
import { buildSignature } from "../scripts/ship-build.mjs";

/** 被取消那一跑（`cnb-lm1-1k5h1otqt`）：第二格被顶掉，第三格根本没跑。 */
const CANCELLED_BUILD = {
  status: 200,
  data: {
    status: "error",
    pipelinesStatus: {
      "cnb-lm1-1k5h1otqt-001": {
        id: "cnb-lm1-1k5h1otqt-001",
        name: "单跑生产构建（API 触发）",
        status: "cancel",
        duration: 244230,
        stages: [
          {
            status: "success",
            duration: 29083,
            name: "Prepare",
            id: "prepare",
          },
          {
            status: "success",
            duration: 214977,
            name: "单跑构建·安装依赖",
            id: "stage-0",
          },
          {
            status: "cancel",
            duration: 86,
            name: "单跑构建·同步数据库表结构",
            id: "stage-1",
          },
          {
            status: "skipped",
            duration: 0,
            name: "单跑构建·生产构建",
            id: "stage-2",
          },
          {
            status: "success",
            duration: 3,
            name: "BeforeEnd",
            id: "beforeEnd",
          },
          {
            status: "skipped",
            duration: 0,
            name: "DebugDetection",
            id: "debugDetection",
          },
          { status: "success", duration: 81, name: "End", id: "end" },
        ],
      },
    },
  },
};

/** 真失败那一跑（`cnb-723-1k5h25hkt`）：第三格自己跑挂了（体积拒涨）。 */
const FAILED_BUILD = {
  status: 200,
  data: {
    status: "error",
    pipelinesStatus: {
      "cnb-723-1k5h25hkt-001": {
        id: "cnb-723-1k5h25hkt-001",
        name: "单跑生产构建（API 触发）",
        status: "error",
        stages: [
          {
            status: "success",
            duration: 26686,
            name: "Prepare",
            id: "prepare",
          },
          {
            status: "success",
            duration: 197327,
            name: "单跑构建·安装依赖",
            id: "stage-0",
          },
          {
            status: "success",
            duration: 12676,
            name: "单跑构建·同步数据库表结构",
            id: "stage-1",
          },
          {
            status: "error",
            duration: 100418,
            name: "单跑构建·生产构建",
            id: "stage-2",
          },
          {
            status: "success",
            duration: 4,
            name: "BeforeEnd",
            id: "beforeEnd",
          },
          { status: "success", duration: 70, name: "End", id: "end" },
        ],
      },
    },
  },
};

/** 绿的那一跑（PR 流水线 `cnb-ih9-1k5h9ntl9` 的形状）。 */
const GREEN_BUILD = {
  status: 200,
  data: {
    status: "success",
    pipelinesStatus: {
      "cnb-ih9-1k5h9ntl9-001": {
        id: "cnb-ih9-1k5h9ntl9-001",
        name: "质量门禁",
        status: "success",
        stages: [
          { status: "success", duration: 10, name: "Prepare", id: "prepare" },
          {
            status: "success",
            duration: 20,
            name: "工作区出处",
            id: "stage-0",
          },
          { status: "success", duration: 30, name: "End", id: "end" },
        ],
      },
    },
  },
};

describe("逐格分类：平台自带那几格不是本仓配置的那几格", () => {
  it("只收 id 形如 stage-N 的那几格", () => {
    const stages = classifyStages(
      CANCELLED_BUILD.data.pipelinesStatus["cnb-lm1-1k5h1otqt-001"].stages,
    );
    expect(stages.configured.map((s) => s.id)).toEqual([
      "stage-0",
      "stage-1",
      "stage-2",
    ]);
    expect(stages.configured.map((s) => s.name)).not.toContain("Prepare");
  });

  it("认不出 id 形状时退回「全收」—— 宁可多念几行，也不把证据一起丢掉", () => {
    const stages = classifyStages([
      { status: "cancel", name: "某格", id: "weird-id" },
      { status: "success", name: "平台那格", id: "prepare" },
    ]);
    expect(stages.configured).toHaveLength(2);
    expect(stages.cancelled.map((s) => s.name)).toEqual(["某格"]);
  });

  it("形状不对（不是数组）⇒ 空读数，不是「没出问题」", () => {
    const stages = classifyStages(undefined);
    expect(stages.configured).toEqual([]);
    expect(stages.failed).toEqual([]);
  });
});

describe("整条构建的分类：三档 + 负控制", () => {
  it("被取消那一跑 ⇒ cancelled，并点名被取消的那一格与下面那几格", () => {
    const o = classifyBuildOutcome(CANCELLED_BUILD);
    expect(o.state).toBe("cancelled");
    expect(o.cancelled.map((s) => s.name)).toEqual([
      "单跑构建·同步数据库表结构",
    ]);
    expect(o.failed).toEqual([]);
    expect(downstreamSkipped(o).map((s) => s.name)).toEqual([
      "单跑构建·生产构建",
    ]);
  });

  it("真失败那一跑 ⇒ failed（不是 cancelled），并点名红的那一格", () => {
    const o = classifyBuildOutcome(FAILED_BUILD);
    expect(o.state).toBe("failed");
    expect(o.failed.map((s) => s.name)).toEqual(["单跑构建·生产构建"]);
    expect(o.cancelled).toEqual([]);
  });

  it("绿的那一跑 ⇒ green", () => {
    expect(classifyBuildOutcome(GREEN_BUILD).state).toBe("green");
  });

  it("负控制：只有信封上的 status（data 缺席）⇒ unknown，**不是** green", () => {
    expect(classifyBuildOutcome({ status: 200 }).state).toBe("unknown");
    expect(classifyBuildOutcome(null).state).toBe("unknown");
    expect(classifyBuildOutcome({ data: {} }).state).toBe("unknown");
  });

  it("逐格读数缺席时退回构建级状态（error ⇒ failed），不是「没发现问题」", () => {
    expect(classifyBuildOutcome({ data: { status: "error" } }).state).toBe(
      "failed",
    );
    expect(classifyBuildOutcome({ data: { status: "success" } }).state).toBe(
      "green",
    );
    expect(classifyBuildOutcome({ data: { status: "running" } }).state).toBe(
      "running",
    );
  });

  it("真红优先于被取消（两者同时出现 ⇒ failed）", () => {
    const mixed = {
      data: {
        status: "error",
        pipelinesStatus: {
          p: {
            name: "某条流水线",
            status: "cancel",
            stages: [
              { status: "cancel", name: "被顶掉的那格", id: "stage-0" },
              { status: "error", name: "红的那格", id: "stage-1" },
            ],
          },
        },
      },
    };
    expect(classifyBuildOutcome(mixed).state).toBe("failed");
  });

  it("流水线级就是 cancel（逐格读数没给出取消格）⇒ 也是 cancelled", () => {
    const pipelineOnly = {
      data: {
        status: "error",
        pipelinesStatus: { p: { name: "某条流水线", status: "cancel" } },
      },
    };
    expect(classifyBuildOutcome(pipelineOnly).state).toBe("cancelled");
  });
});

describe("读出来的那几行：被取消不许被念成「CI 红」", () => {
  it("被取消 ⇒ 念「没有结论」、点名被取消的那一格与下面根本没跑的那几格", () => {
    const o = classifyBuildOutcome(CANCELLED_BUILD);
    const text = formatOutcome(o, {
      sn: "cnb-lm1-1k5h1otqt",
      slug: "org/repo",
    }).join("\n");
    expect(text).toContain("被取消");
    expect(text).toContain("不是产物坏了");
    expect(text).toContain("单跑构建·同步数据库表结构");
    expect(text).toContain("下面这些格根本没跑");
    expect(text).toContain("单跑构建·生产构建");
    expect(text).toContain("不要去查产物");
    expect(text).not.toContain("CI 红");
  });

  it("真失败 ⇒ 念「红的那一格」并给日志页", () => {
    const o = classifyBuildOutcome(FAILED_BUILD);
    const text = formatOutcome(o, {
      sn: "cnb-723-1k5h25hkt",
      slug: "org/repo",
    }).join("\n");
    expect(text).toContain("真失败");
    expect(text).toContain("红的那一格");
    expect(text).toContain("/-/build/logs/cnb-723-1k5h25hkt");
  });

  it("平台给的原因原话被原样念出来（那是平台自己的话，不是本仓转述的）", () => {
    const o = classifyBuildOutcome(CANCELLED_BUILD);
    const text = formatOutcome(o, {
      sn: "cnb-lm1-1k5h1otqt",
      slug: "org/repo",
      reason:
        "The pipeline has been manually terminated or terminated by another pipeline.",
    }).join("\n");
    expect(text).toContain("平台给的原因");
    expect(text).toContain("terminated by another pipeline");
  });
});

describe("命令行：认不出的参数与缺值都不许默默作动", () => {
  it("认得的那几个旗标", () => {
    const a = parseArgs([
      "--repo",
      "org/repo",
      "--sn",
      "cnb-1",
      "--limit",
      "5",
    ]);
    expect(a.repo).toBe("org/repo");
    expect(a.sn).toBe("cnb-1");
    expect(a.limit).toBe(5);
    expect(a.error).toBeNull();
  });

  it("缺省：事件是「单跑生产构建（API 触发）」，条数 3", () => {
    const a = parseArgs([]);
    expect(a.event).toBe("api_trigger_build");
    expect(a.limit).toBe(3);
  });

  it("认不出的旗标 ⇒ 报错，不是「没这个参数也照跑」", () => {
    expect(parseArgs(["--sn"]).error).not.toBeNull();
    expect(parseArgs(["--limit", "0"]).error).not.toBeNull();
    expect(parseArgs(["--limit", "x"]).error).not.toBeNull();
    expect(parseArgs(["--whatever"]).error).not.toBeNull();
  });
});

describe("入口：三档各退各的码", () => {
  /** 假执行者：只答平台那两个调用。 */
  function fakeRun(
    status: unknown,
    stage?: unknown,
  ): (
    cmd: string,
    args: string[],
  ) => {
    status: number;
    stdout: string;
    stderr: string;
    error: string | null;
  } {
    return (_cmd, args) => {
      if (args[1] === "get-build-status") {
        return {
          status: 0,
          stdout: JSON.stringify(status),
          stderr: "",
          error: null,
        };
      }
      if (args[1] === "get-build-stage") {
        return {
          status: 0,
          stdout: JSON.stringify(stage ?? { data: {} }),
          stderr: "",
          error: null,
        };
      }
      return { status: 0, stdout: "", stderr: "", error: null };
    };
  }

  it("绿 ⇒ 0；真失败 ⇒ 1；被取消 ⇒ 2（那是「没有结论」，不是「红」）", () => {
    const log: string[] = [];
    const green = main({
      argv: ["--repo", "org/repo", "--sn", "b1"],
      run: fakeRun(GREEN_BUILD),
      log: (s) => log.push(s),
    });
    expect(green).toBe(0);

    const failed = main({
      argv: ["--repo", "org/repo", "--sn", "b2"],
      run: fakeRun(FAILED_BUILD),
      log: (s) => log.push(s),
    });
    expect(failed).toBe(1);

    const cancelled = main({
      argv: ["--repo", "org/repo", "--sn", "b3"],
      run: fakeRun(CANCELLED_BUILD, {
        data: {
          error:
            "The pipeline has been manually terminated or terminated by another pipeline.",
        },
      }),
      log: (s) => log.push(s),
    });
    expect(cancelled).toBe(2);
    expect(log.join("\n")).toContain("平台给的原因");
  });

  it("取不到状态 ⇒ 没有结论（2），不是绿", () => {
    const code = main({
      argv: ["--repo", "org/repo", "--sn", "b4"],
      run: fakeRun(null),
      log: () => undefined,
    });
    expect(code).toBe(2);
  });

  it("参数认不出 ⇒ 2，并打印用法", () => {
    const log: string[] = [];
    const code = main({
      argv: ["--nope"],
      run: fakeRun(GREEN_BUILD),
      log: (s) => log.push(s),
    });
    expect(code).toBe(2);
    expect(log.join("\n")).toContain("用法");
  });
});

/**
 * `inFlightStages`（ISSUE #2184）：轮询的**第二个前提**。
 *
 * 签名是离散计数，一格跑得久时签名自己不动 —— 只看「签名没变」就会把正在推进的流水线
 * 掐掉（现场：`…/pending/0-1+11/33` 连满 10 眼，几分钟后同一条构建是 28/33）。
 * 所以这一判要认的是平台那份**逐格**词汇：运行中的那一格叫 `start`，
 * 而还没轮到的那一格叫 `pending` —— 两者必须分开，否则队列里没起来的那种真停滞
 * 就再也断不掉了（那是 #2152 这一格存在的全部理由）。
 */
describe("inFlightStages：这一刻有没有一格在飞", () => {
  /** 造一份「一条 pipeline、几格各有各状态」的读数。 */
  const build = (statuses: string[]) => ({
    status: 200,
    data: {
      status: "pending",
      pipelinesStatus: {
        "p-001": {
          id: "p-001",
          name: "质量门禁",
          status: "pending",
          stages: statuses.map((s, i) => ({
            status: s,
            duration: 0,
            name: s === "start" ? "受影响用例" : `格${i}`,
            id: `stage-${i}`,
          })),
        },
      },
    },
  });

  it("一格 `start` ⇒ 数出 1 格，并带上格名（那一格是要念给人的）", () => {
    expect(inFlightStages(build(["success", "start", "pending"]))).toEqual({
      count: 1,
      names: ["受影响用例"],
    });
  });

  it("负控制：`pending`（还没轮到）不算在飞 ⇒ 队列里没起来那一形照旧能断流", () => {
    expect(inFlightStages(build(["success", "pending", "pending"])).count).toBe(
      0,
    );
  });

  it("已落定的格（success / error / cancel / skipped）都不算在飞", () => {
    expect(
      inFlightStages(build(["success", "error", "cancel", "skipped"])).count,
    ).toBe(0);
  });

  it("读不到（null / 畸形 / 没有 pipelinesStatus）⇒ 0 格，而不是抛错", () => {
    expect(inFlightStages(null)).toEqual({ count: 0, names: [] });
    expect(inFlightStages({})).toEqual({ count: 0, names: [] });
    expect(inFlightStages({ data: { pipelinesStatus: null } }).count).toBe(0);
  });
});

/**
 * 格的日志正文有三种形状（字符串 / 行数组 / 带 ANSI），归一是**唯一实现**。
 *
 * 不归一的后果不是「显示难看」：`content` 是行数组时按字符串读会得到 `"a,b,c"`，
 * 行号与 `FAIL` 匹配全部失效，于是「摘要空着」被读成「日志里没有失败行」。
 */
describe("normalizeStageContent：三种形状一处收口", () => {
  it("行数组按行拼接（不是逗号串）", () => {
    expect(normalizeStageContent(["a", "b", "c"])).toBe("a\nb\nc");
  });

  it("字符串原样保留、CRLF 归一成 LF", () => {
    expect(normalizeStageContent("a\r\nb\rc")).toBe("a\nb\nc");
  });

  it("剥掉 ANSI 控制序列（颜色不该混进行号与匹配）", () => {
    expect(normalizeStageContent(["\u001b[31mFAIL\u001b[0m x", "ok"])).toBe(
      "FAIL x\nok",
    );
  });

  it("非字符串 / null / 缺字段 ⇒ 空串，不抛", () => {
    expect(normalizeStageContent(null)).toBe("");
    expect(normalizeStageContent(undefined)).toBe("");
    expect(normalizeStageContent([null, 42])).toBe("\n42");
  });
});

/**
 * 构建列表的信封有两种形状（ISSUE #2335 的现场读数）。
 *
 * 平台在 `get-build-logs` 上两种都给过：列表直挂 `data`，与套一层
 * `{data:{total,totalCapped,data:[…]}}`。只认第一种时 `fetchBuildList()` 回 `null`，
 * 调用方把它念成「取不到构建列表」—— 一次**看起来像网络故障**的空读数；而 PR 档那一格
 * 正是靠这份列表认出「这一跑是谁」的：认不出 ⇒ 一律不写 ⇒ 那一格绿着、红没人知道
 * （#2335 的 `cnb-vko-1k5oj5gb0`）。
 */
describe("fetchBuildList：两种信封都要认出列表", () => {
  const ROWS = [
    {
      sn: "sn-a",
      createTime: "2026-10-25T04:07:35.000Z",
      status: "error",
      eventUrl: "https://cnb.cool/a/b/-/pulls/1",
    },
    {
      sn: "sn-b",
      createTime: "2026-10-25T03:07:35.000Z",
      status: "success",
      eventUrl: "https://cnb.cool/a/b/-/pulls/1",
    },
  ];
  const runner = (payload: unknown) => () => ({
    status: 0,
    stdout: JSON.stringify(payload),
    stderr: "",
    error: null,
  });

  it("套一层（`data.data`）⇒ 认出来，且按时间新到旧排", () => {
    const got = fetchBuildList(
      runner({ status: 200, data: { total: "2", data: ROWS } }),
      "a/b",
      "pull_request",
      10,
    );
    expect(got?.map((b: { sn: string }) => b.sn)).toEqual(["sn-a", "sn-b"]);
    expect(got?.[0]?.eventUrl).toBe("https://cnb.cool/a/b/-/pulls/1");
  });

  it("列表直挂（`data` 就是数组）⇒ 同样认出来", () => {
    const got = fetchBuildList(
      runner({ status: 200, data: ROWS }),
      "a/b",
      "pull_request",
      10,
    );
    expect(got?.map((b: { sn: string }) => b.sn)).toEqual(["sn-a", "sn-b"]);
  });

  it("两种都不是 ⇒ null（那是真「取不到」，不许当成空列表）", () => {
    expect(
      fetchBuildList(runner({ status: 200, data: {} }), "a/b", "x", 10),
    ).toBeNull();
  });

  /**
   * 「取不到」要自己说清是哪一种（ISSUE #2335 现场：那一格只留下六个字
   * `取不到构建列表`，而「命令没起来 / 退码非零（凭据、权限）/ 信封又变了」
   * 三种原因的下一个动作完全不同）。这里判的是**念出声**，结论仍是 `null`。
   */
  it("取不到时把原因念出来（退码 + stderr 首行 + 信封的顶层键），结论仍是 null", () => {
    const heard: string[] = [];
    const got = fetchBuildList(
      () => ({
        status: 1,
        // 平台那侧真给的形状：`data` 里放的是错误详情，不是列表。
        stdout: JSON.stringify({
          status: 200,
          data: { code: 401, message: "unauthorized" },
        }),
        stderr: "凭据已过期\n第二行",
        error: null,
      }),
      "a/b",
      "pull_request",
      10,
      { log: (line: string) => heard.push(line) },
    );
    expect(got).toBeNull();
    const out = heard.join("\n");
    expect(out).toContain("取不到");
    expect(out).toContain("退码 1");
    expect(out).toContain("凭据已过期");
    // 第二行 stderr 不念：一行足够定性，整段倒进流水线只是噪声。
    expect(out).not.toContain("第二行");
    // 信封的**内容**也念（顶层键与本地一样时，只念顶层键等于什么都没说）。
    expect(out).toContain("data=");
    expect(out).toContain("unauthorized");
  });

  it("命令根本没起来 ⇒ 念的是「没起来」，不是退码", () => {
    const heard: string[] = [];
    fetchBuildList(
      () => ({ status: -1, stdout: "", stderr: "", error: "ENOENT" }),
      "a/b",
      "x",
      10,
      { log: (line: string) => heard.push(line) },
    );
    expect(heard.join("\n")).toContain("没起来");
  });
});
describe("stageLogExcerpt：失败行带行号 + 尾部，两段都给", () => {
  const LOG = [
    "RUN v1",
    " ✓ 通过的一堆",
    " ❯ src/a.test.ts (3 tests | 1 failed)",
    "   × 缺键时念 pnpm env:init",
    "     → expected 'x' to contain 'y'",
    " FAIL src/a.test.ts > 那一条",
    "AssertionError: expected 1 to be 2",
    " Test Files  1 failed (1)",
    "",
  ].join("\n");

  it("失败行原样带完整日志行号", () => {
    const ex = stageLogExcerpt(LOG);
    const lines = ex.failure.map((l) => l.line);
    expect(lines).toContain(4);
    expect(lines).toContain(6);
    expect(lines).toContain(7);
    expect(lines).toContain(8);
    expect(ex.failure.map((l) => l.text).join("\n")).toContain(
      "缺键时念 pnpm env:init",
    );
  });

  it("尾部按「末 N 行」取，且行号对得上完整日志", () => {
    const ex = stageLogExcerpt(LOG, { tailLines: 2 });
    expect(ex.totalLines).toBe(9);
    expect(ex.tail.map((l) => l.line)).toEqual([7, 8]);
  });

  it("负控制：日志里没有失败形状 ⇒ 失败行为空（那是「没认出」，不是「没有红」）", () => {
    expect(stageLogExcerpt("all good\nok\n").failure).toEqual([]);
  });
});

describe("describeFailedStages：红格的头、失败行、尾部与日志链接", () => {
  const STAGE_DETAIL = {
    status: 200,
    data: {
      status: "error",
      duration: 100418,
      error: "",
      content: [
        "RUN v5.0.3",
        " × 缺键时念 pnpm env:init 5ms",
        "   → expected 'a' to contain 'b'",
        " Test Files  1 failed (1)",
      ],
    },
  };

  function fakeRun(detail: unknown) {
    return (_cmd: string, args: string[]) => {
      if (args[0] === "build" && args[1] === "get-build-stage") {
        return {
          status: 0,
          stdout: JSON.stringify(detail),
          stderr: "",
          error: null,
        };
      }
      return { status: 0, stdout: "", stderr: "", error: null };
    };
  }

  it("念出格名 / status / 耗时，失败行带行号，尾部与完整链接都在", () => {
    const log: string[] = [];
    const outcome = classifyBuildOutcome(FAILED_BUILD);
    const noted = describeFailedStages(fakeRun(STAGE_DETAIL), {
      slug: "org/repo",
      sn: "cnb-723-1k5h25hkt",
      outcome,
      log: (s) => log.push(s),
    });
    const text = log.join("\n");
    expect(noted).toBe(1);
    expect(text).toContain("失败格：单跑构建·生产构建");
    expect(text).toContain("100418s");
    expect(text).toContain("L2  × 缺键时念 pnpm env:init");
    expect(text).toContain("末 4 行");
    // 完整日志链接由 `formatOutcome` 的下一动作那句给出（不是这里重复一遍）。
    expect(
      formatOutcome(outcome, {
        sn: "cnb-723-1k5h25hkt",
        slug: "org/repo",
      }).join("\n"),
    ).toContain("https://cnb.cool/org/repo/-/build/logs/cnb-723-1k5h25hkt");
  });

  it("取不到正文 ⇒ 念「没有结论」，不念「日志里没有失败行」", () => {
    const log: string[] = [];
    const noted = describeFailedStages(fakeRun({}), {
      slug: "org/repo",
      sn: "b1",
      outcome: classifyBuildOutcome(FAILED_BUILD),
      log: (s) => log.push(s),
    });
    expect(noted).toBe(0);
    expect(log.join("\n")).toContain("取不到这一格的日志正文");
    expect(log.join("\n")).not.toContain("没认出失败行");
  });

  it("pipelineForStage 找得到格所在的流水线；找不到回 null", () => {
    const outcome = classifyBuildOutcome(FAILED_BUILD);
    expect(pipelineForStage(outcome, "stage-2")?.name).toBe(
      "单跑生产构建（API 触发）",
    );
    expect(pipelineForStage(outcome, "stage-9")).toBeNull();
  });
});

describe("formatOutcome：前缀可注入（ship 的 --diagnose 复用同一份话术）", () => {
  it("每行都用给定前缀", () => {
    const lines = formatOutcome(classifyBuildOutcome(GREEN_BUILD), {
      sn: "b1",
      slug: "org/repo",
      prefix: "[ship]",
    });
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line.startsWith("[ship]")).toBe(true);
  });
});

/**
 * 「还在跑」那一支的进度读数（ISSUE #2304）。
 *
 * 防的是这一格：诊断只念「还在跑，等它跑完再读一次」，而轮询那行念的是格子进度 ——
 * 同一个事实两个读者面，看诊断的人只能去翻原始 JSON，而那层嵌套
 * （`data.pipelinesStatus.<sn>-001.stages[]`）读错一次就把「在推进」念成「一格都没起」。
 */
const RUNNING_BUILD = {
  status: 200,
  data: {
    status: "pending",
    pipelinesStatus: {
      "b1-001": {
        id: "b1-001",
        name: "质量门禁",
        status: "pending",
        stages: [
          { status: "success", duration: 1, name: "Prepare", id: "s1" },
          { status: "start", duration: 0, name: "受影响用例", id: "s2" },
          { status: "pending", duration: 0, name: "类型检查", id: "s3" },
        ],
      },
    },
  },
};

describe("progressReadout：诊断与轮询共用同一份计数", () => {
  it("签名逐字等于 `buildSignature`（不许另数一遍）", () => {
    const got = progressReadout(RUNNING_BUILD, "b1");
    expect(got.signature).toBe(buildSignature(RUNNING_BUILD, "b1"));
    expect(got.signature).toContain("/pending/");
  });

  it("在飞那一格只算 `start`，完成数把它排除在外（`0-1+1/3`）", () => {
    const got = progressReadout(RUNNING_BUILD, "b1");
    expect(got.flyingCount).toBe(1);
    expect(got.flyingNames).toEqual(["受影响用例"]);
    expect(got.signature).toBe("b1/pending/0-1+1/3");
  });

  it("取不到原值时不抛，签名里点名「取不到」", () => {
    const got = progressReadout(null, "b1");
    expect(got.flyingCount).toBe(0);
    expect(got.signature).toContain("(取不到 data)");
  });
});

describe("formatOutcome：running 那一支把进度念出来", () => {
  it("给了 json ⇒ 两行（进度 + 在飞），且进度那行就是同一个签名", () => {
    const lines = formatOutcome(classifyBuildOutcome(RUNNING_BUILD), {
      sn: "b1",
      slug: "org/repo",
      json: RUNNING_BUILD,
      prefix: "[ship]",
    });
    const text = lines.join("\n");
    expect(text).toContain("还在跑");
    expect(text).toContain(`进度（与轮询那行同一份计算）：${buildSignature(RUNNING_BUILD, "b1")}`);
    expect(text).toContain("在飞 1 格：受影响用例");
  });

  it("一格都没在飞时念「没有一格在飞」，不念成绿", () => {
    const idle = structuredClone(RUNNING_BUILD);
    const stage = idle.data.pipelinesStatus["b1-001"]?.stages?.[1];
    expect(stage, "夹具形状变了（找不到第二格）").toBeTruthy();
    if (stage) stage.status = "pending";
    const text = formatOutcome(classifyBuildOutcome(idle), {
      sn: "b1",
      json: idle,
    }).join("\n");
    expect(text).toContain("此刻没有一格在飞");
    expect(text).not.toContain("结论：绿");
  });

  it("没给 json 就少念那两行 —— 旧行为与判定一字不变（仍是「没有结论」）", () => {
    const lines = formatOutcome(classifyBuildOutcome(RUNNING_BUILD), {
      sn: "b1",
      slug: "org/repo",
    });
    const text = lines.join("\n");
    expect(text).toContain("还在跑");
    expect(text).not.toContain("进度（");
    expect(text).not.toContain("在飞 ");
  });
});
