/**
 * `pnpm ship`（`scripts/ship*.mjs` 这一族）的**取数**判据。
 *
 * ## 为什么这份文件只测「取数」，不测「流程走没走完」
 *
 * `ship` 是编排层，它唯一的新逻辑就是**从外部执行者那里把结论读对**。流程本身
 * 全是既有判据（`pre-commit` / `pre-push` / 平台 build / `is_merged`），那些各有
 * 自己的执行者，不该在这里重测一遍（AGENTS 硬规则 24：不在调用点重抄）。
 *
 * 而「读错一个字段」在这一族里是**最贵的失效**，因为它不报错、只是把结论换掉：
 *
 *   · 把 HTTP 信封的 `status: 200` 读成流水线终态 ⇒ 一条从没跑起来的 build 被报成成功；
 *   · 并行会话的 build 列表里挑了不相干的那条 ⇒ 拿别人的绿灯合自己的 PR；
 *   · 「列表没拿到」与「拿到了但没有我的」并成一格 ⇒ 「没测到」被读成「测过了」。
 *
 * 前两条是**实测踩到的**（ISSUE #2027 那趟流程里：非 JSON 输出里 `status:` 出现两次，
 * `grep '^status:'` 恒取到 200，于是白轮询 28 次；同一时刻另有两条 `pull_request` 在跑）。
 * 所以本文件里的每一条都喂**那份真实形状**的样本，而不是喂一个理想化的最小对象。
 *
 * ## 反向样本（缺了就会静默全绿的那几种）
 *
 * `readBuildVerdict` 那组里刻意各有一条「只有信封字段」与「data 是别的形状」的负控制 ——
 * 判据若被写成 `json.status ?? json.data.status`，正样本照样绿，只有负样本会红。
 */
import fs, { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  asArray,
  buildPullBody,
  buildSignature,
  CODE,
  combineShipCodes,
  decideCleanBranch,
  decideCloseIssue,
  decideCreateBranch,
  deriveTitle,
  findPullForBranch,
  issueNumbersFromText,
  looksNewlineMangled,
  parseArgs,
  parseSlug,
  pickBuildForSha,
  planCommands,
  readBuildVerdict,
  readPullVerdict,
  resolveUpstream,
} from "../scripts/ship-core.mjs";
import {
  issueAuthoring,
  readDevHandle,
  ticketReading,
} from "../scripts/ship-ticket.mjs";
import {
  cleanBranch,
  closeIssues,
  pollUntilTerminal,
  reportVerdict,
} from "../scripts/ship-platform.mjs";
import {
  decideReap,
  instanceReading,
  reapCheckoutInstances,
} from "../scripts/ship-reap.mjs";
import { main } from "../scripts/ship.mjs";

/** 真机取到的一份 `cnb build get-build-status -v` 的形状（信封 + data 各有一个 status）。 */
const BUILD_ENVELOPE_AND_DATA = {
  status: 200,
  trace: "00-abc-01",
  contentType: "application/json; charset=utf-8",
  data: {
    status: "success",
    pipelinesStatus: { "x-001": { status: "success" } },
  },
};

describe("readBuildVerdict：只认 data.status，信封那个 status 与判决无关", () => {
  it("两个 status 并存时取的是 data 那一个", () => {
    expect(readBuildVerdict(BUILD_ENVELOPE_AND_DATA)).toEqual({
      state: "green",
      raw: "success",
    });
  });

  it("负控制：只有信封 status（data 缺席）⇒ unknown，**不是** green", () => {
    // 写成 `json.status ?? json.data.status` 的实现会让这条正样本「看起来对」，
    // 而它读的其实是 HTTP 状态码 —— 200 永远不等于流水线绿。
    expect(readBuildVerdict({ status: 200 }).state).toBe("unknown");
    expect(readBuildVerdict(null).state).toBe("unknown");
    expect(readBuildVerdict({ data: {} }).state).toBe("unknown");
    expect(
      readBuildVerdict({ data: { status: /** @type {any} */ 200 } }).state,
    ).toBe("unknown");
  });

  it("data.status 的三档：success / 终态失败 / 在跑", () => {
    expect(readBuildVerdict({ data: { status: "success" } }).state).toBe(
      "green",
    );
    for (const s of ["failed", "error", "cancelled", "canceled"]) {
      expect(readBuildVerdict({ data: { status: s } }).state).toBe("red");
    }
    for (const s of ["running", "pending", "queued", "waiting", "created"]) {
      expect(readBuildVerdict({ data: { status: s } }).state).toBe("running");
    }
    // 认不出的值不猜方向：unknown ⇒ 调用方退 2，而不是退 0 或退 1。
    expect(readBuildVerdict({ data: { status: "whatever" } }).state).toBe(
      "unknown",
    );
  });

  it("大小写不敏感（平台在 success / SUCCESS 之间换过写法）", () => {
    expect(readBuildVerdict({ data: { status: "SUCCESS" } }).state).toBe(
      "green",
    );
  });
});

describe("pickBuildForSha：并行会话下只认 sha 命中那条", () => {
  const MINE = "d02ec96364d5f3713b77c91b0d3fe789878f1747";
  const OTHER = "3d6aceb456db9aff10a5eee692db3a241afff818";

  it("同 event 两条并存时，选中的是 sha 命中的那条", () => {
    const builds = [
      {
        sn: "cnb-t9s-other",
        event: "pull_request",
        sha: OTHER,
        createTime: "2026-10-19T09:20:00Z",
      },
      {
        sn: "cnb-7f0-mine",
        event: "pull_request",
        sha: MINE,
        createTime: "2026-10-19T09:12:32Z",
      },
    ];
    expect(pickBuildForSha(builds, MINE)).toEqual({
      sn: "cnb-7f0-mine",
      createTime: "2026-10-19T09:12:32Z",
    });
  });

  it("负控制：sha 不在列表里 ⇒ null，**不许**退化成「拿最新那条」", () => {
    // 退化成「最新」就是把别人的 build 读成自己的 —— 那正是这一族最贵的误读。
    const builds = [
      { sn: "cnb-x", event: "pull_request", sha: OTHER, createTime: "z" },
    ];
    expect(pickBuildForSha(builds, MINE)).toBeNull();
  });

  it("event 不是 pull_request 的不算（同一 sha 可能是 push / 每日档）", () => {
    const builds = [
      { sn: "cnb-daily", event: "push", sha: MINE, createTime: "z" },
    ];
    expect(pickBuildForSha(builds, MINE)).toBeNull();
  });

  it("同 sha 多条时取 createTime 最新的那条", () => {
    const builds = [
      {
        sn: "old",
        event: "pull_request",
        sha: MINE,
        createTime: "2026-10-19T09:00:00Z",
      },
      {
        sn: "new",
        event: "pull_request",
        sha: MINE,
        createTime: "2026-10-19T10:00:00Z",
      },
    ];
    expect(pickBuildForSha(builds, MINE)?.sn).toBe("new");
  });

  it("sha 比对不区分大小写，且入参畸形时不抛", () => {
    expect(
      pickBuildForSha(
        [
          {
            sn: "a",
            event: "pull_request",
            sha: MINE.toUpperCase(),
            createTime: "z",
          },
        ],
        MINE,
      )?.sn,
    ).toBe("a");
    expect(pickBuildForSha([], MINE)).toBeNull();
    expect(pickBuildForSha(/** @type {any} */ null, MINE)).toBeNull();
    expect(pickBuildForSha([{ sn: "a" }], "")).toBeNull();
  });
});

describe("asArray：「没拿到列表」与「拿到了但是空的」是两件事", () => {
  it("两种 data 形状都收", () => {
    expect(asArray({ data: [{ sn: "a" }] })).toHaveLength(1);
    expect(asArray({ data: { data: [{ sn: "a" }] } })).toHaveLength(1);
  });

  it("取不到回 null（⇒ 调用方退 2），不回空数组（⇒ 会被读成「查过了，没有」）", () => {
    expect(asArray({})).toBeNull();
    expect(asArray(null)).toBeNull();
    expect(asArray({ data: null })).toBeNull();
  });
});

describe("combineShipCodes：2 压过 1", () => {
  it("「有一步没跑起来」不被「另有几步红了」盖掉", () => {
    expect(combineShipCodes([CODE.GREEN, CODE.RED, CODE.NOT_RUN])).toBe(
      CODE.NOT_RUN,
    );
    expect(combineShipCodes([CODE.GREEN, CODE.RED])).toBe(CODE.RED);
    expect(combineShipCodes([CODE.GREEN])).toBe(CODE.GREEN);
    expect(combineShipCodes([])).toBe(CODE.GREEN);
  });

  it("三态的字面值钉住（0 绿 / 1 红 / 2 没跑起来），与 premerge-check 同口径", () => {
    expect([CODE.GREEN, CODE.RED, CODE.NOT_RUN]).toEqual([0, 1, 2]);
  });
});

describe("parseArgs：拼错的旗标不许被静默忽略", () => {
  it("未知旗标进 unknown（调用方据此停，而不是当成「没要那个动作」）", () => {
    const a = parseArgs(["--merg"]);
    expect(a.merge).toBe(false);
    expect(a.unknown).toEqual(["--merg"]);
  });

  it("合并默认关；--message / --add 两种写法都收", () => {
    expect(parseArgs([]).merge).toBe(false);
    expect(parseArgs(["--merge"]).merge).toBe(true);
    expect(parseArgs(["--message=x"]).message).toBe("x");
    expect(parseArgs(["-m", "x"]).message).toBe("x");
    expect(parseArgs(["--add", "a.ts", "--add=b.md"]).adds).toEqual([
      "a.ts",
      "b.md",
    ]);
    /* `--title` 两种写法同样要收 —— 它是标题那格的显式出口，
     * 而 `--add` 那一族曾因为一次替换整块丢掉过一条分支。 */
    expect(parseArgs(["--title", "feat(a): 人给的标题"]).title).toBe(
      "feat(a): 人给的标题",
    );
    expect(parseArgs(["--title=feat(b): 等号写法"]).title).toBe(
      "feat(b): 等号写法",
    );
    expect(parseArgs([]).title).toBeNull();
  });

  it("--no-wait 与 --only 各自独立", () => {
    expect(parseArgs(["--no-wait"]).wait).toBe(false);
    expect(parseArgs(["--only=poll"]).only).toBe("poll");
  });

  it("--close-issue 默认关，且不牵连 --merge（两个是各自独立的显式动作）", () => {
    expect(parseArgs([]).closeIssue).toBe(false);
    expect(parseArgs(["--merge"]).closeIssue).toBe(false);
    expect(parseArgs(["--close-issue"]).closeIssue).toBe(true);
    expect(parseArgs(["--close-issue"]).merge).toBe(false);
    /* 拼错的写法进 unknown —— 「以为会关、其实没关」与合并那一格是同一族误读。 */
    const typo = parseArgs(["--close-issues"]);
    expect(typo.closeIssue).toBe(false);
    expect(typo.unknown).toEqual(["--close-issues"]);
  });

  it("--branch 两种写法都收；--clean-branch 默认关（清 ref 不是随口就该做的动作）", () => {
    expect(parseArgs([]).branch).toBeNull();
    expect(parseArgs([]).cleanBranch).toBe(false);
    expect(parseArgs(["--branch", "feat/x"]).branch).toBe("feat/x");
    expect(parseArgs(["--branch=fix/2143-y"]).branch).toBe("fix/2143-y");
    expect(parseArgs(["--clean-branch"]).cleanBranch).toBe(true);
    /* 同一个理由：拼错的 `--clean-branch` 被静默忽略，就是「以为会清、其实没清」，
     * 屏幕上还留着合并那两行的绿。 */
    expect(parseArgs(["--clen-branch"]).unknown).toEqual(["--clen-branch"]);
    expect(parseArgs(["--branc"]).unknown).toEqual(["--branc"]);
  });

  it("--reap 默认关：不给旗标就一次都不该伸手", () => {
    expect(parseArgs([]).reap).toBe(false);
    expect(parseArgs(["--merge", "--clean-branch"]).reap).toBe(false);
    expect(parseArgs(["--reap"]).reap).toBe(true);
    expect(parseArgs(["--reep"]).unknown).toEqual(["--reep"]);
  });
});

describe("issueNumbersFromText：只从标题本体取，绝不从拼完 PR 号的那一整行取", () => {
  it("(#2070) 与 #2070 两种写法都认，按出现顺序去重", () => {
    expect(issueNumbersFromText("fix(a): 修一格 (#2070)")).toEqual([2070]);
    expect(issueNumbersFromText("fix(a): 修一格 #2070 与 #2096")).toEqual([
      2070, 2096,
    ]);
    expect(issueNumbersFromText("修 (#2070) 再修 (#2070)")).toEqual([2070]);
    expect(issueNumbersFromText("没有号的一行")).toEqual([]);
    expect(issueNumbersFromText("")).toEqual([]);
  });

  it("负控制：那一整行末尾的 (#2110) 是 **PR 号**，喂整行就会去关一张别人的单子", () => {
    /* 本仓 PR 号与 issue 号共用一套编号空间：`#2110` 既可能是这条 PR，也可能是
     * 某个人的 issue。`mergeAndVerify` 发给平台的是 `${title} (#${number})`，
     * 所以「号」必须来自 `title` 本体 —— 这一条钉的就是那条边界。 */
    const title = "fix(a): 修一格 (#2070)";
    const squashLine = `${title} (#2110)`;
    expect(issueNumbersFromText(title)).toEqual([2070]);
    expect(issueNumbersFromText(squashLine)).toEqual([2070, 2110]);
  });
});

describe("decideCloseIssue：要求了但没合并 ⇒ 不是「跳过」，是 2", () => {
  it("没要求 ⇒ 不动、也不落任何码", () => {
    const d = decideCloseIssue({
      requested: false,
      landedVerified: true,
      title: "fix(a): 一格 (#2070)",
    });
    expect(d.act).toBe(false);
    expect(d.code).toBeNull();
  });

  it("要求了、这一跳没有验真的合并 ⇒ NOT_RUN 并说明（单子不能被标成完成）", () => {
    const d = decideCloseIssue({
      requested: true,
      landedVerified: false,
      title: "fix(a): 一格 (#2070)",
    });
    expect(d.act).toBe(false);
    expect(d.code).toBe(CODE.NOT_RUN);
    expect(d.reason).toContain("没有");
  });

  it("要求了、也合上了，但标题里没有号 ⇒ 也按 NOT_RUN，并说出喂进去的是哪一行", () => {
    const d = decideCloseIssue({
      requested: true,
      landedVerified: true,
      title: "docs(x): 这行没写号",
    });
    expect(d.act).toBe(false);
    expect(d.code).toBe(CODE.NOT_RUN);
    expect(d.reason).toContain("docs(x): 这行没写号");
  });

  it("合上了且标题里有号 ⇒ 动手，号就是那一个", () => {
    const d = decideCloseIssue({
      requested: true,
      landedVerified: true,
      title: "fix(a): 一格 (#2070)",
    });
    expect(d.act).toBe(true);
    expect(d.numbers).toEqual([2070]);
    expect(d.code).toBeNull();
  });
});

