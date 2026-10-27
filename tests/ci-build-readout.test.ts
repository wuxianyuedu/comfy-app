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
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  cancelledCause,
  classifyBuildOutcome,
  classifyStages,
  describeFailedStages,
  downstreamSkipped,
  enrichStageErrors,
  formatOutcome,
  fetchBuildList,
  findStageMatches,
  inFlightStages,
  main,
  normalizeStageContent,
  parseArgs,
  pipelineForStage,
  pipelineSn,
  progressReadout,
  resolveBuildSn,
  stageInFlight,
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

describe("逐格分类：工作格 = stage-N 与 prepare，平台其余那几格不算", () => {
  it("收 stage-N 与 prepare，不收 BeforeEnd / DebugDetection / End", () => {
    const stages = classifyStages(
      CANCELLED_BUILD.data.pipelinesStatus["cnb-lm1-1k5h1otqt-001"].stages,
    );
    expect(stages.configured.map((s) => s.id)).toEqual([
      "prepare",
      "stage-0",
      "stage-1",
      "stage-2",
    ]);
    /* `prepare` 必须在里面（ISSUE #2406）：prepare 期就被终止的那一跑里，它是唯一
     * 有读数的格 —— 丢掉它等于把那一整类读数交给构建级 `error` 去顶替。 */
    expect(stages.configured.map((s) => s.name)).toContain("Prepare");
    for (const noise of ["BeforeEnd", "DebugDetection", "End"]) {
      expect(stages.configured.map((s) => s.name)).not.toContain(noise);
    }
  });

  it("认不出 id 形状时退回「全收」—— 宁可多念几行，也不把证据一起丢掉", () => {
    const stages = classifyStages([
      { status: "cancel", name: "某格", id: "weird-id" },
      { status: "success", name: "另一格", id: "another-weird-id" },
    ]);
    expect(stages.configured).toHaveLength(2);
    expect(stages.cancelled.map((s) => s.name)).toEqual(["某格"]);
    /* 反向：只要**有一格**认得出形状，就按那个口径收 —— 认得出的时候不退回「全收」，
     * 否则 `BeforeEnd` / `End` 这些平台自带格会被当成工作格念进读数。 */
    const mixed = classifyStages([
      { status: "cancel", name: "某格", id: "weird-id" },
      { status: "success", name: "Prepare", id: "prepare" },
      { status: "success", name: "End", id: "end" },
    ]);
    expect(mixed.configured.map((s) => s.name)).toEqual(["Prepare"]);
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
    /* 原话从现在起走 `outcome.reasons` 那一栏（它先于兜底那行被念），话术从
     * 「平台给的原因」改成「平台原话」—— 同一件事，不再念两遍（ISSUE #2406）。 */
    expect(log.join("\n")).toContain("平台原话");
    expect(log.join("\n")).toContain("terminated by another pipeline");
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

describe("stageLogExcerpt：判据锚优先，夹具噪声降级成一句计数（ISSUE #2443）", () => {
  /* 形状照抄 build `cnb-phl-1k5rscpsg` 的「受影响用例」：清单按行号排，
   * 噪声（夹具驱动的产品日志 + teardown 时被 abort 的真请求）排在真读数前面。 */
  const NOISY = [
    "stdout | src/components/workshop/hooks/x.test.ts > 某条用例",
    "[canvas-sync] 这份画布没能存进服务端（暂时性，下一次自动保存会再试）：… TRPCClientError — cause=Error: Stream closed before head was received",
    "",
    "    Error: connect ECONNREFUSED ::1:3000",
    "    Error: connect ECONNREFUSED 127.0.0.1:3000",
    "",
    " FAIL   node  tests/ci-env-probe.test.ts > 环境前提 > 读数与判据分得开",
    "Error: Test timed out in 30000ms.",
    " > tests/ci-env-probe.test.ts:284:3",
    " FAIL   node  tests/storybook-tsc-input.test.ts > ④ 缺了生成件时 tsc 真的退 0",
    "Error: Test timed out in 120000ms.",
    " Test Files  2 failed | 226 passed (228)",
    "      Tests  2 failed | 2674 passed | 3 skipped (2679)",
  ].join("\n");

  it("有锚点 ⇒ 只列锚点，带错误字样的噪声行只计数", () => {
    const ex = stageLogExcerpt(NOISY);
    const listed = ex.failure.map((l) => l.text).join("\n");
    for (const want of [
      "tests/ci-env-probe.test.ts > 环境前提",
      "Test timed out in 30000ms",
      "tests/storybook-tsc-input.test.ts",
      "Test timed out in 120000ms",
      "Test Files  2 failed",
    ]) {
      expect(listed).toContain(want);
    }
    expect(listed).not.toContain("canvas-sync");
    expect(listed).not.toContain("ECONNREFUSED");
    expect(ex.anchored).toBe(true);
    expect(ex.demoted).toBe(3);
    /* 行号仍是完整日志的行号（人能拿着它跳进去） */
    expect(ex.failure[0]!.line).toBe(7);
  });

  it("负控制：没有锚点的格（构建类）保持宽松指纹，不降级", () => {
    const ex = stageLogExcerpt("RUN build\nError: Cannot find module 'x'\n");
    expect(ex.anchored).toBe(false);
    expect(ex.failure.map((l) => l.text)).toEqual([
      "Error: Cannot find module 'x'",
    ]);
    expect(ex.demoted).toBe(0);
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
    expect(text).toContain("· 1m40s");
    // 毫秒原值不许出现在时长那一格里：`100418s` 是这条判据上线前的实际读数
    // （平台的 `duration` 是毫秒，旧实现硬接了一个字面量 `s`，ISSUE #2442）。
    expect(text).not.toContain("100418s");
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

  it("当场那份读数：930916 毫秒念成 15m31s，不念成 930916s（≈10.7 天）", () => {
    const log: string[] = [];
    const detail = {
      ...STAGE_DETAIL,
      data: { ...STAGE_DETAIL.data, duration: 930_916 },
    };
    describeFailedStages(fakeRun(detail), {
      slug: "org/repo",
      sn: "cnb-phl-1k5rscpsg",
      outcome: classifyBuildOutcome(FAILED_BUILD),
      log: (s) => log.push(s),
    });
    const text = log.join("\n");
    expect(text).toContain("· 15m31s");
    expect(text).not.toContain("930916");
  });

  it("夹具噪声不占失败行清单，只念一句计数（ISSUE #2443）", () => {
    const log: string[] = [];
    const detail = {
      ...STAGE_DETAIL,
      data: {
        ...STAGE_DETAIL.data,
        /* 真实形状：噪声按行号在前面，锚点（`×` / 汇总）在后面。 */
        content: [
          "stdout | src/a.test.ts > 某条用例",
          "[canvas-sync] 这份画布没能存进服务端：… cause=Error: Stream closed before head was received",
          " × 缺键时念 pnpm env:init 5ms",
          " Test Files  1 failed (1)",
        ],
      },
    };
    describeFailedStages(fakeRun(detail), {
      slug: "org/repo",
      sn: "b1",
      outcome: classifyBuildOutcome(FAILED_BUILD),
      log: (s) => log.push(s),
    });
    const text = log.join("\n");
    /* 尾部是**不过滤**的（它就是「最后那一屏」），所以噪声仍出现在末 4 行里；
     * 判的是失败行清单不再给它留位置。 */
    expect(text).toContain("L3  × 缺键时念 pnpm env:init");
    expect(text).toContain("另有 1 行含错误形状文本，未列出");
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
    expect(text).toContain(
      `进度（与轮询那行同一份计算）：${buildSignature(RUNNING_BUILD, "b1")}`,
    );
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

/**
 * ⚠️ 下面这一族是 ISSUE #2406 的现场（2026-10-26）：**prepare 期就被另一条流水线抢走锁**。
 *
 * 它此前被判成「真失败」，理由是漏了整整一层读数：
 *   · `get-build-status` 的 `stages[]` **没有 `error` 这一栏**（真机取回来只有
 *     `status/duration/name/id`），而「被顶掉」与「真失败」的分界线就在那句原话上；
 *   · `prepare` 那一格平台记的是 `error`（不是 `cancel`），它又曾被当成
 *     「平台自带的噪声」丢掉 ⇒ `failed` / `cancelled` 两个集合都空 ⇒ 落到构建级 `error`。
 *
 * 所以这一族的样本必须**两层都给**：`get-build-status` 那份（没 `error`）
 * 与 `get-build-stage` 那份（有 `error`），而 `enrichStageErrors()` 就是中间那一步。
 */

/** `get-build-status -v` 的 `data` 那一段（用例只用到 `pipelinesStatus[*].stages[]`）。 */
interface BuildJson {
  data: {
    status?: string;
    pipelinesStatus: Record<
      string,
      { id?: string; name?: string; status?: string; stages: StageJson[] }
    >;
  };
}

/** 一格（`error` 那一栏只有 `get-build-stage -v` 才给，`get-build-status` 里没有）。 */
interface StageJson {
  id?: string;
  name?: string;
  status?: string;
  duration?: number;
  error?: string;
}

/** 取 `prepare` 那一格 —— 这一族样本里它是主角（唯一有读数的那一格）。 */
function prepareStage(
  json: BuildJson,
  key = "cnb-9qi-1k5qojle1-001",
): StageJson {
  /* `noUncheckedIndexedAccess` 在本仓开着。样本是我们自己造的形状，取不到就是样本坏了 ——
     抛出比静默给出 `undefined` 更早暴露，且与「生产代码 0 处 `!`」那条判据不冲突。 */
  const stage = json.data.pipelinesStatus[key]?.stages[0];
  if (!stage) throw new Error(`样本里没有 ${key} 的第一格`);
  return stage;
}

const LOCK_TERMINATED_MESSAGE =
  "Pipeline was stoped，Pipeline: cnb-jpf-1k5qok15v-001 got lock: moon-read/comfy-app-t3-push. The current pipeline is terminated";

/** `cnb-9qi-1k5qojle1` 的真形状：构建级 error、流水线 cancel、prepare 报 error 且**没有** error 栏。 */
const KILLED_AT_PREPARE = {
  status: 200,
  data: {
    status: "error",
    pipelinesStatus: {
      "cnb-9qi-1k5qojle1-001": {
        id: "cnb-9qi-1k5qojle1-001",
        name: "master 合并复核",
        status: "cancel",
        duration: 12855,
        stages: [
          { status: "error", duration: 12856, name: "Prepare", id: "prepare" },
          {
            status: "skipped",
            duration: 0,
            name: "合并形态复核",
            id: "stage-0",
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
          { status: "success", duration: 77, name: "End", id: "end" },
        ],
      },
    },
  },
};

/** 同一跑、`prepare` 那一格用 `get-build-stage -v` 取回来的形状（**带** error）。 */
const KILLED_AT_PREPARE_STAGE = {
  status: 200,
  data: {
    duration: 12856,
    content: ["…", "Pipeline prepare error: …"],
    endTime: 1792973342893,
    error: LOCK_TERMINATED_MESSAGE,
    status: "error",
    name: "Prepare",
    startTime: 1792973330037,
    id: "prepare",
  },
};

/** 真失败的那一跑（`cnb-ico-1k5r2letb`）：Prepare 绿、`受影响用例` 红在一条断言上。 */
const REAL_FAILURE = {
  status: 200,
  data: {
    status: "error",
    pipelinesStatus: {
      "cnb-ico-1k5r2letb-001": {
        id: "cnb-ico-1k5r2letb-001",
        name: "质量门禁",
        status: "error",
        stages: [
          {
            status: "success",
            duration: 30000,
            name: "Prepare",
            id: "prepare",
          },
          {
            status: "error",
            duration: 239752,
            name: "受影响用例",
            id: "stage-9",
            error: "任务执行失败，返回码：1, signal: -1",
          },
          {
            status: "skipped",
            duration: 0,
            name: "标题行让位",
            id: "stage-10",
          },
          {
            status: "success",
            duration: 3,
            name: "BeforeEnd",
            id: "beforeEnd",
          },
          { status: "success", duration: 81, name: "End", id: "end" },
        ],
      },
    },
  },
};

describe("cancelledCause：被终止与真失败在原话上分得开（ISSUE #2406）", () => {
  it("抢锁那条原话 ⇒ cancelled，并读出抢锁的是哪一跑", () => {
    const c = cancelledCause({
      status: "error",
      error: LOCK_TERMINATED_MESSAGE,
    });
    expect(c.kind).toBe("cancelled");
    expect(c.holder).toBe("cnb-jpf-1k5qok15v");
    expect(c.sn).toBe("cnb-jpf-1k5qok15v");
  });

  it("人为终止那条原话 ⇒ cancelled，但认不出「谁」时不编一个号出来", () => {
    const c = cancelledCause({
      status: "cancel",
      error:
        "The pipeline has been manually terminated or terminated by another pipeline.",
    });
    expect(c.kind).toBe("cancelled");
    expect(c.holder).toBeNull();
    expect(c.sn).toBeNull();
  });

  it("格状态是 error 而原话是被终止 ⇒ 仍然 cancelled（prepare 那种格平台只记 error）", () => {
    expect(
      cancelledCause({ status: "error", error: LOCK_TERMINATED_MESSAGE }).kind,
    ).toBe("cancelled");
  });

  it("负控制：真失败那一条原话 ⇒ failed（判据自己的退出码，不是终止语）", () => {
    const c = cancelledCause({
      status: "error",
      error: "任务执行失败，返回码：1, signal: -1",
    });
    expect(c.kind).toBe("failed");
  });

  it("负控制：没有原话时按状态判，不因为「读不到原话」就把它读成终止", () => {
    expect(cancelledCause({ status: "error" }).kind).toBe("failed");
    expect(cancelledCause({ status: "cancel" }).kind).toBe("cancelled");
    expect(cancelledCause({ status: "success" }).kind).toBe("clean");
  });

  it("pipelineSn：流水线 id 收成构建号；认不出就原样回（不猜）", () => {
    expect(pipelineSn("cnb-jpf-1k5qok15v-001")).toBe("cnb-jpf-1k5qok15v");
    expect(pipelineSn("cnb-9qi-1k5qojle1-002")).toBe("cnb-9qi-1k5qojle1");
    expect(pipelineSn("某条没见过的形状")).toBe("某条没见过的形状");
  });
});

describe("enrichStageErrors：原话只在 get-build-stage 里，分类前必须先补", () => {
  /** 假执行者：`get-build-stage` 回那一格的详情，别的一概不答。 */
  function stageRun(detail: unknown, asked: string[][] = []) {
    return (_cmd: string, args: string[]) => {
      if (args[1] === "get-build-stage") {
        asked.push(args);
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

  it("非绿非 skipped 的那一格被补上原话，且不改入参（原值要留给比对）", () => {
    const run = stageRun(KILLED_AT_PREPARE_STAGE);
    const enriched = enrichStageErrors(
      run,
      "org/repo",
      "cnb-9qi-1k5qojle1",
      KILLED_AT_PREPARE,
    ) as BuildJson;
    expect(prepareStage(enriched).error).toBe(LOCK_TERMINATED_MESSAGE);
    /* 原值一个字节都没改 —— 这是「只读平台读数」那条纪律的执行面。 */
    expect(prepareStage(KILLED_AT_PREPARE)).not.toHaveProperty("error");
  });

  it("绿格与 skipped 格不去问平台（一次请求都不多花）", () => {
    const asked: string[][] = [];
    enrichStageErrors(stageRun({ data: {} }, asked), "org/repo", "b1", {
      data: {
        status: "success",
        pipelinesStatus: {
          p: {
            id: "p",
            status: "success",
            stages: [
              { status: "success", name: "Prepare", id: "prepare" },
              { status: "skipped", name: "某格", id: "stage-0" },
              { status: "success", name: "End", id: "end" },
            ],
          },
        },
      },
    });
    expect(asked).toEqual([]);
  });

  it("取不到原话 ⇒ 那一格保持原样（空 ≠ 「没有异常」，分类照状态判）", () => {
    const enriched = enrichStageErrors(
      stageRun({ data: { code: 204, message: "没有查询到该stage信息。" } }),
      "org/repo",
      "b1",
      KILLED_AT_PREPARE,
    ) as BuildJson;
    expect(prepareStage(enriched)).toEqual({
      status: "error",
      duration: 12856,
      name: "Prepare",
      id: "prepare",
    });
  });

  it("形状不对（没有 pipelinesStatus）⇒ 原样回，不抛", () => {
    expect(
      enrichStageErrors(stageRun(null), "o/r", "b", { status: 200 }),
    ).toEqual({ status: 200 });
  });
});

describe("现场那一形：prepare 期被抢锁 ⇒ 被取消，不是「去查产物」", () => {
  it("只给 get-build-status（没有原话）时不会谎报绿或真红 —— 构建级 error 仍然是 error", () => {
    /* 这一条钉的是**边界**：原话没补上时，分类只能按状态与流水线级 cancel 兜底。
     * 它不许被念成绿（那一跑一个字都没验证过）。 */
    const o = classifyBuildOutcome(KILLED_AT_PREPARE);
    expect(o.state).not.toBe("green");
  });

  it("补上原话之后 ⇒ cancelled，并点名「谁抢了锁」与「下面那几格根本没跑」", () => {
    const run = (_cmd: string, args: string[]) => ({
      status: 0,
      stdout:
        args[1] === "get-build-stage"
          ? JSON.stringify(KILLED_AT_PREPARE_STAGE)
          : "",
      stderr: "",
      error: null,
    });
    const enriched = enrichStageErrors(
      run,
      "org/repo",
      "cnb-9qi-1k5qojle1",
      KILLED_AT_PREPARE,
    ) as BuildJson;
    const o = classifyBuildOutcome(enriched);
    expect(o.state).toBe("cancelled");
    expect(o.failed).toEqual([]);
    expect(o.reasons.map((r) => r.sn)).toEqual(["cnb-jpf-1k5qok15v"]);
    const text = formatOutcome(o, {
      sn: "cnb-9qi-1k5qojle1",
      slug: "org/repo",
    }).join("\n");
    expect(text).toContain("被取消");
    expect(text).toContain("抢走锁的那一跑：cnb-jpf-1k5qok15v");
    expect(text).toContain("平台原话");
    expect(text).toContain("合并形态复核");
    expect(text).not.toContain("查那一格的日志");
  });

  it("真失败那一跑照旧 ⇒ failed，一个字都不许被挪进「被取消」", () => {
    const run = (_cmd: string, args: string[]) => ({
      status: 0,
      stdout:
        args[1] === "get-build-stage"
          ? JSON.stringify({
              data: { status: "error", error: "任务执行失败，返回码：1" },
            })
          : "",
      stderr: "",
      error: null,
    });
    const enriched = enrichStageErrors(
      run,
      "org/repo",
      "cnb-ico-1k5r2letb",
      REAL_FAILURE,
    ) as BuildJson;
    const o = classifyBuildOutcome(enriched);
    expect(o.state).toBe("failed");
    expect(o.failed.map((s) => s.name)).toEqual(["受影响用例"]);
    expect(o.reasons).toEqual([]);
  });
});

/**
 * `--stage-log` 那三件（ISSUE #2455）：按格名反查、在飞判定、「要读哪一跑」的归属。
 *
 * 它们与 `--diagnose` 共用同一份实现，所以样本钉的是「两个入口不会给出两种答案」：
 * 反查只认**逐字**（三十几格里互为子串的格名不少，挑错一格读的是另一格的日志，
 * 而它同样带行号、看起来就像证据 —— #2455 现场那条手工拼 `stageId` 的命令正是这个坑）；
 * 归属不到就 null，不拿「最新那条」顶上。
 */
describe("findStageMatches：格名反查只认逐字，认不出就停手", () => {
  const TWO_PIPELINES = {
    status: 200,
    data: {
      status: "success",
      pipelinesStatus: {
        "cnb-aaa-1k5q00001-001": {
          id: "cnb-aaa-1k5q00001-001",
          name: "质量门禁",
          status: "success",
          stages: [
            { status: "success", name: "Prepare", id: "prepare" },
            { status: "success", name: "受影响用例", id: "stage-9" },
            { status: "skipped", name: "API 文档生成与自检", id: "stage-27" },
            { status: "success", name: "生产构建", id: "stage-30" },
          ],
        },
        "cnb-aaa-1k5q00001-002": {
          id: "cnb-aaa-1k5q00001-002",
          name: "每日档",
          status: "success",
          stages: [{ status: "success", name: "受影响用例", id: "stage-9" }],
        },
      },
    },
  };
  const outcome = classifyBuildOutcome(TWO_PIPELINES);

  it("格名逐字相同 ⇒ 命中那一格，并带出它在哪条流水线", () => {
    const { hits, examined } = findStageMatches(outcome, "API 文档生成与自检");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.stage.id).toBe("stage-27");
    expect(hits[0]?.pipeline.name).toBe("质量门禁");
    // 比过几格要念得出：「这一跑没这一格」与「没取到格表」是两种下一动作。
    expect(examined).toBe(5);
  });

  it("格 id 也认，且前后空白与大小写不算差异", () => {
    expect(findStageMatches(outcome, " stage-27 ").hits).toHaveLength(1);
    expect(findStageMatches(outcome, "STAGE-27").hits[0]?.stage.name).toBe(
      "API 文档生成与自检",
    );
  });

  it("互为子串的两格 ⇒ 如实给出多格，不替你挑一个", () => {
    const { hits } = findStageMatches(outcome, "受影响用例");
    expect(hits).toHaveLength(2);
    expect(hits.map((h) => h.pipeline.name)).toEqual(["质量门禁", "每日档"]);
  });

  it("只给片段 ⇒ 零命中 + 相近候选（候选只是提示，不构成结论）", () => {
    const { hits, near } = findStageMatches(outcome, "生产");
    expect(hits).toEqual([]);
    expect(near.map((s) => s.name)).toContain("生产构建");
  });

  it("空点名 ⇒ 什么都不判（不把「没给名字」读成「这一跑没格」）", () => {
    const { hits, near, examined } = findStageMatches(outcome, "   ");
    expect(hits).toEqual([]);
    expect(near).toEqual([]);
    expect(examined).toBeGreaterThan(0);
  });

  it("stageInFlight：只有平台那两个在飞的词算「还没终态」", () => {
    expect(stageInFlight("start")).toBe(true);
    expect(stageInFlight("Running")).toBe(true);
    expect(stageInFlight("success")).toBe(false);
    expect(stageInFlight("skipped")).toBe(false);
    expect(stageInFlight(null)).toBe(false);
  });
});

describe("resolveBuildSn：点名照点名，没点名按 HEAD 逐字归属（两个入口共用）", () => {
  const SHA = "d02ec96364d5f3713b77c91b0d3fe789878f1747";
  const fake = (rows: unknown) => {
    const calls: string[] = [];
    return {
      calls,
      run: (cmd: string, args: string[]) => {
        calls.push([cmd, ...args].join(" "));
        return {
          status: 0,
          stdout: JSON.stringify({ status: 200, data: rows }),
          stderr: "",
          error: null,
        };
      },
    };
  };
  const hear = () => {
    const lines: string[] = [];
    return { lines, log: (l: string) => lines.push(l) };
  };

  it("人点了名 ⇒ 照点名，一条命令也不发", () => {
    const f = fake([]);
    const h = hear();
    expect(
      resolveBuildSn({
        run: f.run,
        log: h.log,
        slug: "a/b",
        sn: "cnb-aaa-1k5q00001",
        headSha: SHA,
      }),
    ).toBe("cnb-aaa-1k5q00001");
    expect(f.calls).toEqual([]);
  });

  it("没点名 ⇒ 按 sha 逐字命中那条，并把归属念出来", () => {
    const f = fake([
      {
        sn: "cnb-old-1k5q00000",
        sha: "0000000000000000000000000000000000000000",
        event: "pull_request",
        createTime: "2026-10-27T01:00:00Z",
      },
      {
        sn: "cnb-mine-1k5q00002",
        sha: SHA,
        event: "pull_request",
        createTime: "2026-10-27T02:00:00Z",
      },
    ]);
    const h = hear();
    expect(
      resolveBuildSn({ run: f.run, log: h.log, slug: "a/b", headSha: SHA }),
    ).toBe("cnb-mine-1k5q00002");
    expect(h.lines.join("\n")).toContain("归属到构建 cnb-mine-1k5q00002");
  });

  it("列表里只有别人的跑 ⇒ null，并念「没找到」——不拿最新那条顶上", () => {
    const f = fake([
      {
        sn: "cnb-other-1k5q00003",
        sha: "1111111111111111111111111111111111111111",
        event: "pull_request",
        createTime: "2026-10-27T09:00:00Z",
      },
    ]);
    const h = hear();
    expect(
      resolveBuildSn({ run: f.run, log: h.log, slug: "a/b", headSha: SHA }),
    ).toBeNull();
    expect(h.lines.join("\n")).toContain("没找到 pull_request 构建");
  });

  it("下一动作那行念的是**调用方那枚旗标**（--stage-log 不该被教成 --diagnose）", () => {
    const f = fake([]);
    const h = hear();
    resolveBuildSn({
      run: f.run,
      log: h.log,
      slug: "a/b",
      headSha: SHA,
      command: "pnpm ship --stage-log",
    });
    const out = h.lines.join("\n");
    expect(out).toContain("pnpm ship --stage-log <sn>");
    expect(out).not.toContain("--diagnose");
  });
});

/**
 * 「一族读数只允许有一份定义」（ISSUE #2526 切分之后的形状档）。
 *
 * 为什么要单独钉这一条：#2526 把 `formatOutcome` / `stageLogExcerpt` 搬到
 * `ci-build-print.mjs`，而 `ci-build-readout.mjs` 继续**转发**它们（消费口一字不改）。
 * 那个形状一旦被人「顺手在原处再补一份」，两份会同时存在、被不同调用点各读一份，
 * 漂移形态恰恰是**账面全绿而两个入口给出两种话术**（与 #2455 那条「同一跑不许给出两种答案」
 * 同一个方向）。而 `scripts/` 不在 `check-code-duplication.cjs` 的量程里（它扫 `src/**`），
 * 这一族没有别的执行者会响。
 */
describe("切分之后：ci-build 这一族的读数各只有一份定义", () => {
  const dir = path.resolve(process.cwd(), "scripts");
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^ci-build.*\.mjs$/.test(f))
    .map((f) => ({ name: f, src: fs.readFileSync(path.join(dir, f), "utf8") }));
  const names = [
    "classifyBuildOutcome",
    "formatOutcome",
    "progressReadout",
    "stageLogExcerpt",
    "normalizeStageContent",
    "resolveBuildSn",
  ];
  const definedIn = (name: string) =>
    files
      .filter((f) => new RegExp(`^export function ${name}\\(`, "m").test(f.src))
      .map((f) => f.name);

  it("前置：文件在、每个名字都抓得到一个定义点（正则写漂会两侧都成空集、于是恒绿）", () => {
    for (const need of [
      "ci-build-classify.mjs",
      "ci-build-print.mjs",
      "ci-build-readout.mjs",
    ]) {
      expect(files.map((f) => f.name), `少了 ${need}`).toContain(need);
    }
    for (const name of names) {
      expect(definedIn(name), `${name} 的定义点`).toHaveLength(1);
    }
  });

  it("搬走的那两个由 readout 转发出去，而定义只在 print 那一份里", () => {
    const readout = files.find((f) => f.name === "ci-build-readout.mjs");
    /* ⚠️ 锚在**行首**：`readout` 的文件头里有一句正写着「见下面那个 `export { … }`」，
     * 不锚行首的写法会从那句注释起、一路吞到真的转发块，于是清单里少转发一个名字也照样绿
     * （变异自证踩过：把 `formatOutcome` 从清单里删掉，这条当时没红）。 */
    const block =
      /^export \{([\s\S]*?)\};/m.exec(readout?.src ?? "")?.[1] ?? "(没有转发块)";
    for (const name of ["formatOutcome", "stageLogExcerpt", "progressReadout"]) {
      expect(block, `转发清单里没有 ${name}`).toContain(name);
    }
    /* 转发 ≠ 再定义：定义点各归各的一份，谁也没被复制。 */
    expect(definedIn("formatOutcome")).toEqual(["ci-build-print.mjs"]);
    expect(definedIn("stageLogExcerpt")).toEqual(["ci-build-print.mjs"]);
    expect(definedIn("classifyBuildOutcome")).toEqual(["ci-build-classify.mjs"]);
    expect(definedIn("progressReadout")).toEqual(["ci-build-classify.mjs"]);
    expect(definedIn("normalizeStageContent")).toEqual(["ci-build-readout.mjs"]);
    expect(definedIn("resolveBuildSn")).toEqual(["ci-build-readout.mjs"]);
  });
});
