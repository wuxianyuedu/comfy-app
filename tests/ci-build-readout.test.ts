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
  downstreamSkipped,
  formatOutcome,
  main,
  parseArgs,
} from "../scripts/ci-build-readout.mjs";

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