describe("decideCreateBranch：名字只能人给，脚本只补动 ref 那一半", () => {
  it("没给 --branch ⇒ 这一格不存在（不落码、不动 ref）", () => {
    const d = decideCreateBranch({ current: "master" });
    expect(d.requested).toBe(false);
    expect(d.act).toBe(false);
    expect(d.code).toBeNull();
  });

  it("在 master 上给了名字 ⇒ 建", () => {
    expect(
      decideCreateBranch({ requested: "feat/x", current: "master" }),
    ).toEqual({
      requested: true,
      act: true,
      code: null,
      branch: "feat/x",
      reason: "",
    });
  });

  it("游离 HEAD 也算「没有可用分支」（硬规则 6 那一格过去就是这么判的）", () => {
    expect(
      decideCreateBranch({ requested: "feat/x", current: "HEAD" }).act,
    ).toBe(true);
  });

  it("负控制①：已经在同名分支上 ⇒ 幂等，不落红也不重复建", () => {
    const d = decideCreateBranch({ requested: "feat/x", current: "feat/x" });
    expect(d.act).toBe(false);
    expect(d.code).toBe(CODE.GREEN);
  });

  it("负控制②：名字撞了已存在的 ref ⇒ 停（不覆盖、不切换）—— 删掉别人的分支不是「建分支」", () => {
    for (const exists of [{ existsLocal: true }, { existsRemote: true }]) {
      const d = decideCreateBranch({
        requested: "feat/x",
        current: "master",
        ...exists,
      });
      expect(d.act).toBe(false);
      expect(d.code).toBe(CODE.NOT_RUN);
      expect(d.reason).toContain("已经存在");
    }
  });

  it("负控制③：当前在另一条分支上而 --branch 指别名 ⇒ 停，不在分支之间搬工作树", () => {
    const d = decideCreateBranch({ requested: "feat/y", current: "feat/x" });
    expect(d.act).toBe(false);
    expect(d.code).toBe(CODE.NOT_RUN);
    expect(d.reason).toContain("不在分支之间搬");
  });

  it("负控制④：名字是 master / HEAD ⇒ 红（不许把「建分支」做成「切回主干」）", () => {
    for (const name of ["master", "HEAD"]) {
      const d = decideCreateBranch({ requested: name, current: "master" });
      expect(d.act, `名字 ${name} 不该被拿去建分支`).toBe(false);
      expect(d.code).toBe(CODE.RED);
    }
  });
});

describe("decideCleanBranch：只跟在验真的合并之后，且只删这一次那一条", () => {
  it("没给 --clean-branch ⇒ 这一格根本不存在", () => {
    const d = decideCleanBranch({
      requested: false,
      landedVerified: true,
      branch: "feat/x",
    });
    expect(d.act).toBe(false);
    expect(d.code).toBeNull();
  });

  it("要求了但这一跳没有验真的合并 ⇒ 2 并说明（本地那条是这些提交唯一的对象）", () => {
    const d = decideCleanBranch({
      requested: true,
      landedVerified: false,
      branch: "feat/x",
    });
    expect(d.act).toBe(false);
    expect(d.code).toBe(CODE.NOT_RUN);
    expect(d.reason).toContain("唯一的对象");
  });

  it("负控制：分支名为空 / 是 master ⇒ 不删（不猜名字，更不删主干）", () => {
    for (const branch of ["", "master", "HEAD"]) {
      const d = decideCleanBranch({
        requested: true,
        landedVerified: true,
        branch,
      });
      expect(d.act, `分支名「${branch}」不该走到删除`).toBe(false);
      expect(d.code).toBe(CODE.NOT_RUN);
    }
  });

  it("验真过 + 正常分支名 ⇒ 才允许动 ref", () => {
    expect(
      decideCleanBranch({
        requested: true,
        landedVerified: true,
        branch: "feat/x",
      }),
    ).toEqual({ act: true, code: null, branch: "feat/x", reason: "" });
  });
});

describe("closeIssues：回执不算结论，独立回读三件原值才算", () => {
  /* 与 `ship-exec.mjs` 的 `ExecResult` 同形（`error` 是**必需**的：把它写成可选，
   * 注入时就过不了类型 —— 而那正是这层接缝唯一的形状约束）。 */
  type FakeResult = {
    status: number;
    stdout: string;
    stderr: string;
    error: string | null;
  };

  /** 按 cnb 的子命令答；`calls` 记录每一次伸手。 */
  function io(opts: {
    update?: string | null;
    state?: string;
    stateReason?: string | null;
    closedAt?: string | null;
  }) {
    const calls: string[] = [];
    const log: string[] = [];
    const json = (data: unknown) =>
      JSON.stringify({ status: 200, contentType: "application/json", data });
    const run = (_cmd: string, args: string[]): FakeResult => {
      calls.push(args.join(" "));
      if (args[0] === "issues" && args[1] === "update-issue") {
        if (opts.update === null)
          return { status: 0, stdout: "boom", stderr: "", error: null };
        return {
          status: 0,
          stdout: opts.update ?? json({ number: 2070, state: "closed" }),
          stderr: "",
          error: null,
        };
      }
      if (args[0] === "issues" && args[1] === "get-issue") {
        return {
          status: 0,
          stdout: json({
            number: 2070,
            state: opts.state ?? "closed",
            state_reason: opts.stateReason ?? "completed",
            closed_at: opts.closedAt ?? "2026-10-21T08:54:30Z",
          }),
          stderr: "",
          error: null,
        };
      }
      return { status: 0, stdout: "", stderr: "", error: null };
    };
    return { run, calls, log };
  }

  const landedOk = {
    title: "fix(a): 一格 (#2070)",
    sha: "abc1234",
    verified: true,
  };

  it("合上了 ⇒ 关它、再回读，并把三件原值打出来", () => {
    const f = io({});
    const code = closeIssues({
      run: f.run,
      log: (l) => f.log.push(l),
      slug: "org/repo",
      closeIssue: true,
      landed: landedOk,
    });
    expect(code).toBe(CODE.GREEN);
    expect(f.calls[0]).toContain("--state closed --state-reason completed");
    // 回读是一次**独立的** get-issue，不是复用 update 的返回。
    expect(f.calls.some((c) => c.includes("get-issue"))).toBe(true);
    expect(f.log.join("\n")).toContain("state=closed");
    expect(f.log.join("\n")).toContain("closed_at=2026-10-21T08:54:30Z");
  });

  it("回读说还开着 ⇒ 红（1），不跟着回执念成绿", () => {
    const f = io({ state: "open", stateReason: null, closedAt: null });
    const code = closeIssues({
      run: f.run,
      log: (l) => f.log.push(l),
      slug: "org/repo",
      closeIssue: true,
      landed: landedOk,
    });
    expect(code).toBe(CODE.RED);
    expect(f.log.join("\n")).toContain("state=open");
  });

  it("关闭调用没拿到 JSON ⇒ 2，且**不发**那次回读（没执行者就不去猜）", () => {
    const f = io({ update: null });
    const code = closeIssues({
      run: f.run,
      log: (l) => f.log.push(l),
      slug: "org/repo",
      closeIssue: true,
      landed: landedOk,
    });
    expect(code).toBe(CODE.NOT_RUN);
    expect(f.calls.filter((c) => c.includes("get-issue"))).toEqual([]);
  });

  it("最要紧的那条安全边界：这一跳没合并成 ⇒ cnb **一次都不碰**", () => {
    /* 误把 `--close-issue` 带在轮询那一跳（或合并被拒的那一次）上时，
     * 世界不能被改动 —— 关掉一张没落地的单子，正是这一族最贵的误读。 */
    const f = io({});
    const code = closeIssues({
      run: f.run,
      log: (l) => f.log.push(l),
      slug: "org/repo",
      closeIssue: true,
      landed: { title: "fix(a): 一格 (#2070)", sha: "", verified: false },
    });
    expect(code).toBe(CODE.NOT_RUN);
    expect(f.calls).toEqual([]);
    expect(f.log.join("\n")).toContain("没有执行");
  });

  it("已经关着的单子再跑一次：幂等，回读带的是第一次那个时刻", () => {
    const f = io({ closedAt: "2026-10-21T07:02:02Z" });
    const code = closeIssues({
      run: f.run,
      log: (l) => f.log.push(l),
      slug: "org/repo",
      closeIssue: true,
      landed: landedOk,
    });
    expect(code).toBe(CODE.GREEN);
    expect(f.log.join("\n")).toContain("closed_at=2026-10-21T07:02:02Z");
  });

  it("没给 --close-issue ⇒ 这一格根本不存在（不落任何码、也不打字）", () => {
    const f = io({});
    const code = closeIssues({
      run: f.run,
      log: (l) => f.log.push(l),
      slug: "org/repo",
      closeIssue: false,
      landed: landedOk,
    });
    expect(code).toBe(CODE.GREEN);
    expect(f.calls).toEqual([]);
    expect(f.log).toEqual([]);
  });
});

/**
 * 只装碎片的临时根 —— `ticketReading` 判的是「文件名里的号 + 首行段落」，
 * 两份都得上盘。落点用 `os.tmpdir()` 的真实 Windows 路径，不写 `/tmp`：那串在
 * MSYS 下能解析、到了 Windows 侧进程里是另一个地方，读不到文件会被当成「没有段落」。
 */
function fragRoot(files: Record<string, string>) {
  const root = mkdtempSync(path.join(os.tmpdir(), "ship-ticket-"));
  const dir = path.join(root, "changelog.d");
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), text);
  }
  return root;
}

describe("cleanBranch：删的是 ref，判的还是回读 —— 两边各问一次事实", () => {
  type FakeResult = {
    status: number;
    stdout: string;
    stderr: string;
    error: string | null;
  };

  /**
   * git 的替身。形状按真实输出给：`ls-remote` 命中是一行 `<sha>\trefs/heads/<名>`、
   * 没命中是**空串退 0**（这正是这一格的判点：空与失败不是一件事）。
   */
  function gitIo(
    opts: {
      remoteStillThere?: boolean;
      lsRemoteFails?: boolean;
      localStillThere?: boolean;
      pushStatus?: number;
      branchStatus?: number;
    } = {},
  ) {
    const calls: string[] = [];
    const log: string[] = [];
    const ok = (stdout = "", status = 0): FakeResult => ({
      status,
      stdout,
      stderr: "",
      error: null,
    });
    const run = (_cmd: string, args: string[]): FakeResult => {
      calls.push(args.join(" "));
      const key = args.join(" ");
      if (key.startsWith("rev-parse --short")) return ok("dead123");
      if (key.startsWith("push cnb --delete"))
        return ok("", opts.pushStatus ?? 0);
      if (key.startsWith("ls-remote --heads")) {
        if (opts.lsRemoteFails) return ok("", 128);
        return ok(opts.remoteStillThere ? "abc123\trefs/heads/feat/x" : "", 0);
      }
      if (key.startsWith("branch -D")) return ok("", opts.branchStatus ?? 0);
      if (key.startsWith("show-ref --verify"))
        return ok("", opts.localStillThere ? 0 : 1);
      return ok("");
    };
    return { run, calls, log };
  }

  const base = { remote: "cnb", branch: "feat/x", landedVerified: true };

  it("两边都回读到「没有了」才算清理完成，并把恢复线那行 sha 打出来", () => {
    const f = gitIo();
    const code = cleanBranch({
      run: f.run,
      log: (l) => f.log.push(l),
      ...base,
      cleanBranch: true,
    });
    expect(code).toBe(CODE.GREEN);
    expect(f.log.join("\n")).toContain("git branch feat/x dead123");
    expect(f.calls).toEqual([
      "rev-parse --short feat/x",
      "push cnb --delete feat/x",
      "ls-remote --heads cnb feat/x",
      "branch -D feat/x",
      "show-ref --verify --quiet refs/heads/feat/x",
    ]);
  });

  it("负控制①：push 退 0 但远端回读仍然有 ⇒ 红（回执不算结论）", () => {
    const f = gitIo({ remoteStillThere: true });
    expect(
      cleanBranch({
        run: f.run,
        log: (l) => f.log.push(l),
        ...base,
        cleanBranch: true,
      }),
    ).toBe(CODE.RED);
  });

  it("负控制②：远端回读**没跑起来** ⇒ 2，不判「已删」也不判「还在」", () => {
    const f = gitIo({ lsRemoteFails: true });
    expect(
      cleanBranch({
        run: f.run,
        log: (l) => f.log.push(l),
        ...base,
        cleanBranch: true,
      }),
    ).toBe(CODE.NOT_RUN);
  });

  it("负控制③：本地 show-ref 仍查得到 ⇒ 红，不记「已清理」", () => {
    const f = gitIo({ localStillThere: true });
    expect(
      cleanBranch({
        run: f.run,
        log: (l) => f.log.push(l),
        ...base,
        cleanBranch: true,
      }),
    ).toBe(CODE.RED);
  });

  it("没有验真的合并 ⇒ 一次伸手都不伸（`-D` 那一步是删唯一的对象）", () => {
    const f = gitIo();
    const code = cleanBranch({
      run: f.run,
      log: (l) => f.log.push(l),
      remote: "cnb",
      branch: "feat/x",
      landedVerified: false,
      cleanBranch: true,
    });
    expect(code).toBe(CODE.NOT_RUN);
    expect(f.calls).toEqual([]);
  });

  it("没要求 ⇒ 这一格根本不存在（不落码、不打字、不伸手）", () => {
    const f = gitIo();
    const code = cleanBranch({
      run: f.run,
      log: (l) => f.log.push(l),
      ...base,
      cleanBranch: false,
    });
    expect(code).toBe(CODE.GREEN);
    expect(f.calls).toEqual([]);
    expect(f.log).toEqual([]);
  });

  it("远端名取不到 ⇒ 2，且不去删本地那一半冒充「清理完成」", () => {
    const f = gitIo();
    const code = cleanBranch({
      run: f.run,
      log: (l) => f.log.push(l),
      remote: null,
      branch: "feat/x",
      landedVerified: true,
      cleanBranch: true,
    });
    expect(code).toBe(CODE.NOT_RUN);
    expect(f.calls.filter((c) => c.startsWith("branch -D"))).toEqual([]);
  });
});

