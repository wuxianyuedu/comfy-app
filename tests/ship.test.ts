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
 *
 * ## `-t <字串>` 筛出来的绿不等于「这一组跑过了」
 *
 * vitest 5 里 `-t` **不跳过未命中的 `it()` 函数体**：未命中的用例是 `mode=skip` /
 * `result=null`（= **没跑**），而函数体照旧执行。于是「筛着跑一组」时，屏幕上那几行
 * `passed` 混着**根本没有断言过筛选目标**的绿 —— 拿它当证据就是在给「没测」发一张
 * 「测过了」的证书（§13.6.4.1 那条「拿不到测量 ≠ 测量结果是红的」的同族）。
 *
 * 所以本文件里新增的用例组在**第一步**就问 \`getCurrentTest()?.result?.state\`：
 * 不是 `skip` 才算真跑。判据只有这一份，不按 `mode` 判 —— 未命中与手写 `.skip`
 * 在 `mode` 上同形，而它们不该被同一句话盖住。
 */
import fs, { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, TestRunner } from "vitest";

/* 与 `ship-exec.mjs` 的 `ExecResult` 同形（`error` 是**必需**的：把它写成可选，
 * 注入时就过不了类型 —— 而那正是这层接缝唯一的形状约束）。放在模块层是因为
 * 不止一组假执行者要用它（后面的 `describe` 各自那份是局部收窄，不冲突）。 */
type FakeResult = {
  error: string | null;
  status: number;
  stderr: string;
  stdout: string;
};

/** `check-deps-freshness.mjs --json` 的「一致」读数（阶段 0 读它，见 ISSUE #2390）。 */
const FRESH_OK = JSON.stringify({
  code: 0,
  remoteChecked: true,
  remoteAgeMs: 1000,
  remoteDrifts: [],
  installDrift: null,
  envBroken: false,
});

import {
  asArray,
  buildSignature,
  pickBuildForSha,
  readBuildVerdict,
} from "../scripts/ship-build.mjs";
import {
  CODE,
  classifyPushFailure,
  combineShipCodes,
  decideCleanBranch,
  decideCreateBranch,
  deriveTitle,
  findMergedPullForHeadSha,
  findPullForBranch,
  looksNewlineMangled,
  parseSlug,
  planCommands,
  readFreshnessState,
  readPullCreateError,
  readPullVerdict,
  resolveUpstream,
} from "../scripts/ship-core.mjs";
import { runPushStage, runRerunCiStage } from "../scripts/ship-local.mjs";
/* 旗标层单独一份（ISSUE #2491）：这一族的用例读的是「命令行长什么样」，不是「执行者给了什么读数」。 */
import { parseArgs, parseIssueNumberToken } from "../scripts/ship-args.mjs";
import { buildPullBody, capDiffstat, PULL_BODY_LIMIT } from "../scripts/ship-pull-body.mjs";
import {
  claimNumbersFromTitle,
  closeIssues,
  decideCloseIssue,
  fetchPullMergeProof,
  findMergedPullProofs,
  issueNumbersFromText,
  pullTitleBody,
  referencedNotClaimed,
} from "../scripts/ship-close.mjs";
import {
  authorLabel,
  commentHeader,
  handlerLabel,
  issueAuthoring,
  issueItemShapes,
  participantLabel,
  readDevHandle,
  readDevHandleWithSource,
  ticketReading,
  withCommentHeader,
  whoamiLines,
} from "../scripts/ship-ticket.mjs";
import {
  claimComment,
  decideClaim,
  decideRelease,
  finishIssueWork,
  handleCommentState,
  releaseComment,
  runIssueAction,
} from "../scripts/ship-claim.mjs";
import { cleanBranch, createOrReusePull, reportVerdict } from "../scripts/ship-platform.mjs";
import { pollUntilTerminal } from "../scripts/ship-poll.mjs";
import { readIssueBody, runAppendIssueComment, runIssueComment } from "../scripts/ship-issue-new.mjs";
import { sameCommentBody, stripTrailingNewline } from "../scripts/ship-comment.mjs";
import { decideReap, instanceReading, reapCheckoutInstances } from "../scripts/ship-reap.mjs";
import { runPreflightStage } from "../scripts/ship-preflight.mjs";
import { DIAGNOSE_STALL_MINUTES, stallReadout } from "../scripts/ship-diagnose.mjs";
import { main } from "../scripts/ship.mjs";
import { EMPTY_COMMIT_ENV } from "../scripts/intentional-empty-commit.mjs";

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
    expect(readBuildVerdict({ data: { status: /** @type {any} */ 200 } }).state).toBe("unknown");
  });

  it("data.status 的三档：success / 终态失败 / 在跑", () => {
    expect(readBuildVerdict({ data: { status: "success" } }).state).toBe("green");
    for (const s of ["failed", "error", "cancelled", "canceled"]) {
      expect(readBuildVerdict({ data: { status: s } }).state).toBe("red");
    }
    for (const s of ["running", "pending", "queued", "waiting", "created"]) {
      expect(readBuildVerdict({ data: { status: s } }).state).toBe("running");
    }
    // 认不出的值不猜方向：unknown ⇒ 调用方退 2，而不是退 0 或退 1。
    expect(readBuildVerdict({ data: { status: "whatever" } }).state).toBe("unknown");
  });

  it("大小写不敏感（平台在 success / SUCCESS 之间换过写法）", () => {
    expect(readBuildVerdict({ data: { status: "SUCCESS" } }).state).toBe("green");
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
    const builds = [{ sn: "cnb-x", event: "pull_request", sha: OTHER, createTime: "z" }];
    expect(pickBuildForSha(builds, MINE)).toBeNull();
  });

  it("event 不是 pull_request 的不算（同一 sha 可能是 push / 每日档）", () => {
    const builds = [{ sn: "cnb-daily", event: "push", sha: MINE, createTime: "z" }];
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
    expect(combineShipCodes([CODE.GREEN, CODE.RED, CODE.NOT_RUN])).toBe(CODE.NOT_RUN);
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
    expect(parseArgs(["--add", "a.ts", "--add=b.md"]).adds).toEqual(["a.ts", "b.md"]);
    /* `--title` 两种写法同样要收 —— 它是标题那格的显式出口，
     * 而 `--add` 那一族曾因为一次替换整块丢掉过一条分支。 */
    expect(parseArgs(["--title", "feat(a): 人给的标题"]).title).toBe("feat(a): 人给的标题");
    expect(parseArgs(["--title=feat(b): 等号写法"]).title).toBe("feat(b): 等号写法");
    expect(parseArgs([]).title).toBeNull();
  });

  it("--no-wait 与 --only 各自独立", () => {
    expect(parseArgs(["--no-wait"]).wait).toBe(false);
    expect(parseArgs(["--only=poll"]).only).toBe("poll");
  });

  it("--comment 两种写法都收号；--body-file 与它各自独立（拼错不许静默）", () => {
    expect(parseArgs([]).comment).toBeNull();
    expect(parseArgs(["--comment", "2719"]).comment).toBe(2719);
    expect(parseArgs(["--comment=#2719"]).comment).toBe(2719);
    expect(parseArgs(["--comment", "abc"]).comment).toBeNull();
    expect(parseArgs(["--comment", "abc"]).commentBad).toEqual(["abc"]);
    /* 第二次不静默覆盖：那会把「写两张单」读成「写最后那张」。 */
    expect(parseArgs(["--comment", "2719", "--comment", "2720"]).commentBad.length).toBe(1);
    expect(parseArgs(["--body-file", ".git/c.md"]).bodyFile).toBe(".git/c.md");
    expect(parseArgs(["--body-file=.git/c.md"]).bodyFile).toBe(".git/c.md");
    expect(parseArgs(["--commentt"]).unknown).toEqual(["--commentt"]);
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

  it("--whoami 默认关；拼错进 unknown（自查口不该被一个 typo 静默变成整条 ship）", () => {
    expect(parseArgs([]).whoami).toBe(false);
    expect(parseArgs(["--whoami"]).whoami).toBe(true);
    expect(parseArgs(["--who-am-i"]).unknown).toEqual(["--who-am-i"]);
  });
});

describe("issueNumbersFromText：只从标题本体取，绝不从拼完 PR 号的那一整行取", () => {
  it("(#2070) 与 #2070 两种写法都认，按出现顺序去重", () => {
    expect(issueNumbersFromText("fix(a): 修一格 (#2070)")).toEqual([2070]);
    expect(issueNumbersFromText("fix(a): 修一格 #2070 与 #2096")).toEqual([2070, 2096]);
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

/**
 * 「这行文字里出现过哪些号」与「这一轮认领了哪张单」是两个问题（ISSUE #2646）。
 *
 * 上面那组用例留着不删是刻意的：`issueNumbersFromText` 仍在被用
 * （`referencedNotClaimed` 拿它当全集），把全集一起收窄等于连「这里有处引用」那半句
 * 信息也丢掉 —— 收窄只发生在**认领**这一刀上。
 */
describe("claimNumbersFromTitle / referencedNotClaimed：认领形态与正文引用分开", () => {
  it("认领只认 (#号)，裸写的那一半落进「引用」", () => {
    /* 这就是 PR #2642 的原始标题形状：那一次 `#730` 被连带推定成本轮的单子去关，
     * 靠它 10-04 就 closed 才只是 no-op。 */
    const title = "test(gates): #730 那格改判 oxfmt 的忽略面 (#2603)";
    expect(claimNumbersFromTitle(title)).toEqual([2603]);
    expect(referencedNotClaimed(title)).toEqual([730]);
    expect(issueNumbersFromText(title)).toEqual([730, 2603]);
  });

  it("全是裸写 ⇒ 一个认领都没有（这种标题只能靠人点名，不能靠推定）", () => {
    expect(claimNumbersFromTitle("fix(a): 修 #2070 与 #2096")).toEqual([]);
    expect(referencedNotClaimed("fix(a): 修 #2070 与 #2096")).toEqual([2070, 2096]);
  });

  it("括号里带空格的写法也认，且去重照旧", () => {
    expect(claimNumbersFromTitle("修 ( #2070 ) 再修 (#2070)")).toEqual([2070]);
    expect(claimNumbersFromTitle("")).toEqual([]);
  });

  it("decideCloseIssue 那一层：裸写的号不进待关集合", () => {
    const d = decideCloseIssue({
      requested: true,
      landedVerified: true,
      title: "test(gates): #730 那格 (#2603)",
      explicit: [],
    });
    expect(d.act).toBe(true);
    expect(d.numbers).toEqual([2603]);
  });

  it("反面的反面：人点名过的号即使标题里是裸写也照关 —— 收窄针对推定，不针对显式动作", () => {
    const d = decideCloseIssue({
      requested: true,
      landedVerified: true,
      title: "test(gates): #730 那格",
      explicit: [730],
    });
    expect(d.numbers).toEqual([730]);
    expect(d.sources.get(730)).toContain("人点名");
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
    expect(decideCreateBranch({ requested: "feat/x", current: "master" })).toEqual({
      requested: true,
      act: true,
      code: null,
      branch: "feat/x",
      reason: "",
    });
  });

  it("游离 HEAD 也算「没有可用分支」（硬规则 6 那一格过去就是这么判的）", () => {
    expect(decideCreateBranch({ requested: "feat/x", current: "HEAD" }).act).toBe(true);
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

describe("classifyPushFailure：push 失败按原话分型，不固定猜 premerge（ISSUE #2825）", () => {
  /* 远端 128 的现场逐字读数（2026-10-31，fix/2823 分支首次 push）：premerge 根本没跑，
   * 旧话术「多半是 pre-push 的合并前复算没放行」把人引去查一条没执行的门禁。 */
  const REMOTE_404_STDERR = [
    "remote: Repository Not Found.",
    "remote: 仓库不存在。",
    "remote: ",
    "remote: trace-id: 271f06a8c6324b9ea1154fa08b1ff7da",
    "remote: token: d5***********************BH",
    "fatal: repository 'https://cnb.cool/moon-read/comfy-app-t3/' not found",
  ].join("\n");

  it("远端 404 现场 ⇒ remote，且不再落「多半是 premerge」那条固定猜测", () => {
    const got = classifyPushFailure("", REMOTE_404_STDERR);
    expect(got.kind).toBe("remote");
    expect(got.note).toContain("凭据");
    /* 禁的是**误导归因的形状**（固定猜测「多半是…复算没放行」），不是 premerge 这个词
     * —— remote 话术里「premerge 与本仓门禁都无关」是正确内容，要留着。 */
    expect(got.note).not.toContain("多半是");
    expect(got.note).not.toContain("复算没放行");
  });

  it("无凭据形态（terminal prompts disabled）也归 remote", () => {
    const got = classifyPushFailure(
      "",
      "fatal: could not read Username for 'https://cnb.cool': terminal prompts disabled",
    );
    expect(got.kind).toBe("remote");
  });

  it("钩子拒绝现场 ⇒ hook（premerge 复算红的原话在上面）", () => {
    const got = classifyPushFailure(
      "",
      [
        "[pre-push] ✗ 合并前复算红了，本次 push 不放行：",
        "      · tsc --noEmit",
        "error: failed to push some refs to 'https://cnb.cool/moon-read/comfy-app-t3'",
      ].join("\n"),
    );
    expect(got.kind).toBe("hook");
    expect(got.note).toContain("pre-push");
  });

  it("两类特征同时在场 ⇒ 仍判 remote（钩子放行后传输被拒，终止原因是远端）", () => {
    const got = classifyPushFailure(
      "",
      "[pre-push] ✓ 合并前复算全绿\n" + REMOTE_404_STDERR,
    );
    expect(got.kind).toBe("remote");
  });

  it("空 / 没有特征的输出 ⇒ unknown，不编因（unknown 的话术不点名任何一侧）", () => {
    for (const [out, err] of [
      ["", ""],
      [null, undefined],
      ["", "error: failed to push some refs to 'https://example/x'"],
    ]) {
      const got = classifyPushFailure(out, err);
      expect(got.kind).toBe("unknown");
      expect(got.note).not.toContain("premerge");
      expect(got.note).not.toContain("凭据");
    }
  });

  it("接线判据：runPushStage 真把分型话术念出来（不再固定说 premerge）", () => {
    const logs: Array<string> = [];
    let pushed = 0;
    const ctx = {
      up: { remote: "origin" },
      branch: "fix/x",
      root: "/tmp/nowhere",
      resolveDir: () => null,
      log: (s: string) => logs.push(s),
      run: () => {
        pushed += 1;
        return { status: 128, stdout: "", stderr: REMOTE_404_STDERR };
      },
      relay: () => undefined,
    };
    const got = runPushStage(ctx);
    expect(pushed).toBe(1);
    expect(got).toEqual({ stop: true, codes: [CODE.RED] });
    const line = logs.join("\n");
    expect(line).toContain("push 失败（exit 128）");
    expect(line).toContain("远端拒了");
    expect(line).not.toContain("多半是 pre-push");
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
  /** 按 cnb 的子命令答；`calls` 记录每一次伸手。 */
  function io(opts: {
    body?: string;
    closedAt?: string | null;
    merged?: Array<{ is_merged: boolean; number: number; title: string }>;
    /** `--as-merged` 那条凭据 PR 的回读形状（ISSUE #2491）：`null` = 取不到（非 JSON）。 */
    pull?: { is_merged?: boolean; title?: string } | null;
    state?: string;
    stateReason?: string | null;
    update?: string | null;
  }) {
    const calls: Array<string> = [];
    const log: Array<string> = [];
    const json = (data: unknown) =>
      JSON.stringify({ status: 200, contentType: "application/json", data });
    const run = (_cmd: string, args: Array<string>): FakeResult => {
      calls.push(args.join(" "));
      if (args[0] === "pulls" && args[1] === "get-pull") {
        if (opts.pull === null || opts.pull === undefined) {
          return { status: 0, stdout: "", stderr: "", error: null };
        }
        return {
          status: 0,
          stdout: json({ number: 2487, ...opts.pull }),
          stderr: "",
          error: null,
        };
      }
      if (args[0] === "pulls" && args[1] === "list-pulls") {
        return {
          status: 0,
          stdout: json(opts.merged ?? []),
          stderr: "",
          error: null,
        };
      }
      if (args[0] === "issues" && args[1] === "update-issue") {
        if (opts.update === null) {
          return { status: 0, stdout: "boom", stderr: "", error: null };
        }
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
            /* 不给 `body` 时**不补空串** —— 「回读里没这一格」与「正文是空的」是两件事，
             * 后者可以念成零条，前者不行（#2251）。 */
            ...(opts.body === undefined ? {} : { body: opts.body }),
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

  it("正文里还列着条目 ⇒ 念出形态读数，退码一次也不动（是读数不是闸，#2251）", () => {
    /* 「处置了几条」机器读不出来，但「正文里数得出几条」能。这一格钉的不是数字，
     * 是**方向**：unchecked > 0 时退码必须仍是 GREEN —— 做成闸就会逼人把正文删短来凑数
     * （与 §13.10.9 那句「随手挂一张别人的单子」同型）。 */
    const f = io({
      body: "### 红的那两条\n- [ ] 体积那条\n- [ ] 预算那条\n- [x] 已经修掉的\n1. 待确认的警告\n",
    });
    const code = closeIssues({
      run: f.run,
      log: (l) => f.log.push(l),
      slug: "org/repo",
      closeIssue: true,
      landed: landedOk,
    });
    const all = f.log.join("\n");
    expect(all).toContain("小节 1");
    expect(all).toContain("未勾 2/已勾 1");
    expect(all).toContain("序号 1");
    expect(all).toContain("不改退码");
    expect(code).toBe(CODE.GREEN);
  });

  it("回读里没有正文那一格 ⇒ 念「正文没读到」，不许念成「零条」", () => {
    const f = io({});
    const code = closeIssues({
      run: f.run,
      log: (l) => f.log.push(l),
      slug: "org/repo",
      closeIssue: true,
      landed: landedOk,
    });
    const all = f.log.join("\n");
    expect(all).toContain("正文没读到");
    expect(all).not.toContain("小节 0");
    expect(code).toBe(CODE.GREEN);
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

  /* ── 补关通道（ISSUE #2199）：人点名的号，前提换成「平台查得到落地证明」 ── */

  it("补关：平台查得到它随某条已合并 PR 落地 ⇒ 关它并回读（来源要念出来）", () => {
    const f = io({
      merged: [
        {
          number: 2182,
          is_merged: true,
          title: "fix(ci): 四条判据 (#2179) (#2182)",
        },
      ],
    });
    const code = closeIssues({
      run: f.run,
      log: (l) => f.log.push(l),
      slug: "org/repo",
      closeIssue: true,
      landed: null,
      explicit: [2179],
    });
    expect(code).toBe(CODE.GREEN);
    expect(f.calls.some((c) => c.includes("list-pulls"))).toBe(true);
    expect(f.calls.some((c) => c.includes("update-issue") && c.includes("2179"))).toBe(true);
    expect(f.log.join("\n")).toContain("落地证明是已合并的 PR #2182");
  });

  it("补关：查不到落地证明 ⇒ 2，且**一次写动作都不发**", () => {
    const f = io({ merged: [] });
    const code = closeIssues({
      run: f.run,
      log: (l) => f.log.push(l),
      slug: "org/repo",
      closeIssue: true,
      landed: null,
      explicit: [2179],
    });
    expect(code).toBe(CODE.NOT_RUN);
    expect(f.calls.filter((c) => c.includes("update-issue"))).toEqual([]);
    expect(f.log.join("\n")).toContain("查不到");
    expect(f.log.join("\n")).not.toContain("手动");
  });

  /**
   * `--as-merged` 落在这一格，因为它改的是「凭什么关」那一条前提（ISSUE #2491）。
   *
   * 三态各有出口：`true` ⇒ 关；`false` ⇒ 退 1（前提被平台推翻，那是**事实**，不是没跑起来）；
   * 取不到 ⇒ 退 2（既不关也不判它没合并）。每格都同时问「写动作发没发」与「退码是几」——
   * 只钉一侧的话，「念成 2 让人去重跑」和「念成 0 就是假完成」这两种误读会漏掉一种。
   */
  describe("#2491 --as-merged：凭据由人点名，合并与否仍由平台回读", () => {
    it("点名的 PR 回读 is_merged=true ⇒ 关，且**不再**扫「已合并 PR」那份列表", () => {
      const f = io({
        pull: {
          is_merged: true,
          title: "fix(e2e): 对齐换页后的 /models (#2487)",
        },
      });
      const code = closeIssues({
        run: f.run,
        log: (l) => f.log.push(l),
        slug: "org/repo",
        closeIssue: true,
        landed: null,
        explicit: [2488],
        asMerged: 2487,
      });
      expect(code, f.log.join("\n")).toBe(CODE.GREEN);
      expect(f.calls.some((c) => c.includes("update-issue"))).toBe(true);
      /* 有了点名的凭据就不必再反查列表 —— 那一路正是这张单**结构上**走不通的那条。
       * 断言「没扫」而不是「扫了也没关系」：留着那趟扫描会把两条凭据混成一句读得通的话。 */
      expect(f.calls.some((c) => c.includes("list-pulls"))).toBe(false);
      const text = f.log.join("\n");
      expect(text).toContain("is_merged=true");
      expect(text).toContain("PR #2487");
      expect(text).toContain("state=closed");
    });

    it("点名的 PR 回读 is_merged=false ⇒ 退 **1**（前提被推翻），一张也不关", () => {
      const f = io({
        pull: { is_merged: false, title: "fix(x): 还没人审 (#2487)" },
      });
      const code = closeIssues({
        run: f.run,
        log: (l) => f.log.push(l),
        slug: "org/repo",
        closeIssue: true,
        landed: null,
        explicit: [2488],
        asMerged: 2487,
      });
      /* 这一格落红而不是 2 是有意的：命令跑起来了、平台也答了，答案是「那条 PR 没合并」。
       * 念成 2 会让人去重跑，念成 0 就是假完成 —— 两头都不许。 */
      expect(code, f.log.join("\n")).toBe(CODE.RED);
      expect(f.calls.filter((c) => c.includes("update-issue"))).toEqual([]);
      expect(f.log.join("\n")).toContain("前提不成立");
    });

    it("那条 PR 取不到读数 ⇒ 退 **2**，既不关也不判它没合并", () => {
      const f = io({ pull: null });
      const code = closeIssues({
        run: f.run,
        log: (l) => f.log.push(l),
        slug: "org/repo",
        closeIssue: true,
        landed: null,
        explicit: [2488],
        asMerged: 2487,
      });
      expect(code, f.log.join("\n")).toBe(CODE.NOT_RUN);
      expect(f.calls.filter((c) => c.includes("update-issue"))).toEqual([]);
      expect(f.log.join("\n")).toContain("没有结论");
    });
  });

  /**
   * 引用与认领是两件事（ISSUE #2646）。
   *
   * 现场是本轮自己撞的：PR #2642 的标题 `test(gates): #730 那格改判 oxfmt 的忽略面…(#2603)`
   * 让 `#730` 也被推定成本轮的单子去关 —— 那次纯属运气（它 10-04 就 closed，重复关是
   * no-op），换成一张在世的单就是**静默关掉别人的单子**，而 `update-issue` 的包装退出码
   * 照旧 0。下面三条按「贵的顺序」排：先钉不关（后果最重），再钉念出来（可审计性），
   * 最后钉人点名那条路没被收窄误伤（撤便利不撤能力）。
   */
  describe("标题正文里的裸 #号 不算认领凭证（ISSUE #2646）", () => {
    const mixedTitleLanded = {
      title: "test(gates): #730 那格改判忽略面 (#2603)",
      sha: "abc1234",
      verified: true,
    };

    it("只关 (#2603)，#730 一次都不碰", () => {
      const f = io({});
      const code = closeIssues({
        run: f.run,
        log: (l) => f.log.push(l),
        slug: "org/repo",
        closeIssue: true,
        landed: mixedTitleLanded,
      });
      expect(code, f.log.join("\n")).toBe(CODE.GREEN);
      const updates = f.calls.filter((c) => c.includes("update-issue"));
      /* 「一次都不碰」要数调用次数，不能只看没报错：多关一张单子在退出码上是零成本。 */
      expect(updates).toHaveLength(1);
      expect(updates[0]).toContain("--number 2603");
      expect(updates.join("\n")).not.toContain("--number 730");
    });

    it("那句「没关」要念出来 —— 静默不关与静默关掉，读者读到的是同一种「不知道处理过没有」", () => {
      const f = io({});
      closeIssues({
        run: f.run,
        log: (l) => f.log.push(l),
        slug: "org/repo",
        closeIssue: true,
        landed: mixedTitleLanded,
      });
      const all = f.log.join("\n");
      expect(all).toContain("标题引用了 #730");
      expect(all).toContain("没关");
      /* 出口要给全：只说「没关」而不说怎么才能关，读者会以为这是脚本漏了什么。 */
      expect(all).toContain("--close-issue 730");
    });

    it("人点名仍然算 —— 收窄只针对**推定**，不针对显式动作（硬规则 28 第一条）", () => {
      const f = io({});
      const code = closeIssues({
        run: f.run,
        log: (l) => f.log.push(l),
        slug: "org/repo",
        closeIssue: true,
        landed: { title: "test(gates): 一格没有括号号", sha: "", verified: true },
        explicit: [730],
      });
      expect(code, f.log.join("\n")).toBe(CODE.GREEN);
      expect(f.calls.filter((c) => c.includes("update-issue"))).toHaveLength(1);
      expect(f.calls[0]).toContain("--number 730");
    });
  });
});

/**
 * `--as-merged`（ISSUE #2491）的**函数层与入口层**：回读三态、旗标两种写法、误用当场拒。
 *
 * 动作面那三格（`closeIssues` 关不关、发没发写请求）嵌在上面那个 describe 里 —— 它共用
 * 那一格的假执行者 `io`，抄第二份就是本仓那条「同一段样板被抄了 N 遍」的反面。
 * 这一族要防的是两个方向相反的误读：把「按标题反查不到」当「没落地」（于是每日档自动立案的
 * 单子永远关不掉，只能人工绕行），以及为了关掉它而接受人的一句「它就是随那条 PR 落的」
 * （那正是 `--force-close` 的形态，`ship-close.mjs` 文件头第 3 条不许明确禁止）。
 */
describe("#2491 --as-merged：凭据由人点名，合并与否仍由平台回读", () => {
  it("fetchPullMergeProof：三态之外还认得「标题尾数是 PR 号」那一坑", () => {
    const ok = (data: unknown): FakeResult => ({
      status: 0,
      stdout: JSON.stringify({ status: 200, data }),
      stderr: "",
      error: null,
    });
    const base = { run: () => ok({}), slug: "org/repo", prNumber: 2487 };
    expect(
      fetchPullMergeProof({
        ...base,
        run: () => ok({ is_merged: true, title: "fix(x): … (#2487)" }),
      }),
    ).toEqual({
      state: "merged",
      title: "fix(x): …",
      prNumber: 2487,
    });
    expect(fetchPullMergeProof({ ...base, run: () => ok({ is_merged: false }) }).state).toBe(
      "not-merged",
    );
    /* 「回读里没有 is_merged 那一格」不能读成 false：那是没有结论，不是前提被推翻。 */
    expect(fetchPullMergeProof({ ...base, run: () => ok({ title: "x" }) }).state).toBe(
      "unreadable",
    );
    expect(
      fetchPullMergeProof({
        ...base,
        run: () => ({ status: 0, stdout: "boom", stderr: "", error: null }),
      }).state,
    ).toBe("unreadable");
  });

  it("parseArgs：两种写法共用一处；不像号与重复都进 bad，不静默收下", () => {
    expect(parseArgs(["--as-merged", "2487"]).asMerged).toBe(2487);
    expect(parseArgs(["--as-merged=2487"]).asMerged).toBe(2487);
    expect(parseArgs(["--as-merged", "#2487"]).asMerged).toBe(2487);
    expect(parseArgs(["--as-merged", "标题粘错了"]).asMergedBad).toEqual(["标题粘错了"]);
    expect(parseArgs(["--as-merged"]).asMergedBad).toEqual(["(缺号)"]);
    /* 个位数不进（`parseIssueNumberToken` 的下限是 2 位）：把 `--as-merged 7` 读成
     * 「存在第 7 号 PR」比多问一句贵。*/
    expect(parseArgs(["--as-merged=7"]).asMergedBad).toEqual(["7"]);
    expect(parseArgs(["--as-merged=2487", "--as-merged=2489"]).asMergedBad).toEqual([
      "重复的 --as-merged（前一条 #2487）",
    ]);
    expect(parseArgs(["--as-merged=2487", "--as-merged=2489"]).asMerged).toBe(2487);
    expect(parseArgs([]).asMerged).toBeNull();
  });

  it("`--as-merged` 没带 `--close-issue` ⇒ 退 2：它没有执行者，不能留一句沉默", async () => {
    const calls: Array<string> = [];
    const log: Array<string> = [];
    const run = (cmd: string, args: Array<string>): FakeResult => {
      calls.push([cmd, ...args].join(" "));
      if (cmd === "cnb" && args[0] === "--version") {
        return { status: 0, stdout: "1.15.25", stderr: "", error: null };
      }
      return { status: 0, stdout: "", stderr: "", error: null };
    };
    const code = await main({
      args: ["--as-merged", "2487"],
      env: {},
      run,
      log: (l: string) => log.push(l),
    });
    expect(code).toBe(CODE.NOT_RUN);
    expect(log.join("\n")).toContain("没有任何执行者");
    /* 这一格一次写动作都不该发：它连「要关哪张」都还没拿到。 */
    expect(calls.filter((c) => /update-issue|merge-pull|git push|git commit/.test(c))).toEqual([]);
  });
});

describe("#2199 --close-issue 收号：三种写法都认，不像号的 token 当场点名", () => {
  it("裸旗标保持今天的行为：号从标题取，一个 token 都不收", () => {
    const o = parseArgs(["--close-issue"]);
    expect(o.closeIssue).toBe(true);
    expect(o.closeIssueNumbers).toEqual([]);
    expect(o.closeIssueBad).toEqual([]);
  });

  it("空格分隔：2179 / #2179 / 多个号；后面的旗标不被吞掉", () => {
    expect(parseArgs(["--close-issue", "2179"]).closeIssueNumbers).toEqual([2179]);
    expect(parseArgs(["--close-issue", "#2179"]).closeIssueNumbers).toEqual([2179]);
    const many = parseArgs(["--close-issue", "2179", "2186", "--clean-branch"]);
    expect(many.closeIssueNumbers).toEqual([2179, 2186]);
    expect(many.cleanBranch).toBe(true);
  });

  it("等号写法：逗号与空白都切开", () => {
    expect(parseArgs(["--close-issue=2179,2186"]).closeIssueNumbers).toEqual([2179, 2186]);
    expect(parseArgs(["--close-issue=#2179 2186"]).closeIssueNumbers).toEqual([2179, 2186]);
  });

  it("不像号 ⇒ 记进 bad 并**停手**，不吞后面的旗标", () => {
    const o = parseArgs(["--close-issue", "abc", "--merge"]);
    expect(o.closeIssueBad).toEqual(["abc"]);
    expect(o.closeIssueNumbers).toEqual([]);
    expect(o.merge).toBe(true);
  });

  it("负控制：单个数字不像号（那是打错，不是一张一号单子）", () => {
    expect(parseArgs(["--close-issue", "1"]).closeIssueBad).toEqual(["1"]);
    expect(parseIssueNumberToken("2179")).toBe(2179);
    expect(parseIssueNumberToken("#2179")).toBe(2179);
    expect(parseIssueNumberToken("#")).toBeNull();
  });
});

describe("#2199 两条通道：前提不同，落地证明是同一条线", () => {
  it("本轮已验真 ⇒ 标题号 + 人点名的号并集去重，来源分开标", () => {
    const d = decideCloseIssue({
      requested: true,
      landedVerified: true,
      title: "fix(a): 一格 (#2070)",
      explicit: [2070, 2179],
    });
    expect(d.act).toBe(true);
    expect(d.numbers).toEqual([2070, 2179]);
    expect(d.sources.get(2070)).toContain("本轮");
    expect(d.sources.get(2179)).toContain("人点名");
  });

  it("本轮没合并 + 查得到落地证明 ⇒ 只关查得到的那张", () => {
    const proofs = new Map([[2179, { prNumber: 2182, title: "fix(ci): 四条判据 (#2179)" }]]);
    const d = decideCloseIssue({
      requested: true,
      landedVerified: false,
      title: "",
      explicit: [2179, 2200],
      proofs,
      proofScanned: 12,
    });
    expect(d.act).toBe(true);
    expect(d.numbers).toEqual([2179]);
    expect(d.unproven).toEqual([2200]);
    expect(d.sources.get(2179)).toContain("#2182");
  });

  it("本轮没合并 + 查不到 ⇒ 2，话术是「不构成结论」，**不含「手动」**", () => {
    const d = decideCloseIssue({
      requested: true,
      landedVerified: false,
      title: "",
      explicit: [2179],
      proofs: new Map(),
      proofScanned: 40,
    });
    expect(d.act).toBe(false);
    expect(d.code).toBe(CODE.NOT_RUN);
    expect(d.unproven).toEqual([2179]);
    expect(d.reason).toContain("最近 40");
    expect(d.reason).not.toContain("手动");
  });

  it("取不到那份列表 ⇒ 2（不是 0），也不念成「查不到」", () => {
    const d = decideCloseIssue({
      requested: true,
      landedVerified: false,
      title: "",
      explicit: [2179],
      proofRan: false,
    });
    expect(d.code).toBe(CODE.NOT_RUN);
    expect(d.reason).toContain("没有结论");
    expect(d.reason).not.toContain("查不到");
  });
});

describe("#2199 pullTitleBody：先剥掉平台追加的 PR 尾数，再提号", () => {
  it("只剥末尾那个 (#PR号)，中间的 (#单号) 原样留着", () => {
    expect(pullTitleBody("fix(a): 一格 (#2070) (#2182)", 2182)).toBe("fix(a): 一格 (#2070)");
    expect(pullTitleBody("fix(a): 一格 (#2070)", 2182)).toBe("fix(a): 一格 (#2070)");
  });

  it("负控制：PR 号不是纯数字 ⇒ 原样返回（不拿别人的输入去构造正则）", () => {
    expect(pullTitleBody("x (#1)", "1)(.*")).toBe("x (#1)");
  });
});

describe("#2199 findMergedPullProofs：只认 is_merged，先剥尾数再找号", () => {
  function io(pages: Array<Array<unknown>>, opts: { fail?: boolean } = {}) {
    const calls: Array<string> = [];
    const run = (_c: string, args: Array<string>): FakeResult => {
      calls.push(args.join(" "));
      if (opts.fail) {
        return { status: 9, stdout: "", stderr: "", error: null };
      }
      const page = Number(args[args.indexOf("--page") + 1]);
      const data = pages[page - 1] ?? [];
      return {
        status: 0,
        stdout: JSON.stringify({ status: 200, data }),
        stderr: "",
        error: null,
      };
    };
    return { run, calls };
  }

  it("命中：那条已合并 PR 的标题本体里真有这个号", () => {
    const f = io([
      [
        {
          number: 2182,
          is_merged: true,
          title: "fix(ci): 四条判据 (#2179) (#2182)",
        },
        { number: 2170, is_merged: false, title: "没合的 PR (#2199)" },
      ],
    ]);
    const r = findMergedPullProofs({
      run: f.run,
      slug: "o/r",
      numbers: [2179],
    });
    expect(r.ran).toBe(true);
    expect(r.scanned).toBe(1);
    expect(r.proofs.get(2179)).toEqual({
      prNumber: 2182,
      title: "fix(ci): 四条判据 (#2179)",
    });
  });

  it("负控制：PR 自己的号不能被当成单子号", () => {
    const f = io([[{ number: 2179, is_merged: true, title: "chore(x): 没有单子 (#2179)" }]]);
    expect(findMergedPullProofs({ run: f.run, slug: "o/r", numbers: [2179] }).proofs.size).toBe(0);
  });

  it("负控制：没合并的那条即便标题里有号也不算证明", () => {
    const f = io([[{ number: 2170, is_merged: false, title: "fix(a): 一格 (#2179)" }]]);
    expect(findMergedPullProofs({ run: f.run, slug: "o/r", numbers: [2179] }).proofs.size).toBe(0);
  });

  it("负控制：标题里**裸写**那个号不算落地证明（认领形态才算，ISSUE #2646）", () => {
    /* 「那条 PR 顺手修了 #2179 的邻居」是描述，不是「它把 #2179 做完了」的声明。
     * 这一格与 `decideCloseIssue` 那条同源，但它是**另一条通道**（按标题反查证明），
     * 只钉住关单那一刀会留下这条：推定来源还在，只是没人用它关过。 */
    const f = io([[{ number: 2184, is_merged: true, title: "fix(ci): 顺带修 #2179 的邻居" }]]);
    const r = findMergedPullProofs({
      run: f.run,
      slug: "o/r",
      numbers: [2179],
    });
    expect(r.proofs.has(2179)).toBe(false);
    /* 扫过与否是另一件事：这一条**跑到过**平台、也数到了那条已合并 PR，
     * 只是它不构成证明（「没证明」与「没查」在两处出口里各说各的话）。 */
    expect(r.ran).toBe(true);
    expect(r.scanned).toBe(1);
  });

  it("cnb 取不到 ⇒ ran=false（不构成结论），且不往下翻页", () => {
    const f = io([[]], { fail: true });
    const r = findMergedPullProofs({
      run: f.run,
      slug: "o/r",
      numbers: [2179],
    });
    expect(r.ran).toBe(false);
    expect(f.calls.length).toBe(1);
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
    error: string | null;
    status: number;
    stderr: string;
    stdout: string;
  };

  /**
   * git 的替身。形状按真实输出给：`ls-remote` 命中是一行 `<sha>\trefs/heads/<名>`、
   * 没命中是**空串退 0**（这正是这一格的判点：空与失败不是一件事）。
   */
  function gitIo(
    opts: {
      branchStatus?: number;
      localStillThere?: boolean;
      lsRemoteFails?: boolean;
      pushStatus?: number;
      remoteStillThere?: boolean;
    } = {},
  ) {
    const calls: Array<string> = [];
    const log: Array<string> = [];
    const ok = (stdout = "", status = 0): FakeResult => ({
      status,
      stdout,
      stderr: "",
      error: null,
    });
    const run = (_cmd: string, args: Array<string>): FakeResult => {
      calls.push(args.join(" "));
      const key = args.join(" ");
      if (key.startsWith("rev-parse --short")) {
        return ok("dead123");
      }
      if (key.startsWith("push cnb --delete")) {
        return ok("", opts.pushStatus ?? 0);
      }
      if (key.startsWith("ls-remote --heads")) {
        if (opts.lsRemoteFails) {
          return ok("", 128);
        }
        return ok(opts.remoteStillThere ? "abc123\trefs/heads/feat/x" : "", 0);
      }
      if (key.startsWith("branch -D")) {
        return ok("", opts.branchStatus ?? 0);
      }
      if (key.startsWith("show-ref --verify")) {
        return ok("", opts.localStillThere ? 0 : 1);
      }
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
  it("配了留痕 ⇒ 念出 `提单人:<短名>` 标签，优先级指回平台原生 --priority（本脚本不代填）", () => {
    const all = issueAuthoring({
      handle: "yuedu-win",
      platform: "linux",
      showExits: true,
    }).lines.join("\n");
    expect(all).toContain("提单人=yuedu-win");
    expect(all).toContain("标签 提单人:yuedu-win");
    expect(all).toContain("读数，不改退码");
    // 实测 `create-issue --labels` 不落地（回读是空）⇒ 出口必须是两条，而不是一条说了不算。
    expect(all).toContain("cnb issues create-issue");
    expect(all).toContain("--priority <P0|P1|P2|P3>");
    expect(all).toContain("cnb issues post-issue-labels");
    expect(all).toContain("--labels 提单人:yuedu-win");
    // 前缀是角色（谁提的），不是仓库名 —— 换仓库由 --repo 区分。
    expect(all).not.toContain("dev:");
  });

  it("Windows 且没配 ⇒ 点名要配，并给 `.env` 里那个键名与占位标签", () => {
    const r = issueAuthoring({
      handle: null,
      platform: "win32",
      root: "/checkout/one",
      showExits: true,
    });
    expect(r.required).toBe(true);
    const all = r.lines.join("\n");
    expect(all).toContain("Windows 开发者");
    expect(all).toContain("COMFYAPP_DEV_HANDLE");
    expect(all).toContain("--labels 提单人:<名称>");
    // 一台机器上多份并行检出时，「去 .env 里加一行」指不出是哪一份（#2186 的现场），
    // 而整行缺失时下一动作是那一条命令 —— 两句都要把人带到能动的地方。
    expect(all).toContain("checkout");
    expect(all).toContain("env:init");
  });

  it("负控制：非 Windows 且调用方给了空值 ⇒ 不点名要求，但把取值链与出口都念出来", () => {
    /* `handle: null` 现在只可能来自装配层显式传空 —— 取值链保证给得出名字。
     * 这一格钉的是「不点名要求配」（本轮只管 Windows）+「照旧指得出能动的地方」。 */
    const r = issueAuthoring({ handle: null, platform: "linux" });
    expect(r.required).toBe(false);
    const all = r.lines.join("\n");
    expect(all).toContain("dev-handle.mjs");
    expect(all).toContain("COMFYAPP_DEV_HANDLE");
    expect(all).not.toContain("Windows 开发者按规范在");
  });

  it("两格都在场、又不缺单 ⇒ 只念身份那一行（出口每次都刷屏就没人看了）", () => {
    const r = issueAuthoring({
      handle: "yuedu-win",
      platform: "win32",
      showExits: false,
    });
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toContain("提单人=yuedu-win");
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

describe("issueItemShapes：一张单子正文里的条目形态（#2251 —— 是读数，不是「剩余条数」）", () => {
  it("真实那张单的形态：`###` + 序号在场，而复选框一条都没有", () => {
    /* 立案现场：标题列了 7 条待办的那张单，正文用的是小节与序号，不是 checkbox。
     * 这一格钉的就是「只按 `- [ ]` 数会把 7 条读成 0 条」那一族误读。 */
    const body = [
      "## 读数",
      "### 第 1 条：红的那格",
      "### 第 2 条：警告那三格",
      "1. 待确认 A",
      "2) 待确认 B",
      "- 项目符不算条目形态（它太常见）",
    ].join("\n");
    const s = issueItemShapes(body);
    expect(s.headings).toBe(2);
    expect(s.ordered).toBe(2);
    expect(s.unchecked).toBe(0);
    expect(s.checked).toBe(0);
    expect(s.total).toBe(4);
  });

  it("复选框分未勾 / 已勾两档，缩进的也数得到", () => {
    const s = issueItemShapes("- [ ] 甲\n  - [ ] 乙\n- [x] 丙\n* [X] 丁\n");
    expect(s.unchecked).toBe(2);
    expect(s.checked).toBe(2);
  });

  it("`###` 后面没内容不算小节；空正文与非字符串输入都归零而不是抛", () => {
    expect(issueItemShapes("###   \n### 有内容\n").headings).toBe(1);
    expect(issueItemShapes("").total).toBe(0);
    expect(issueItemShapes(/* SAFETY: 类型断言已复核 */ undefined as never).total).toBe(0);
    expect(issueItemShapes(/* SAFETY: 类型断言已复核 */ null as never).total).toBe(0);
  });
});

describe("withCommentHeader：开头署名有且只有一行（ISSUE #2268）", () => {
  it("没有 ⇒ 补本检出那一行；已有 ⇒ 原样保留，不再前插", () => {
    expect(withCommentHeader("## 症状\n\nCI 红了\n", "yuedu-win")).toBe(
      "**[评论人：yuedu-win]**\n\n## 症状\n\nCI 红了\n",
    );
    const once = "**[评论人：yuedu-win]**\n\n## 症状\n\n正文\n";
    expect(withCommentHeader(once, "yuedu-win")).toBe(once);
  });

  it("重复的两行收成一行（#2258 的现场）", () => {
    const dup = "**[评论人：b-win]**\n**[评论人：b-win]**\n\n## 症状\n\n正文\n";
    const got = withCommentHeader(dup, "yuedu-win");
    expect(got.startsWith("**[评论人：b-win]**\n\n## 症状")).toBe(true);
    expect(got.match(/\*\*\[评论人：/g) ?? []).toHaveLength(1);
  });

  it("不改写人名：开头那行是谁写的就留谁，工具只管「有且只有一行」", () => {
    const got = withCommentHeader("**[评论人：b-win]**\n\n## 症状\n", "yuedu-win");
    expect(got).toContain("b-win");
    expect(got).not.toContain("yuedu-win");
  });

  it("前导空行与正文中间的同形文字都不误伤", () => {
    expect(
      withCommentHeader("\n\n  \n## 症状\n", "h").startsWith("**[评论人：h]**\n\n## 症状"),
    ).toBe(true);
    /* 中间那行是正文内容（比如文档里在讲这个格式），不算署名、不许被吃掉。 */
    const mid = "## 说明\n\n**[评论人：x]** 这一行的形状是……\n\n结尾\n";
    const got = withCommentHeader(mid, "h");
    expect(got.startsWith("**[评论人：h]**\n\n## 说明")).toBe(true);
    expect(got).toContain("**[评论人：x]** 这一行的形状是");
  });

  it("幂等：跑第二遍与第一遍逐字节相同", () => {
    const once = withCommentHeader("**[评论人：a]**\n**[评论人：a]**\n正文\n", "b");
    expect(withCommentHeader(once, "b")).toBe(once);
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

  it("负控制：`.env.example` 那种**注释掉**的形态不算填了 ⇒ 走取值链，不念成空短名", () => {
    const root = envRoot('# COMFYAPP_DEV_HANDLE="yuedu-win"\n');
    try {
      const r = readDevHandleWithSource({ root, env: {} });
      expect(r.name.trim()).not.toBe("");
      expect(r.explicit).toBe(false);
      expect(r.source).not.toBe(".env");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("没有 `.env`（CI / 干净检出）⇒ 取值链给一个名字，而不是抛错也不是空串", () => {
    const r = readDevHandleWithSource({
      root: path.join(os.tmpdir(), "comfy-no-such-checkout"),
      env: {},
    });
    expect(r.name.trim()).not.toBe("");
    expect(r.explicit).toBe(false);
  });
});

describe("角色标签与署名：提单人 / 处理人 / 参与人 —— 只有一份生成处（ISSUE #2204 / #2213 / #2215）", () => {
  it("同一份短名派生三枚标签：issue 侧 `提单人:`、PR / 领取侧 `处理人:`、只增不删的 `参与人:`", () => {
    expect(authorLabel("yuedu-win")).toBe("提单人:yuedu-win");
    expect(handlerLabel("yuedu-win")).toBe("处理人:yuedu-win");
    expect(participantLabel("yuedu-win")).toBe("参与人:yuedu-win");
    expect(commentHeader("yuedu-win")).toBe("**[评论人：yuedu-win]**");
    // 首尾空白吃掉 —— 与 `readDevHandle` 同一条口径。
    expect(authorLabel("  yuedu-win  ")).toBe("提单人:yuedu-win");
    expect(handlerLabel("  yuedu-win  ")).toBe("处理人:yuedu-win");
    expect(participantLabel("  yuedu-win  ")).toBe("参与人:yuedu-win");
  });

  it("未配 / 空白 ⇒ 标签 null、署名如实写「未配」，不编一个名字", () => {
    for (const v of [null, undefined, "", "   "]) {
      expect(authorLabel(v)).toBeNull();
      expect(handlerLabel(v)).toBeNull();
      expect(participantLabel(v)).toBeNull();
      expect(commentHeader(v)).toBe("**[评论人：未配]**");
    }
  });

  it("--whoami 出口：三枚标签、三条规则与可粘贴命令都在", () => {
    const all = whoamiLines({
      handle: "yuedu-win",
      root: "/checkout/one",
      slug: "moon-read/comfy-app-t3",
    }).join("\n");
    expect(all).toContain("提单人:yuedu-win");
    expect(all).toContain("处理人:yuedu-win");
    expect(all).toContain("参与人:yuedu-win");
    expect(all).toContain("正文最前面带一行粗体署名 `**[评论人：yuedu-win]**`");
    expect(all).toContain("提单 / PR 正文与领取 / 结束评论同一格式");
    expect(all).toContain(
      "cnb pulls post-pull-labels --repo moon-read/comfy-app-t3 --number <PR号> --labels 处理人:yuedu-win -v",
    );
    // 回读那一行不是可选提示：回执不算结论，看得见名字才算打上了。
    expect(all).toContain("cnb pulls list-pull-labels");
    expect(all).toContain("回读里看得见那个名字才算打上了");
    // 领取 / 结束 / 列表的入口也要在这里列出来（手工通道的自查出口）。
    expect(all).toContain("pnpm ship --claim <号>");
    expect(all).toContain("pnpm ship --release <号>");
    expect(all).toContain("pnpm ship --claims");
  });

  it("没配 ⇒ 点到这一份检出的 .env 与 env:init，而不是只说「未配」", () => {
    const all = whoamiLines({ handle: null, root: "/checkout/one" }).join("\n");
    expect(all).toContain("未配");
    expect(all).toContain(path.join("/checkout/one", ".env"));
    expect(all).toContain("pnpm env:init");
    expect(all).toContain("**[评论人：未配]**");
    // 仓库取不到时占位，而不是把 `undefined` 拼进一条能粘贴的命令。
    expect(all).toContain("--repo <组织>/<仓库>");
  });
});

describe("ship-claim：领取 / 结束释放 / 我的领取列表（ISSUE #2213）", () => {
  /**
   * 有状态的假平台：标签、评论、状态都能被写动作改到，**回读读的是改过之后的事实**。
   * 这一点是本组的要害 —— 若回读始终返回夹具的初值，「写后独立回读」那几格用假执行者
   * 就永远测不出来（回执与事实永远一致）。
   */
  function issueIo(
    opts: {
      commentListFails?: boolean;
      /** 平台落下来的正文被别人改过（回读只剩「形似」，用于负控制）。 */
      commentRewrite?: (text: string) => string;
      comments?: Array<string>;
      getIssueFails?: boolean;
      labels?: Array<string>;
      listFails?: boolean;
      listRows?: Array<{ number: number; priority: string; title: string }>;
      pages?: Array<Array<{ number: number; priority: string; title: string }>>;
      postCommentFails?: boolean;
      state?: string;
      /** 平台落评论时把末尾那个换行收掉（实测口径，ISSUE #2719 的 ⑤）。 */
      stripCommentTail?: boolean;
      writeExtraHandler?: string | null;
    } = {},
  ) {
    let state = opts.state ?? "open";
    let labels = [...(opts.labels ?? [])];
    const comments = [...(opts.comments ?? [])];
    const calls: Array<string> = [];
    const log: Array<string> = [];
    const json = (data: unknown) =>
      JSON.stringify({ status: 200, contentType: "application/json", data });
    const arg = (args: Array<string>, name: string) => {
      const i = args.indexOf(name);
      return i >= 0 ? String(args[i + 1] ?? "") : "";
    };
    const run = (_cmd: string, args: Array<string>): FakeResult => {
      calls.push(args.join(" "));
      if (args[0] === "issues" && args[1] === "update-issue") {
        state = "closed";
        return {
          status: 0,
          stdout: json({ number: 2187, state }),
          stderr: "",
          error: null,
        };
      }
      if (args[0] === "issues" && args[1] === "get-issue") {
        if (opts.getIssueFails) {
          return { status: 0, stdout: "boom", stderr: "", error: null };
        }
        return {
          status: 0,
          stdout: json({
            number: "2187",
            state,
            title: "领一张单试试",
            priority: "P1",
            labels: labels.map((name) => ({ name })),
          }),
          stderr: "",
          error: null,
        };
      }
      if (args[0] === "issues" && args[1] === "post-issue-labels") {
        const name = arg(args, "--labels");
        if (name) {
          labels.push(name);
        }
        // 竞态夹具：另一个会话在我之后也把它的处理人标签打了上来。
        if (opts.writeExtraHandler) {
          labels.push(`处理人:${opts.writeExtraHandler}`);
        }
        return { status: 0, stdout: json({}), stderr: "", error: null };
      }
      if (args[0] === "issues" && args[1] === "delete-issue-label") {
        const name = arg(args, "--name");
        labels = labels.filter((x) => x !== name);
        return { status: 0, stdout: json({}), stderr: "", error: null };
      }
      if (args[0] === "issues" && args[1] === "post-issue-comment") {
        if (opts.postCommentFails) {
          return { status: 0, stdout: "boom", stderr: "", error: null };
        }
        const text = fs.readFileSync(arg(args, "--body-file"), "utf8");
        const stored = opts.stripCommentTail ? text.replace(/\r?\n$/, "") : text;
        comments.unshift(opts.commentRewrite ? opts.commentRewrite(stored) : stored);
        return { status: 0, stdout: json({}), stderr: "", error: null };
      }
      if (args[0] === "issues" && args[1] === "list-issue-comments") {
        if (opts.commentListFails) {
          return { status: 0, stdout: "boom", stderr: "", error: null };
        }
        return {
          status: 0,
          stdout: json(comments.map((body) => ({ body }))),
          stderr: "",
          error: null,
        };
      }
      if (args[0] === "issues" && args[1] === "list-issues") {
        if (opts.listFails) {
          return { status: 0, stdout: "boom", stderr: "", error: null };
        }
        const page = Number(arg(args, "--page") || "1");
        const rows = opts.pages ? (opts.pages[page - 1] ?? []) : (opts.listRows ?? []);
        return {
          status: 0,
          stdout: json(rows),
          stderr: "",
          error: null,
        };
      }
      return { status: 0, stdout: "", stderr: "", error: null };
    };
    return {
      run,
      calls,
      log,
      labels: () => labels,
      comments: () => comments,
    };
  }

  /** 评论正文要落盘（`--body-file` 那条路），用完清掉。 */
  function scratch() {
    const dir = mkdtempSync(path.join(os.tmpdir(), "ship-claim-test-"));
    let n = 0;
    return {
      mkTmp: (_name: string, text: string) => {
        const p = path.join(dir, `f-${n++}.tmp`);
        fs.writeFileSync(p, text, "utf8");
        return p;
      },
      cleanup: () => rmSync(dir, { recursive: true, force: true }),
    };
  }

  const slug = "moon-read/comfy-app-t3";
  const handle = "yuedu-win";
  const opts = (argv: Array<string>) => parseArgs(argv);

  it("评论文案：第一行是粗体署名，正文那句人话在下面 —— 领取 / 结束各一条", () => {
    /* 尾部那个换行来自 `withCommentHeader` 的统一收口（正文类文字以换行结尾）；
     * 状态判据走 `handleCommentState` 的 `includes`，不依赖尾部形状。 */
    expect(claimComment(handle)).toBe(
      `**[评论人：${handle}]**\n\n开发者 ${handle} 已接单，正在开发中。\n`,
    );
    expect(releaseComment(handle)).toBe(`**[评论人：${handle}]**\n\n开发者 ${handle} 开发结束。\n`);
  });

  it("handleCommentState 认的是**最新一条**自己的状态评论（领取→结束→再领取）", () => {
    const claim = claimComment(handle);
    const release = releaseComment(handle);
    expect(handleCommentState([], handle)).toBeNull();
    expect(handleCommentState([claim], handle)).toBe("claim");
    // 列表是「新到旧」：第一条命中的才是这一轮的状态。
    expect(handleCommentState([release, claim], handle)).toBe("release");
    expect(handleCommentState([claim, release], handle)).toBe("claim");
    // 别人的状态评论不影响我的判读。
    expect(handleCommentState([claimComment("someone-else")], handle)).toBeNull();
    // 旧格式（末尾 `处理人:`）的评论仍认得出动作 —— 换格式不能把历史评论读丢。
    expect(handleCommentState([`开发者 ${handle} 开发结束。\n\n处理人:${handle}`], handle)).toBe(
      "release",
    );
  });

  it("decideClaim：未配 ⇒ 2；非 open ⇒ 1；别人名下 ⇒ 1 且说明「仍可评论」", () => {
    expect(decideClaim({ number: 7, state: "open", labels: [], handle: null }).code).toBe(
      CODE.NOT_RUN,
    );
    expect(decideClaim({ number: 7, state: "closed", labels: [], handle }).code).toBe(CODE.RED);
    const taken = decideClaim({
      number: 7,
      state: "open",
      labels: [{ name: "处理人:someone-else" }],
      handle,
    });
    expect(taken.act).toBe(false);
    expect(taken.code).toBe(CODE.RED);
    expect(taken.reason).toContain("仍然可以在单子上评论");
  });

  it("decideClaim：我是唯一处理人 ⇒ 幂等；我和别人同时挂着 ⇒ 冲突（不替谁撤标签）", () => {
    const mine = decideClaim({
      number: 7,
      state: "open",
      labels: [{ name: `处理人:${handle}` }],
      handle,
    });
    expect(mine).toMatchObject({ act: true, already: true, others: [] });
    const conflict = decideClaim({
      number: 7,
      state: "open",
      labels: [{ name: `处理人:${handle}` }, { name: "处理人:someone-else" }],
      handle,
    });
    expect(conflict.act).toBe(false);
    expect(conflict.code).toBe(CODE.RED);
    expect(conflict.others).toEqual(["someone-else"]);
    expect(conflict.reason).toContain("人裁定");
  });

  it("decideRelease：不是我且开着 ⇒ 1；不是我且已关 ⇒ 0 无需动作；是我 ⇒ act", () => {
    expect(decideRelease({ number: 7, state: "open", labels: [], handle }).code).toBe(CODE.RED);
    const closed = decideRelease({
      number: 7,
      state: "closed",
      labels: [],
      handle,
    });
    expect(closed.act).toBe(false);
    expect(closed.code).toBe(CODE.GREEN);
    expect(
      decideRelease({
        number: 7,
        state: "open",
        labels: [{ name: `处理人:${handle}` }],
        handle,
      }).act,
    ).toBe(true);
  });

  it("--claim：先打标签、再评论，两件都独立回读", () => {
    const f = issueIo();
    const s = scratch();
    try {
      const code = runIssueAction({
        run: f.run,
        log: (l) => f.log.push(l),
        slug,
        cnbOk: true,
        handle,
        root: os.tmpdir(),
        opt: opts(["--claim", "2187"]),
        mkTmp: s.mkTmp,
      });
      expect(code).toBe(CODE.GREEN);
      const put = f.calls.findIndex((c) => c.includes("post-issue-labels"));
      const said = f.calls.findIndex((c) => c.includes("post-issue-comment"));
      expect(put).toBeGreaterThan(-1);
      // 标签先落地（别人刷新时立刻看得见），评论晚一步。
      expect(put).toBeLessThan(said);
      // 两处写动作之后各问了一次平台（不是拿回执当结论）。
      expect(f.calls.slice(put + 1).some((c) => c.startsWith("issues get-issue"))).toBe(true);
      expect(f.calls.slice(said + 1).some((c) => c.startsWith("issues list-issue-comments"))).toBe(
        true,
      );
      expect(f.labels()).toContain(`处理人:${handle}`);
      expect(f.labels()).toContain(`参与人:${handle}`);
      expect(f.comments()[0]).toContain("已接单");
      expect(f.comments()[0]?.startsWith(`${commentHeader(handle)}\n\n`)).toBe(true);
    } finally {
      s.cleanup();
    }
  });

  it("--claim：别人已领取 ⇒ 红，且一次写动作都不发", () => {
    const f = issueIo({ labels: ["处理人:someone-else"] });
    const s = scratch();
    try {
      const code = runIssueAction({
        run: f.run,
        log: (l) => f.log.push(l),
        slug,
        cnbOk: true,
        handle,
        root: os.tmpdir(),
        opt: opts(["--claim", "2187"]),
        mkTmp: s.mkTmp,
      });
      expect(code).toBe(CODE.RED);
      expect(
        f.calls.some(
          (c) =>
            c.includes("post-issue-labels") ||
            c.includes("post-issue-comment") ||
            c.includes("delete-issue-label"),
        ),
      ).toBe(false);
      expect(f.log.join("\n")).toContain("仍然可以在单子上评论");
    } finally {
      s.cleanup();
    }
  });

  it("--claim：单子已关闭 ⇒ 红（不是「已经领好了」）", () => {
    const f = issueIo({ state: "closed" });
    const s = scratch();
    try {
      const code = runIssueAction({
        run: f.run,
        log: (l) => f.log.push(l),
        slug,
        cnbOk: true,
        handle,
        root: os.tmpdir(),
        opt: opts(["--claim", "2187"]),
        mkTmp: s.mkTmp,
      });
      expect(code).toBe(CODE.RED);
      expect(f.calls.some((c) => c.includes("post-issue-labels"))).toBe(false);
    } finally {
      s.cleanup();
    }
  });

  it("--claim：未配留痕 ⇒ 2，且一次 cnb 都不碰（连读都不读）", () => {
    const f = issueIo();
    const s = scratch();
    try {
      const code = runIssueAction({
        run: f.run,
        log: (l) => f.log.push(l),
        slug,
        cnbOk: true,
        handle: null,
        root: os.tmpdir(),
        opt: opts(["--claim", "2187"]),
        mkTmp: s.mkTmp,
      });
      expect(code).toBe(CODE.NOT_RUN);
      expect(f.calls).toEqual([]);
      // 空短名只可能来自装配层显式传空 ⇒ 话术点的是取值链，而不是「去配那个键」。
      expect(f.log.join("\n")).toContain("dev-handle.mjs");
    } finally {
      s.cleanup();
    }
  });

  it("--claim：写后回读里冒出第二个处理人 ⇒ 红（标签不是锁，冲突要人裁定）", () => {
    const f = issueIo({ writeExtraHandler: "someone-else" });
    const s = scratch();
    try {
      const code = runIssueAction({
        run: f.run,
        log: (l) => f.log.push(l),
        slug,
        cnbOk: true,
        handle,
        root: os.tmpdir(),
        opt: opts(["--claim", "2187"]),
        mkTmp: s.mkTmp,
      });
      expect(code).toBe(CODE.RED);
      expect(f.log.join("\n")).toContain("冲突");
      // 冲突之后不再往下写评论 —— 先把这个事实交给人才说「正在开发中」。
      expect(f.calls.some((c) => c.includes("post-issue-comment"))).toBe(false);
    } finally {
      s.cleanup();
    }
  });

  it("--claim：已在名下、只缺评论 ⇒ 只补评论，不重复打标签（幂等）", () => {
    const f = issueIo({
      labels: [`处理人:${handle}`, `参与人:${handle}`],
    });
    const s = scratch();
    try {
      const code = runIssueAction({
        run: f.run,
        log: (l) => f.log.push(l),
        slug,
        cnbOk: true,
        handle,
        root: os.tmpdir(),
        opt: opts(["--claim", "2187"]),
        mkTmp: s.mkTmp,
      });
      expect(code).toBe(CODE.GREEN);
      expect(f.calls.some((c) => c.includes("post-issue-labels"))).toBe(false);
      expect(f.comments()[0]).toContain("已接单");
    } finally {
      s.cleanup();
    }
  });

  it("--claim：旧单只有处理人、缺参与人 ⇒ 只补参与人（不重复打处理人）", () => {
    const f = issueIo({ labels: [`处理人:${handle}`] });
    const s = scratch();
    try {
      const code = runIssueAction({
        run: f.run,
        log: (l) => f.log.push(l),
        slug,
        cnbOk: true,
        handle,
        root: os.tmpdir(),
        opt: opts(["--claim", "2187"]),
        mkTmp: s.mkTmp,
      });
      expect(code).toBe(CODE.GREEN);
      const puts = f.calls.filter((c) => c.includes("post-issue-labels"));
      expect(puts).toHaveLength(1);
      expect(puts[0]).toContain(`--labels 参与人:${handle}`);
      expect(f.labels()).toContain(`参与人:${handle}`);
      expect(f.comments()[0]).toContain("已接单");
    } finally {
      s.cleanup();
    }
  });

  it("--claim：评论写失败 ⇒ 2 且标签**保留**（下一跑只补评论）", () => {
    const f = issueIo({ postCommentFails: true });
    const s = scratch();
    try {
      const code = runIssueAction({
        run: f.run,
        log: (l) => f.log.push(l),
        slug,
        cnbOk: true,
        handle,
        root: os.tmpdir(),
        opt: opts(["--claim", "2187"]),
        mkTmp: s.mkTmp,
      });
      expect(code).toBe(CODE.NOT_RUN);
      expect(f.labels()).toContain(`处理人:${handle}`);
      expect(f.comments()).toEqual([]);
    } finally {
      s.cleanup();
    }
  });

  it("--claim --dry-run：只念计划，一次写动作都不发", () => {
    const f = issueIo();
    const s = scratch();
    try {
      const code = runIssueAction({
        run: f.run,
        log: (l) => f.log.push(l),
        slug,
        cnbOk: true,
        handle,
        root: os.tmpdir(),
        opt: opts(["--claim", "2187", "--dry-run"]),
        mkTmp: s.mkTmp,
        dryRun: true,
      });
      expect(code).toBe(CODE.GREEN);
      expect(f.labels()).toEqual([]);
      expect(f.calls.some((c) => c.includes("post-issue"))).toBe(false);
      expect(f.log.join("\n")).toContain("一条都没写");
    } finally {
      s.cleanup();
    }
  });

  it("--release：评论先于撤标签，撤后独立回读；参与人保留", () => {
    const f = issueIo({
      labels: [`处理人:${handle}`, `参与人:${handle}`],
    });
    const s = scratch();
    try {
      const code = runIssueAction({
        run: f.run,
        log: (l) => f.log.push(l),
        slug,
        cnbOk: true,
        handle,
        root: os.tmpdir(),
        opt: opts(["--release", "2187"]),
        mkTmp: s.mkTmp,
      });
      expect(code).toBe(CODE.GREEN);
      const said = f.calls.findIndex((c) => c.includes("post-issue-comment"));
      const drop = f.calls.findIndex((c) => c.includes("delete-issue-label"));
      expect(said).toBeGreaterThan(-1);
      expect(said).toBeLessThan(drop);
      // 撤完标签再问一次事实：回执不算结论。
      expect(f.calls.slice(drop + 1).some((c) => c.startsWith("issues get-issue"))).toBe(true);
      expect(f.comments()[0]).toContain("开发结束");
      expect(f.labels()).not.toContain(`处理人:${handle}`);
      expect(f.labels()).toContain(`参与人:${handle}`);
      expect(f.calls.some((c) => c.includes("delete-issue-label") && c.includes("参与人:"))).toBe(
        false,
      );
    } finally {
      s.cleanup();
    }
  });

  it("--release：不在我名下且单子开着 ⇒ 红，一次写动作都不发", () => {
    const f = issueIo({ labels: ["处理人:someone-else"] });
    const s = scratch();
    try {
      const code = runIssueAction({
        run: f.run,
        log: (l) => f.log.push(l),
        slug,
        cnbOk: true,
        handle,
        root: os.tmpdir(),
        opt: opts(["--release", "2187"]),
        mkTmp: s.mkTmp,
      });
      expect(code).toBe(CODE.RED);
      expect(f.calls.some((c) => c.includes("post-issue"))).toBe(false);
      expect(f.labels()).toEqual(["处理人:someone-else"]);
    } finally {
      s.cleanup();
    }
  });

  it("--release：结束评论没落地 ⇒ 2 且标签保留（不出现无声释放）", () => {
    const f = issueIo({
      labels: [`处理人:${handle}`],
      postCommentFails: true,
    });
    const s = scratch();
    try {
      const code = runIssueAction({
        run: f.run,
        log: (l) => f.log.push(l),
        slug,
        cnbOk: true,
        handle,
        root: os.tmpdir(),
        opt: opts(["--release", "2187"]),
        mkTmp: s.mkTmp,
      });
      expect(code).toBe(CODE.NOT_RUN);
      expect(f.labels()).toContain(`处理人:${handle}`);
      expect(f.calls.some((c) => c.includes("delete-issue-label"))).toBe(false);
      expect(f.log.join("\n")).toContain("保留");
    } finally {
      s.cleanup();
    }
  });

  it("--claims：按 `处理人:` 标签列 open 的单子；空列表念「没有」", () => {
    const rows = [
      { number: 2187, priority: "P1", title: "领一张单试试" },
      { number: 2190, priority: "P2", title: "另一张" },
    ];
    const f = issueIo({ listRows: rows });
    const s = scratch();
    try {
      const code = runIssueAction({
        run: f.run,
        log: (l) => f.log.push(l),
        slug,
        cnbOk: true,
        handle,
        root: os.tmpdir(),
        opt: opts(["--claims"]),
        mkTmp: s.mkTmp,
      });
      expect(code).toBe(CODE.GREEN);
      expect(f.calls[0]).toContain("--labels 处理人:yuedu-win");
      expect(f.calls[0]).toContain("--state open");
      expect(f.log.join("\n")).toContain("2 张");
      expect(f.log.join("\n")).toContain("#2187 · P1 · 领一张单试试");

      const empty = issueIo({ listRows: [] });
      const code2 = runIssueAction({
        run: empty.run,
        log: (l) => empty.log.push(l),
        slug,
        cnbOk: true,
        handle,
        root: os.tmpdir(),
        opt: opts(["--claims"]),
        mkTmp: s.mkTmp,
      });
      expect(code2).toBe(CODE.GREEN);
      expect(empty.log.join("\n")).toContain("没有你领取中的单子");
    } finally {
      s.cleanup();
    }
  });

  it("--claims：列表读不到 ⇒ 2，不念成「没有领取中的单子」", () => {
    const f = issueIo({ listFails: true });
    const s = scratch();
    try {
      const code = runIssueAction({
        run: f.run,
        log: (l) => f.log.push(l),
        slug,
        cnbOk: true,
        handle,
        root: os.tmpdir(),
        opt: opts(["--claims"]),
        mkTmp: s.mkTmp,
      });
      expect(code).toBe(CODE.NOT_RUN);
      expect(f.log.join("\n")).not.toContain("没有你领取中的单子");
    } finally {
      s.cleanup();
    }
  });

  it("互斥：一次只做一件，且不与主流程（--merge / --close-issue / --branch…）同跑", () => {
    for (const argv of [
      ["--claim", "2187", "--release", "2188"],
      ["--claim", "2187", "--claims"],
      ["--claim", "2187", "--merge"],
      ["--release", "2187", "--close-issue", "2187"],
      ["--claim", "2187", "--branch", "feat/x"],
      ["--claim", "2187", "--only=commit"],
    ]) {
      const f = issueIo();
      const s = scratch();
      try {
        const code = runIssueAction({
          run: f.run,
          log: (l) => f.log.push(l),
          slug,
          cnbOk: true,
          handle,
          root: os.tmpdir(),
          opt: opts(argv),
          mkTmp: s.mkTmp,
        });
        expect(code, `argv=${argv.join(" ")}`).toBe(CODE.NOT_RUN);
        expect(f.calls, `argv=${argv.join(" ")} 不该碰平台`).toEqual([]);
      } finally {
        s.cleanup();
      }
    }
  });

  it("不像号 / 重复点名 ⇒ 2 并逐条点名，不去猜是哪一张", () => {
    for (const argv of [
      ["--claim", "abc"],
      ["--claim"],
      ["--claim", "2187", "--claim", "2188"],
      ["--release", "#x"],
    ]) {
      const f = issueIo();
      const s = scratch();
      try {
        const code = runIssueAction({
          run: f.run,
          log: (l) => f.log.push(l),
          slug,
          cnbOk: true,
          handle,
          root: os.tmpdir(),
          opt: opts(argv),
          mkTmp: s.mkTmp,
        });
        expect(code, `argv=${argv.join(" ")}`).toBe(CODE.NOT_RUN);
        expect(f.calls).toEqual([]);
      } finally {
        s.cleanup();
      }
    }
  });

  it("cnb 不在 / slug 取不到 ⇒ 2（没有执行者，不去猜单子状态）", () => {
    for (const ctx of [
      { cnbOk: false, slug },
      { cnbOk: true, slug: null },
    ]) {
      const f = issueIo();
      const s = scratch();
      try {
        const code = runIssueAction({
          run: f.run,
          log: (l) => f.log.push(l),
          cnbOk: ctx.cnbOk,
          slug: ctx.slug,
          handle,
          root: os.tmpdir(),
          opt: opts(["--claim", "2187"]),
          mkTmp: s.mkTmp,
        });
        expect(code).toBe(CODE.NOT_RUN);
        expect(f.calls).toEqual([]);
      } finally {
        s.cleanup();
      }
    }
  });

  it("finishIssueWork：处理人是我 ⇒ 结束评论 + 撤处理人（参与人保留）", () => {
    const f = issueIo({
      labels: [`处理人:${handle}`, `参与人:${handle}`],
    });
    const s = scratch();
    try {
      const code = finishIssueWork({
        run: f.run,
        log: (l) => f.log.push(l),
        slug,
        handle,
        number: 2187,
        mkTmp: s.mkTmp,
      });
      expect(code).toBe(CODE.GREEN);
      expect(f.comments()[0]).toContain("开发结束");
      expect(f.labels()).not.toContain(`处理人:${handle}`);
      expect(f.labels()).toContain(`参与人:${handle}`);
      expect(f.calls.findIndex((c) => c.includes("post-issue-comment"))).toBeLessThan(
        f.calls.findIndex((c) => c.includes("delete-issue-label")),
      );
    } finally {
      s.cleanup();
    }
  });

  it("finishIssueWork：处理人是别人 / 不在场 ⇒ 不代发、不动标签（退 0）", () => {
    for (const labels of [["处理人:someone-else"], []]) {
      const f = issueIo({ labels });
      const s = scratch();
      try {
        const code = finishIssueWork({
          run: f.run,
          log: (l) => f.log.push(l),
          slug,
          handle,
          number: 2187,
          mkTmp: s.mkTmp,
        });
        expect(code).toBe(CODE.GREEN);
        expect(
          f.calls.some((c) => c.includes("post-issue-comment") || c.includes("delete-issue-label")),
        ).toBe(false);
      } finally {
        s.cleanup();
      }
    }
  });

  it("finishIssueWork：取的名字撞上别人的处理人 ⇒ 话术把『我是谁是怎么来的』说出来（ISSUE #2833）", () => {
    /* 「不代发」背后是两件事：处理人真是别人，与这份检出的「我是谁」落到了**取的**名字上
     * （链接 worktree 不带 .env ⇒ 跌到 git user.name）。后者要修留痕通道，话术必须分开。 */
    const f = issueIo({ labels: ["处理人:someone-else"] });
    const s = scratch();
    try {
      const code = finishIssueWork({
        run: f.run,
        log: (l) => f.log.push(l),
        slug,
        handle,
        handleExplicit: false,
        number: 2833,
        mkTmp: s.mkTmp,
      });
      expect(code).toBe(CODE.GREEN);
      expect(f.log.join("\n")).toContain("取的");
      expect(f.log.join("\n")).toContain("ISSUE #2833");
      expect(
        f.calls.some((c) => c.includes("post-issue-comment") || c.includes("delete-issue-label")),
      ).toBe(false);
    } finally {
      s.cleanup();
    }
  });

  it("finishIssueWork：显式的名字撞上别人的处理人 ⇒ 不打 worktree 提示（那真是别人在收尾）", () => {
    const f = issueIo({ labels: ["处理人:someone-else"] });
    const s = scratch();
    try {
      const code = finishIssueWork({
        run: f.run,
        log: (l) => f.log.push(l),
        slug,
        handle,
        handleExplicit: true,
        number: 2833,
        mkTmp: s.mkTmp,
      });
      expect(code).toBe(CODE.GREEN);
      expect(f.log.join("\n")).not.toContain("ISSUE #2833");
    } finally {
      s.cleanup();
    }
  });

  it("finishIssueWork：结束评论没落地 ⇒ 2 且标签保留", () => {
    const f = issueIo({
      labels: [`处理人:${handle}`],
      postCommentFails: true,
    });
    const s = scratch();
    try {
      const code = finishIssueWork({
        run: f.run,
        log: (l) => f.log.push(l),
        slug,
        handle,
        number: 2187,
        mkTmp: s.mkTmp,
      });
      expect(code).toBe(CODE.NOT_RUN);
      expect(f.labels()).toContain(`处理人:${handle}`);
    } finally {
      s.cleanup();
    }
  });

  it("closeIssues 验真关闭后带上 handle：补「开发结束」评论并撤自己的处理人标签，参与人保留", () => {
    const f = issueIo({
      labels: [`处理人:${handle}`, `参与人:${handle}`],
    });
    const s = scratch();
    try {
      const code = closeIssues({
        run: f.run,
        log: (l) => f.log.push(l),
        slug,
        closeIssue: true,
        landed: {
          title: "fix(x): 一格 (#2187)",
          sha: "abc1234",
          verified: true,
        },
        handle,
        mkTmp: s.mkTmp,
      });
      expect(code).toBe(CODE.GREEN);
      expect(f.comments()[0]).toContain("开发结束");
      expect(f.labels()).not.toContain(`处理人:${handle}`);
      expect(f.labels()).toContain(`参与人:${handle}`);
    } finally {
      s.cleanup();
    }
  });

  it("closeIssues 验真关闭但处理人是别人：不代发结束评论、不动标签", () => {
    const f = issueIo({ labels: ["处理人:someone-else"] });
    const s = scratch();
    try {
      const code = closeIssues({
        run: f.run,
        log: (l) => f.log.push(l),
        slug,
        closeIssue: true,
        landed: {
          title: "fix(x): 一格 (#2187)",
          sha: "abc1234",
          verified: true,
        },
        handle,
        mkTmp: s.mkTmp,
      });
      expect(code).toBe(CODE.GREEN);
      expect(f.comments()).toEqual([]);
      expect(f.labels()).toEqual(["处理人:someone-else"]);
    } finally {
      s.cleanup();
    }
  });

  /**
   * `--comment`（ISSUE #2719）：正文只从文件读、写完独立回读、**逐字相同**才退 0。
   *
   * 与状态评论（`--claim` / `--release`）共用同一条「落盘 → post → 回读」实现
   * （`scripts/ship-comment.mjs`）；这一组钉的是那层之上多出来的三件：
   * ① 正文文件是唯一入口；② 回读比对先归一末尾换行；③ 不相等就是红，不是「差不多」。
   */
  describe("--comment：往单子上写一条读数（ISSUE #2719）", () => {
    const bodyText = "读数：回执两条，逐字比对通过。\n";

    function commentFixture(body = bodyText) {
      const dir = mkdtempSync(path.join(os.tmpdir(), "ship-comment-test-"));
      const bodyFile = path.join(dir, "comment.md");
      fs.writeFileSync(bodyFile, body, "utf8");
      return { dir, bodyFile };
    }

    function runComment(
      f: ReturnType<typeof issueIo>,
      s: ReturnType<typeof scratch>,
      argv: Array<string>,
    ) {
      return runIssueAction({
        run: f.run,
        log: (l) => f.log.push(l),
        slug,
        cnbOk: true,
        handle,
        root: os.tmpdir(),
        opt: opts(argv),
        mkTmp: s.mkTmp,
        commentIssue: runIssueComment,
        dryRun: opts(argv).dryRun,
      });
    }

    it("写成并逐字回读 ⇒ 0：先 post 再 list，评论首行是本检出的署名", () => {
      const f = issueIo();
      const s = scratch();
      const { dir, bodyFile } = commentFixture();
      try {
        const code = runComment(f, s, ["--comment", "2187", "--body-file", bodyFile]);
        expect(code).toBe(CODE.GREEN);
        const said = f.calls.findIndex((c) => c.includes("post-issue-comment"));
        expect(said).toBeGreaterThan(-1);
        /* 写完之后必须再问平台一次（回执不是结论）。 */
        expect(f.calls.slice(said + 1).some((c) => c.includes("list-issue-comments"))).toBe(true);
        expect(f.comments()[0]?.startsWith(`${commentHeader(handle)}\n\n`)).toBe(true);
        expect(f.comments()[0]).toContain("读数：回执两条");
      } finally {
        s.cleanup();
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("平台收掉末尾换行（1818 ⇄ 1817 那一跑）⇒ 仍判 0：比对先归一", () => {
      const f = issueIo({ stripCommentTail: true });
      const s = scratch();
      const { dir, bodyFile } = commentFixture();
      try {
        const code = runComment(f, s, ["--comment", "2187", "--body-file", bodyFile]);
        expect(code).toBe(CODE.GREEN);
        /* 回读里那条确实少了末尾换行 —— 判 0 是因为归一口径，不是因为平台原样存下。 */
        expect(f.comments()[0]?.endsWith("\n")).toBe(false);
      } finally {
        s.cleanup();
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("回读里没有逐字相同的那一条 ⇒ 1（不念「已评论」），且不重复投递", () => {
      const f = issueIo({ commentRewrite: (t) => `${t}（平台改过）` });
      const s = scratch();
      const { dir, bodyFile } = commentFixture();
      try {
        const code = runComment(f, s, ["--comment", "2187", "--body-file", bodyFile]);
        expect(code).toBe(CODE.RED);
        expect(f.calls.filter((c) => c.includes("post-issue-comment")).length).toBe(1);
      } finally {
        s.cleanup();
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("写动作失败 ⇒ 2；写成功但回读没跑起来 ⇒ 2（两件事话术分开）", () => {
      const s = scratch();
      const { dir, bodyFile } = commentFixture();
      try {
        const failed = issueIo({ postCommentFails: true });
        expect(runComment(failed, s, ["--comment", "2187", "--body-file", bodyFile])).toBe(
          CODE.NOT_RUN,
        );
        const halfDone = issueIo({ commentListFails: true });
        expect(runComment(halfDone, s, ["--comment", "2187", "--body-file", bodyFile])).toBe(
          CODE.NOT_RUN,
        );
      } finally {
        s.cleanup();
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("缺 --body-file / 空文件 ⇒ 2，且一条 cnb 都不发", () => {
      const s = scratch();
      const { dir, bodyFile } = commentFixture("");
      try {
        for (const argv of [
          ["--comment", "2187"],
          ["--comment", "2187", "--body-file", bodyFile],
        ]) {
          const f = issueIo();
          expect(runComment(f, s, argv)).toBe(CODE.NOT_RUN);
          expect(f.calls).toEqual([]);
        }
      } finally {
        s.cleanup();
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("与 --claim 同跑 / --body-file 单独出现 ⇒ 2，一次写动作都不发", () => {
      const s = scratch();
      const { dir, bodyFile } = commentFixture();
      try {
        const both = issueIo();
        expect(
          runComment(both, s, ["--comment", "2187", "--claim", "2187", "--body-file", bodyFile]),
        ).toBe(CODE.NOT_RUN);
        expect(both.calls).toEqual([]);
        const orphan = issueIo();
        expect(runComment(orphan, s, ["--body-file", bodyFile])).toBe(CODE.NOT_RUN);
        expect(orphan.calls).toEqual([]);
      } finally {
        s.cleanup();
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("--dry-run：只念计划，一条都不写", () => {
      const f = issueIo();
      const s = scratch();
      const { dir, bodyFile } = commentFixture();
      try {
        const code = runComment(f, s, [
          "--comment",
          "2187",
          "--body-file",
          bodyFile,
          "--dry-run",
        ]);
        expect(code).toBe(CODE.GREEN);
        expect(f.calls).toEqual([]);
      } finally {
        s.cleanup();
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("CI 那条链（runAppendIssueComment）改用同一份写+回读后，仍按 marker 认回读", () => {
      const f = issueIo();
      const s = scratch();
      try {
        const yes = runAppendIssueComment({
          run: f.run,
          log: (l) => f.log.push(l),
          slug,
          number: 2187,
          body: "构建 cnb-x-1 读数。",
          marker: "cnb-x-1",
          mkTmp: s.mkTmp,
        });
        expect(yes).toBe(true);
        const no = runAppendIssueComment({
          run: f.run,
          log: (l) => f.log.push(l),
          slug,
          number: 2187,
          body: "另一条读数。",
          marker: "cnb-y-2",
          mkTmp: s.mkTmp,
        });
        expect(no).toBe(false);
      } finally {
        s.cleanup();
      }
    });

    it("比对口径：只吃末尾那一个换行，正文里任何一处差异都不许被抹平", () => {
      expect(sameCommentBody("a\n\nb\n", "a\n\nb")).toBe(true);
      expect(sameCommentBody("a\n\nb\r\n", "a\n\nb")).toBe(true);
      expect(sameCommentBody("a\n\nb", "a\n\nc")).toBe(false);
      expect(sameCommentBody("a\n\nb\n\n", "a\n\nb")).toBe(false);
      expect(stripTrailingNewline("x\r\n")).toBe("x");
    });
  });
});

describe("reapCheckoutInstances：只收 via port 那批，session 那一档不归它收", () => {
  type Live = { pids?: Array<number>; running?: boolean; via?: string | null };

  /** 「判据 + 执行者」的替身：`before` 是收尾那一格第一次读到的形状。 */
  function io(before: Live | null | Error, after: Live | null | Error, reapStatus = 0) {
    const calls: Array<string> = [];
    const log: Array<string> = [];
    let n = 0;
    const read = async (_root: string): Promise<Live> => {
      const one = n++ === 0 ? before : after;
      if (one instanceof Error) {
        throw one;
      }
      if (one === null) {
        throw new Error("判据返回了空形状");
      }
      return one;
    };
    const run = (_cmd: string, args: Array<string>) => {
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
    expect(instanceReading({ running: false, pids: [7], via: "port" })).toContain("形状矛盾");
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
    error: string | null;
    status: number;
    stderr: string;
    stdout: string;
  };
  const SHA = "d02ec96364d5f3713b77c91b0d3fe789878f1747";
  const ok = (stdout: string): FakeResult => ({
    status: 0,
    stdout,
    stderr: "",
    error: null,
  });

  function io(opts: {
    /** `pulls get-pull` 回读的 blocked_on。 */
    blockedOn?: string;
    /** false = 列表里没有这条 sha（平台还没开跑）。 */
    found?: boolean;
    /** `pulls get-pull` 回读的 mergeable_state；不给则这一问回空（读不到）。 */
    mergeableState?: string;
    /** 每次的 pipeline 计数（"0-1" 这种 `完成-总`），与 statuses 同长。 */
    progress?: Array<string>;
    /** 每次的 stage 计数（"12/33" 这种 `完成/总`）；不给就造不出 stages 字段。 */
    stageProgress?: Array<string>;
    /** 每次 get-build-status 的 data.status；用完后重复最后一个。 */
    statuses?: Array<string>;
  }) {
    const log: Array<string> = [];
    const calls: Array<string> = [];
    let i = 0;
    const run = (_cmd: string, args: Array<string>): FakeResult => {
      calls.push(args.join(" "));
      if (args[1] === "get-build-logs") {
        const builds =
          opts.found === false
            ? []
            : [{ sn: "b1", sha: SHA, event: "pull_request", createTime: "t" }];
        return ok(JSON.stringify({ status: 200, data: { data: builds } }));
      }
      if (args[0] === "pulls" && args[1] === "get-pull") {
        const ms = opts.mergeableState ?? "mergeable";
        return ok(
          JSON.stringify({
            status: 200,
            data: {
              number: 2633,
              mergeable_state: ms,
              blocked_on: opts.blockedOn ?? "",
              is_merged: false,
              state: "open",
            },
          }),
        );
      }
      if (args[1] === "get-build-status") {
        const statuses = opts.statuses ?? ["pending"];
        const progress = opts.progress ?? ["0-1"];
        const st = statuses[Math.min(i, statuses.length - 1)] ?? "pending";
        const [done, total] = (progress[Math.min(i, progress.length - 1)] ?? "0-1").split("-");
        const stage = (opts.stageProgress ?? [])[
          Math.min(i, (opts.stageProgress ?? []).length - 1)
        ];
        i += 1;
        /** 平台那一层的外部形状（本测试只造得出判据看得见的字段）。 */
        const pipelinesStatus: Record<
          string,
          {
            stages?: Array<{
              duration: number;
              id: string;
              name: string;
              status: string;
            }>;
            status: string;
          }
        > = {};
        for (let p = 0; p < Number(total); p += 1) {
          const pipeline: {
            stages?: Array<{
              duration: number;
              id: string;
              name: string;
              status: string;
            }>;
            status: string;
          } = { status: p < Number(done) ? "success" : "running" };
          pipelinesStatus[`p${p}`] = pipeline;
          if (stage) {
            /* 只有第一条 pipeline 带 stages（与本仓的真实拓扑一致：一条流水线，
             * 里面几十格）。运行中那一格的 `duration` 是占位 0 —— 平台按格缓冲。 */
            const [sDone, sTotal] = stage.split("/");
            const stages: Array<{
              duration: number;
              id: string;
              name: string;
              status: string;
            }> = [];
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

  it("ISSUE #2645：按 sha 查不到 build 且 PR 冲突 ⇒ 念 mergeable_state 并指明「平台不跑 CI」（每轮只念一次）", async () => {
    /* 真因常在冲突：mergeable_state=conflict 的 PR 平台不派生构建，干等只会烧预算。
     * 这一条喂 `found:false`（列表里没有这条 sha）+ PR 冲突，验两件事：① 轮询会把
     * `mergeable_state`/`blocked_on` 读出来打在「还没解析到 build」那一句旁边；
     * ② 那句只在 `!picked` 那一格念一次（不每 20 秒复述）。 */
    const f = io({
      found: false,
      mergeableState: "conflict",
      blockedOn: "code_conflict",
    });
    const out = await pollUntilTerminal({
      run: f.run,
      log: (s) => f.log.push(s),
      ...base,
      now: f.now,
      sleep: f.sleep,
      number: 2633,
    });
    expect(out.stop).toBe(CODE.NOT_RUN);
    const all = f.log.join("\n");
    expect(all).toContain("PR #2633：mergeable_state=conflict blocked_on=code_conflict");
    expect(all).toContain("冲突的 PR 平台不派生 CI");
    // 只念一次：反复复述「PR 冲突」与复述「没变化」是同一类噪音。
    expect(all.split("mergeable_state=conflict").length - 1).toBe(1);
    // 没给 number 的那一族测试不受影响（上面那条「连续 10 次」就不带 number）。
  });

  it("ISSUE #2645（负控制）：查不到 build 但 PR 可合并 ⇒ 只念 mergeable_state，不报冲突提示", async () => {
    const f = io({ found: false, mergeableState: "mergeable" });
    const out = await pollUntilTerminal({
      run: f.run,
      log: (s) => f.log.push(s),
      ...base,
      now: f.now,
      sleep: f.sleep,
      number: 2633,
    });
    expect(out.stop).toBe(CODE.NOT_RUN);
    const all = f.log.join("\n");
    expect(all).toContain("PR #2633：mergeable_state=mergeable");
    expect(all).not.toContain("冲突的 PR 平台不派生 CI");
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
                stages: [{ status: "success" }, { status: "start" }, { status: "pending" }],
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
    error: string | null;
    status: number;
    stderr: string;
    stdout: string;
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
    const log: Array<string> = [];
    const run = (_cmd: string, args: Array<string>): FakeResult => {
      if (args[1] === "get-build-logs") {
        return ok(
          JSON.stringify({
            status: 200,
            data: {
              data: [{ sn: "b1", sha: SHA, event: "pull_request", createTime: "t" }],
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
    expect(parseSlug("https://cnb.cool/moon-read/comfy-app-t3")).toBe("moon-read/comfy-app-t3");
    expect(parseSlug("https://cnb.cool/moon-read/comfy-app-t3.git")).toBe("moon-read/comfy-app-t3");
    expect(parseSlug("git@cnb.cool:moon-read/comfy-app-t3.git")).toBe("moon-read/comfy-app-t3");
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
    expect(resolveUpstream({ upstream: "cnb/master", remotes: ["cnb"] })).toEqual({
      remote: "cnb",
      base: "cnb/master",
      source: "upstream",
    });
    /* 带斜杠的分支名不能被截断（`cnb` + `release/2026-10`）。 */
    expect(resolveUpstream({ upstream: "cnb/release/2026-10", remotes: ["cnb"] }).base).toBe(
      "cnb/release/2026-10",
    );
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
    expect(resolveUpstream({ upstream: null, remotes: ["origin", "gitee"] }).remote).toBe("origin");
    expect(resolveUpstream({ upstream: null, remotes: ["cnb", "gitee"] })).toEqual({
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

describe("findMergedPullForHeadSha：这一笔是不是已经随某条已合并的 PR 落过地（ISSUE #2250）", () => {
  /* 样本取**平台真实形状**（`list-pulls --state closed -v` 实测）：列表页没有 `merged`
   * 这一档，`closed` 里混着「合了」与「关了没合」，所以只认逐条 `is_merged`。 */
  const CLOSED = {
    data: [
      {
        number: 2237,
        state: "closed",
        is_merged: true,
        head: { ref: "refs/heads/fix/a", sha: "dd16f7ec" },
      },
      {
        number: 2244,
        state: "closed",
        is_merged: false,
        head: { ref: "refs/heads/fix/b", sha: "aa11bb22" },
      },
      {
        number: 2245,
        state: "closed",
        is_merged: true,
        head: { ref: "refs/heads/fix/c", sha: "cc33dd44" },
      },
    ],
  };

  it("sha 逐字相等且 `is_merged` 为真才算命中", () => {
    expect(findMergedPullForHeadSha(CLOSED, "dd16f7ec")).toBe(2237);
    /* 同一笔 sha 挂在别的分支上也算：判的是「这一笔进过主干」，不是「这条分支合过」。 */
    expect(findMergedPullForHeadSha(CLOSED, "cc33dd44")).toBe(2245);
  });

  it("三条反面各拦一种误读：关了没合 / sha 不同 / sha 为空", () => {
    /* is_merged=false 的那条 sha 就算撞上也不算 —— 列表状态词与「合了」是两件事。 */
    expect(findMergedPullForHeadSha(CLOSED, "aa11bb22")).toBeNull();
    expect(findMergedPullForHeadSha(CLOSED, "ff99ee88")).toBeNull();
    expect(findMergedPullForHeadSha(CLOSED, "")).toBeNull();
    expect(
      findMergedPullForHeadSha(CLOSED, /* SAFETY: 类型断言已复核 */ undefined as never),
    ).toBeNull();
  });

  it("信封形状：只给 HTTP `status` 不给 data 时不算命中（与「信封不等于终态」同一条）", () => {
    expect(findMergedPullForHeadSha({ status: 200 }, "dd16f7ec")).toBeNull();
    expect(findMergedPullForHeadSha(null, "dd16f7ec")).toBeNull();
    /* `data.data` 那一层嵌套（分页信封）也要认，否则整格恒为「没查到」。 */
    expect(
      findMergedPullForHeadSha(
        {
          data: { data: [{ number: 1, is_merged: true, head: { sha: "x" } }] },
        },
        "x",
      ),
    ).toBe(1);
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
    expect(plan.some((l) => l.includes("--base master --head feat/x"))).toBe(true);
    for (const line of plan.filter((l) => l.startsWith("cnb "))) {
      expect(line, `计划里这条 cnb 调用没带 -v：${line}`).toContain("-v");
    }
  });

  it("PR 处理人标签与独立回读成对出现，且只在配了留痕时进计划", () => {
    const plain = planCommands(st).join("\n");
    expect(plain).not.toContain("post-pull-labels");
    const withLabel = planCommands({ ...st, handle: "yuedu-win" }).join("\n");
    expect(withLabel).toContain("cnb pulls post-pull-labels");
    expect(withLabel).toContain("--labels 处理人:yuedu-win");
    // 回读不是可选步骤：只打不回读，dry-run 就把「回执即结论」教给读者。
    expect(withLabel).toContain("cnb pulls list-pull-labels");
    expect(withLabel.indexOf("post-pull-labels")).toBeLessThan(
      withLabel.indexOf("list-pull-labels"),
    );
  });

  it("领取 / 结束 / 列表三格只在各自旗标下进计划，且每条写动作后都有回读", () => {
    const plain = planCommands(st).join("\n");
    expect(plain).not.toContain("--claim");
    expect(plain).not.toContain("delete-issue-label");
    expect(plain).not.toContain("list-issues");

    const claim = planCommands({
      ...st,
      handle: "yuedu-win",
      claim: 2187,
    }).join("\n");
    expect(claim).toContain("cnb issues post-issue-labels");
    expect(claim).toContain("--labels 处理人:yuedu-win");
    expect(claim).toContain("--labels 参与人:yuedu-win");
    expect(claim).toContain("cnb issues post-issue-comment");
    // 两枚标签都打完才回读：两枚都看得见才念「已打上」。
    expect(claim.lastIndexOf("--labels 参与人:yuedu-win")).toBeLessThan(
      claim.lastIndexOf("get-issue"),
    );
    // 打标签与发评论之后各有一处独立回读（get-issue / list-issue-comments）。
    expect(claim.indexOf("post-issue-labels")).toBeLessThan(claim.lastIndexOf("get-issue"));
    expect(claim.indexOf("post-issue-comment")).toBeLessThan(
      claim.lastIndexOf("list-issue-comments"),
    );

    const release = planCommands({
      ...st,
      handle: "yuedu-win",
      release: 2188,
    }).join("\n");
    expect(release).toContain("cnb issues post-issue-comment");
    expect(release).toContain("cnb issues delete-issue-label");
    expect(release).toContain("--name 处理人:yuedu-win");
    // 先评论、再撤标签：反过来的顺序会把「结束」这句话丢掉。
    expect(release.indexOf("post-issue-comment")).toBeLessThan(
      release.indexOf("delete-issue-label"),
    );

    const list = planCommands({
      ...st,
      handle: "yuedu-win",
      claims: true,
    }).join("\n");
    expect(list).toContain("cnb issues list-issues");
    expect(list).toContain("--labels 处理人:yuedu-win");
    expect(list).toContain("--state open");
  });

  it("合并那一行只在 merge 为真时出现（默认不合并这条纪律的自证）", () => {
    expect(planCommands(st).some((l) => l.includes("merge-pull"))).toBe(true);
    expect(planCommands({ ...st, merge: false }).some((l) => l.includes("merge-pull"))).toBe(false);
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
    expect(cleaned).toContain("git show-ref --verify --quiet refs/heads/feat/x");
    /* 远端名用解析出来的那个（夹具里是 cnb），写死 origin 就是两头一起错。 */
    expect(cleaned.join("\n")).not.toContain("origin --delete");
  });

  it("计划里的碎片那一查与执行面同形（取并的两条，不是那条已经没人跑的 ls-files）", () => {
    /* `planCommands` 是抄本，抄本会过期：#2034 把执行面从 `git ls-files changelog.d`
     * （数出整个目录 118 份 ⇒ 那条守卫恒真）改成「分支相对主干已提交的 ∪ 还没提交的」
     * 之后，计划里那一行还停在旧取数面上。dry-run 是给人的第一份说明书，
     * 它写着一件不存在的查询，就把错的取数面教给了读者。 */
    const plan = planCommands(st);
    expect(plan).toContain("git diff --name-only cnb/master...HEAD -- changelog.d");
    expect(plan).toContain("git status --porcelain -- changelog.d");
    expect(plan.join("\n")).not.toContain("git ls-files");
    /* 带斜杠的主干名（往 release 线开 PR）不能被拼成 `cnb/release`。 */
    expect(
      planCommands({
        ...st,
        remote: "cnb",
        baseBranch: "release/2026-10",
      }).some((l) => l.includes("git diff --name-only cnb/release/2026-10...HEAD")),
    ).toBe(true);
  });

  it("--diagnose / --new-issue 的计划各自只在自己的旗标下出现", () => {
    /* 默认那份计划里两格都不该有：`--diagnose` 是额外读的一格，`--new-issue` 是
     * 伸手建单 —— 出现在默认计划里，dry-run 教的执行面就比人请求的大。 */
    const plain = planCommands(st).join("\n");
    expect(plain).not.toContain("get-build-stage");
    expect(plain).not.toContain("create-issue");

    expect(planCommands({ ...st, diagnose: true }).join("\n")).toContain(
      "cnb build get-build-stage",
    );
    const made = planCommands({
      ...st,
      handle: "yuedu-win",
      newIssue: true,
    }).join("\n");
    expect(made).toContain("cnb issues create-issue");
    expect(made).toContain("--labels 提单人:yuedu-win");
    // 标签只能建完之后按（create-issue --labels 实测不落地）。
    expect(made.indexOf("create-issue")).toBeLessThan(made.indexOf("post-issue-labels"));
    expect(made.indexOf("post-issue-labels")).toBeLessThan(made.indexOf("get-issue"));
  });

  it("对账：计划里的「模块+工具」对 ⇄ 源码里真实调用的，必须同集合", () => {
    /* `planCommands` 是命令清单的第二份抄本 —— 这正是要避免的形态，所以不装作它不是：
     * 这里把它与真执行面**逐条对账**，任何一侧新增/改名而另一侧没跟，这条就红。
     * 只比「模块 + 工具」这一对（参数值里有 `<tmp>` / `…` 这类占位，逐字比会脆）。
     * 取数面是 `scripts/ship*.mjs` **整个族** + `ci-build-readout.mjs`（`--diagnose`
     * 与 `ci-build-readout` 自己的入口共用同一份取数，那些 `cnbJson` 调用就在后者里）：
     * cnb 调用从编排入口搬去平台侧模块时，只读单份文件的提取会抓到 0 条 ⇒ 两侧都空集、
     * 于是恒绿，而下面那条前置断言就是拦住这种「提取坏了却看起来像结论」的。 */
    const shipDir = path.resolve(__dirname, "../scripts");
    const src = readdirSync(shipDir)
      .filter((f) => /^ship.*\.mjs$/.test(f) || f === "ci-build-readout.mjs")
      .map((f) => readFileSync(path.join(shipDir, f), "utf8"))
      .join("\n");
    /** 从 `cnbJson(run, ["pulls", "post-pull", …])` 里抽出前两个字符串。 */
    const called = new Set<string>();
    for (const m of src.matchAll(/cnbJson\(run,\s*\[\s*"(\w+)"\s*,\s*"([\w-]+)"/g)) {
      called.add(`${m[1]} ${m[2]}`);
    }
    const planned = new Set<string>();
    /* 两个显式动作**都拨上**才是「源码里可能伸手的全部集合」：`--merge` 与
     * `--close-issue` 各自的命令都只在对应旗标下进计划（默认那份是子集）。
     * 只拨一个的话，另一格新增的调用会在这条对账里被漏看 —— 而这条对账的存在
     * 理由恰恰是「计划与执行两头一起错时没人响」。`--diagnose` / `--new-issue`
     * 与领取那三格同理：它们的读 / 写命令只在各自旗标下出现。 */
    for (const line of planCommands({
      ...st,
      merge: true,
      closeIssue: true,
      handle: "yuedu-win",
      claim: 2187,
      release: 2188,
      claims: true,
      newIssue: true,
      comment: true,
      diagnose: true,
    })) {
      const m = /^cnb (\w+) ([\w-]+)/.exec(line);
      if (m) {
        planned.add(`${m[1]} ${m[2]}`);
      }
    }
    // 前置断言：提取本身要真的抓到东西（正则写漂会让两侧都成空集、于是恒绿）。
    expect(called.size, "从源码里一条 cnb 调用都没抽到 ⇒ 提取正则坏了").toBeGreaterThan(0);
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
        subjects: ["fix(ship): 主体的那一笔", "docs(changelog): 补碎片", "test: 加一条反向样本"],
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

  it("配了留痕 ⇒ 正文开头一行粗体署名；没配 ⇒ 写「未配」而不是编一个名字", () => {
    const withHandle = buildPullBody({
      root: process.cwd(),
      fragments: [],
      diffstat: " 1 file changed",
      handle: "yuedu-win",
    });
    expect(withHandle.startsWith("**[评论人：yuedu-win]**\n\n")).toBe(true);
    const without = buildPullBody({
      root: process.cwd(),
      fragments: [],
      diffstat: " 1 file changed",
    });
    expect(without.startsWith("**[评论人：未配]**\n\n")).toBe(true);
    expect(without).not.toContain("yuedu-win");
    // 正文里不出现旧的 `dev:` 形态：那一维已经拆成「提单人 / 处理人」两个角色。
    expect(withHandle).not.toContain("dev:");
  });

  it("负控制：正文里不许出现 check-commit-claims 会拿事实复核的那三种句式", () => {
    // ①「§x.y 照旧保留」②「<path> 一个字没动」③「N 处…收到 0」。
    // 脚本没跑过那些判据，写出来就是**未经验证的声明**进了历史。
    const body = buildPullBody({
      root: process.cwd(),
      fragments: ["changelog.d/0-x.md"],
      diffstat: " 3 files changed",
    });
    for (const banned of ["照旧保留", "一个字没动", "收到 0", "收到0", "没动"]) {
      expect(body, `正文里出现了未经验证的声明句式：${banned}`).not.toContain(banned);
    }
  });
});

/**
 * PR 正文的**摘要性**（ISSUE #2248）。
 *
 * 起因是实测：#2231 那次改动面 2673 个文件，`git diff --stat` 原样贴进正文 = 166324 字节，
 * 而平台对正文的硬上限是 65535 ⇒ 建 PR 直接被拒（`errcode 2000003`）。那一格在屏幕上只念
 * 「响应里没有 PR 号 ⇒ 没跑起来」，看不出是**正文太长** —— 于是「改动面大」这一件事本身
 * 就成了「PR 建不出来」，红的形态与被判对象毫无关系。
 */
describe("PR 正文：diffstat 是摘要而不是清单，改动面再大也不许顶穿上限（ISSUE #2248）", () => {
  const ok = (stdout: string): FakeResult => ({
    status: 0,
    stdout,
    stderr: "",
    error: null,
  });

  /** 造一份 `git diff --stat` 的形状：N 行逐文件明细，末行是总数（顺序与 git 一致）。 */
  const statText = (n: number) =>
    [
      ...Array.from({ length: n }, (_, i) => `  docs/generated/x${i}.md | 1 +`),
      ` ${n} files changed, ${n} insertions(+)`,
    ].join("\n");

  /** 直调 `createOrReusePull` 的量具：记下每一次命令，以及交给 `mkTmp` 的那份正文。 */
  function pullHarness(env: { postPull?: FakeResult; stat?: string; } = {}) {
    const calls: Array<string> = [];
    const bodies: Array<string> = [];
    const heard: Array<string> = [];
    const run = (cmd: string, args: Array<string>): FakeResult => {
      const key = args.join(" ");
      calls.push(`${cmd} ${key}`);
      if (cmd === "cnb" && key.includes("list-pulls")) {
        return ok('{"status":200,"data":[]}');
      }
      if (cmd === "cnb" && key.includes("post-pull")) {
        return env.postPull ?? ok('{"status":201,"data":{"number":3002}}');
      }
      if (cmd === "git" && key.startsWith("diff --stat")) {
        return ok(env.stat ?? "");
      }
      return ok("");
    };
    const io = {
      run,
      log: (s: string) => heard.push(s),
      mkTmp: (_name: string, text: string) => {
        bodies.push(text);
        return "C:/tmp/comfy-ship-tmp/body";
      },
      root: process.cwd(),
      slug: "x/y",
      branch: "feat/big",
      frags: ["changelog.d/0-x.md"],
      baseRef: "cnb/master",
      baseBranch: "master",
      explicitTitle: "fix(x): 一句话说得完",
      handle: null,
    };
    return { calls, bodies, heard, io };
  }

  it("capDiffstat 对账：列出的 + 省略的 === 逐行明细总数，且总计数行永远留下", () => {
    const big = capDiffstat(statText(3000), 40);
    expect(big.total).toBe(3000);
    expect(big.listed + big.omitted).toBe(big.total);
    expect(big.omitted).toBe(2960);
    // 裁的是逐行明细，不是「这次动了多少」那一行 —— 被裁之后它是读者唯一的量。
    expect(big.text.split("\n")).toContain(" 3000 files changed, 3000 insertions(+)");
    expect(big.note).toContain("另有 2960 条未列出");
    const small = capDiffstat(" a.ts | 1 +\n b.ts | 2 +-\n 2 files changed, 1 insertion(+)");
    expect(small.omitted).toBe(0);
    expect(small.note, "没裁却念「被裁了」就是量具说谎").toBe("");
    expect(small.text).toContain("a.ts");
  });

  it("正文长度与改动面无关：3000 行的 diffstat 发出去的正文仍在上限之内", () => {
    const { calls, bodies, io } = pullHarness({ stat: statText(3000) });
    const out = createOrReusePull(io);
    expect(out.number).toBe(3002);
    expect(calls.some((c) => c.includes("post-pull"))).toBe(true);
    expect(bodies.length, "正文必须经 mkTmp 落一次，否则断的是空串").toBe(1);
    const [body = ""] = bodies;
    expect(body.length).toBeLessThan(PULL_BODY_LIMIT);
    // 省略必须被说出来：省了多少条、为什么，以及去哪里看全量。
    expect(body).toContain("前 40 条");
    expect(body).toContain("另有 2960 条未列出");
    expect(body).toContain(" 3000 files changed");
  });

  it("小改动面原样进正文，不出现「未列出」那句话", () => {
    const { bodies, io } = pullHarness({
      stat: " a.ts | 1 +\n b.ts | 2 +-\n 2 files changed, 1 insertion(+)",
    });
    createOrReusePull(io);
    expect(bodies[0]).toContain("a.ts | 1 +");
    expect(bodies[0]).not.toContain("未列出");
  });

  it("封顶之后仍然装不下（碎片清单自己就顶穿上限）⇒ 一次 post-pull 都不发，并念出「不建 PR」", () => {
    /* 这一格证明的是「减半」真的在承重：不是「40 条大概够用」的乐观假设。
     * 碎片清单不在裁剪面里（少列一份碎片就等于漏报这次带了什么），所以它自己超长时
     * 唯一诚实的出口是**不发**，并把已经量到的上限念出来。 */
    const frags = Array.from({ length: 900 }, (_, i) => `changelog.d/${"z".repeat(80)}${i}.md`);
    const { calls, bodies, heard, io } = pullHarness({ stat: statText(3000) });
    const out = createOrReusePull({ ...io, frags });
    expect(
      calls.some((c) => c.includes("post-pull")),
      "超上限还发给平台，拿到的是一条 400 而不是一个结论",
    ).toBe(false);
    expect(bodies).toEqual([]);
    expect(out.number).toBeFalsy();
    const all = heard.join("\n");
    expect(all).toContain("不建 PR");
    expect(all).toContain(String(PULL_BODY_LIMIT));
  });

  it("平台给的拒绝（errcode / errmsg）单独念一行，不靠响应原文那个字符窗口", () => {
    const { heard, io } = pullHarness({
      postPull: {
        status: 0,
        stdout:
          '{"status":400,"data":{"errcode":2000003,"errmsg":"body length exceeded the limit 65,535"}}',
        stderr: "",
        error: null,
      },
    });
    const out = createOrReusePull(io);
    expect(out.number).toBeFalsy();
    const all = heard.join("\n");
    expect(all).toContain("平台给的拒绝：errcode=2000003");
    expect(all).toContain("body length exceeded the limit 65,535");
    expect(all).toContain("没有 PR 号");
  });

  it("readPullCreateError：只认 errcode / errmsg 这两个键名，成功响应一律回 null", () => {
    expect(
      readPullCreateError({
        status: 400,
        data: {
          errcode: 2000003,
          errmsg: "body length exceeded the limit 65,535",
        },
      }),
    ).toEqual({
      errcode: "2000003",
      errmsg: "body length exceeded the limit 65,535",
    });
    expect(readPullCreateError({ status: 201, data: { number: 3002 } })).toBeNull();
    // 没有 errcode 的旧形状不猜：那一格仍由响应原文转述，不由这里编一个理由。
    expect(readPullCreateError({ status: 400, data: { message: "title invalid" } })).toBeNull();
    expect(readPullCreateError(null)).toBeNull();
  });
});

describe("ship 阶段 0：`.env` 缺键的读数与启动器同一份实现（ISSUE #2215）", () => {
  it("缺键时念 `pnpm env:init`，且不改退码", async () => {
    /* CI 的「受影响用例」格设了 `SKIP_ENV_VALIDATION=1`（`.cnb.yml`），而 `envInitHint()`
     * 按设计在该变量在场时整格静默 —— 不清掉它，这条验的就不是接线而是「跳过时不出声」。
     * 用例自己收起再还原，别让读数取决于跑在谁的机器上。 */
    const savedSkip = process.env.SKIP_ENV_VALIDATION;
    delete process.env.SKIP_ENV_VALIDATION;
    const rootDir = mkdtempSync(path.join(os.tmpdir(), "ship-preflight-env-"));
    fs.writeFileSync(path.join(rootDir, ".env"), "BETTER_AUTH_SECRET=abc\n", "utf8");
    fs.writeFileSync(
      path.join(rootDir, ".env.example"),
      'BETTER_AUTH_SECRET=""\nCOMFYAPP_DEV_HANDLE=""\n',
      "utf8",
    );
    const logs: Array<string> = [];
    const run = (cmd: string, args: Array<string>): FakeResult => {
      const key = args.join(" ");
      if (cmd === "git" && key === "rev-parse --abbrev-ref HEAD") {
        return { status: 0, stdout: "feat/x\n", stderr: "", error: null };
      }
      if (cmd === "git" && key === "rev-parse HEAD") {
        return { status: 0, stdout: "abc1234\n", stderr: "", error: null };
      }
      return { status: 0, stdout: "", stderr: "", error: null };
    };
    try {
      const res = await runPreflightStage({
        run,
        log: (l: string) => logs.push(l),
        relay: () => undefined,
        opt: parseArgs([]),
        root: rootDir,
        up: { remote: "origin", base: "master", source: "remote-head" },
        baseRef: null,
        baseBranch: "master",
        slug: "moon-read/comfy-app-t3",
        cnbOk: true,
        handle: null,
        readInstances: async () => ({ running: false }),
        platform: "linux",
      });
      const text = logs.join("\n");
      expect(text).toContain("环境配置提醒");
      expect(text).toContain("COMFYAPP_DEV_HANDLE");
      expect(text).toContain("pnpm env:init");
      // 读数不改结论：baseRef 取不到仍按原判据落 2。
      expect(res.action).toBe("finish");
      expect(res.codes).toContain(CODE.NOT_RUN);
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
      if (savedSkip === undefined) {
        delete process.env.SKIP_ENV_VALIDATION;
      } else {
        process.env.SKIP_ENV_VALIDATION = savedSkip;
      }
    }
  });
});

/**
 * 依赖新鲜度那一格（ISSUE #2390）：判据的三件不同的事共用一个非零码，
 * 只看退出码就必然把「还没装」念成「红了」—— 而那正是硬规则 26 明令禁止的误读。
 */
/**
 * 依赖新鲜度那一格（ISSUE #2390）：判据的三件不同的事共用一个非零码，
 * 只看退出码就必然把「还没装」念成「红了」—— 而那正是硬规则 26 明令禁止的误读。
 */
describe("readFreshnessState：判据原值里三件不同的事必须分开读", () => {
  /** 这一条用例这次**真跑了**吗。见文件头「`-t` 筛出来的绿」那一节。 */
  function ranThisCase(): boolean {
    return TestRunner.getCurrentTest()?.result?.state !== "skip";
  }

  const json = (o: unknown): FakeResult => ({
    status: Number(/* SAFETY: 类型断言已复核 */ (o as { code?: number }).code ?? 0),
    stdout: JSON.stringify(o),
    stderr: "",
    error: null,
  });

  it("干净 ⇒ clean", () => {
    if (!ranThisCase()) {
      return;
    }
    expect(
      readFreshnessState(
        json({
          code: 0,
          remoteChecked: true,
          remoteDrifts: [],
          installDrift: null,
          envBroken: false,
        }),
      ),
    ).toBe("clean");
  });

  it("远端漂移 ⇒ drift（唯一该念成「红了」的那一档）", () => {
    if (!ranThisCase()) {
      return;
    }
    expect(
      readFreshnessState(
        json({
          code: 1,
          remoteChecked: true,
          remoteDrifts: [{ file: "pnpm-lock.yaml", kind: "modified" }],
          installDrift: null,
          envBroken: false,
        }),
      ),
    ).toBe("drift");
  });

  it("依赖没装 ⇒ no-install（不是漂移，更不是「跑不了门禁」）", () => {
    if (!ranThisCase()) {
      return;
    }
    expect(
      readFreshnessState(
        json({
          code: 1,
          remoteChecked: true,
          remoteDrifts: [],
          installDrift: { state: "no-install", unresolved: [] },
          envBroken: false,
        }),
      ),
    ).toBe("no-install");
  });

  it("没装 + 远端也改过依赖 ⇒ drift：先 pull 再装才是完整动作", () => {
    if (!ranThisCase()) {
      return;
    }
    // 只说「没装」会让人在旧基线上装一套旧依赖，出口漏掉前半步。
    expect(
      readFreshnessState(
        json({
          code: 1,
          remoteChecked: true,
          remoteDrifts: [{ file: "package.json", kind: "modified" }],
          installDrift: { state: "no-install", unresolved: [] },
          envBroken: false,
        }),
      ),
    ).toBe("drift");
  });

  it("envBroken 压过其余（环境不可信时红与绿都不构成结论）", () => {
    if (!ranThisCase()) {
      return;
    }
    expect(
      readFreshnessState(
        json({
          code: 2,
          remoteChecked: false,
          remoteDrifts: [],
          installDrift: { state: "no-install", unresolved: [] },
          envBroken: true,
        }),
      ),
    ).toBe("env");
  });

  it("负控制：起不来 / 形状对不上 ⇒ unknown，既不念「红了」也不念「没问题」", () => {
    if (!ranThisCase()) {
      return;
    }
    expect(readFreshnessState({ status: 1, stdout: "", stderr: "", error: null })).toBe("unknown");
    expect(
      readFreshnessState({
        status: 1,
        stdout: "not json",
        stderr: "",
        error: "ENOENT",
      }),
    ).toBe("unknown");
    // 有 JSON 但没有判据自己的 `code`：读出来的不是那份判据的结论。
    expect(readFreshnessState(json({ remoteDrifts: [], installDrift: null }))).toBe("unknown");
  });
});

describe("ship 阶段 0 的依赖新鲜度那一格：读数分档，不再只看退出码（ISSUE #2390）", () => {
  /** 这一条用例这次**真跑了**吗。见文件头「`-t` 筛出来的绿」那一节。 */
  function ranThisCase(): boolean {
    return TestRunner.getCurrentTest()?.result?.state !== "skip";
  }

  /** 阶段 0 需要的几跳：分支 / sha / 一份碎片；依赖判据那一跳由用例给。 */
  function preflightIo(fresh: FakeResult) {
    const logs: Array<string> = [];
    const run = (cmd: string, args: Array<string>): FakeResult => {
      const key = args.join(" ");
      if (cmd === "node" && key.includes("check-deps-freshness")) {
        return fresh;
      }
      if (cmd === "git" && key === "rev-parse --abbrev-ref HEAD") {
        return { status: 0, stdout: "feat/x\n", stderr: "", error: null };
      }
      if (cmd === "git" && key === "rev-parse HEAD") {
        return { status: 0, stdout: "abc1234\n", stderr: "", error: null };
      }
      if (cmd === "git" && key.includes("status --porcelain -- changelog.d")) {
        return {
          status: 0,
          stdout: "?? changelog.d/2390-x.md\n",
          stderr: "",
          error: null,
        };
      }
      return { status: 0, stdout: "", stderr: "", error: null };
    };
    return { run, logs };
  }

  async function stage(fresh: FakeResult) {
    const { run, logs } = preflightIo(fresh);
    const res = await runPreflightStage({
      run,
      log: (l: string) => logs.push(l),
      relay: () => undefined,
      opt: parseArgs([]),
      root: os.tmpdir(),
      up: { remote: "origin", base: "master", source: "remote-head" },
      baseRef: "origin/master",
      baseBranch: "master",
      slug: "moon-read/comfy-app-t3",
      cnbOk: true,
      handle: null,
      readInstances: async () => ({ running: false }),
      platform: "linux",
    });
    return { res, text: logs.join("\n") };
  }

  it("依赖没装 ⇒ 落 2 并念「还没装」，而不是「红」，且后面的阶段照跑", async () => {
    if (!ranThisCase()) {
      return;
    }
    const { res, text } = await stage({
      status: 1,
      stdout: JSON.stringify({
        code: 1,
        remoteChecked: true,
        remoteDrifts: [],
        installDrift: { state: "no-install", unresolved: [] },
        envBroken: false,
      }),
      stderr: "",
      error: null,
    });
    // 这是本条的立案现场：过去这一格 action=finish + CODE.RED，整条链一步都走不了。
    expect(res.action).toBe("continue");
    expect(res.codes).toContain(CODE.NOT_RUN);
    expect(res.codes).not.toContain(CODE.RED);
    expect(text).toContain("依赖还没装");
    expect(text).toContain("pnpm install");
    expect(text).toContain("硬规则 26");
    // 那句最该被撤掉的话一个字都不许留（它教的正是硬规则 26 禁止的事）。
    expect(text).not.toContain("依赖新鲜度红了");
  });

  it("真漂移 ⇒ 保持 1 且停在阶段 0（该拦的仍然拦）", async () => {
    if (!ranThisCase()) {
      return;
    }
    const { res, text } = await stage({
      status: 1,
      stdout: JSON.stringify({
        code: 1,
        remoteChecked: true,
        remoteDrifts: [{ file: "pnpm-lock.yaml", kind: "modified" }],
        installDrift: null,
        envBroken: false,
      }),
      stderr: "",
      error: null,
    });
    expect(res.action).toBe("finish");
    expect(res.codes).toContain(CODE.RED);
    expect(text).toContain("依赖新鲜度红了");
  });

  it("envBroken ⇒ 2，出口指向 git 读数而不是 `pnpm install`", async () => {
    if (!ranThisCase()) {
      return;
    }
    const { res, text } = await stage({
      status: 2,
      stdout: JSON.stringify({
        code: 2,
        remoteChecked: false,
        remoteDrifts: [],
        installDrift: null,
        envBroken: true,
      }),
      stderr: "",
      error: null,
    });
    expect(res.action).toBe("continue");
    expect(res.codes).toContain(CODE.NOT_RUN);
    expect(res.codes).not.toContain(CODE.RED);
    expect(text).toContain("git 状态");
    expect(text).not.toContain("依赖新鲜度红了");
  });

  it("判据起不来（读数是空的）⇒ 2，既不念「红了」也不念「没问题」", async () => {
    if (!ranThisCase()) {
      return;
    }
    const { res, text } = await stage({
      status: -1,
      stdout: "",
      stderr: "",
      error: "ENOENT",
    });
    expect(res.action).toBe("continue");
    expect(res.codes).toContain(CODE.NOT_RUN);
    expect(text).toContain("没有给出可读的结论");
    expect(text).not.toContain("依赖新鲜度红了");
  });
});

describe("main() 的单子动作：独立于主流程，在 master 上、没碎片时也能跑", () => {
  /** 只答单子动作需要的那几跳 —— 别的一律空响应（走了就是用例失败）。 */
  function issueMainIo(rows: Array<{ number: number; priority: string; title: string }>) {
    const calls: Array<string> = [];
    const log: Array<string> = [];
    const ok = (stdout: string): FakeResult => ({
      status: 0,
      stdout,
      stderr: "",
      error: null,
    });
    const run = (cmd: string, args: Array<string>): FakeResult => {
      calls.push([cmd, ...args].join(" "));
      const key = args.join(" ");
      if (cmd === "cnb" && args[0] === "--version") {
        return ok("1.15.25");
      }
      if (cmd === "git" && key.includes("@{u}")) {
        return ok("");
      }
      if (cmd === "git" && key === "remote") {
        return ok("cnb\n");
      }
      if (cmd === "git" && key.includes("symbolic-ref")) {
        return ok("refs/remotes/cnb/master");
      }
      if (cmd === "git" && key.includes("--abbrev-ref")) {
        return ok("master");
      }
      if (cmd === "git" && key.includes("rev-parse --verify --quiet")) {
        return ok("d02ec9");
      }
      if (cmd === "git" && key.includes("get-url")) {
        return ok("https://cnb.cool/moon-read/comfy-app-t3\n");
      }
      if (cmd === "cnb" && args[0] === "issues" && args[1] === "list-issues") {
        return ok(JSON.stringify({ status: 200, data: rows }));
      }
      return ok("");
    };
    return { run, calls, log };
  }

  it("--claims：不跑 preflight（master 上、没有碎片也照样列得出来）", async () => {
    const f = issueMainIo([{ number: 2187, priority: "P1", title: "领一张单试试" }]);
    const code = await main({
      args: ["--claims"],
      env: { COMFYAPP_DEV_HANDLE: "yuedu-win" },
      run: f.run,
      log: (l) => f.log.push(l),
    });
    expect(code).toBe(CODE.GREEN);
    expect(f.calls.some((c) => c.includes("list-issues"))).toBe(true);
    expect(f.calls.some((c) => c.includes("--state open"))).toBe(true);
    // 主流程那几跳一次都没伸手：单子动作排在阶段 0 之前。
    expect(f.calls.some((c) => c.includes("status --porcelain"))).toBe(false);
    expect(f.calls.some((c) => c.includes("check-deps-freshness"))).toBe(false);
    expect(f.log.join("\n")).toContain("#2187 · P1 · 领一张单试试");
  });

  it("--claim 与 --merge 同跑 ⇒ 2，且一张单子都不碰", async () => {
    const f = issueMainIo([]);
    const code = await main({
      args: ["--claim", "2187", "--merge"],
      env: { COMFYAPP_DEV_HANDLE: "yuedu-win" },
      run: f.run,
      log: (l) => f.log.push(l),
    });
    expect(code).toBe(CODE.NOT_RUN);
    expect(f.calls.some((c) => c.includes("issues"))).toBe(false);
    expect(f.log.join("\n")).toContain("不与");
  });
});

/**
 * `--dry-run` 与「只补关」那一路（ISSUE #2766）。
 *
 * 现场：`pnpm ship --close-issue=2748,2755 --dry-run` 念完「将要执行的命令」那几行，
 * 然后**真的把两张单关掉了** —— 置 `closed/completed`、发「开发结束」评论、撤处理人标签，
 * 三件写动作一件不落。根因不是「dry-run 这个机制不管关单」，而是装配层那一次调用
 * **少传了一个字段**：同一个文件里 `--diagnose` / `--stage-log` / `--claim` 三条独立动作
 * 都带了 `dryRun: opt.dryRun`，只有「只补关」那一条没带。
 *
 * 所以这两条用例**打在 `main()` 上**，不只在 `closeIssues` 上：只测被调方那一层，
 * 「调用点漏传」这个真实回归形永远不会红（本仓反复收的那一型 —— 注入式单测看不见默认出口）。
 * 两条是一对：dry-run 那条钉「写面一条都不发」，对照那条钉「不带它时确实发了一次」——
 * 缺了对照，「整条链根本没跑起来」也会把前者读成绿。
 */
describe("#2766 --dry-run 底下「只补关」：读面照跑，写面一条不发", () => {
  /** 只答这一族要的那几跳；`calls` 记下每一次伸手（含 git，写动作要从里面筛）。 */
  function closeMainIo() {
    const calls: Array<string> = [];
    const log: Array<string> = [];
    const ok = (stdout: string): FakeResult => ({
      status: 0,
      stdout,
      stderr: "",
      error: null,
    });
    const run = (cmd: string, args: Array<string>): FakeResult => {
      calls.push([cmd, ...args].join(" "));
      const key = args.join(" ");
      if (cmd === "cnb" && args[0] === "--version") {
        return ok("1.15.25");
      }
      if (cmd === "git" && key.includes("@{u}")) {
        return ok("");
      }
      if (cmd === "git" && key === "remote") {
        return ok("cnb\n");
      }
      if (cmd === "git" && key.includes("symbolic-ref")) {
        return ok("refs/remotes/cnb/master");
      }
      if (cmd === "git" && key.includes("--abbrev-ref")) {
        return ok("master");
      }
      if (cmd === "git" && key.includes("rev-parse --verify --quiet")) {
        return ok("d02ec9");
      }
      if (cmd === "git" && key.includes("get-url")) {
        return ok("https://cnb.cool/moon-read/comfy-app-t3\n");
      }
      if (cmd === "cnb" && args[0] === "pulls" && args[1] === "get-pull") {
        return ok(
          JSON.stringify({
            status: 200,
            data: { number: 2069, is_merged: true, title: "fix(a): 那一格 (#2070)" },
          }),
        );
      }
      if (cmd === "cnb" && args[0] === "issues" && args[1] === "update-issue") {
        return ok(JSON.stringify({ status: 200, data: { number: 2070, state: "closed" } }));
      }
      if (cmd === "cnb" && args[0] === "issues" && args[1] === "get-issue") {
        return ok(
          JSON.stringify({
            status: 200,
            data: {
              number: 2070,
              state: "closed",
              state_reason: "completed",
              closed_at: "2026-10-30T08:19:09Z",
              /* 处理人标签**不在场**：这一族自己会念「不代发『开发结束』、不动标签」，
               * 对照组因此只余「关单」这一件写动作要盯。 */
              labels: [],
            },
          }),
        );
      }
      return ok("");
    };
    /** 写面那四条命令（读面是 get-issue / get-pull / list-*）。 */
    const WRITE = ["update-issue", "post-issue-comment", "post-issue-labels", "delete-issue-label"];
    const writes = (list: Array<string>) => list.filter((c) => WRITE.some((w) => c.includes(w)));
    return { run, calls, log, writes };
  }

  const ARGS = ["--close-issue", "2070", "--as-merged", "2069"];

  it("带 --dry-run ⇒ 凭据照样回读，四件写动作一件不发，退 0（它跑起来了，结论是「可以关而这次没写」）", async () => {
    const f = closeMainIo();
    const code = await main({
      args: [...ARGS, "--dry-run"],
      env: { COMFYAPP_DEV_HANDLE: "yuedu-win" },
      run: f.run,
      log: (l) => f.log.push(l),
    });
    expect(code).toBe(CODE.GREEN);
    expect(f.writes(f.calls)).toEqual([]);
    // 读面照跑：落地证明仍取自平台回读，不是被 dry-run 跳过。
    expect(f.calls.some((c) => c.includes("get-pull"))).toBe(true);
    const all = f.log.join("\n");
    expect(all).toContain("is_merged=true");
    expect(all).toContain("#2070 将置 state=closed / state_reason=completed");
    expect(all).toContain("一条写命令都没发");
  });

  it("同一组旗标不带 --dry-run ⇒ 确实发了一次 update-issue（对照：缺了它，上一条能被「整条没跑」冒充绿）", async () => {
    const f = closeMainIo();
    const code = await main({
      args: ARGS,
      env: { COMFYAPP_DEV_HANDLE: "yuedu-win" },
      run: f.run,
      log: (l) => f.log.push(l),
    });
    expect(code).toBe(CODE.GREEN);
    const updates = f.calls.filter((c) => c.includes("update-issue"));
    expect(updates).toHaveLength(1);
    expect(updates[0]).toContain("--state closed --state-reason completed");
    expect(f.log.join("\n")).not.toContain("一条写命令都没发");
  });
});

/**
 * `--diagnose`（ISSUE #2217）：CI 红了之后只读取回失败格与日志摘要。
 *
 * 判据落在三件事上：
 *   ① 真红 ⇒ 1 且屏幕上出现失败行（不是只给一个日志链接）；
 *   ② 绿 ⇒ 0，且**一次也不按格取日志**（那是红才需要的读）；
 *   ③ 不给构建号时按 HEAD 的 sha 归属；归属不到 ⇒ 2（没结论），不拿最新一条顶。
 */
describe("--diagnose：只读取回失败格与日志摘要", () => {
  const FAILED = {
    status: 200,
    data: {
      status: "error",
      pipelinesStatus: {
        "p-001": {
          id: "p-001",
          name: "质量门禁",
          status: "error",
          stages: [
            { status: "success", name: "Prepare", id: "prepare" },
            { status: "success", name: "安装依赖", id: "stage-0" },
            { status: "error", name: "受影响用例", id: "stage-1" },
            { status: "skipped", name: "生产构建", id: "stage-2" },
          ],
        },
      },
    },
  };
  const GREEN = {
    status: 200,
    data: {
      status: "success",
      pipelinesStatus: {
        "p-001": {
          id: "p-001",
          name: "质量门禁",
          status: "success",
          stages: [
            { status: "success", name: "安装依赖", id: "stage-0" },
            { status: "success", name: "受影响用例", id: "stage-1" },
          ],
        },
      },
    },
  };
  const STAGE_DETAIL = {
    status: 200,
    data: {
      status: "error",
      duration: 93,
      error: "",
      content: ["RUN v5.0.3", " × 缺键时念 pnpm env:init 5ms", " Test Files  1 failed (1)"],
    },
  };

  function diagnoseIo(opts: {
    build?: unknown;
    builds?: Array<unknown>;
    headSha?: string;
    stage?: unknown;
  }) {
    const calls: Array<string> = [];
    const log: Array<string> = [];
    const ok = (stdout: string): FakeResult => ({
      status: 0,
      stdout,
      stderr: "",
      error: null,
    });
    const run = (cmd: string, args: Array<string>): FakeResult => {
      calls.push([cmd, ...args].join(" "));
      const key = args.join(" ");
      if (cmd === "cnb" && args[0] === "--version") {
        return ok("1.15.25");
      }
      if (cmd === "git" && key.includes("@{u}")) {
        return ok("");
      }
      if (cmd === "git" && key === "remote") {
        return ok("origin\n");
      }
      if (cmd === "git" && key.includes("symbolic-ref")) {
        return ok("refs/remotes/origin/master");
      }
      if (cmd === "git" && key.includes("--abbrev-ref")) {
        return ok("feat/x");
      }
      if (cmd === "git" && key.includes("rev-parse --verify --quiet")) {
        return ok("d02ec9");
      }
      if (cmd === "git" && key.includes("get-url")) {
        return ok("https://cnb.cool/moon-read/comfy-app-t3\n");
      }
      if (cmd === "git" && key.includes("rev-parse HEAD")) {
        return ok(opts.headSha ?? "d02ec96364d5f3713b77c91b0d3fe789878f1747");
      }
      if (cmd === "cnb" && args[0] === "build" && args[1] === "get-build-logs") {
        return ok(JSON.stringify({ status: 200, data: opts.builds ?? [] }));
      }
      if (cmd === "cnb" && args[0] === "build" && args[1] === "get-build-status") {
        return ok(JSON.stringify(opts.build ?? null));
      }
      if (cmd === "cnb" && args[0] === "build" && args[1] === "get-build-stage") {
        return ok(JSON.stringify(opts.stage ?? {}));
      }
      return ok("");
    };
    return { run, calls, log };
  }

  const runMain = (f: ReturnType<typeof diagnoseIo>, args: Array<string>) =>
    main({
      args,
      run: f.run,
      log: (l: string) => f.log.push(l),
    });

  it("真红 ⇒ 1：点名红格、给出带行号的失败行与完整日志链接，且不写平台", async () => {
    const f = diagnoseIo({ build: FAILED, stage: STAGE_DETAIL });
    const code = await runMain(f, ["--diagnose", "cnb-723-1k5h25hkt"]);
    const text = f.log.join("\n");
    expect(code).toBe(CODE.RED);
    expect(text).toContain("真失败");
    expect(text).toContain("失败格：受影响用例");
    expect(text).toContain("L2  × 缺键时念 pnpm env:init");
    expect(text).toContain("Test Files  1 failed");
    expect(text).toContain("base-check.mjs");
    // 只读：一条写动作都没发（建 / 评论 / 合并 / 关单）。
    for (const write of ["post-", "merge-pull", "update-issue", "delete-", "create-issue"]) {
      expect(
        f.calls.some((c) => c.includes(write)),
        `发了写动作：${write}`,
      ).toBe(false);
    }
  });

  it("绿 ⇒ 0，且一次也不按格取日志（那是红才需要的读）", async () => {
    const f = diagnoseIo({ build: GREEN });
    const code = await runMain(f, ["--diagnose", "cnb-green"]);
    expect(code).toBe(CODE.GREEN);
    expect(f.log.join("\n")).toContain("绿");
    expect(f.calls.some((c) => c.includes("get-build-stage"))).toBe(false);
  });

  it("不给构建号 ⇒ 按 HEAD 的 sha 在 pull_request 构建里归属", async () => {
    const f = diagnoseIo({
      build: FAILED,
      stage: STAGE_DETAIL,
      builds: [
        {
          sn: "cnb-old",
          sha: "0000000",
          event: "pull_request",
          createTime: "2026-10-22T00:00:00Z",
        },
        {
          sn: "cnb-mine",
          sha: "d02ec96364d5f3713b77c91b0d3fe789878f1747",
          event: "pull_request",
          createTime: "2026-10-23T01:00:00Z",
        },
      ],
    });
    const code = await runMain(f, ["--diagnose"]);
    expect(code).toBe(CODE.RED);
    expect(f.log.join("\n")).toContain("归属到构建 cnb-mine");
    expect(f.calls.some((c) => c.includes("--sn cnb-mine"))).toBe(true);
  });

  it("归属不到 ⇒ 2（没有结论），不拿「最新那条」顶上", async () => {
    const f = diagnoseIo({ build: FAILED, builds: [] });
    const code = await runMain(f, ["--diagnose"]);
    expect(code).toBe(CODE.NOT_RUN);
    expect(f.log.join("\n")).toContain("没找到 pull_request 构建");
    expect(f.calls.some((c) => c.includes("get-build-status"))).toBe(false);
  });

  it("与 --merge 同跑 ⇒ 2，且一条 build 命令都不发（一次只做一件）", async () => {
    const f = diagnoseIo({});
    const code = await runMain(f, ["--diagnose", "--merge"]);
    expect(code).toBe(CODE.NOT_RUN);
    expect(f.log.join("\n")).toContain("不与");
    expect(f.calls.some((c) => c.includes("get-build"))).toBe(false);
  });

  it("--dry-run 只打印计划，不读平台", async () => {
    const f = diagnoseIo({});
    const code = await runMain(f, ["--diagnose", "--dry-run"]);
    expect(code).toBe(CODE.GREEN);
    expect(f.log.join("\n")).toContain("--dry-run 计划");
    expect(f.calls.some((c) => c.includes("get-build"))).toBe(false);
  });
});

/**
 * `--new-issue`（ISSUE #2217）：建单 → 补 `提单人:` → 独立回读。
 *
 * 负控制的重点在「回执不算结论」：建单回执给了号，但回读里标签不在 ⇒ 2；
 * 标题对不上 ⇒ 1（公开状态不是请求的那件事）。
 */
describe("--new-issue：一步建单并回读", () => {
  function newIssueIo(opts: { created?: unknown; labelsOk?: boolean; readback?: unknown; }) {
    const calls: Array<string> = [];
    const log: Array<string> = [];
    const ok = (stdout: string): FakeResult => ({
      status: 0,
      stdout,
      stderr: "",
      error: null,
    });
    const run = (cmd: string, args: Array<string>): FakeResult => {
      calls.push([cmd, ...args].join(" "));
      const key = args.join(" ");
      if (cmd === "cnb" && args[0] === "--version") {
        return ok("1.15.25");
      }
      if (cmd === "git" && key.includes("@{u}")) {
        return ok("");
      }
      if (cmd === "git" && key === "remote") {
        return ok("origin\n");
      }
      if (cmd === "git" && key.includes("symbolic-ref")) {
        return ok("refs/remotes/origin/master");
      }
      if (cmd === "git" && key.includes("--abbrev-ref")) {
        return ok("master");
      }
      if (cmd === "git" && key.includes("rev-parse --verify --quiet")) {
        return ok("d02ec9");
      }
      if (cmd === "git" && key.includes("get-url")) {
        return ok("https://cnb.cool/moon-read/comfy-app-t3\n");
      }
      if (cmd === "cnb" && args[0] === "issues" && args[1] === "create-issue") {
        return ok(JSON.stringify(opts.created ?? { data: { number: 2222 } }));
      }
      if (cmd === "cnb" && args[0] === "issues" && args[1] === "post-issue-labels") {
        return ok(opts.labelsOk === false ? "{}" : "{}");
      }
      if (cmd === "cnb" && args[0] === "issues" && args[1] === "get-issue") {
        return ok(
          JSON.stringify(
            opts.readback ?? {
              data: {
                number: 2222,
                state: "open",
                title: "fix(ship): 一步建单",
                priority: "P1",
                labels: [{ name: "提单人:yuedu-win" }],
              },
            },
          ),
        );
      }
      return ok("");
    };
    return { run, calls, log };
  }

  function withBody(text: string) {
    const dir = mkdtempSync(path.join(os.tmpdir(), "ship-new-issue-"));
    const file = path.join(dir, "body.md");
    fs.writeFileSync(file, text, "utf8");
    return { dir, file };
  }

  it("正文开头补一行粗体署名，正文本身一字不改（旧的末尾署名不再追加）", () => {
    const tmp = withBody("## 症状\n\nCI 红了\n");
    try {
      const got = readIssueBody(tmp.dir, tmp.file, "yuedu-win");
      expect(got.ok).toBe(true);
      expect(got.text.startsWith("**[评论人：yuedu-win]**\n\n## 症状")).toBe(true);
      expect(got.text).toContain("CI 红了");
      expect(got.text).not.toContain("提单人:");
      expect(readIssueBody(tmp.dir, tmp.file, null).text.startsWith("**[评论人：未配]**")).toBe(
        true,
      );
    } finally {
      rmSync(tmp.dir, { recursive: true, force: true });
    }
  });

  it("正文文件里自己已写署名行 ⇒ 不再前插第二遍（#2258 那两行的现场）", () => {
    const tmp = withBody("**[评论人：b-win]**\n\n## 症状\n\n正文\n");
    try {
      const got = readIssueBody(tmp.dir, tmp.file, "yuedu-win");
      expect(got.ok).toBe(true);
      expect(got.text.match(/\*\*\[评论人：/g) ?? []).toHaveLength(1);
      expect(got.text).toBe("**[评论人：b-win]**\n\n## 症状\n\n正文\n");
    } finally {
      rmSync(tmp.dir, { recursive: true, force: true });
    }
  });

  const runMain = (
    f: ReturnType<typeof newIssueIo>,
    args: Array<string>,
    tmp: { dir: string },
    env: Record<string, string | undefined> = {
      COMFYAPP_DEV_HANDLE: "yuedu-win",
    },
    /* 「未配留痕」那一格要把 root 指到临时目录：本仓根上有 `.env`，短路回落到它
     * 就等于在开发机上永远测不到「没配」那一形。 */
    root?: string,
  ) =>
    main({
      args,
      run: f.run,
      env,
      log: (l: string) => f.log.push(l),
      resolveGitDir: () => tmp.dir,
      ...(root ? { root } : {}),
    });

  it("建单 → 打 提单人: → get-issue 回读，三件原值念出来", async () => {
    const tmp = withBody("## 症状\n\nCI 红了\n");
    const f = newIssueIo({});
    try {
      const code = await runMain(
        f,
        ["--new-issue", "fix(ship): 一步建单", "--issue-body-file", tmp.file, "--priority", "P1"],
        tmp,
      );
      const text = f.log.join("\n");
      expect(code).toBe(CODE.GREEN);
      expect(f.calls.some((c) => c.includes("create-issue"))).toBe(true);
      expect(f.calls.some((c) => c.includes("post-issue-labels"))).toBe(true);
      expect(f.calls.some((c) => c.includes("get-issue"))).toBe(true);
      expect(text).toContain("✓ #2222 已回读");
      expect(text).toContain("labels=[提单人:yuedu-win]");
      expect(text).toContain("pnpm ship --claim 2222");
      // 不跑主流程任何一段（建单独立于提交 / 合并）。
      expect(f.calls.some((c) => c.includes("status --porcelain"))).toBe(false);
    } finally {
      rmSync(tmp.dir, { recursive: true, force: true });
    }
  });

  it("负控制：回读里没有 提单人: 标签 ⇒ 2（回执不算结论）", async () => {
    const tmp = withBody("## 症状\n\n…\n");
    const f = newIssueIo({
      readback: {
        data: {
          number: 2222,
          state: "open",
          title: "fix(ship): 一步建单",
          priority: "P1",
          labels: [],
        },
      },
    });
    try {
      const code = await runMain(
        f,
        ["--new-issue", "fix(ship): 一步建单", "--issue-body-file", tmp.file],
        tmp,
      );
      expect(code).toBe(CODE.NOT_RUN);
      expect(f.log.join("\n")).toContain("回读里没有 提单人:yuedu-win");
    } finally {
      rmSync(tmp.dir, { recursive: true, force: true });
    }
  });

  it("回读标题与请求不一致 ⇒ 1（公开状态不是这一件事）", async () => {
    const tmp = withBody("## 症状\n\n…\n");
    const f = newIssueIo({
      readback: {
        data: {
          number: 2222,
          state: "open",
          title: "别的标题",
          priority: "P1",
          labels: [{ name: "提单人:yuedu-win" }],
        },
      },
    });
    try {
      const code = await runMain(
        f,
        ["--new-issue", "fix(ship): 一步建单", "--issue-body-file", tmp.file],
        tmp,
      );
      expect(code).toBe(CODE.RED);
      expect(f.log.join("\n")).toContain("不一致");
    } finally {
      rmSync(tmp.dir, { recursive: true, force: true });
    }
  });

  it("缺正文文件 / 词表外的优先级 ⇒ 2，且一条 create-issue 都不发", async () => {
    const tmp = withBody("## 症状\n\n…\n");
    const missing = newIssueIo({});
    try {
      const noBody = await runMain(missing, ["--new-issue", "fix(ship): 一步建单"], tmp);
      expect(noBody).toBe(CODE.NOT_RUN);
      expect(missing.calls.some((c) => c.includes("create-issue"))).toBe(false);

      const badPriority = newIssueIo({});
      const code = await runMain(
        badPriority,
        ["--new-issue", "fix(ship): 一步建单", "--issue-body-file", tmp.file, "--priority", "P9"],
        tmp,
      );
      expect(code).toBe(CODE.NOT_RUN);
      expect(badPriority.calls.some((c) => c.includes("create-issue"))).toBe(false);
    } finally {
      rmSync(tmp.dir, { recursive: true, force: true });
    }
  });

  it("短名是取的 ⇒ 单子照样建、不因「回读没有标签」退 2（ISSUE #2355）", async () => {
    const tmp = withBody("## 症状\n\n…\n");
    const f = newIssueIo({
      readback: {
        data: {
          number: 2222,
          state: "open",
          title: "fix(ship): 一步建单",
          priority: "P2",
          labels: [],
        },
      },
    });
    try {
      const code = await runMain(
        f,
        ["--new-issue", "fix(ship): 一步建单", "--issue-body-file", tmp.file],
        tmp,
        {},
        tmp.dir,
      );
      expect(code).toBe(CODE.GREEN);
      /* 取值链给的短名（`git config user.name` / 兜底 `cnb`）建单时**会**按标签
       * （名字非空就按，ISSUE #2387）：回读里没有它时念一条 ⚠ 读数并给出
       * `--claim` 补上的出口，但**不**退 2 —— 把它读成「你填了却没落上」是
       * ISSUE #2355 拦的那个误判，旧实现那句「是取的 ⇒ 不带标签」与回读互相推翻。 */
      const text = f.log.join("\n");
      expect(text).toContain("没在回读里");
      expect(text).toContain("--claim 2222");
      expect(text).not.toContain("这次建单不带");
    } finally {
      rmSync(tmp.dir, { recursive: true, force: true });
    }
  });

  it("--dry-run 只说要建什么，一条都不写", async () => {
    const tmp = withBody("## 症状\n\n…\n");
    const f = newIssueIo({});
    try {
      const code = await runMain(
        f,
        ["--new-issue", "fix(ship): 一步建单", "--issue-body-file", tmp.file, "--dry-run"],
        tmp,
      );
      expect(code).toBe(CODE.GREEN);
      expect(f.log.join("\n")).toContain("--dry-run");
      expect(f.calls.some((c) => c.includes("create-issue"))).toBe(false);
    } finally {
      rmSync(tmp.dir, { recursive: true, force: true });
    }
  });
});

describe("parseArgs：--diagnose / --new-issue 两格的形状", () => {
  it("--diagnose 的构建号可选，给了就收下", () => {
    const auto = parseArgs(["--diagnose"]);
    expect(auto.diagnose).toBe(true);
    expect(auto.diagnoseSn).toBeNull();
    expect(parseArgs(["--diagnose", "cnb-x"]).diagnoseSn).toBe("cnb-x");
    expect(parseArgs(["--diagnose=cnb-y"]).diagnoseSn).toBe("cnb-y");
  });

  it("--new-issue 缺标题 ⇒ 记进 newIssueBad；正文与优先级各自成格", () => {
    const missing = parseArgs(["--new-issue"]);
    expect(missing.newIssue).toBeNull();
    expect(missing.newIssueBad).toEqual(["(缺标题)"]);
    const full = parseArgs([
      "--new-issue",
      "fix(ship): x",
      "--issue-body-file",
      "body.md",
      "--priority",
      "P1",
    ]);
    expect(full.newIssue).toBe("fix(ship): x");
    expect(full.issueBodyFile).toBe("body.md");
    expect(full.priority).toBe("P1");
    expect(full.newIssueBad).toEqual([]);
    expect(parseArgs(["--new-issue=fix: x"]).newIssue).toBe("fix: x");
    expect(parseArgs(["--priority=P0"]).priority).toBe("P0");
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
    error: string | null;
    status: number;
    stderr: string;
    stdout: string;
  };

  /** 现场形状。 */
  type FakeEnv = {
    /** 那条上游引用在不在本地（验不验得过）。false = `rev-parse --verify` 退非 0。 */
    baseExists?: boolean;
    branch?: string;
    /** 这条分支相对上游基线**已提交**的碎片（第二次跑那一向）。 */
    branchFrags?: Array<string>;
    /** 这条分支相对主干**自己带进来的**提交 subject（`log --no-merges --reverse`）。 */
    branchSubjects?: Array<string>;
    /** 答齐全链（轮询 / 合并 / 清理）那几跳 —— 默认关，见 `fake()` 里那段注释。 */
    chain?: boolean;
    cnbMissing?: boolean;
    commitStatus?: number;
    /** 假 `git commit` 往 **stderr** 写的话（钩子的输出面）。 */
    commitStderr?: string;
    /** 本次要暂存的文件（触发真提交那一支）。 */
    dirty?: Array<string>;
    frags?: Array<string>;
    /** 当前顶端那一笔的 subject（`log -1 --pretty=%s`）—— 默认给一个合并节点形状。 */
    headSubject?: string;
    /** 直接覆盖 `git status --porcelain` 的返回（喂非默认形状，见 #2073 那格）。 */
    porcelain?: string;
    /** `show-ref --verify` 查得到那个 ref（--branch 那一跳的「名字已被占用」形态）。 */
    refExists?: boolean;
    /** 远端默认分支的符号引用（`git symbolic-ref refs/remotes/<远端>/HEAD`）。
     *  `null` = 这台克隆没有它（那样就只能推 `<远端>/master`，且要读得出是推的）。 */
    remoteHead?: string | null;
    /** HEAD 的上游（`git rev-parse --abbrev-ref --symbolic-full-name @{u}`）。 */
    upstream?: string | null;
  };

  /**
   * 造一个 git / cnb / node 的替身，并**记录每一次调用**。
   * 记录才是这一组的核心：断言的不是返回值，而是「它有没有伸手去改世界」。
   */
  function fake(env: FakeEnv = {}) {
    const calls: Array<string> = [];
    const branch = env.branch ?? "feat/x";
    const frags = env.frags ?? ["changelog.d/0-x.md"];
    const dirty = env.dirty ?? [];
    const ok = (stdout: string, stderr = ""): FakeResult => ({
      status: 0,
      stdout,
      stderr,
      error: null,
    });
    const run = (cmd: string, args: Array<string>): FakeResult => {
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
      if (cmd === "git" && key.includes("@{u}")) {
        return ok(env.upstream === null ? "" : (env.upstream ?? "cnb/master"));
      }
      /* 主干那一条有本地可读的权威事实：远端的 `HEAD` 符号引用。
       * 夹具默认给出（与真实克隆一致），`remoteHead: null` 那一格专门演「没有它」。 */
      if (cmd === "git" && key.includes("symbolic-ref")) {
        return env.remoteHead === null
          ? { status: 1, stdout: "", stderr: "", error: null }
          : ok(env.remoteHead ?? "refs/remotes/cnb/master");
      }
      if (cmd === "git" && key.includes("--abbrev-ref")) {
        return ok(branch);
      }
      if (cmd === "git" && key === "remote") {
        return ok("cnb\n");
      }
      if (cmd === "git" && key.includes("rev-parse --verify --quiet")) {
        return env.baseExists === false
          ? { status: 1, stdout: "", stderr: "", error: null }
          : ok("d02ec96364d5f3713b77c91b0d3fe789878f1747");
      }
      /* `show-ref --verify --quiet <ref>`：git 的语义是**查不到退 1**。默认答「查不到」，
       * 因为这一格在 --branch 那一跳判的是「这个名字有没有被占用」—— 拿通用兜底的
       * 退 0 当默认值，等于让夹具自己担保「名字都撞车了」，于是建分支那一格永远走不到。 */
      if (cmd === "git" && key.startsWith("show-ref --verify --quiet")) {
        return env.refExists
          ? ok("9b1bade9cafe9b5a4d76e0c0d0bfb1d1a3a4f9b2")
          : { status: 1, stdout: "", stderr: "", error: null };
      }
      if (cmd === "git" && key.includes("rev-parse HEAD")) {
        return ok("d02ec96364d5f3713b77c91b0d3fe789878f1747");
      }
      // ⚠️ 顺序要紧：碎片那一查也是 `status --porcelain`，只是多一个 `-- changelog.d`。
      if (cmd === "git" && key.includes("status --porcelain -- changelog.d")) {
        return ok(frags.map((f) => `?? ${f}`).join("\n"));
      }
      if (cmd === "git" && key.includes("status --porcelain")) {
        return ok(env.porcelain ?? dirty.map((f) => `M  ${f}`).join("\n"));
      }
      /* 分支相对上游**已提交**的碎片（同一条分支上第二次跑就靠这一格不为空）。
       * 这里**不**按某个写死的基线名命中 —— 命中基线名等于替被测代码担保「它选的
       * 那条引用是对的」。改为照 git 的语义答：拿 HEAD 自己这条分支的远端副本当基线
       * 就是自己比自己 ⇒ 结果必空，这正是那条缺陷的现场。 */
      if (cmd === "git" && key.includes("diff --name-only") && key.includes("...HEAD")) {
        const base = key.replace("diff --name-only ", "").split("...")[0] ?? "";
        if (base === `cnb/${branch}`) {
          return ok("");
        }
        return ok((env.branchFrags ?? []).join("\n"));
      }
      /* 标题的取数面（`deriveTitle` 那一格）：`--no-merges --reverse` 给的是这条分支
       * **自己带进来的**那些提交，`log -1` 给的是当前顶端那一笔。默认把后者设成一个
       * 合并节点、前者设成主体那一笔 —— 缺陷正是拿后者当标题（#2057 在主干上留下的
       * 那行 `Merge branch 'master' into …` 就是这么来的）。 */
      if (cmd === "git" && key.includes("log --no-merges")) {
        return ok((env.branchSubjects ?? ["fix(x): 主体的那一笔"]).join("\n"));
      }
      if (cmd === "git" && key.includes("log -1 --pretty=%s")) {
        return ok(env.headSubject ?? "Merge branch 'master' into fix/x");
      }
      if (cmd === "git" && key.startsWith("commit")) {
        return {
          status: env.commitStatus ?? 0,
          stdout: "",
          stderr: env.commitStderr ?? "",
          error: null,
        };
      }
      if (cmd === "git" && key.includes("get-url")) {
        return ok("https://cnb.cool/moon-read/comfy-app-t3\n");
      }
      /* 依赖新鲜度那一格读的是**判据自己的 `--json` 原值**（ISSUE #2390），
       * 所以夹具要答那份形状：只回一句 "OK" 会被读成「读数不完整」（`unknown` ⇒ 落 2）。 */
      if (cmd === "node" && key.includes("check-deps-freshness")) {
        return ok(FRESH_OK);
      }
      /* ── 整链形状（`chain: true` 才答）───────────────────────────
       * 默认不答，是为了不惊动已有那些用例：它们中好几条判的正是「建 PR 那一跳的
       * 各种失败出口」，一旦 list-pulls 有了可解析的响应就会改走「复用」那条支路。 */
      if (!env.chain) {
        return ok("");
      }
      if (cmd === "git" && key.startsWith("rev-parse --short")) {
        return ok("edda13b6");
      }
      if (cmd === "git" && key.startsWith("cat-file -e")) {
        return ok("");
      }
      if (cmd === "git" && key.startsWith("push cnb --delete")) {
        return ok("");
      }
      if (cmd === "git" && key.startsWith("ls-remote --heads")) {
        return ok("");
      }
      if (cmd === "git" && key.startsWith("branch -D")) {
        return ok("");
      }
      if (cmd === "cnb" && args[0] === "build" && args[1] === "get-build-logs") {
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
      }
      if (cmd === "cnb" && args[0] === "build" && args[1] === "get-build-status") {
        return ok(JSON.stringify({ status: 200, data: { status: "success" } }));
      }
      if (cmd === "cnb" && args[0] === "pulls" && args[1] === "list-pulls") {
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
      }
      if (cmd === "cnb" && args[0] === "pulls" && args[1] === "get-pull") {
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
      }
      if (cmd === "cnb" && args[0] === "pulls" && args[1] === "merge-pull") {
        return ok(
          JSON.stringify({
            status: 200,
            data: {
              merged: true,
              sha: "906bce4c1a0b3f0d6a1c2b3e4f50617283a4b5c6",
            },
          }),
        );
      }
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
    const heard: Array<string> = [];
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
    const heard: Array<string> = [];
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
    const heard: Array<string> = [];
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
    const heard: Array<string> = [];
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
      const heard: Array<string> = [];
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
      const at = (needle: string) => calls.findIndex((c) => c.startsWith(needle));
      expect(at("cnb pulls merge-pull")).toBeGreaterThanOrEqual(0);
      expect(at("git push cnb --delete feat/x")).toBeGreaterThan(at("cnb pulls merge-pull"));
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
    const heard: Array<string> = [];
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
    const heard: Array<string> = [];
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
    expect(heard.join("\n"), "未暂存改动存在却没提醒").toContain("还有未暂存的改动");
  });

  it("阶段 0 念出「单子」那一行，而它是读数：退码不因它改变", async () => {
    /* 默认夹具那份 `changelog.d/0-x.md` 不在盘上 ⇒ 只念「无号碎片 1 份」，
     * **不**指控没立案（首行读不到就不判）。这一条钉的两件事：读数在场、闸不在场。 */
    const heard: Array<string> = [];
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
    const heard: Array<string> = [];
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
      expect(code, "把这条做成闸，人就会去凑一张别人开着的单子（§13.10.8）").toBe(CODE.GREEN);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("基线引用不存在 ⇒ 退 2 并说「没有事实源」，**不许**退成「没有碎片」的红", async () => {
    /* 这一格钉的是「取不到」与「取到且为空」必须长得不一样 —— 而这一版就是在这里
     * 把两件事混成一件的：远端名写死 `origin`，`origin/master...HEAD` 那条 git 直接失败、
     * stdout 为空，于是 preflight 报「没有 changelog.d 碎片」（一条正当的假结论），
     * 而真原因是「这条比对没有事实源」。 */
    const heard: Array<string> = [];
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
    expect(await main({ ...quiet, run, probeCnb: () => false, args: [] })).toBe(CODE.NOT_RUN);
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
    expect(await main({ ...quiet, run, args: ["--only=preflight", "--dry-run"] })).toBe(CODE.GREEN);
  });

  it("提交被钩子拦下时，stderr 上的理由必须被转述出来", async () => {
    /* 这一条是本轮最重的回归。钩子把全部原因写在 **stderr**，而第一版只接 stdout ——
     * 屏幕上就只剩一句「提交被门槛拦下」而一个理由都没有。
     * 一个职责是「如实转述执行者」的工具，把执行者的话弄丢了，比没有这个工具更糟。 */
    const heard: Array<string> = [];
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
    const heard: Array<string> = [];
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
      const heard: Array<string> = [];
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
          ["git commit", "git push", "cnb pulls post-pull"].some((w) => c.startsWith(w)),
        ),
        `--only=${phase} 伸出了写动作`,
      ).toEqual([]);
      expect(heard.join("\n")).toContain("没有任何一段落下结论");
    }
    /* 反向：正常跑完阶段 0 的那几条不许被这条守卫误伤。 */
    const { run } = fake();
    expect(await main({ ...quiet, run, args: ["--only=preflight", "--dry-run"] })).toBe(CODE.GREEN);
  });

  it("同一条分支上第二次跑（碎片已提交、工作树干净）不许被那条守卫拒掉", async () => {
    /* 这是把上一条从「恒真」改成「只看工作树」之后**新引入**的失效：
     * 第一次跑提交了碎片 ⇒ 工作树干净 ⇒ 只看工作树就恒假 ⇒
     * `pnpm ship --merge` 在 preflight 被拒（实测：exit 1「没有 changelog.d 碎片」）。
     * 正确的面是「分支相对上游已提交的 ∪ 还没提交的」，所以这一格必须读到 1 份。 */
    const heard: Array<string> = [];
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
    const heard: Array<string> = [];
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
    expect(all, `基线取成了分支自己的副本 ⇒ ${all.split("\n")[0]}`).toContain("基线 cnb/master");
    expect(all).toContain("碎片 1 份");
    expect(code).toBe(CODE.GREEN);
  });

  it("远端没有 HEAD 符号引用时，退回 <远端>/master 并读得出是推的", async () => {
    const heard: Array<string> = [];
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
    const heard: Array<string> = [];
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
  function overrideRun(base: ReturnType<typeof fake>, answers: Record<string, string>) {
    return (cmd: string, args: Array<string>): FakeResult => {
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
  function proofRoot(tag: string): { gitDir: string; tmpRoot: string; } {
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
      const heard: Array<string> = [];
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
      expect(post, "没建 PR，或标题没进 argv").toContain("--title fix(x): 主体的那一笔");
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
      const heard: Array<string> = [];
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

  it("内容已随某条已合并 PR 落地 ⇒ 不再建 PR：退 2 并给「开新分支」的出口（ISSUE #2250）", async () => {
    /* 现场形状：squash 合并成功会把 PR 转 `closed`，于是「开放清单里没有」那格失效，
     * 同一条分支上再跑一次 ship 会建出一条**内容已在主干**的幽灵 PR —— 它能被再合一次
     * （主干落重复提交），还白烧一轮 CI。夹具的 HEAD 是 `d02ec96…`，这里就让它逐字命中。 */
    const { tmpRoot, gitDir } = proofRoot("landed");
    try {
      const heard: Array<string> = [];
      const base = fake();
      const run = overrideRun(base, {
        "--state open": '{"status":200,"data":[]}',
        "--state closed":
          '{"status":200,"data":[{"number":2237,"state":"closed","is_merged":true,"head":{"ref":"refs/heads/feat/x","sha":"d02ec96364d5f3713b77c91b0d3fe789878f1747"}}]}',
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
        "已落地却还伸手建 PR —— 那条就是幽灵 PR",
      ).toBe(false);
      const all = heard.join("\n");
      expect(all).toContain("已随 PR #2237 落地");
      expect(all).toContain("开新分支");
      expect(code).toBe(CODE.NOT_RUN);
      /* 它确实去问了 closed 那一档，而不是拿 open 那份读数凑过去。 */
      expect(base.calls.some((c) => c.includes("list-pulls") && c.includes("--state closed"))).toBe(
        true,
      );
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("反面：closed 里那条是「关了没合」⇒ 照常建 PR（落地判定不许把所有历史都当已落地）", async () => {
    /* `--state` 没有 `merged` 这一档，`closed` 混着两种 —— 只认 `is_merged` 这件事
     * 只有配上这一格才算钉住：把它写成「sha 出现在 closed 清单里就停」，
     * 被关掉的 PR 那条分支就永远发不出去，而这条红看起来像「幂等坏了」。 */
    const { tmpRoot, gitDir } = proofRoot("closed-unmerged");
    try {
      const base = fake();
      const run = overrideRun(base, {
        "--state open": '{"status":200,"data":[]}',
        "--state closed":
          '{"status":200,"data":[{"number":2240,"state":"closed","is_merged":false,"head":{"ref":"refs/heads/feat/x","sha":"d02ec96364d5f3713b77c91b0d3fe789878f1747"}}]}',
        "post-pull": '{"status":201,"data":{"number":3002}}',
      });
      const code = await main({
        root: tmpRoot,
        run,
        log: () => undefined,
        probeCnb: () => true,
        resolveGitDir: () => gitDir,
        args: ["--no-wait"],
      });
      expect(
        base.calls.find((c) => c.includes("post-pull")) ?? "",
        "关了没合的那条不算落地，PR 该建",
      ).toContain("--title");
      expect(code).toBe(CODE.GREEN);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("落地判定读不到清单 ⇒ 念「未判定」并照建：缺读数不撤销结论", async () => {
    /* 与 `combineEvidence` 那条同一口径：「git/平台问不出来」既不算「已落地」，也不算
     * 「没落地」。把它写成「读不到就停」会多出一条新的假阻塞 —— 网络抖一下，
     * 一条正常的 PR 就发不出去，而屏幕上看不出任何区别。 */
    const { tmpRoot, gitDir } = proofRoot("landed-unknown");
    try {
      const heard: Array<string> = [];
      const base = fake();
      const run = overrideRun(base, {
        "--state open": '{"status":200,"data":[]}',
        "--state closed": "不是 JSON",
        "post-pull": '{"status":201,"data":{"number":3003}}',
      });
      const code = await main({
        root: tmpRoot,
        run,
        log: (s: string) => heard.push(s),
        probeCnb: () => true,
        resolveGitDir: () => gitDir,
        args: ["--no-wait"],
      });
      const all = heard.join("\n");
      expect(all).toContain("未判定");
      expect(all).not.toContain("已随 PR");
      expect(base.calls.some((c) => c.includes("post-pull"))).toBe(true);
      expect(code).toBe(CODE.GREEN);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("显式 `--title` 压过推导，且来源读得出是 flag", async () => {
    const { tmpRoot, gitDir } = proofRoot("flag-title");
    try {
      const heard2: Array<string> = [];
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
    const heard: Array<string> = [];
    const base = fake();
    const run = (cmd: string, args: Array<string>): FakeResult => {
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

  it("建 PR 后打 dev 标签，并**独立回读**才念成功（回执不算结论，ISSUE #2204）", async () => {
    const { tmpRoot, gitDir } = proofRoot("author-label");
    try {
      const heard: Array<string> = [];
      const base = fake();
      const run = overrideRun(base, {
        "list-pulls": '{"status":200,"data":[]}',
        "post-pull-labels": '{"status":200}',
        "list-pull-labels": '{"status":200,"data":[{"name":"处理人:yuedu-win"}]}',
        "post-pull": '{"status":201,"data":{"number":2999}}',
      });
      const code = await main({
        root: tmpRoot,
        run,
        log: (s: string) => heard.push(s),
        probeCnb: () => true,
        resolveGitDir: () => gitDir,
        env: { COMFYAPP_DEV_HANDLE: "yuedu-win" },
        args: ["--no-wait"],
      });
      const all = heard.join("\n");
      expect(code).toBe(CODE.GREEN);
      expect(base.calls).toContain(
        "cnb pulls post-pull-labels --repo moon-read/comfy-app-t3 --number 2999 --labels 处理人:yuedu-win -v",
      );
      expect(base.calls).toContain(
        "cnb pulls list-pull-labels --repo moon-read/comfy-app-t3 --number 2999 -v",
      );
      // 顺序：先打、再独立回读。反过来写等于拿上一次的状态给自己作证。
      const applyAt = base.calls.findIndex((c) => c.includes("post-pull-labels"));
      const readAt = base.calls.findIndex((c) => c.includes("list-pull-labels"));
      expect(applyAt).toBeGreaterThanOrEqual(0);
      expect(readAt).toBeGreaterThan(applyAt);
      expect(all).toContain("✓ PR #2999 标签 处理人:yuedu-win 已回读");
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("回执 200 但回读里没有那个标签 ⇒ 不念「已回读」，也不改退码", async () => {
    const { tmpRoot, gitDir } = proofRoot("author-label-missing");
    try {
      const heard: Array<string> = [];
      const base = fake();
      const run = overrideRun(base, {
        "list-pulls": '{"status":200,"data":[]}',
        "post-pull-labels": '{"status":200}',
        "list-pull-labels": '{"status":200,"data":[]}',
        "post-pull": '{"status":201,"data":{"number":3002}}',
      });
      const code = await main({
        root: tmpRoot,
        run,
        log: (s: string) => heard.push(s),
        probeCnb: () => true,
        resolveGitDir: () => gitDir,
        env: { COMFYAPP_DEV_HANDLE: "yuedu-win" },
        args: ["--no-wait"],
      });
      const all = heard.join("\n");
      expect(all).not.toContain("已回读");
      expect(all).toContain("没有落地证明");
      // 手工补的那条命令必须给全 —— 只说「没打上」等于把下一步吞了。
      expect(all).toContain(
        "cnb pulls post-pull-labels --repo moon-read/comfy-app-t3 --number 3002 --labels 处理人:yuedu-win -v",
      );
      // 留痕是读数，不是闸（#2175 同一条）：标签没落地照样走到 GREEN。
      expect(code).toBe(CODE.GREEN);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("复用已有 PR 而没人填过名字 ⇒ 用取来的短名打标签，并念「这是取的」", async () => {
    const { tmpRoot, gitDir } = proofRoot("author-label-reuse");
    try {
      const heard: Array<string> = [];
      const base = fake();
      const run = overrideRun(base, {
        "list-pulls":
          '{"status":200,"data":[{"number":2888,"head":{"ref":"refs/heads/feat/x"},"base":{"ref":"refs/heads/master"}}]}',
        "post-pull-labels": '{"status":200}',
        "list-pull-labels": '{"status":200,"data":[{"name":"处理人:yuedu-win"}]}',
      });
      const code = await main({
        root: tmpRoot,
        run,
        log: (s: string) => heard.push(s),
        probeCnb: () => true,
        resolveGitDir: () => gitDir,
        env: {},
        args: ["--no-wait"],
      });
      const all = heard.join("\n");
      expect(code).toBe(CODE.GREEN);
      expect(all).toContain("复用，不重建");
      // 没填 ⇒ 不阻断：名字由取值链给，但要念出「这是取的」并给出能固定的下一动作。
      /* 这一跑没有把 `root` 指到临时目录（`main()` 的 root 就是本仓），所以不钉绝对路径 ——
       * 绝对路径那一形由 `whoamiLines` / `issueAuthoring` 的用例钉着。 */
      expect(all).toContain("是**取的**");
      expect(all).toContain("COMFYAPP_DEV_HANDLE");
      expect(all).toContain("pnpm env:init");
      /* 与「填过」那一支的差别只在话术（谁的名字、是不是取的）：取值链给了短名，
       * 标签就照打 —— 过去那支要么打 `处理人:undefined`，要么让「这台机器上没人配」
       * 变成「这张 PR 没有处理人」，两种都更坏。 */
      expect(
        base.calls.find((c) => c.includes("post-pull-labels")),
        "取来的短名也要真的落成标签",
      ).toContain("处理人:");
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("复用已有 PR 且配了 handle ⇒ 同样打标签并回读", async () => {
    const { tmpRoot, gitDir } = proofRoot("author-label-reuse-ok");
    try {
      const heard: Array<string> = [];
      const base = fake();
      const run = overrideRun(base, {
        "list-pulls":
          '{"status":200,"data":[{"number":2888,"head":{"ref":"refs/heads/feat/x"},"base":{"ref":"refs/heads/master"}}]}',
        "post-pull-labels": '{"status":200}',
        "list-pull-labels": '{"status":200,"data":[{"name":"处理人:yuedu-win"}]}',
      });
      const code = await main({
        root: tmpRoot,
        run,
        log: (s: string) => heard.push(s),
        probeCnb: () => true,
        resolveGitDir: () => gitDir,
        env: { COMFYAPP_DEV_HANDLE: "yuedu-win" },
        args: ["--no-wait"],
      });
      expect(code).toBe(CODE.GREEN);
      expect(base.calls).toContain(
        "cnb pulls post-pull-labels --repo moon-read/comfy-app-t3 --number 2888 --labels 处理人:yuedu-win -v",
      );
      expect(heard.join("\n")).toContain("✓ PR #2888 标签 处理人:yuedu-win 已回读");
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("--whoami：只读自查，一次也不碰 cnb，也不受 master 守卫影响", async () => {
    const heard: Array<string> = [];
    const base = fake({ branch: "master" });
    const code = await main({
      root: process.cwd(),
      run: base.run,
      log: (s: string) => heard.push(s),
      probeCnb: () => {
        throw new Error("--whoami 不该探 cnb");
      },
      env: { COMFYAPP_DEV_HANDLE: "yuedu-win" },
      args: ["--whoami"],
    });
    expect(code).toBe(CODE.GREEN);
    expect(base.calls.filter((c) => c.startsWith("cnb "))).toEqual([]);
    const all = heard.join("\n");
    expect(all).toContain("处理人:yuedu-win");
    expect(all).toContain("提单人:yuedu-win");
    expect(all).toContain("cnb pulls post-pull-labels");
    expect(all).toContain("cnb pulls list-pull-labels");
  });
});

/**
 * `--diagnose` 的「还在跑」该念哪句话（ISSUE #2304）。
 *
 * 单发读数没有「上一眼」，所以基数落在 `.git/` 下按构建号分文件；这一组只判**纯函数**
 * 那五条分支 —— 关键是「疑似派发未出勤」要**三件同时成立**（签名不变 + 到阈值 +
 * 没一格在飞），缺一件就不许念出来：那正是 #2184 / #2172 记过的「与正在长跑同形」。
 */
describe("stallReadout：慢、没推进、没派发起来 是三件事（#2304）", () => {
  const SIG_OLD = "b1/pending/0-1+11/37";
  const SIG_NEW = "b1/pending/0-1+30/37";
  const none = { count: 0, names: [] };
  const one = { count: 1, names: ["受影响用例"] };

  it("第一眼看：只落基数，不评价快慢", () => {
    const text = stallReadout({
      signature: SIG_OLD,
      flying: one,
      elapsedMinutes: 0,
      previous: null,
    }).join("\n");
    expect(text).toContain("第一眼看这一跑");
    expect(text).toContain("已落一份基数");
    expect(text).not.toContain("疑似");
  });

  it("落不了基数（git 目录取不到）就说落不了，不念「已落」", () => {
    const text = stallReadout({
      signature: SIG_OLD,
      flying: none,
      elapsedMinutes: 0,
      previous: null,
      stored: false,
    }).join("\n");
    expect(text).toContain("没有可比基数");
    expect(text).toContain("不念停滞");
    expect(text).not.toContain("已落一份基数");
  });

  it("签名变了 ⇒ 在推进，并把上一眼与这一眼并排给出来", () => {
    const text = stallReadout({
      signature: SIG_NEW,
      flying: one,
      elapsedMinutes: 30,
      previous: { signature: SIG_OLD, atMs: 0 },
    }).join("\n");
    expect(text).toContain("在推进");
    expect(text).toContain(SIG_OLD);
    expect(text).toContain(SIG_NEW);
    expect(text).not.toContain("疑似");
  });

  it("签名没变但有格在飞 ⇒ 还在跑（这一档**不许**念成停滞）", () => {
    const text = stallReadout({
      signature: SIG_NEW,
      flying: one,
      elapsedMinutes: 60,
      previous: { signature: SIG_NEW, atMs: 0 },
    }).join("\n");
    expect(text).toContain("还在跑，继续等");
    expect(text).toContain("受影响用例");
    expect(text).not.toContain("疑似");
    expect(text).not.toContain("--rerun-ci");
  });

  it("三件同时成立 ⇒ 念「疑似派发未出勤」，并点名平台不给执行体归属 + 出口 --rerun-ci", () => {
    const text = stallReadout({
      signature: SIG_NEW,
      flying: none,
      elapsedMinutes: DIAGNOSE_STALL_MINUTES,
      previous: { signature: SIG_NEW, atMs: 0 },
    }).join("\n");
    expect(text).toContain("疑似**派发未出勤**");
    expect(text).toContain("runner");
    expect(text).toContain("pnpm ship --rerun-ci");
    expect(text).toContain("仍退 2，不改成红");
  });

  it("签名没变、没格在飞、但没到阈值 ⇒ 先不下判断（阈值这一档是判断的一部分）", () => {
    const text = stallReadout({
      signature: SIG_NEW,
      flying: none,
      elapsedMinutes: DIAGNOSE_STALL_MINUTES - 1,
      previous: { signature: SIG_NEW, atMs: 0 },
    }).join("\n");
    expect(text).toContain("未到");
    expect(text).toContain(String(DIAGNOSE_STALL_MINUTES));
    expect(text).not.toContain("疑似");
    expect(text).not.toContain("--rerun-ci");
  });
});

/**
 * `--rerun-ci` 那一格（ISSUE #2354）。
 *
 * 现场：平台侧没有 PR 重跑入口（`cnb build` 只有 start/stop，`--event` 只认 api_trigger 前缀），
 * 于是「红了的 PR 再跑一次」唯一的名字就是这一格；而它推的是**空提交**，D0 里有两步读当场
 * 暂存区、把空索引写成「取不到判决面 ⇒ 退 2」⇒ 钩子拦下提交，这个入口从写下那天起没走过一次。
 * 这里钉的不是返回值，是**那一调带没带上说出来的意图** —— 不带，修复就是装饰。
 */
describe("--rerun-ci：空提交要说出自己的意图，否则 D0 把它读成「取不到面」", () => {
  type RunCall = {
    args: Array<string>;
    cmd: string;
    opts?: { env?: Record<string, string> };
  };

  function rerunIo(env: { branch?: string; commitStatus?: number; dryRun?: boolean }) {
    const seen: Array<RunCall> = [];
    const log: Array<string> = [];
    const run = (cmd: string, args: Array<string>, opts?: { env?: Record<string, string> }) => {
      seen.push({ cmd, args, opts });
      if (args[0] === "commit") {
        return {
          status: env.commitStatus ?? 0,
          stdout: "",
          stderr: env.commitStatus ? "no changes added to commit" : "",
        };
      }
      if (args[0] === "rev-parse") {
        return { status: 0, stdout: "abc123\n", stderr: "" };
      }
      return { status: 0, stdout: "", stderr: "" };
    };
    const code = runRerunCiStage({
      up: { remote: "cnb" },
      branch: env.branch ?? "feat/x",
      root: "G:/nowhere",
      log: (s: string) => log.push(s),
      run,
      relay: () => undefined,
      opt: { dryRun: env.dryRun ?? false },
    });
    return { code, log: log.join("\n"), seen };
  }

  it("提交那一调带上刻意空提交的旗标（不带 = 这条路还是死的）", () => {
    const { code, seen, log } = rerunIo({});
    const commit = seen.find((c) => c.args[0] === "commit");
    expect(commit, "没有伸手去 commit").toBeTruthy();
    expect(commit!.args).toContain("--allow-empty");
    expect(commit!.opts?.env?.[EMPTY_COMMIT_ENV], "旗标没带上，D0 仍会退 2").toBe("1");
    expect(code).toBe(0);
    // 成功时钩子只留一行「入选档位全部通过」⇒ 这枚旗标由发起方在回执里说出口（读者在那一屏）。
    expect(log).toContain(EMPTY_COMMIT_ENV);
    // push 那一跳不带旗标：它是 git 动作，不是门禁的输入。
    const push = seen.find((c) => c.args[0] === "push");
    expect(push?.opts?.env?.[EMPTY_COMMIT_ENV]).toBeUndefined();
  });

  it("dry-run 一个字都不执行，但把「将带哪个旗标」念出来", () => {
    const { code, log, seen } = rerunIo({ dryRun: true });
    expect(seen).toHaveLength(0);
    expect(code).toBe(0);
    expect(log).toContain(`--allow-empty`);
    expect(log).toContain(EMPTY_COMMIT_ENV);
  });

  it("在 master 上不做这件事（那一跳要的是有 PR 的分支）", () => {
    const { code, log, seen } = rerunIo({ branch: "master" });
    expect(seen).toHaveLength(0);
    expect(code).toBe(2);
    expect(log).toContain("换到 PR 分支");
  });
});

/**
 * `--stage-log`（ISSUE #2455）：绿跑里取「某一格到底念了什么」。
 *
 * 判据落在四件事：
 *   ① 按**格名**就能取到正文，带完整日志的行号（不必再手工拼 `pipelineId` / `stageId`，
 *      那两条拼错不报错、读到的是另一格的日志）；
 *   ② 认不出 / 命中多格 ⇒ 2，且**不替你挑一格**；
 *   ③ 只读：一条写动作都不发；点了名就不再问构建列表（少一次平台请求，也少一处可能错的归属）；
 *   ④ 缺格名 / 与写动作同行 ⇒ 2，且一条 build 命令都不发。
 */
describe("--stage-log：只读取某一格的日志正文（绿跑也能用）", () => {
  const GREEN_BUILD = {
    status: 200,
    data: {
      status: "success",
      pipelinesStatus: {
        "cnb-ggg-1k5q00001-001": {
          id: "cnb-ggg-1k5q00001-001",
          name: "质量门禁",
          status: "success",
          stages: [
            { status: "success", name: "Prepare", id: "prepare" },
            { status: "success", name: "受影响用例", id: "stage-9" },
            { status: "skipped", name: "API 文档生成与自检", id: "stage-27" },
          ],
        },
      },
    },
  };
  /* 两条流水线各有一格同名同 id：这是「不挑一个」那一支的样本（平台给的名字并不唯一）。 */
  const TWICE = {
    status: 200,
    data: {
      status: "success",
      pipelinesStatus: {
        "cnb-ggg-1k5q00001-001": {
          id: "cnb-ggg-1k5q00001-001",
          name: "质量门禁",
          status: "success",
          stages: [{ status: "success", name: "受影响用例", id: "stage-9" }],
        },
        "cnb-ggg-1k5q00001-002": {
          id: "cnb-ggg-1k5q00001-002",
          name: "每日档",
          status: "success",
          stages: [{ status: "success", name: "受影响用例", id: "stage-9" }],
        },
      },
    },
  };
  /* `content` 是**行数组**且带 ANSI：归一不收口就会念出 `[31mRUN…`，而行号要靠它数。 */
  const STAGE = {
    status: 200,
    data: {
      status: "success",
      duration: 470_000,
      error: "",
      content: [
        "\u001b[31m RUN v5.0.5\u001b[0m",
        " ✓ 缺键时念 pnpm env:init 5ms",
        "Finished, code: 0",
      ],
    },
  };

  function stageIo(opts: {
    build?: unknown;
    builds?: Array<unknown>;
    headSha?: string;
    stage?: unknown;
  }) {
    const calls: Array<string> = [];
    const log: Array<string> = [];
    const ok = (stdout: string): FakeResult => ({
      status: 0,
      stdout,
      stderr: "",
      error: null,
    });
    const run = (cmd: string, args: Array<string>): FakeResult => {
      calls.push([cmd, ...args].join(" "));
      const key = args.join(" ");
      if (cmd === "cnb" && args[0] === "--version") {
        return ok("1.15.25");
      }
      if (cmd === "git" && key.includes("@{u}")) {
        return ok("");
      }
      if (cmd === "git" && key === "remote") {
        return ok("origin\n");
      }
      if (cmd === "git" && key.includes("symbolic-ref")) {
        return ok("refs/remotes/origin/master");
      }
      if (cmd === "git" && key.includes("--abbrev-ref")) {
        return ok("feat/x");
      }
      if (cmd === "git" && key.includes("rev-parse --verify --quiet")) {
        return ok("d02ec9");
      }
      if (cmd === "git" && key.includes("get-url")) {
        return ok("https://cnb.cool/moon-read/comfy-app-t3\n");
      }
      if (cmd === "git" && key.includes("rev-parse HEAD")) {
        return ok(opts.headSha ?? "d02ec96364d5f3713b77c91b0d3fe789878f1747");
      }
      if (cmd === "cnb" && args[0] === "build" && args[1] === "get-build-logs") {
        return ok(JSON.stringify({ status: 200, data: opts.builds ?? [] }));
      }
      if (cmd === "cnb" && args[0] === "build" && args[1] === "get-build-status") {
        return ok(JSON.stringify(opts.build ?? null));
      }
      if (cmd === "cnb" && args[0] === "build" && args[1] === "get-build-stage") {
        return ok(JSON.stringify(opts.stage ?? {}));
      }
      return ok("");
    };
    return { run, calls, log };
  }

  const runStage = (f: ReturnType<typeof stageIo>, args: Array<string>) =>
    main({
      args,
      run: f.run,
      log: (l: string) => f.log.push(l),
    });

  it("绿跑的某一格：按格名取到正文，带完整日志行号，且不写平台", async () => {
    const f = stageIo({ build: GREEN_BUILD, stage: STAGE });
    const code = await runStage(f, ["--stage-log", "cnb-ggg-1k5q00001", "受影响用例"]);
    const text = f.log.join("\n");
    expect(code).toBe(CODE.GREEN);
    expect(text).toContain("这一格：受影响用例（id=stage-9");
    // 行号是这件事的全部价值：拿它能直接跳进完整日志，不用再搜一遍。
    expect(text).toContain("L2  ✓ 缺键时念 pnpm env:init");
    expect(text).toContain("L3 Finished, code: 0");
    // ANSI 剥掉了（带着它就没法比行内容，也没法 grep）。
    expect(text).not.toContain("[31m");
    // 平台的 `duration` 是毫秒（#2442 同一格）：印成人读的时长而不是 `470000s`。
    expect(text).toContain("耗时：7m50s");
    expect(text).toContain("build/logs/cnb-ggg-1k5q00001");
    expect(text).toContain("不判这一跑绿没绿");
    // 点了名就不问构建列表：少一次平台请求，也少一处可能错的归属。
    expect(f.calls.some((c) => c.includes("get-build-logs"))).toBe(false);
    for (const write of ["post-", "merge-pull", "update-issue", "delete-", "create-issue"]) {
      expect(
        f.calls.some((c) => c.includes(write)),
        `发了写动作：${write}`,
      ).toBe(false);
    }
  });

  it("不给构建号 ⇒ 与 --diagnose 同一份归属算法（同一跑不许给出两种答案）", async () => {
    const f = stageIo({
      build: GREEN_BUILD,
      stage: STAGE,
      builds: [
        {
          sn: "cnb-old-1k5q00000",
          sha: "0000000000000000000000000000000000000000",
          event: "pull_request",
          createTime: "2026-10-27T01:00:00Z",
        },
        {
          sn: "cnb-mine-1k5q00002",
          sha: "d02ec96364d5f3713b77c91b0d3fe789878f1747",
          event: "pull_request",
          createTime: "2026-10-27T02:00:00Z",
        },
      ],
    });
    const code = await runStage(f, ["--stage-log", "受影响用例"]);
    expect(code).toBe(CODE.GREEN);
    expect(f.log.join("\n")).toContain("归属到构建 cnb-mine-1k5q00002");
  });

  it("格名认不出 ⇒ 2：念出「比过几格」，且不发按格取日志那一条", async () => {
    const f = stageIo({ build: GREEN_BUILD, stage: STAGE });
    const code = await runStage(f, ["--stage-log", "cnb-ggg-1k5q00001", "单元测试"]);
    expect(code).toBe(CODE.NOT_RUN);
    const text = f.log.join("\n");
    expect(text).toContain("没有**逐字**叫「单元测试」的格");
    expect(text).toContain("3 格");
    expect(f.calls.some((c) => c.includes("get-build-stage"))).toBe(false);
  });

  it("命中两格 ⇒ 2 且不替你挑一格（挑错的那一格读起来同样像证据）", async () => {
    const f = stageIo({ build: TWICE, stage: STAGE });
    const code = await runStage(f, ["--stage-log", "cnb-ggg-1k5q00001", "受影响用例"]);
    expect(code).toBe(CODE.NOT_RUN);
    const text = f.log.join("\n");
    expect(text).toContain("命中 2 格");
    expect(text).toContain("质量门禁");
    expect(text).toContain("每日档");
    expect(f.calls.some((c) => c.includes("get-build-stage"))).toBe(false);
  });

  it("正文取不到 ⇒ 2，念的是「没取到」而不是「这一格没念任何话」", async () => {
    const f = stageIo({ build: GREEN_BUILD });
    const code = await runStage(f, ["--stage-log", "cnb-ggg-1k5q00001", "stage-9"]);
    expect(code).toBe(CODE.NOT_RUN);
    expect(f.log.join("\n")).toContain("不是「这一格没念任何话」");
  });

  it("没点名哪一格 ⇒ 2，且一条 build 命令都不发", async () => {
    const f = stageIo({});
    const code = await runStage(f, ["--stage-log"]);
    expect(code).toBe(CODE.NOT_RUN);
    expect(f.log.join("\n")).toContain("没点名要读哪一格");
    expect(f.calls.some((c) => c.includes("get-build"))).toBe(false);
  });

  it("与 --merge 同行 ⇒ 2，且一条 build 命令都不发（只读、一次只做一件）", async () => {
    const f = stageIo({});
    const code = await runStage(f, ["--stage-log", "cnb-ggg-1k5q00001", "受影响用例", "--merge"]);
    expect(code).toBe(CODE.NOT_RUN);
    expect(f.log.join("\n")).toContain("不与 --merge 同跑");
    expect(f.calls.some((c) => c.includes("get-build"))).toBe(false);
  });

  it("--dry-run 只打印那三条读命令，不读平台", async () => {
    const f = stageIo({});
    const code = await runStage(f, ["--stage-log", "cnb-ggg-1k5q00001", "受影响用例", "--dry-run"]);
    expect(code).toBe(CODE.GREEN);
    const text = f.log.join("\n");
    expect(text).toContain("get-build-status");
    expect(text).toContain("--stageId <stageId>");
    expect(f.calls.some((c) => c.includes("get-build"))).toBe(false);
  });
});

describe("parseArgs：--stage-log 的形状（自由文本 + 可选构建号）", () => {
  it("只给格名 ⇒ 不设构建号（走按 HEAD 归属那一路）", () => {
    const got = parseArgs(["--stage-log", "受影响用例"]);
    expect(got.stageLog).toBe(true);
    expect(got.stageLogSn).toBeNull();
    expect(got.stageLogRef).toBe("受影响用例");
    expect(got.stageLogBad).toEqual([]);
  });

  it("构建号 + 格名 ⇒ 各归各位", () => {
    const got = parseArgs(["--stage-log", "cnb-68q-1k5sc5kgq", "受影响用例"]);
    expect(got.stageLogSn).toBe("cnb-68q-1k5sc5kgq");
    expect(got.stageLogRef).toBe("受影响用例");
  });

  it("格名**没加引号**带空格 ⇒ 拼回完整一串（切一截就必然反查落空）", () => {
    const got = parseArgs(["--stage-log", "cnb-68q-1k5sc5kgq", "API", "文档生成与自检"]);
    expect(got.stageLogSn).toBe("cnb-68q-1k5sc5kgq");
    expect(got.stageLogRef).toBe("API 文档生成与自检");
  });

  it("等号写法与空格写法同形，且不吞后面的旗标", () => {
    expect(parseArgs(["--stage-log=stage-27"]).stageLogRef).toBe("stage-27");
    const next = parseArgs(["--stage-log", "stage-27", "--dry-run"]);
    expect(next.stageLogRef).toBe("stage-27");
    expect(next.dryRun).toBe(true);
  });

  it("只给构建号、没给格名 ⇒ 记进 bad（不能默默去读一格不存在的东西）", () => {
    const got = parseArgs(["--stage-log", "cnb-68q-1k5sc5kgq"]);
    expect(got.stageLogSn).toBe("cnb-68q-1k5sc5kgq");
    expect(got.stageLogBad).toEqual(["(缺点名哪一格)"]);
  });
});