describe("ticketReading：这次变更挂在哪张单子上（读数，不是闸）", () => {
  it("带号的碎片被列出来（`<号>-` 与 `#<号>-` 两种形态都认，与形态门禁同一条正则）", () => {
    const root = fragRoot({
      "2127-a.md": "## Fixed\n\n- 条目\n",
      "#408-b.md": "## Changed\n\n- 条目\n",
    });
    try {
      const r = ticketReading({
        root,
        fragments: ["changelog.d/2127-a.md", "changelog.d/#408-b.md"],
      });
      expect(r.numbers).toEqual([2127, 408]);
      expect(r.anonymous).toEqual([]);
      expect(r.lines[0]).toContain("#2127 #408");
      expect(r.lines.join("\n")).not.toContain("先立案");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("`## Fixed` 而号是 0 ⇒ 点名「先立案」，并给建单出口（本脚本不替人按下去）", () => {
    const root = fragRoot({ "0-a14-kernel.md": "## Fixed\n\n- 条目\n" });
    try {
      const r = ticketReading({
        root,
        fragments: ["changelog.d/0-a14-kernel.md"],
      });
      expect(r.anonymousFixed).toEqual(["0-a14-kernel.md"]);
      const all = r.lines.join("\n");
      expect(all).toContain("0-a14-kernel.md");
      expect(all).toContain("先立案");
      // 命令只有一份实现（在 `issueAuthoring` 那两行里）⇒ 这一格只指路，不抄第二份。
      expect(all).toContain("建单的出口在下面那两行");
      expect(all).not.toContain("cnb issues create-issue");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("负控制①：段落不是 Fixed 的无号碎片**不报违规** —— §13.10.8 第 2 条那条 `0-` 出口照旧可用", () => {
    const root = fragRoot({ "0-ship-driver.md": "## Added\n\n- 条目\n" });
    try {
      const r = ticketReading({
        root,
        fragments: ["changelog.d/0-ship-driver.md"],
      });
      expect(r.anonymous).toEqual(["0-ship-driver.md"]);
      expect(r.anonymousFixed).toEqual([]);
      expect(r.lines.join("\n")).not.toContain("先立案");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("负控制②：首行读不到 ⇒ 不判段落，**不凭空指控**人没立案", () => {
    const root = fragRoot({});
    try {
      const r = ticketReading({
        root,
        fragments: ["changelog.d/0-not-on-disk.md"],
      });
      expect(r.anonymous).toEqual(["0-not-on-disk.md"]);
      expect(r.anonymousFixed).toEqual([]);
      expect(r.lines.join("\n")).not.toContain("先立案");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("号去重按出现顺序、非 `<号>-` 形态的文件不参与（README.md 没有号这一格可判）", () => {
    const root = fragRoot({
      "2070-a.md": "## Fixed\n\n- 条目\n",
      "2070-b.md": "## Added\n\n- 条目\n",
      "0-c.md": "## Fixed\n\n- 条目\n",
      "0-d.md": "## Added\n\n- 条目\n",
      "README.md": "# changelog.d —— CHANGELOG 碎片目录\n",
    });
    try {
      const r = ticketReading({
        root,
        fragments: [
          "changelog.d/2070-a.md",
          "changelog.d/2070-b.md",
          "changelog.d/0-c.md",
          "changelog.d/0-d.md",
          "changelog.d/README.md",
        ],
      });
      expect(r.numbers).toEqual([2070]);
      expect(r.anonymous).toEqual(["0-c.md", "0-d.md"]);
      expect(r.anonymousFixed).toEqual(["0-c.md"]);
      // 两份无号里只有一份是 Fixed：另一份要在话术上被明确排除，不然读者会以为全部碎片都违规。
      expect(r.lines.join("\n")).toContain("另 1 份无号碎片的段落不是");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("issueAuthoring：单子的两格身份（提单人 / 优先级）—— 是读数，不参与判决", () => {
  it("配了留痕 ⇒ 念出 dev:<短名>，优先级指回平台原生 --priority（本脚本不代填）", () => {
    const all = issueAuthoring({
      handle: "yuedu-win",
      platform: "linux",
      showExits: true,
    }).lines.join("\n");
    expect(all).toContain("提单人=dev:yuedu-win");
    expect(all).toContain("读数，不改退码");
    // 实测 `create-issue --labels` 不落地（回读是空）⇒ 出口必须是两条，而不是一条说了不算。
    expect(all).toContain("cnb issues create-issue");
    expect(all).toContain("--priority <P0|P1|P2|P3>");
    expect(all).toContain("cnb issues post-issue-labels");
    expect(all).toContain("--labels dev:yuedu-win");
  });

  it("Windows 且没配 ⇒ 点名要配，并给 `.env` 里那个键名与占位标签", () => {
    const r = issueAuthoring({
      handle: null,
      platform: "win32",
      showExits: true,
    });
    expect(r.required).toBe(true);
    const all = r.lines.join("\n");
    expect(all).toContain("Windows 开发者");
    expect(all).toContain("COMFYAPP_DEV_HANDLE");
    expect(all).toContain("--labels dev:<短名>");
  });

  it("负控制：非 Windows 没配 ⇒ 同一句事实，但**不点名要求**（本轮口径只管 Windows）", () => {
    const r = issueAuthoring({ handle: null, platform: "linux" });
    expect(r.required).toBe(false);
    const all = r.lines.join("\n");
    expect(all).toContain("只对 Windows 开发者要求");
    expect(all).not.toContain("Windows 开发者按规范在");
  });

  it("两格都在场、又不缺单 ⇒ 只念身份那一行（出口每次都刷屏就没人看了）", () => {
    const r = issueAuthoring({
      handle: "yuedu-win",
      platform: "win32",
      showExits: false,
    });
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toContain("提单人=dev:yuedu-win");
  });

  it("出口只教「怎么按对」，不出现任何跳过形态", () => {
    const all = issueAuthoring({
      handle: null,
      platform: "win32",
      showExits: true,
    }).lines.join("\n");
    expect(all).not.toContain("--no-verify");
    expect(all).not.toContain("--allow");
  });
});

describe("readDevHandle：进程环境优先，回落本检出 .env，读不到就是「没配」", () => {
  /** 造一份只有 `.env` 的临时检出根。 */
  function envRoot(text: string) {
    const root = mkdtempSync(path.join(os.tmpdir(), "ship-handle-"));
    fs.writeFileSync(path.join(root, ".env"), text);
    return root;
  }

  it("进程环境里给了就用它（首尾空白吃掉）", () => {
    const root = envRoot('COMFYAPP_DEV_HANDLE="from-file"');
    try {
      expect(
        readDevHandle({
          root,
          env: { COMFYAPP_DEV_HANDLE: "  from-env  " },
        }),
      ).toBe("from-env");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("回落到 `.env`：与 `COMFYAPP_PORT` 同一份最小解析（引号、行尾注释都算对）", () => {
    const root = envRoot('COMFYAPP_DEV_HANDLE="yuedu-win" # 提单留痕\n');
    try {
      expect(readDevHandle({ root, env: {} })).toBe("yuedu-win");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("负控制：`.env.example` 那种**注释掉**的形态不算配了 ⇒ 回 null，不念成一个空短名", () => {
    const root = envRoot('# COMFYAPP_DEV_HANDLE="yuedu-win"\n');
    try {
      expect(readDevHandle({ root, env: {} })).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("没有 `.env`（CI / 干净检出）⇒ null，而不是抛错也不是「读不出来」", () => {
    expect(
      readDevHandle({
        root: path.join(os.tmpdir(), "comfy-no-such-checkout"),
        env: {},
      }),
    ).toBeNull();
  });
});

describe("reapCheckoutInstances：只收 via port 那批，session 那一档不归它收", () => {
  type Live = { running?: boolean; pids?: number[]; via?: string | null };

  /** 「判据 + 执行者」的替身：`before` 是收尾那一格第一次读到的形状。 */
  function io(
    before: Live | null | Error,
    after: Live | null | Error,
    reapStatus = 0,
  ) {
    const calls: string[] = [];
    const log: string[] = [];
    let n = 0;
    const read = async (_root: string): Promise<Live> => {
      const one = n++ === 0 ? before : after;
      if (one instanceof Error) throw one;
      if (one === null) throw new Error("判据返回了空形状");
      return one;
    };
    const run = (_cmd: string, args: string[]) => {
      calls.push(args.join(" "));
      return {
        status: reapStatus,
        stdout: `via taskkill /PID ${args[1]} /T /F`,
        stderr: "",
        error: null,
      };
    };
    return { read, run, calls, log };
  }

  const portLive = { running: true, pids: [4242], via: "port" };
  const sessionLive = { running: true, pids: [777, 778], via: "session" };
  const noneLive = { running: false, pids: [], via: null };

  it("判据答「无」⇒ 绿、且一次回收都不发", async () => {
    const f = io(noneLive, noneLive);
    const code = await reapCheckoutInstances({
      root: "/tmp",
      log: (s) => f.log.push(s),
      run: f.run,
      read: f.read,
    });
    expect(code).toBe(CODE.GREEN);
    expect(f.calls).toEqual([]);
    expect(f.log.join("\n")).toContain("没有需要收的");
  });

  it("via port：逐个发 reap-process.mjs，然后**独立回读**才算收干净", async () => {
    const f = io(portLive, noneLive);
    const code = await reapCheckoutInstances({
      root: "/tmp",
      log: (s) => f.log.push(s),
      run: f.run,
      read: f.read,
    });
    expect(code).toBe(CODE.GREEN);
    expect(f.calls).toEqual(["scripts/reap-process.mjs 4242"]);
    expect(f.log.join("\n")).toContain("已无在跑的应用实例");
  });

  it("关键负控制：via session ⇒ 不杀会话，也**不许**念成「没有需要收的」", async () => {
    const f = io(sessionLive, sessionLive);
    const code = await reapCheckoutInstances({
      root: "/tmp",
      log: (s) => f.log.push(s),
      run: f.run,
      read: f.read,
    });
    expect(code).toBe(CODE.NOT_RUN);
    expect(f.calls).toEqual([]);
    const all = f.log.join("\n");
    expect(all).toContain("不是残留");
    // 关键的那一句：不许走到「无事可做」那条出口（它打的是一句把在跑的服务报成没东西可收的话）。
    expect(all).not.toContain("没有在跑的应用实例");
    // 出口要指到编排器自己的收尾路径，不然这一句只是拒绝。
    expect(all).toContain("dev-launcher.mjs");
  });

  it("decideReap 四态各给一个动作（判断与效应分家，这条边界不写在效应代码里）", () => {
    expect(decideReap(noneLive)).toEqual({
      act: "none",
      code: CODE.GREEN,
      pids: [],
      reason: "",
    });
    expect(decideReap(sessionLive).act).toBe("session");
    expect(decideReap(sessionLive).code).toBe(CODE.NOT_RUN);
    expect(decideReap(portLive)).toEqual({
      act: "port",
      code: null,
      pids: [4242],
      reason: "",
    });
    // running:true 却没 pid ⇒ 不猜、不按端口反查。
    const odd = decideReap({ running: true, pids: [], via: "port" });
    expect(odd.code).toBe(CODE.NOT_RUN);
    expect(odd.act).toBe("none");
  });

  it("负控制：回收全退 0 而回读说还在 ⇒ 红（退码不算结论）", async () => {
    const f = io(portLive, portLive);
    expect(
      await reapCheckoutInstances({
        root: "/tmp",
        log: (s) => f.log.push(s),
        run: f.run,
        read: f.read,
      }),
    ).toBe(CODE.RED);
  });

  it("负控制：归属判据本身抛错 ⇒ 2 且不发回收（读不出来 ≠ 没有残留）", async () => {
    const f = io(new Error("netstat 起不来"), noneLive);
    const code = await reapCheckoutInstances({
      root: "/tmp",
      log: (s) => f.log.push(s),
      run: f.run,
      read: f.read,
    });
    expect(code).toBe(CODE.NOT_RUN);
    expect(f.calls).toEqual([]);
  });

  it("负控制：回读那一次抛错 ⇒ 2（收令发出去了，落没落不知道）", async () => {
    const f = io(portLive, new Error("第二次查询失败"));
    const code = await reapCheckoutInstances({
      root: "/tmp",
      log: (s) => f.log.push(s),
      run: f.run,
      read: f.read,
    });
    expect(code).toBe(CODE.NOT_RUN);
    expect(f.calls).toEqual(["scripts/reap-process.mjs 4242"]);
  });

  it("instanceReading：无 / 在场 / 读不出 / 矛盾形状各有一句实话", () => {
    expect(instanceReading(noneLive)).toBe("无");
    expect(instanceReading(portLive)).toContain("1 个（via port · pids 4242）");
    expect(instanceReading(sessionLive)).toContain("via session");
    expect(instanceReading(null)).toContain("没读到");
    expect(
      instanceReading({ running: false, pids: [7], via: "port" }),
    ).toContain("形状矛盾");
  });
});

describe("pollUntilTerminal：读数连着若干次一模一样就断流，不烧墙钟", () => {
  /* 这一格要防的形状是实测撞过的：一次真跑里 20 次轮询全是同一句「还没解析到 build」，
   * 最后落 exit 2 —— 等待没有换来任何新事实，而屏幕上只看得出「在等」。
   * 断流的依据是**签名**（sn / data.status / pipeline 完成数-总数 / stage 完成数-总数），
   * 任何一件变了就归零，所以它只掐掉重复，不掐掉慢。
   * stage 级那一件是 2026-10-22 补的：本仓 PR 是一条 pipeline / 三十几个 stage，
   * 只看 pipeline 级计数时推进中的流水线也念得出 `…/pending/0-1` —— 于是「只掐重复」
   * 那句话在那种拓扑上不成立（下面「stage 在推进」那一条就是这个反例的钉子）。
   * 第二个前提是同日 #2184 补的：**计数是离散的**，一格跑久了签名自己不动，
   * 所以「签名没变」还要配「此刻没有一格在飞」才叫停滞
   * （下面「有一格在飞」与「所有格都已落定」那两条是这一判的正反钉子）。 */
  type FakeResult = {
    status: number;
    stdout: string;
    stderr: string;
    error: string | null;
  };
  const SHA = "d02ec96364d5f3713b77c91b0d3fe789878f1747";
  const ok = (stdout: string): FakeResult => ({
    status: 0,
    stdout,
    stderr: "",
    error: null,
  });

  function io(opts: {
    /** 每次 get-build-status 的 data.status；用完后重复最后一个。 */
    statuses?: string[];
    /** 每次的 pipeline 计数（"0-1" 这种 `完成-总`），与 statuses 同长。 */
    progress?: string[];
    /** 每次的 stage 计数（"12/33" 这种 `完成/总`）；不给就造不出 stages 字段。 */
    stageProgress?: string[];
    /** false = 列表里没有这条 sha（平台还没开跑）。 */
    found?: boolean;
  }) {
    const log: string[] = [];
    const calls: string[] = [];
    let i = 0;
    const run = (_cmd: string, args: string[]): FakeResult => {
      calls.push(args.join(" "));
      if (args[1] === "get-build-logs") {
        const builds =
          opts.found === false
            ? []
            : [{ sn: "b1", sha: SHA, event: "pull_request", createTime: "t" }];
        return ok(JSON.stringify({ status: 200, data: { data: builds } }));
      }
      if (args[1] === "get-build-status") {
        const statuses = opts.statuses ?? ["pending"];
        const progress = opts.progress ?? ["0-1"];
        const st = statuses[Math.min(i, statuses.length - 1)] ?? "pending";
        const [done, total] = (
          progress[Math.min(i, progress.length - 1)] ?? "0-1"
        ).split("-");
        const stage = (opts.stageProgress ?? [])[
          Math.min(i, (opts.stageProgress ?? []).length - 1)
        ];
        i += 1;
        /** 平台那一层的外部形状（本测试只造得出判据看得见的字段）。 */
        const pipelinesStatus: Record<
          string,
          {
            status: string;
            stages?: {
              status: string;
              duration: number;
              name: string;
              id: string;
            }[];
          }
        > = {};
        for (let p = 0; p < Number(total); p += 1) {
          const pipeline: {
            status: string;
            stages?: {
              status: string;
              duration: number;
              name: string;
              id: string;
            }[];
          } = { status: p < Number(done) ? "success" : "running" };
          pipelinesStatus[`p${p}`] = pipeline;
          if (stage) {
            /* 只有第一条 pipeline 带 stages（与本仓的真实拓扑一致：一条流水线，
             * 里面几十格）。运行中那一格的 `duration` 是占位 0 —— 平台按格缓冲。 */
            const [sDone, sTotal] = stage.split("/");
            const stages: {
              status: string;
              duration: number;
              name: string;
              id: string;
            }[] = [];
            for (let s = 0; s < Number(sTotal); s += 1) {
              stages.push({
                status: s < Number(sDone) ? "success" : "start",
                duration: 0,
                name: `stage-${s}`,
                id: `stage-${s}`,
              });
            }
            pipeline.stages = stages;
          }
        }
        return ok(
          JSON.stringify({
            status: 200,
            data: { sn: "b1", status: st, pipelinesStatus },
          }),
        );
      }
      return ok("");
    };
    return {
      log,
      calls,
      run,
      polls: () => i,
      now: () => 0,
      sleep: async () => undefined,
    };
  }

  const base = { slug: "org/repo", newSha: SHA };

  it("同一读数连续 10 次 ⇒ 断流、记「没有终态结论」（exit 2，不是红）", async () => {
    const f = io({ statuses: ["pending"], progress: ["0-1"] });
    const out = await pollUntilTerminal({
      run: f.run,
      log: (s) => f.log.push(s),
      ...base,
      now: f.now,
      sleep: f.sleep,
    });
    /* 落 2 而不是 1：签名含 stage 级进度之后，「连着 10 眼一模一样」意味着一个格都没推进过，
     * 那是「拿不到测量」而不是「测出一个红」（#2152 当初落红，理由在只看 pipeline 级计数的
     * 签名下会把推进中的流水线也念成没动；业主定：改记 2）。 */
    expect(out.stop).toBe(CODE.NOT_RUN);
    expect(f.polls()).toBe(10);
    const all = f.log.join("\n");
    expect(all).toContain("连续 10 次读数没变");
    expect(all).toContain("没有终态结论");
    // 断流那句要带着日志页，否则「不再等了」等于把人赶进下一步去猜。
    expect(all).toContain("/-/build/logs/b1");
  });

  it("负控制：pipeline 级读数一字不动、stage 一路推进 ⇒ 不算断流，继续轮到终态", async () => {
    /* 这一条就是本仓那条拓扑的反例钉子：一条 pipeline、三十几个 stage 时 `done-total`
     * 整跑都停在 `0-1`。序列刻意排到 12 眼（> `POLL_STALL_MAX`）—— 只看 pipeline 级计数的
     * 旧版本会在第 10 眼断流落红，而那条流水线其实正推进到 28/33
     * （2026-10-22 实测 `cnb-7d9-1k5h9edct`）。 */
    const f = io({
      statuses: [...Array<string>(11).fill("pending"), "success"],
      progress: Array(12).fill("0-1"),
      stageProgress: [
        "1/33",
        "4/33",
        "7/33",
        "9/33",
        "12/33",
        "15/33",
        "18/33",
        "21/33",
        "24/33",
        "26/33",
        "28/33",
        "33/33",
      ],
    });
    const out = await pollUntilTerminal({
      run: f.run,
      log: (s) => f.log.push(s),
      ...base,
      now: f.now,
      sleep: f.sleep,
    });
    expect(out.stop).toBeNull();
    expect(out.buildState).toBe("green");
    expect(f.polls()).toBe(12);
    expect(f.log.join("\n")).not.toContain("读数没变");
  });

  it("负控制（ISSUE #2184 那一形）：签名冻住但有一格在飞 ⇒ 不断流，且那句说明每轮只念一次", async () => {
    /* #2167 把 stage 计数取进签名之后，「一格跑了很久」仍然会被念成停滞：计数是离散的，
     * 那一格在 `start` 里自己不动签名（现场读数 `…/pending/0-1+11/33` 连满 10 眼，
     * 而几分钟后同一条构建是 28/33）。这一条喂 13 眼完全相同的签名 + 32/33（= 一格在飞），
     * 旧版本会在第 10 眼断流。 */
    const f = io({
      statuses: [...Array<string>(13).fill("pending"), "success"],
      progress: Array(14).fill("0-1"),
      stageProgress: Array(14).fill("32/33"),
    });
    const out = await pollUntilTerminal({
      run: f.run,
      log: (s) => f.log.push(s),
      ...base,
      now: f.now,
      sleep: f.sleep,
    });
    expect(out.stop).toBeNull();
    expect(out.buildState).toBe("green");
    expect(f.polls()).toBe(14);
    const all = f.log.join("\n");
    expect(all).not.toContain("不再轮询");
    expect(all).toContain("有 1 格在飞");
    // 只念一次：反复复述「还在跑」与复述「没变化」是同一类噪音。
    expect(all.split("格在飞").length - 1).toBe(1);
  });

  it("负控制：所有格都已落定、签名还冻着 ⇒ 第 10 眼照旧断流（那一判不因为加了格数而失效）", async () => {
    const f = io({
      statuses: [...Array<string>(12).fill("pending"), "success"],
      progress: Array(13).fill("0-1"),
      stageProgress: Array(13).fill("33/33"),
    });
    const out = await pollUntilTerminal({
      run: f.run,
      log: (s) => f.log.push(s),
      ...base,
      now: f.now,
      sleep: f.sleep,
    });
    expect(out.stop).toBe(CODE.NOT_RUN);
    expect(f.polls()).toBe(10);
    expect(f.log.join("\n")).toContain("且此刻没有一格在飞");
  });

  it("负控制：第 4 眼签名变了（pipeline 从 0-1 走到 1-1）⇒ 计数归零，继续轮到终态", async () => {
    const f = io({
      statuses: ["running", "running", "running", "running", "success"],
      progress: ["0-1", "0-1", "0-1", "1-1", "1-1"],
    });
    const out = await pollUntilTerminal({
      run: f.run,
      log: (s) => f.log.push(s),
      ...base,
      now: f.now,
      sleep: f.sleep,
    });
    expect(out.stop).toBeNull();
    expect(out.buildState).toBe("green");
    expect(f.polls()).toBe(5);
    expect(f.log.join("\n")).not.toContain("读数没变");
  });

  it("「按 sha 还没解析到 build」刷 20 次那一形：第 10 次就断，不再烧满预算", async () => {
    const f = io({ found: false });
    const out = await pollUntilTerminal({
      run: f.run,
      log: (s) => f.log.push(s),
      ...base,
      now: f.now,
      sleep: f.sleep,
    });
    expect(out.stop).toBe(CODE.NOT_RUN);
    const repeated = f.log.filter((s) => s.includes("还没解析到 build"));
    expect(repeated).toHaveLength(10);
    expect(f.log.join("\n")).toContain("(未解析到 build)");
  });

  it("buildSignature：四件原值进签名，缺 data / 缺 sn / 缺 stages 都各有稳定形状", () => {
    expect(
      buildSignature(
        {
          data: {
            status: "running",
            pipelinesStatus: {
              p0: { status: "success" },
              p1: {
                status: "running",
                stages: [
                  { status: "success" },
                  { status: "start" },
                  { status: "pending" },
                ],
              },
            },
          },
        },
        "b1",
      ),
    ).toBe("b1/running/1-2+1/3");
    /* stage 级那两件必须真的进签名 —— 本仓一条 pipeline 的拓扑下，它是唯一会动的量。
     * 两段的差别只在「多一格从 pending 走到 start」：运行中的那一格在平台词汇里就叫 `start`，
     * 把它数成已完成的话，这一对签名会相等，断流照旧掐掉正在推进的流水线。 */
    expect(
      buildSignature(
        {
          data: {
            status: "pending",
            pipelinesStatus: {
              p0: { status: "running", stages: [{ status: "success" }] },
            },
          },
        },
        "b1",
      ),
    ).not.toBe(
      buildSignature(
        {
          data: {
            status: "pending",
            pipelinesStatus: {
              p0: {
                status: "running",
                stages: [{ status: "success" }, { status: "start" }],
              },
            },
          },
        },
        "b1",
      ),
    );
    /* 外部形状不完整（没有 stages 字段）时按 0 计，不替平台补一个「大概在进行」的形状。 */
    expect(
      buildSignature(
        {
          data: {
            status: "running",
            pipelinesStatus: { p0: { status: "running" } },
          },
        },
        "b1",
      ),
    ).toBe("b1/running/0-1+0/0");
    expect(buildSignature(null, "")).toContain("(未解析到 build)");
    expect(buildSignature({}, "b2")).toContain("(取不到 data)");
  });
});

describe("被取消的那一跑：结论是「没有结论」，不是「CI 红」（ISSUE #2158 第 2 条）", () => {
  type FakeResult = {
    status: number;
    stdout: string;
    stderr: string;
    error: string | null;
  };
  const SHA = "d02ec96364d5f3713b77c91b0d3fe789878f1747";
  const ok = (stdout: string): FakeResult => ({
    status: 0,
    stdout,
    stderr: "",
    error: null,
  });

  /* 真形状（`cnb-lm1-1k5h1otqt`）：第二格被顶掉、第三格根本没跑，而**构建级**是
     `error` —— 平台把「被取消」写成「红」，这正是这一族要分开的那个混淆。 */
  const CANCELLED = {
    status: 200,
    data: {
      status: "error",
      pipelinesStatus: {
        "p-001": {
          id: "p-001",
          name: "质量门禁",
          status: "cancel",
          stages: [
            { status: "success", name: "工作区出处", id: "stage-0" },
            { status: "cancel", name: "被顶掉的那格", id: "stage-1" },
            { status: "skipped", name: "下面那一格", id: "stage-2" },
          ],
        },
      },
    },
  };

  function io() {
    const log: string[] = [];
    const run = (_cmd: string, args: string[]): FakeResult => {
      if (args[1] === "get-build-logs") {
        return ok(
          JSON.stringify({
            status: 200,
            data: {
              data: [
                { sn: "b1", sha: SHA, event: "pull_request", createTime: "t" },
              ],
            },
          }),
        );
      }
      if (args[1] === "get-build-status") {
        return ok(JSON.stringify(CANCELLED));
      }
      if (args[1] === "get-pull") {
        return ok(
          JSON.stringify({
            status: 200,
            data: {
              number: 7,
              mergeable_state: "mergeable",
              blocked_on: "",
              is_merged: false,
              state: "open",
            },
          }),
        );
      }
      return ok("");
    };
    return { log, run };
  }

  it("轮询那一格：状态是 cancelled，日志点名被顶掉的那一格与下面根本没跑的那几格", async () => {
    const f = io();
    const out = await pollUntilTerminal({
      run: f.run,
      log: (s) => f.log.push(s),
      slug: "org/repo",
      newSha: SHA,
      now: () => 0,
      sleep: async () => undefined,
    });
    expect(out.stop).toBeNull();
    expect(out.buildState).toBe("cancelled");
    const all = f.log.join("\n");
    expect(all).toContain("被取消");
    expect(all).toContain("被顶掉的那格");
    expect(all).toContain("下面那一格");
  });

  it("判决那一格：退 2（没有结论），并且**不**说「CI 红」", () => {
    const f = io();
    const code = reportVerdict({
      run: f.run,
      log: (s) => f.log.push(s),
      slug: "org/repo",
      number: 7,
      buildState: "cancelled",
      buildSn: "b1",
    });
    expect(code).toBe(CODE.NOT_RUN);
    const all = f.log.join("\n");
    expect(all).toContain("被取消");
    expect(all).toContain("不要去查产物");
    expect(all).not.toContain("CI 红");
  });

  it("负控制：真红的那一跑仍然是红、仍然退 1（这一族的行为一个字没改）", () => {
    const f = io();
    const code = reportVerdict({
      run: f.run,
      log: (s) => f.log.push(s),
      slug: "org/repo",
      number: 7,
      buildState: "red",
      buildSn: "b1",
    });
    expect(code).toBe(CODE.RED);
    expect(f.log.join("\n")).toContain("CI 红");
  });
});

describe("parseSlug：https 与 ssh 两种 origin 都要认", () => {
  it("取不到就回 null（不猜一个仓库名 —— 猜错会把 PR 开到别处）", () => {
    expect(parseSlug("https://cnb.cool/moon-read/comfy-app-t3")).toBe(
      "moon-read/comfy-app-t3",
    );
    expect(parseSlug("https://cnb.cool/moon-read/comfy-app-t3.git")).toBe(
      "moon-read/comfy-app-t3",
    );
    expect(parseSlug("git@cnb.cool:moon-read/comfy-app-t3.git")).toBe(
      "moon-read/comfy-app-t3",
    );
    expect(parseSlug("")).toBeNull();
    expect(parseSlug("https://cnb.cool/")).toBeNull();
  });
});

/**
 * 远端名与上游基线的推导。这一组存在的原因是这一版把 `origin` **写死在五处**
 * （`get-url origin` / `origin/master...HEAD` 取碎片 / `git push -u origin` /
 * `fetch origin master` / `cat-file origin/master:<碎片>`），而本仓按硬规则 6 只有
 * 一个叫 `cnb` 的远端 —— 五条命令全部失败，而失败在每一处都长得像「答案为空」：
 * 碎片那一查拿到空串 ⇒ preflight 报「没有 changelog.d 碎片」⇒ `pnpm ship` 在本仓
 * 从第一次跑起就没工作过，报的还是一个听起来正当的理由。
 */
describe("looksNewlineMangled：`pnpm run` 把 argv 里的换行改写成字面量这一格", () => {
  it("认「没有真换行 + 带字面量 \\n」这一形，其余一律不拦", () => {
    // 实测形状：`pnpm ship --message "一行<换行>二行"` 到 node 手里成了一条
    // `一行\n二行`（真换行没了）；`pnpm exec node` 那条路径则保留真换行。
    expect(looksNewlineMangled("标题\\n\\n正文一段\\n正文二段")).toBe(true);
    /* 真换行在 ⇒ 不是改写产物（`--message-file` 读出来的、`pnpm exec` 传进来的都是这形）。 */
    expect(looksNewlineMangled("标题\n\n正文")).toBe(false);
    // 普通单行不受影响 —— 判据必须只认那一形，别顺手多拦。
    expect(looksNewlineMangled("fix(a): 单行提交信息")).toBe(false);
    expect(looksNewlineMangled("")).toBe(false);
    expect(looksNewlineMangled(null)).toBe(false);
  });
});

describe("resolveUpstream：远端名与主干基线（两处都是每台克隆自己的事实）", () => {
  it("① 有上游就用上游 —— 这是 git 已经知道的事，不另推", () => {
    expect(
      resolveUpstream({ upstream: "cnb/master", remotes: ["cnb"] }),
    ).toEqual({
      remote: "cnb",
      base: "cnb/master",
      source: "upstream",
    });
    /* 带斜杠的分支名不能被截断（`cnb` + `release/2026-10`）。 */
    expect(
      resolveUpstream({ upstream: "cnb/release/2026-10", remotes: ["cnb"] })
        .base,
    ).toBe("cnb/release/2026-10");
  });

  it("② 没有上游但只有唯一远端 ⇒ 推 `<远端>/master`，并标明是推的", () => {
    const got = resolveUpstream({ upstream: "", remotes: ["cnb"] });
    expect(got).toEqual({
      remote: "cnb",
      base: "cnb/master",
      source: "sole-remote",
    });
    /* 推出来的东西必须读得出它是推的：默认分支不叫 master 时这一档会偏，
     * 而调用方靠「基线引用验不过」那一格把它抓住 —— 不是靠这里猜对。 */
    expect(got.source).not.toBe("upstream");
  });

  it("③ 多个远端且没有上游 ⇒ 回到 origin 的习惯；再没有就给 null", () => {
    expect(
      resolveUpstream({ upstream: null, remotes: ["origin", "gitee"] }).remote,
    ).toBe("origin");
    expect(
      resolveUpstream({ upstream: null, remotes: ["cnb", "gitee"] }),
    ).toEqual({
      remote: null,
      base: null,
      source: "none",
    });
    /* `null` 是「没有执行者」的入参，不是「基线是空字符串」——
     * 后者会让 `${base}...HEAD` 变成一条语法合法、语义全错的 git 命令。 */
    expect(resolveUpstream({ upstream: null, remotes: [] }).base).toBeNull();
  });

  it("④ 上游取的是「谁在跟踪」，不是「主干在哪」 —— 自跟踪必须退回主干", () => {
    /* `git push -u origin feat/x` 之后 `@{u}` = `cnb/feat/x`（分支自己在远端的副本）。
     * 拿它当基线 ⇒ `cnb/feat/x...HEAD` 恒空 ⇒ 碎片那一查报 0 份。这一档必须让位于
     * 「远端默认分支」那条事实。 */
    expect(
      resolveUpstream({
        upstream: "cnb/feat/x",
        remotes: ["cnb"],
        localBranch: "feat/x",
        remoteHead: "refs/remotes/cnb/master",
      }),
    ).toEqual({ remote: "cnb", base: "cnb/master", source: "remote-head" });

    /* 反过来：上游是**别的目标分支**（人显式设的，如往 release 线开 PR）时，
     * 那仍然是最贴事实的基线，不能被默认分支顶掉。 */
    expect(
      resolveUpstream({
        upstream: "cnb/release/2026-10",
        remotes: ["cnb"],
        localBranch: "feat/x",
        remoteHead: "refs/remotes/cnb/master",
      }).base,
    ).toBe("cnb/release/2026-10");

    /* 这台克隆没有 `refs/remotes/<远端>/HEAD`（手工 clone 常见）⇒ 只能推
     * `<远端>/master`，且来源要读得出是推的，不能冒充 `upstream`。 */
    const guessed = resolveUpstream({
      upstream: "cnb/feat/x",
      remotes: ["cnb"],
      localBranch: "feat/x",
      remoteHead: null,
    });
    expect(guessed.base).toBe("cnb/master");
    expect(guessed.source).not.toBe("upstream");

    /* 在 master 上自跟踪时，「基线 = 上游」本来就成立 —— 这一档不能把那条也顶掉，
     * 否则①那一档的真语义就没了。 */
    expect(
      resolveUpstream({
        upstream: "cnb/master",
        remotes: ["cnb"],
        localBranch: "master",
        remoteHead: "refs/remotes/cnb/master",
      }).base,
    ).toBe("cnb/master");
  });
});

describe("findPullForBranch：重跑不产生第二个 PR", () => {
  const LIST = {
    data: [
      { number: 2029, state: "open", head: { ref: "refs/heads/fix/a" } },
      { number: 2025, state: "open", head: { ref: "refs/heads/feat/b" } },
    ],
  };

  it("按 head.ref 命中；没有就回 null（⇒ 才去建）", () => {
    expect(findPullForBranch(LIST, "feat/b")).toBe(2025);
    expect(findPullForBranch(LIST, "feat/nope")).toBeNull();
    expect(findPullForBranch({}, "feat/b")).toBeNull();
    expect(findPullForBranch(null, "feat/b")).toBeNull();
  });
});

describe("readPullVerdict：字段缺省时不抛，且默认值是「没合上」", () => {
  it("缺 data / 缺字段都归一到安全默认", () => {
    expect(readPullVerdict(null)).toEqual({
      number: null,
      mergeableState: "unknown",
      blockedOn: "",
      isMerged: false,
      state: "unknown",
    });
    expect(
      readPullVerdict({
        data: { number: 2027, is_merged: true, mergeable_state: "mergeable" },
      }).isMerged,
    ).toBe(true);
  });
});

describe("planCommands：dry-run 打印的就是真跑时会执行的同一份 argv", () => {
  const st = {
    branch: "feat/x",
    sha: "abcdef1234567890",
    slug: "moon-read/comfy-app-t3",
    adds: ["src/a.ts"],
    hasMessage: true,
    merge: true,
    /* 远端名是**每台克隆机器自己的事实**（并行检出里实测见过 `cnb`，本检出是
     * `origin`，见 docs/audits/2026-10-12 R12-01），所以夹具故意给一个不是 `origin`
     * 的名字：计划里那一行必须用**解析出的**远端名 —— 写死 `origin` 时这一版在 push
     * 那一段就起不来，而 dry-run 照样打印得很漂亮：计划与执行两头都写着同一条错。 */
    remote: "cnb",
    baseBranch: "master",
  };

  it("逐条含命令本体，且平台调用一律带 -v（JSON 是唯一取数面）", () => {
    const plan = planCommands(st);
    expect(plan).toContain("git add -- src/a.ts");
    expect(plan).toContain("git push -u cnb feat/x");
    expect(plan.some((l) => l.includes("--base master --head feat/x"))).toBe(
      true,
    );
    for (const line of plan.filter((l) => l.startsWith("cnb "))) {
      expect(line, `计划里这条 cnb 调用没带 -v：${line}`).toContain("-v");
    }
  });

  it("合并那一行只在 merge 为真时出现（默认不合并这条纪律的自证）", () => {
    expect(planCommands(st).some((l) => l.includes("merge-pull"))).toBe(true);
    expect(
      planCommands({ ...st, merge: false }).some((l) =>
        l.includes("merge-pull"),
      ),
    ).toBe(false);
  });

  it("建分支与清分支那两跳同样只在旗标下出现，且清分支的**回读**也在计划里", () => {
    /* 默认那份计划里两条都不该有 —— 「不给旗标就出现在计划里」意味着 dry-run 教的
     * 执行面比人请求过的大。 */
    const plain = planCommands(st).join("\n");
    expect(plain).not.toContain("git checkout -b");
    expect(plain).not.toContain("branch -D");
    const made = planCommands({ ...st, createBranch: "feat/new" }).join("\n");
    expect(made).toContain("git checkout -b feat/new");
    const cleaned = planCommands({ ...st, cleanBranch: true });
    expect(cleaned).toContain("git push cnb --delete feat/x");
    expect(cleaned).toContain("git ls-remote --heads cnb feat/x");
    expect(cleaned).toContain("git branch -D feat/x");
    expect(cleaned).toContain(
      "git show-ref --verify --quiet refs/heads/feat/x",
    );
    /* 远端名用解析出来的那个（夹具里是 cnb），写死 origin 就是两头一起错。 */
    expect(cleaned.join("\n")).not.toContain("origin --delete");
  });

  it("计划里的碎片那一查与执行面同形（取并的两条，不是那条已经没人跑的 ls-files）", () => {
    /* `planCommands` 是抄本，抄本会过期：#2034 把执行面从 `git ls-files changelog.d`
     * （数出整个目录 118 份 ⇒ 那条守卫恒真）改成「分支相对主干已提交的 ∪ 还没提交的」
     * 之后，计划里那一行还停在旧取数面上。dry-run 是给人的第一份说明书，
     * 它写着一件不存在的查询，就把错的取数面教给了读者。 */
    const plan = planCommands(st);
    expect(plan).toContain(
      "git diff --name-only cnb/master...HEAD -- changelog.d",
    );
    expect(plan).toContain("git status --porcelain -- changelog.d");
    expect(plan.join("\n")).not.toContain("git ls-files");
    /* 带斜杠的主干名（往 release 线开 PR）不能被拼成 `cnb/release`。 */
    expect(
      planCommands({
        ...st,
        remote: "cnb",
        baseBranch: "release/2026-10",
      }).some((l) =>
        l.includes("git diff --name-only cnb/release/2026-10...HEAD"),
      ),
    ).toBe(true);
  });

  it("对账：计划里的「模块+工具」对 ⇄ 源码里真实调用的，必须同集合", () => {
    /* `planCommands` 是命令清单的第二份抄本 —— 这正是要避免的形态，所以不装作它不是：
     * 这里把它与真执行面**逐条对账**，任何一侧新增/改名而另一侧没跟，这条就红。
     * 只比「模块 + 工具」这一对（参数值里有 `<tmp>` / `…` 这类占位，逐字比会脆）。
     * 取数面是 `scripts/ship*.mjs` **整个族**，不是某一个文件：cnb 调用从编排入口
     * 搬去平台侧模块时，只读单份文件的提取会抓到 0 条 ⇒ 两侧都空集、于是恒绿，
     * 而下面那条前置断言就是拦住这种「提取坏了却看起来像结论」的。 */
    const shipDir = path.resolve(__dirname, "../scripts");
    const src = readdirSync(shipDir)
      .filter((f) => /^ship.*\.mjs$/.test(f))
      .map((f) => readFileSync(path.join(shipDir, f), "utf8"))
      .join("\n");
    /** 从 `cnbJson(run, ["pulls", "post-pull", …])` 里抽出前两个字符串。 */
    const called = new Set<string>();
    for (const m of src.matchAll(
      /cnbJson\(run,\s*\[\s*"(\w+)"\s*,\s*"([\w-]+)"/g,
    )) {
      called.add(`${m[1]} ${m[2]}`);
    }
    const planned = new Set<string>();
    /* 两个显式动作**都拨上**才是「源码里可能伸手的全部集合」：`--merge` 与
     * `--close-issue` 各自的命令都只在对应旗标下进计划（默认那份是子集）。
     * 只拨一个的话，另一格新增的调用会在这条对账里被漏看 —— 而这条对账的存在
     * 理由恰恰是「计划与执行两头一起错时没人响」。 */
    for (const line of planCommands({
      ...st,
      merge: true,
      closeIssue: true,
    })) {
      const m = /^cnb (\w+) ([\w-]+)/.exec(line);
      if (m) planned.add(`${m[1]} ${m[2]}`);
    }
    // 前置断言：提取本身要真的抓到东西（正则写漂会让两侧都成空集、于是恒绿）。
    expect(
      called.size,
      "从源码里一条 cnb 调用都没抽到 ⇒ 提取正则坏了",
    ).toBeGreaterThan(0);
    expect(planned).toEqual(called);
  });
});

describe("deriveTitle：PR 标题与主干那一行该取自哪一笔", () => {
  it("① 分支相对主干的第一笔非常规提交 —— 合并节点与补碎片那一笔都不算", () => {
    /* 实测代价（主干上留着两条坏行）：标题取 `git log -1 --pretty=%s`，于是
     * 「先把 master 合进来再 `pnpm ship --merge`」把主干那一行写成
     * `Merge branch 'master' into fix/…`（#2057），而「最后补一笔碎片」把它写成
     * `docs(changelog): 碎片按合流后的实际落地面重写`（#2055）——
     * 两条都不描述这次变更，squash 之后读者只能看到一个与内容无关的标题。 */
    expect(
      deriveTitle({
        subjects: [
          "fix(ship): 主体的那一笔",
          "docs(changelog): 补碎片",
          "test: 加一条反向样本",
        ],
        head: "Merge branch 'master' into fix/x",
      }),
    ).toEqual({ title: "fix(ship): 主体的那一笔", source: "branch-first" });
  });

  it("② 人显式给的 `--title` 压过一切推导", () => {
    expect(
      deriveTitle({
        subjects: ["fix(a): 一笔"],
        head: "fix(a): 一笔",
        explicit: "feat(b): 这整条 PR 是一件更大的事",
      }),
    ).toEqual({
      title: "feat(b): 这整条 PR 是一件更大的事",
      source: "flag",
    });
  });

  it("③ 分支上没有非常规提交时退回 HEAD，两处都空就是空 —— 不许编一个", () => {
    expect(deriveTitle({ subjects: [], head: "fix(c): 只有这一笔" })).toEqual({
      title: "fix(c): 只有这一笔",
      source: "head",
    });
    /* `subjects` 里塞合并节点是调用方的责任（`--no-merges`），这里不重复判；
     * 但两处都取不到时必须交回空串 —— 空标题会被调用方按「没跑起来」处理，
     * 而不是把 `--title ""` 发给平台建出一个没有标题的 PR。 */
    expect(deriveTitle({ subjects: [], head: "" })).toEqual({
      title: "",
      source: "none",
    });
    expect(deriveTitle({ subjects: ["  "], head: "" })).toEqual({
      title: "",
      source: "none",
    });
  });
});

describe("buildPullBody：只搬量到的事实，不生成会被复核的因果句", () => {
  it("碎片标题与 diffstat 进正文", () => {
    const body = buildPullBody({
      root: process.cwd(),
      fragments: ["changelog.d/0-nonexistent-for-test.md"],
      diffstat: " 1 file changed",
    });
    expect(body).toContain("changelog.d/0-nonexistent-for-test.md");
    expect(body).toContain("1 file changed");
  });

  it("负控制：正文里不许出现 check-commit-claims 会拿事实复核的那三种句式", () => {
    // ①「§x.y 照旧保留」②「<path> 一个字没动」③「N 处…收到 0」。
    // 脚本没跑过那些判据，写出来就是**未经验证的声明**进了历史。
    const body = buildPullBody({
      root: process.cwd(),
      fragments: ["changelog.d/0-x.md"],
      diffstat: " 3 files changed",
    });
    for (const banned of [
      "照旧保留",
      "一个字没动",
      "收到 0",
      "收到0",
      "没动",
    ]) {
      expect(body, `正文里出现了未经验证的声明句式：${banned}`).not.toContain(
        banned,
      );
    }
  });
});

describe("main()：用注入的假执行者钉住「哪些命令真的会被跑」", () => {
  /**
   * 注入执行者的返回形状 —— 与 `ship-exec.mjs` 的 `ExecResult` 同形。
   * 「同形」不是这句注释自己保证的：`main({ run })` 的入参类型就是那个 typedef，
   * 少一个字段（尤其 `stderr`）会当场在 `fake()` 的调用点报 TS 错。
   * 这里用 TS 语法而不是 JSDoc `@type`：本文件是 `.ts`，而 JSDoc 的变量/参数注解
   * 只在 `.js` / `.mjs` 里被采纳，在 `.ts` 里会被静默忽略（实测报
   * `Property 'branch' does not exist on type '{}'`）。
   */
  type FakeResult = {
    status: number;
    stdout: string;
    stderr: string;
    error: string | null;
  };

  /** 现场形状。 */
  type FakeEnv = {
    branch?: string;
    frags?: string[];
    cnbMissing?: boolean;
    /** 假 `git commit` 往 **stderr** 写的话（钩子的输出面）。 */
    commitStderr?: string;
    commitStatus?: number;
    /** 本次要暂存的文件（触发真提交那一支）。 */
    dirty?: string[];
    /** 直接覆盖 `git status --porcelain` 的返回（喂非默认形状，见 #2073 那格）。 */
    porcelain?: string;
    /** 这条分支相对上游基线**已提交**的碎片（第二次跑那一向）。 */
    branchFrags?: string[];
    /** HEAD 的上游（`git rev-parse --abbrev-ref --symbolic-full-name @{u}`）。 */
    upstream?: string | null;
    /** 那条上游引用在不在本地（验不验得过）。false = `rev-parse --verify` 退非 0。 */
    baseExists?: boolean;
    /** 远端默认分支的符号引用（`git symbolic-ref refs/remotes/<远端>/HEAD`）。
     *  `null` = 这台克隆没有它（那样就只能推 `<远端>/master`，且要读得出是推的）。 */
    remoteHead?: string | null;
    /** 这条分支相对主干**自己带进来的**提交 subject（`log --no-merges --reverse`）。 */
    branchSubjects?: string[];
    /** `show-ref --verify` 查得到那个 ref（--branch 那一跳的「名字已被占用」形态）。 */
    refExists?: boolean;
    /** 答齐全链（轮询 / 合并 / 清理）那几跳 —— 默认关，见 `fake()` 里那段注释。 */
    chain?: boolean;
    /** 当前顶端那一笔的 subject（`log -1 --pretty=%s`）—— 默认给一个合并节点形状。 */
    headSubject?: string;
  };

  /**
   * 造一个 git / cnb / node 的替身，并**记录每一次调用**。
   * 记录才是这一组的核心：断言的不是返回值，而是「它有没有伸手去改世界」。
   */
  function fake(env: FakeEnv = {}) {
    const calls: string[] = [];
    const branch = env.branch ?? "feat/x";
    const frags = env.frags ?? ["changelog.d/0-x.md"];
    const dirty = env.dirty ?? [];
    const ok = (stdout: string, stderr = ""): FakeResult => ({
      status: 0,
      stdout,
      stderr,
      error: null,
    });
    const run = (cmd: string, args: string[]): FakeResult => {
      calls.push([cmd, ...args].join(" "));
      const key = args.join(" ");
      if (cmd === "cnb" && args[0] === "--version") {
        return env.cnbMissing
          ? { status: -1, stdout: "", stderr: "", error: "ENOENT" }
          : ok("1.15.25");
      }
      /* ⚠️ 必须排在下面那条通用 `--abbrev-ref` **之前**：HEAD 那一查与上游那一查
       * 共用同一个前缀，顺序反了上游查询会拿到分支名，于是「远端解析」这一格
       * 判的是夹具自己的形状。 */
      if (cmd === "git" && key.includes("@{u}"))
        return ok(env.upstream === null ? "" : (env.upstream ?? "cnb/master"));
      /* 主干那一条有本地可读的权威事实：远端的 `HEAD` 符号引用。
       * 夹具默认给出（与真实克隆一致），`remoteHead: null` 那一格专门演「没有它」。 */
      if (cmd === "git" && key.includes("symbolic-ref"))
        return env.remoteHead === null
          ? { status: 1, stdout: "", stderr: "", error: null }
          : ok(env.remoteHead ?? "refs/remotes/cnb/master");
      if (cmd === "git" && key.includes("--abbrev-ref")) return ok(branch);
      if (cmd === "git" && key === "remote") return ok("cnb\n");
      if (cmd === "git" && key.includes("rev-parse --verify --quiet"))
        return env.baseExists === false
          ? { status: 1, stdout: "", stderr: "", error: null }
          : ok("d02ec96364d5f3713b77c91b0d3fe789878f1747");
      /* `show-ref --verify --quiet <ref>`：git 的语义是**查不到退 1**。默认答「查不到」，
       * 因为这一格在 --branch 那一跳判的是「这个名字有没有被占用」—— 拿通用兜底的
       * 退 0 当默认值，等于让夹具自己担保「名字都撞车了」，于是建分支那一格永远走不到。 */
      if (cmd === "git" && key.startsWith("show-ref --verify --quiet"))
        return env.refExists
          ? ok("9b1bade9cafe9b5a4d76e0c0d0bfb1d1a3a4f9b2")
          : { status: 1, stdout: "", stderr: "", error: null };
      if (cmd === "git" && key.includes("rev-parse HEAD"))
        return ok("d02ec96364d5f3713b77c91b0d3fe789878f1747");
      // ⚠️ 顺序要紧：碎片那一查也是 `status --porcelain`，只是多一个 `-- changelog.d`。
      if (cmd === "git" && key.includes("status --porcelain -- changelog.d"))
        return ok(frags.map((f) => `?? ${f}`).join("\n"));
      if (cmd === "git" && key.includes("status --porcelain"))
        return ok(env.porcelain ?? dirty.map((f) => `M  ${f}`).join("\n"));
      /* 分支相对上游**已提交**的碎片（同一条分支上第二次跑就靠这一格不为空）。
       * 这里**不**按某个写死的基线名命中 —— 命中基线名等于替被测代码担保「它选的
       * 那条引用是对的」。改为照 git 的语义答：拿 HEAD 自己这条分支的远端副本当基线
       * 就是自己比自己 ⇒ 结果必空，这正是那条缺陷的现场。 */
      if (
        cmd === "git" &&
        key.includes("diff --name-only") &&
        key.includes("...HEAD")
      ) {
        const base = key.replace("diff --name-only ", "").split("...")[0] ?? "";
        if (base === `cnb/${branch}`) return ok("");
        return ok((env.branchFrags ?? []).join("\n"));
      }
      /* 标题的取数面（`deriveTitle` 那一格）：`--no-merges --reverse` 给的是这条分支
       * **自己带进来的**那些提交，`log -1` 给的是当前顶端那一笔。默认把后者设成一个
       * 合并节点、前者设成主体那一笔 —— 缺陷正是拿后者当标题（#2057 在主干上留下的
       * 那行 `Merge branch 'master' into …` 就是这么来的）。 */
      if (cmd === "git" && key.includes("log --no-merges"))
        return ok((env.branchSubjects ?? ["fix(x): 主体的那一笔"]).join("\n"));
      if (cmd === "git" && key.includes("log -1 --pretty=%s"))
        return ok(env.headSubject ?? "Merge branch 'master' into fix/x");
      if (cmd === "git" && key.startsWith("commit"))
        return {
          status: env.commitStatus ?? 0,
          stdout: "",
          stderr: env.commitStderr ?? "",
          error: null,
        };
      if (cmd === "git" && key.includes("get-url"))
        return ok("https://cnb.cool/moon-read/comfy-app-t3\n");
      if (cmd === "node" && key.includes("check-deps-freshness"))
        return ok("OK");
      /* ── 整链形状（`chain: true` 才答）───────────────────────────
       * 默认不答，是为了不惊动已有那些用例：它们中好几条判的正是「建 PR 那一跳的
       * 各种失败出口」，一旦 list-pulls 有了可解析的响应就会改走「复用」那条支路。 */
      if (!env.chain) return ok("");
      if (cmd === "git" && key.startsWith("rev-parse --short"))
        return ok("edda13b6");
      if (cmd === "git" && key.startsWith("cat-file -e")) return ok("");
      if (cmd === "git" && key.startsWith("push cnb --delete")) return ok("");
      if (cmd === "git" && key.startsWith("ls-remote --heads")) return ok("");
      if (cmd === "git" && key.startsWith("branch -D")) return ok("");
      if (cmd === "cnb" && args[0] === "build" && args[1] === "get-build-logs")
        return ok(
          JSON.stringify({
            status: 200,
            data: {
              data: [
                {
                  sn: "cnb-267-1k5h0qvib",
                  sha: "d02ec96364d5f3713b77c91b0d3fe789878f1747",
                  event: "pull_request",
                  createTime: "2026-10-22T05:20:07.000Z",
                },
              ],
            },
          }),
        );
      if (
        cmd === "cnb" &&
        args[0] === "build" &&
        args[1] === "get-build-status"
      )
        return ok(JSON.stringify({ status: 200, data: { status: "success" } }));
      if (cmd === "cnb" && args[0] === "pulls" && args[1] === "list-pulls")
        return ok(
          JSON.stringify({
            status: 200,
            data: [
              {
                number: 777,
                head: { ref: `refs/heads/${branch}` },
                base: { ref: "refs/heads/master" },
              },
            ],
          }),
        );
      if (cmd === "cnb" && args[0] === "pulls" && args[1] === "get-pull")
        return ok(
          JSON.stringify({
            status: 200,
            data: {
              number: 777,
              is_merged: true,
              mergeable_state: "mergeable",
            },
          }),
        );
      if (cmd === "cnb" && args[0] === "pulls" && args[1] === "merge-pull")
        return ok(
          JSON.stringify({
            status: 200,
            data: {
              merged: true,
              sha: "906bce4c1a0b3f0d6a1c2b3e4f50617283a4b5c6",
            },
          }),
        );
      return ok("");
    };
    return { run, calls };
  }

  /** 会改动世界的命令形状 —— dry-run 一条都不许碰。 */
  const WRITE_SHAPES = [
    "git add",
    "git commit",
    "git push",
    "git checkout",
    "git fetch",
    /* 建分支与删分支都在这一族里：`git checkout -b` 动 HEAD、`git branch -D` 动 ref。
     * 前者被上面那条 `git checkout` 前缀覆盖，后者没有 —— 漏一条就等于给 dry-run
     * 留了一个「可以悄悄动 ref」的口子。 */
    "git branch -D",
    "cnb pulls post-pull",
    "cnb pulls merge-pull",
    /* 关一张单子是把状态写到别人也看得见、且不会自动回退的地方 —— 与合并同一档。 */
    "cnb issues update-issue",
    /* 杀进程是这一族里最不可逆的一格：dev server 里可能正跑着人没存的东西。 */
    "node scripts/reap-process.mjs",
  ];

  /** 把 `main` 的输出吞掉：这一组判的是**调用面**，不是它说了什么。
   *  `probeCnb` 也一并注入 —— 否则每条用例都会去探一遍真机的 PATH，
   *  结论就随「这台机器装没装 cnb」漂了。 */
  const quiet = {
    root: process.cwd(),
    log: () => undefined,
    probeCnb: () => true,
  };

  it("dry-run 不执行任何写动作（这才是它敢让人随手跑的理由）", async () => {
    const { run, calls } = fake();
    const code = await main({ ...quiet, run, args: ["--dry-run"] });
    expect(code).toBe(CODE.GREEN);
    for (const w of WRITE_SHAPES) {
      expect(
        calls.filter((c) => c.startsWith(w)),
        `dry-run 竟然执行了：${w}`,
      ).toHaveLength(0);
    }
    // 它仍然要读 —— 不读就没法给出计划。
    expect(calls.some((c) => c.includes("--abbrev-ref"))).toBe(true);
  });

  it("负控制：dry-run 不保证恒退 0 —— 在 master 上照样报阻塞", async () => {
    // 「恒退 0」这句已从声明里撤掉，因为一个会藏掉阻塞事实的预览比不预览更糟。
    // 这条用例钉的是撤完之后行为不再被文档反向拉扯。
    const { run } = fake({ branch: "master" });
    expect(await main({ ...quiet, run, args: ["--dry-run"] })).toBe(CODE.RED);
  });

  it("--dry-run + --branch：念出「不建分支」并把那一跳印进计划，一条 ref 都不动", async () => {
    const heard: string[] = [];
    const { run, calls } = fake({ branch: "master" });
    const code = await main({
      root: process.cwd(),
      run,
      log: (s: string) => heard.push(s),
      probeCnb: () => true,
      args: ["--dry-run", "--branch", "feat/new"],
    });
    const all = heard.join("\n");
    expect(code).toBe(CODE.GREEN);
    expect(all).toContain("不建分支");
    expect(all).toContain("$ git checkout -b feat/new");
    // 预览不许动 ref —— `git checkout` 与 `git branch -D` 都在 WRITE_SHAPES 里。
    for (const w of WRITE_SHAPES) {
      expect(
        calls.filter((c) => c.startsWith(w)),
        `dry-run 竟然执行了：${w}`,
      ).toHaveLength(0);
    }
  });

  it("真跑 + --branch：建分支那一跳真的执行，后面 push 用的就是新名字", async () => {
    const heard: string[] = [];
    const { run, calls } = fake({ branch: "master" });
    await main({
      root: process.cwd(),
      run,
      log: (s: string) => heard.push(s),
      probeCnb: () => true,
      args: ["--no-wait", "--branch", "feat/new"],
    });
    expect(calls).toContain("git checkout -b feat/new");
    expect(calls).toContain("git push -u cnb feat/new");
    expect(heard.join("\n")).toContain("已建并切到分支 feat/new");
    // 那句「不动本地 master 上可能存在的误提交」是这条链的边界，不是客套。
    expect(heard.join("\n")).toContain("reset --hard");
  });

  it("名字已被占用 ⇒ 退 2 且不 checkout（「建分支」不等于「覆盖别人的分支」）", async () => {
    const heard: string[] = [];
    const { run, calls } = fake({ branch: "master", refExists: true });
    const code = await main({
      root: process.cwd(),
      run,
      log: (s: string) => heard.push(s),
      probeCnb: () => true,
      args: ["--no-wait", "--branch", "feat/new"],
    });
    expect(code).toBe(CODE.NOT_RUN);
    expect(heard.join("\n")).toContain("已经存在");
    expect(calls.filter((c) => c.startsWith("git checkout"))).toEqual([]);
  });

  it("--only=clean-branch 不能单跑：它要的是合并那一段的验真结果", async () => {
    const heard: string[] = [];
    const { run, calls } = fake();
    const code = await main({
      root: process.cwd(),
      run,
      log: (s: string) => heard.push(s),
      probeCnb: () => true,
      args: ["--only=clean-branch", "--clean-branch"],
    });
    expect(code).toBe(CODE.NOT_RUN);
    expect(heard.join("\n")).toContain("不能单独跑");
    expect(calls.filter((c) => c.startsWith("git branch -D"))).toEqual([]);
  });

  it("整链跑通：合并验真之后才清理，且那句边界声明按这一轮实际做了什么来说", async () => {
    /* 这条补的是这一族的一处空白：此前没有任何一条用例跑通过
     * `preflight → 轮询 → 合并 → 清理`，所以「合并那一段说的话」与「清理那一段做的事」
     * 会不会互相矛盾，只有真跑一次才知道（而真跑那一次确实矛盾过 —— ISSUE #2145）。
     * ⚠️ 走完整链又要断退出码的格子必须**自带一份合并前证明**：`push` 那一段读不到
     * `comfy-premerge-proof.json` 就压 `NOT_RUN`，开发机上有、CI 节点上没有 ——
     * 这条第一版就是这样「本地绿、节点红」（同形先例见本文件 `proofRoot` 那段）。 */
    const { tmpRoot, gitDir } = proofRoot("chain-clean");
    try {
      const heard: string[] = [];
      const { run, calls } = fake({ chain: true });
      const code = await main({
        root: tmpRoot,
        run,
        log: (s: string) => heard.push(s),
        probeCnb: () => true,
        resolveGitDir: () => gitDir,
        args: ["--merge", "--clean-branch"],
      });
      const all = heard.join("\n");
      expect(all).toContain("已有开放 PR #777 ⇒ 复用");
      expect(all).toContain("is_merged=true");
      expect(all).not.toContain("没删");
      expect(all).toContain("交给下一段（--clean-branch）收");
      expect(code).toBe(CODE.GREEN);
      /* 顺序也是判点：清理必须在**验真**之后，否则删的就是这些提交唯一的对象。 */
      const at = (needle: string) =>
        calls.findIndex((c) => c.startsWith(needle));
      expect(at("cnb pulls merge-pull")).toBeGreaterThanOrEqual(0);
      expect(at("git push cnb --delete feat/x")).toBeGreaterThan(
        at("cnb pulls merge-pull"),
      );
      expect(calls.slice(at("git push cnb --delete feat/x") - 1)).toEqual([
        "git rev-parse --short feat/x",
        "git push cnb --delete feat/x",
        "git ls-remote --heads cnb feat/x",
        "git branch -D feat/x",
        "git show-ref --verify --quiet refs/heads/feat/x",
      ]);
      // 恢复线要真的带着那笔 sha，不然「可以恢复」是一句空话。
      expect(all).toContain("git branch feat/x edda13b6");
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("负控制：同一轮没给 --clean-branch ⇒ 那句「没删」照旧要念（边界声明不许被删掉）", async () => {
    const heard: string[] = [];
    const { run, calls } = fake({ chain: true });
    await main({
      root: process.cwd(),
      run,
      log: (s: string) => heard.push(s),
      probeCnb: () => true,
      args: ["--merge"],
    });
    const all = heard.join("\n");
    expect(all).toContain("远端分支**没删**（这一跳没要 --clean-branch）");
    expect(all).not.toContain("交给下一段");
    expect(calls.filter((c) => c.startsWith("git branch -D"))).toEqual([]);
  });

  it("没有 changelog.d 碎片 ⇒ 红（单 PR 单变更那条不成立）", async () => {
    const { run } = fake({ frags: [] });
    expect(await main({ ...quiet, run, args: ["--dry-run"] })).toBe(CODE.RED);
  });

  it("preflight 的暂存/未暂存读数按列判，不把未暂存改动算成已暂存（#2073）", async () => {
    /* 根因：`status --porcelain` 的 `XY <路径>` 两列，先 trim 就把行首空格吃掉，
     * 未暂存的 ` M file` 塌成 `M file` 被数成已暂存 —— 读数谎报，且「还有未暂存的
     * 改动」那句提醒永不触发。这里喂一组真实形状，断言分类按列、且提醒会触发。 */
    const heard: string[] = [];
    const { run } = fake({
      frags: [],
      porcelain: [
        " M README.md", // 改了没 add ⇒ 未暂存（已修改）
        "MM src/a.ts", // 又 add 又改 ⇒ 两边都算
        "A  src/b.ts", // 已暂存新增
        "?? untracked.log", // 未跟踪
      ].join("\n"),
    });
    await main({
      root: process.cwd(),
      run,
      log: (s: string) => heard.push(s),
      probeCnb: () => true,
      args: ["--dry-run"],
    });
    const line = heard.find((s) => s.includes("暂存")) ?? "";
    // 暂存 = `A` + `MM` = 2；未暂存（已修改）= ` M` + `MM` = 2；未跟踪 = `??` = 1。
    expect(line, `读数谎报：${line}`).toContain("暂存 2 项");
    expect(line).toContain("未暂存 2 项");
    expect(line).toContain("未跟踪 1 项");
    expect(heard.join("\n"), "未暂存改动存在却没提醒").toContain(
      "还有未暂存的改动",
    );
  });

  it("阶段 0 念出「单子」那一行，而它是读数：退码不因它改变", async () => {
    /* 默认夹具那份 `changelog.d/0-x.md` 不在盘上 ⇒ 只念「无号碎片 1 份」，
     * **不**指控没立案（首行读不到就不判）。这一条钉的两件事：读数在场、闸不在场。 */
    const heard: string[] = [];
    const { run } = fake();
    const code = await main({
      root: process.cwd(),
      run,
      log: (s: string) => heard.push(s),
      probeCnb: () => true,
      args: ["--dry-run"],
    });
    expect(code).toBe(CODE.GREEN);
    expect(heard.join("\n")).toContain("单子：（无） · 无号碎片 1 份");
    expect(heard.join("\n")).not.toContain("先立案");
  });

  it("盘上真有「## Fixed + 0-」那份碎片时点名先立案 —— 仍然退 0（这条不是闸）", async () => {
    const root = fragRoot({ "0-lazy-chunk.md": "## Fixed\n\n- 条目\n" });
    const heard: string[] = [];
    try {
      const { run } = fake({ frags: ["changelog.d/0-lazy-chunk.md"] });
      const code = await main({
        root,
        run,
        log: (s: string) => heard.push(s),
        probeCnb: () => true,
        args: ["--dry-run"],
      });
      const all = heard.join("\n");
      expect(all).toContain("0-lazy-chunk.md");
      expect(all).toContain("先立案");
      expect(
        code,
        "把这条做成闸，人就会去凑一张别人开着的单子（§13.10.8）",
      ).toBe(CODE.GREEN);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("基线引用不存在 ⇒ 退 2 并说「没有事实源」，**不许**退成「没有碎片」的红", async () => {
    /* 这一格钉的是「取不到」与「取到且为空」必须长得不一样 —— 而这一版就是在这里
     * 把两件事混成一件的：远端名写死 `origin`，`origin/master...HEAD` 那条 git 直接失败、
     * stdout 为空，于是 preflight 报「没有 changelog.d 碎片」（一条正当的假结论），
     * 而真原因是「这条比对没有事实源」。 */
    const heard: string[] = [];
    const { run } = fake({ frags: [], branchFrags: [], baseExists: false });
    const code = await main({
      root: process.cwd(),
      run,
      log: (s: string) => heard.push(s),
      probeCnb: () => true,
      args: ["--dry-run"],
    });
    const all = heard.join("\n");
    expect(code).toBe(CODE.NOT_RUN);
    expect(all).toContain("没有事实源");
    expect(all).not.toContain("单 PR 单变更那条不成立");
  });

  it("cnb 不在 ⇒ 平台那几段没有执行者 ⇒ 退 2，不是退 0", async () => {
    const { run, calls } = fake();
    expect(await main({ ...quiet, run, probeCnb: () => false, args: [] })).toBe(
      CODE.NOT_RUN,
    );
    // 本地动作照跑，但一个 cnb 平台调用都没发出去。
    expect(calls.some((c) => c.startsWith("cnb pulls"))).toBe(false);
    expect(calls.some((c) => c.startsWith("git push"))).toBe(true);
  });

  it("未知旗标 ⇒ 退 2 并停，不把它读成「没要那个动作」", async () => {
    const { run, calls } = fake();
    expect(await main({ ...quiet, run, args: ["--merg"] })).toBe(CODE.NOT_RUN);
    expect(calls).toHaveLength(0);
  });

  it("--only=poll / verdict / merge 拒绝单独跑（否则是一段没跑却退 0 的假绿灯）", async () => {
    for (const phase of ["poll", "verdict", "merge"]) {
      const { run, calls } = fake();
      expect(
        await main({ ...quiet, run, args: [`--only=${phase}`] }),
        `--only=${phase} 不该被当成「跑过了且没问题」`,
      ).toBe(CODE.NOT_RUN);
      expect(calls).toHaveLength(0);
    }
    // 反向：能单独跑的早期阶段不许被这条守卫误伤。
    const { run } = fake();
    expect(
      await main({ ...quiet, run, args: ["--only=preflight", "--dry-run"] }),
    ).toBe(CODE.GREEN);
  });

  it("提交被钩子拦下时，stderr 上的理由必须被转述出来", async () => {
    /* 这一条是本轮最重的回归。钩子把全部原因写在 **stderr**，而第一版只接 stdout ——
     * 屏幕上就只剩一句「提交被门槛拦下」而一个理由都没有。
     * 一个职责是「如实转述执行者」的工具，把执行者的话弄丢了，比没有这个工具更糟。 */
    const heard: string[] = [];
    const { run } = fake({
      dirty: ["src/a.ts"],
      commitStatus: 1,
      commitStderr: "[pre-commit] ✗ 组 C 失败（退出码 1）：tests/x.test.ts 红",
    });
    const code = await main({
      root: process.cwd(),
      run,
      log: (s: string) => heard.push(s),
      probeCnb: () => true,
      args: ["--message=x"],
    });
    const all = heard.join("\n");
    expect(code).toBe(CODE.RED);
    expect(all).toContain("组 C 失败");
    expect(all).toContain("tests/x.test.ts 红");
  });

  it("「单 PR 单变更」数的是本次带来的碎片，不是目录里躺着的全部", async () => {
    /* 第一版用 `git ls-files changelog.d` 数出了 118 份 —— 那条守卫于是恒真、
     * 等于没有，而它看起来像在判什么。现在只数本次工作树里新增/改动的。 */
    const heard: string[] = [];
    const { run } = fake({ frags: ["changelog.d/0-only-this.md"] });
    await main({
      root: process.cwd(),
      run,
      log: (s: string) => heard.push(s),
      probeCnb: () => true,
      args: ["--dry-run"],
    });
    expect(heard.join("\n")).toContain("碎片 1 份");
  });

  it("没有任何一段落下结论时不许退 0（--only=commit / push / pull-request 那一形）", async () => {
    /* 阶段 0 之外的每一段都嵌在 `want("preflight")` 里面，所以单跑这三段时
     * `codes` 是空数组，而 `combineShipCodes([])` 回 0 ⇒ 屏幕落出「全绿到终态」，
     * 实际一段都没跑。实测（拆分之前的同一入口）：
     * `node scripts/ship.mjs --only=commit --dry-run` 只打印那一句结论、退 0。 */
    for (const phase of ["commit", "push", "pull-request"]) {
      const heard: string[] = [];
      const { run, calls } = fake();
      expect(
        await main({
          root: process.cwd(),
          run,
          log: (s: string) => heard.push(s),
          probeCnb: () => true,
          args: [`--only=${phase}`],
        }),
        `--only=${phase} 一段都没跑，不该被读成「跑过了且没问题」`,
      ).toBe(CODE.NOT_RUN);
      /* 而且真的没伸手改世界：这三段各自的写动作一条都不该出现。 */
      expect(
        calls.filter((c) =>
          ["git commit", "git push", "cnb pulls post-pull"].some((w) =>
            c.startsWith(w),
          ),
        ),
        `--only=${phase} 伸出了写动作`,
      ).toEqual([]);
      expect(heard.join("\n")).toContain("没有任何一段落下结论");
    }
    /* 反向：正常跑完阶段 0 的那几条不许被这条守卫误伤。 */
    const { run } = fake();
    expect(
      await main({ ...quiet, run, args: ["--only=preflight", "--dry-run"] }),
    ).toBe(CODE.GREEN);
  });

  it("同一条分支上第二次跑（碎片已提交、工作树干净）不许被那条守卫拒掉", async () => {
    /* 这是把上一条从「恒真」改成「只看工作树」之后**新引入**的失效：
     * 第一次跑提交了碎片 ⇒ 工作树干净 ⇒ 只看工作树就恒假 ⇒
     * `pnpm ship --merge` 在 preflight 被拒（实测：exit 1「没有 changelog.d 碎片」）。
     * 正确的面是「分支相对上游已提交的 ∪ 还没提交的」，所以这一格必须读到 1 份。 */
    const heard: string[] = [];
    const { run } = fake({
      frags: [],
      branchFrags: ["changelog.d/0-already-committed.md"],
    });
    const code = await main({
      root: process.cwd(),
      run,
      log: (s: string) => heard.push(s),
      probeCnb: () => true,
      args: ["--dry-run"],
    });
    const all = heard.join("\n");
    expect(all).toContain("碎片 1 份");
    expect(all).not.toContain("没有 changelog.d/ 碎片");
    expect(code).toBe(CODE.GREEN);
  });

  it("上游就是这条分支自己的远端副本时，基线要退回主干而不是拿自己比自己", async () => {
    /* 现场（实测撞在 `pnpm ship --no-wait` 上）：`git push -u origin feat/x` 之后，
     * `@{u}` 变成 `origin/feat/x` —— 那是**这条分支自己**在远端的副本，不是主干。
     * 而 `resolveUpstream` 那一档①「有上游就用上游」不区分这两件事，于是
     * `git diff --name-only origin/feat/x...HEAD` 拿到**恒空**（自己与自己比），
     * 碎片那一查报 0 份 ⇒ 「单 PR 单变更不成立」⇒ 每次推送之后重新跑都会被拒，
     * 且理由听起来完全正当。上一那条用例只覆盖了「上游是主干」的形状，
     * 所以这一格当时没有被抓到。 */
    const heard: string[] = [];
    const { run } = fake({
      frags: [],
      branchFrags: ["changelog.d/0-already-committed.md"],
      upstream: "cnb/feat/x",
    });
    const code = await main({
      root: process.cwd(),
      run,
      log: (s: string) => heard.push(s),
      probeCnb: () => true,
      args: ["--dry-run"],
    });
    const all = heard.join("\n");
    expect(all, `基线取成了分支自己的副本 ⇒ ${all.split("\n")[0]}`).toContain(
      "基线 cnb/master",
    );
    expect(all).toContain("碎片 1 份");
    expect(code).toBe(CODE.GREEN);
  });

  it("远端没有 HEAD 符号引用时，退回 <远端>/master 并读得出是推的", async () => {
    const heard: string[] = [];
    const { run } = fake({
      frags: [],
      branchFrags: ["changelog.d/0-already-committed.md"],
      upstream: "cnb/feat/x",
      remoteHead: null,
    });
    await main({
      root: process.cwd(),
      run,
      log: (s: string) => heard.push(s),
      probeCnb: () => true,
      args: ["--dry-run"],
    });
    const all = heard.join("\n");
    expect(all).toContain("基线 cnb/master");
    expect(all).toContain("碎片 1 份");
  });

  it("提交信息走 argv 直传 —— 一个临时文件都不建", async () => {
    /* 原先的形状是「写一份 `.workbuddy/ship-commit-msg-<pid>.tmp` → `git commit -F`
     * → finally 回收」。回收已经修好了（见 git 历史），但**不建文件**比建了再删强：
     * 少一处落点，就少一处会忘、少一处依赖某个工具目录存在、也少一处
     * 「提交信息原文躺在盘上」。AGENTS 硬规则 12 把 `COMMIT_EDITMSG` 落进工作区
     * 点名为「提交完忘了删」的信号，这一改是往那个方向收。
     *
     * 断言选的是「什么都没建」而不是「建了又删干净」—— 后者要靠前置断言证明
     * 文件确实建过才不是空转，而前者直接就是这个设计的承诺。 */
    const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "ship-argv-msg-"));
    try {
      const { run, calls } = fake({
        dirty: ["src/a.ts"],
        commitStatus: 1,
        commitStderr: "[pre-commit] ✗ 组 C 失败",
      });
      const code = await main({
        root: tmpRoot,
        run,
        log: () => undefined,
        probeCnb: () => true,
        args: ['--message=第一行\n\n正文带换行与 "引号" 和 `反引号`'],
      });
      expect(code).toBe(CODE.RED);
      const commitCall = calls.find((c) => c.startsWith("git commit"));
      expect(commitCall, "没调到 git commit").toBeTruthy();
      expect(commitCall).toContain("--message=");
      expect(commitCall, "-F 那一套已经撤了").not.toContain("-F");
      // 一个文件都不该建（含隐藏目录）。
      expect(readdirSync(tmpRoot), "工作区里被建了东西").toEqual([]);
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("`--message` 被 `pnpm run` 压成一行时，停在提交之前并给出出口", async () => {
    /* 真发生的形状（实测）：`pnpm ship --message "一行<换行>二行"` 到 node 手里成了一条
     * 带字面量 `\n` 的单行 —— `pnpm run` 这一层改写的，`pnpm exec` 不改（同一份 argv 两条
     * 路径各跑一次对比过）。按原样提交会得一整行 subject，而 PR 标题就取
     * `git log -1 --pretty=%s` ⇒ 那样一份标题被平台拒（响应可解析、`data` 里没有号）。
     * 断言重点是**伸手之前**就停：`git add` 与 `git commit` 一条都不该出现 —— 既然这条
     * 信息不能原样进历史，就不该先把暂存面动过。 */
    const heard: string[] = [];
    const { run, calls } = fake({ dirty: ["src/a.ts"] });
    const code = await main({
      root: process.cwd(),
      run,
      log: (s: string) => heard.push(s),
      probeCnb: () => true,
      args: ["--message=标题\\n\\n正文一段\\n正文二段"],
    });
    const all = heard.join("\n");
    expect(code).toBe(CODE.RED);
    expect(calls.filter((c) => c.startsWith("git commit"))).toEqual([]);
    expect(calls.filter((c) => c.startsWith("git add"))).toEqual([]);
    expect(all).toContain("--message-file");
    expect(all).toContain("pnpm exec");
  });

  it("PR 正文落在 git 目录里，且用完一定被回收（含中途失败那条路径）", async () => {
    /* 提交信息已经不建文件了，PR 正文还得建（上千行会撞 Windows 32k argv 上限）。
     * 所以「finally 回收」这条保证仍要有对象 —— 不能因为少了一处就宣布不用测了。
     *
     * 选的路径仍是**会中途返回**的那条：post-pull 拿不到可解析响应 ⇒ 退 2。
     * 前置断言用「那个目录被建过」—— 否则「目录是空的」只是因为压根没写过。 */
    const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "ship-pr-body-"));
    const gitDir = path.join(tmpRoot, "gitdir", "comfy-ship-tmp");
    try {
      const { run } = fake();
      const code = await main({
        root: tmpRoot,
        run,
        log: () => undefined,
        probeCnb: () => true,
        resolveGitDir: () => path.join(tmpRoot, "gitdir"),
        args: [],
      });
      expect(code).toBe(CODE.NOT_RUN);
      expect(fs.existsSync(gitDir), "正文没写到 git 目录里").toBe(true);
      expect(readdirSync(gitDir), "临时文件没被回收").toEqual([]);
      // 工作区那一侧一个东西都不该有（落点全在 git 目录内）。
      expect(
        readdirSync(tmpRoot).filter((n) => n !== "gitdir"),
        "往工作区里写了东西",
      ).toEqual([]);
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  /** 让假执行者按命令**覆盖应答**，但记录照旧走 `fake()` 那一份。
   *  先 `base.run` 再覆盖 —— 反过来写会绕过记录，于是「断言它有没有伸出这条手」
   *  拿到的是空数组，看起来像「没伸手」，实际是我的量具没接上（这一格错过一次）。 */
  function overrideRun(
    base: ReturnType<typeof fake>,
    answers: Record<string, string>,
  ) {
    return (cmd: string, args: string[]): FakeResult => {
      const r = base.run(cmd, args);
      const key = args.join(" ");
      for (const [needle, stdout] of Object.entries(answers)) {
        if (cmd === "cnb" && key.includes(needle)) {
          return { status: 0, stdout, stderr: "", error: null };
        }
      }
      return r;
    };
  }

  /** 自带一份合并前证明的现场。
   *
   * `push` 那一段会读 `comfy-premerge-proof.json`，读不到就压上 `NOT_RUN` —— 开发机上它
   * 在（真推送过），CI 节点上没有，于是凡「断言走到 PR / 合并那一段的结论」的格子都会
   * **本地绿、节点红**（实测 #2064 第一条就这样）。凡要断退出码的走完整链的格子，都用这一份。 */
  function proofRoot(tag: string): { tmpRoot: string; gitDir: string } {
    const tmpRoot = mkdtempSync(path.join(os.tmpdir(), `ship-${tag}-`));
    const gitDir = path.join(tmpRoot, "gitdir");
    fs.mkdirSync(gitDir, { recursive: true });
    fs.writeFileSync(
      path.join(gitDir, "comfy-premerge-proof.json"),
      JSON.stringify({
        headSha: "d02ec96364d5f3713b77c91b0d3fe789878f1747",
        upstreamSha: "1c649c36b2b51cc7fc96141f8e26da2f5e88d9c3",
        verifiedAt: "2026-01-01T00:00:00.000Z",
        baselineRed: [],
      }),
      "utf8",
    );
    return { tmpRoot, gitDir };
  }

  it("建 PR 用的标题：取分支第一笔非常规提交，顶端那个合并节点不算", async () => {
    /* 与上面那格同一件事的执行侧：`git log -1 --pretty=%s` 在「先合 master 再 ship」
     * 与「最后补一笔碎片」两种走法下都会顶掉主体那一笔，而 PR 标题与 squash 那一行
     * 都从它取。夹具默认把顶端设成 `Merge branch 'master' into fix/x`。 */
    const { tmpRoot, gitDir } = proofRoot("title");
    try {
      const heard: string[] = [];
      const base = fake();
      const run = overrideRun(base, {
        "list-pulls": '{"status":200,"data":[]}',
        "post-pull": '{"status":201,"data":{"number":2999}}',
      });
      const code = await main({
        root: tmpRoot,
        run,
        log: (s: string) => heard.push(s),
        probeCnb: () => true,
        resolveGitDir: () => gitDir,
        args: ["--no-wait"],
      });
      const post = base.calls.find((c) => c.includes("post-pull")) ?? "";
      expect(post, "没建 PR，或标题没进 argv").toContain(
        "--title fix(x): 主体的那一笔",
      );
      expect(post).not.toContain("--title Merge branch");
      expect(heard.join("\n")).toContain("标题取自 branch-first");
      expect(code).toBe(CODE.GREEN);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("两处都取不到标题 ⇒ 不伸手建 PR，退 2 而不是建出一条没有标题的", async () => {
    /* 自带证明这一份现场（见 `proofRoot`），否则这里的 `NOT_RUN` 可能只是「缺证明」
     * 压上来的，断言就成了空转。 */
    const { tmpRoot, gitDir } = proofRoot("no-title");
    try {
      const heard: string[] = [];
      const base = fake({ branchSubjects: [], headSubject: "" });
      const run = overrideRun(base, {
        "list-pulls": '{"status":200,"data":[]}',
      });
      const code = await main({
        root: tmpRoot,
        run,
        log: (s: string) => heard.push(s),
        probeCnb: () => true,
        resolveGitDir: () => gitDir,
        args: ["--no-wait"],
      });
      expect(
        base.calls.some((c) => c.includes("post-pull")),
        '标题是空串也不该把 `--title ""` 发给平台',
      ).toBe(false);
      const all = heard.join("\n");
      expect(all).toContain("标题取自 none");
      expect(all).toContain("不建 PR");
      expect(code).toBe(CODE.NOT_RUN);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("显式 `--title` 压过推导，且来源读得出是 flag", async () => {
    const { tmpRoot, gitDir } = proofRoot("flag-title");
    try {
      const heard2: string[] = [];
      const base2 = fake();
      const run2 = overrideRun(base2, {
        "list-pulls": '{"status":200,"data":[]}',
        "post-pull": '{"status":201,"data":{"number":3001}}',
      });
      await main({
        root: tmpRoot,
        run: run2,
        log: (s: string) => heard2.push(s),
        probeCnb: () => true,
        resolveGitDir: () => gitDir,
        args: ["--no-wait", "--title=feat(z): 整条 PR 其实是这件事"],
      });
      expect(base2.calls.find((c) => c.includes("post-pull")) ?? "").toContain(
        "--title feat(z): 整条 PR 其实是这件事",
      );
      expect(heard2.join("\n")).toContain("标题取自 flag");
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("响应能解析但没有 PR 号时，不许念出「已建」—— 那句成功必须有号撑着", async () => {
    /* 实测踩过的外形：`cnb pulls post-pull` 的响应**能解析**、`data` 里却没有号
     * （第一次撞到它是 #2057：提交信息被 `pnpm run` 压成一整行，发出去的标题就是那一坨），
     * 而上一版先打印 `✓ 已建 PR #null` 再回来看值 —— 平台上根本没有那个 PR，
     * 屏幕上写着成功。所以这一格把「念出口」排在「验到有号」之后，并把响应原文
     * 与 stderr 一起转述出来：这一族宁可说一句「没跑起来」，也不许替执行者总结。 */
    const heard: string[] = [];
    const base = fake();
    const run = (cmd: string, args: string[]): FakeResult => {
      if (cmd === "cnb" && args.join(" ").includes("post-pull")) {
        return {
          status: 0,
          stdout: '{"status":400,"data":{"message":"title invalid"}}',
          stderr: "cnb: bad request",
          error: null,
        };
      }
      return base.run(cmd, args);
    };
    const code = await main({
      root: process.cwd(),
      run,
      log: (s: string) => heard.push(s),
      probeCnb: () => true,
      args: [],
    });
    const all = heard.join("\n");
    expect(all, "没有号却念了「已建」").not.toContain("已建 PR");
    expect(all).toContain("没有 PR 号");
    // 执行者的原话必须能看见 —— 只说一句「没有结论」等于把线索吞了。
    expect(all).toContain("title invalid");
    expect(all).toContain("bad request");
    expect(code).toBe(CODE.NOT_RUN);
  });
});
