/**
 * `scripts/ci-pr-failure-issue.mjs` 的契约（ISSUE #2332）。
 *
 * 这一格是「**PR 那一跑红了 ⇒ 有人知道**」的唯一执行者。它的失效形态与每日档那一格同源，
 * 但多一条：**落点选错**。所以本文件三组对着三个方向：
 *
 *   ① **把没结论写成红**（绿 / 被取消 / 认不出哪一格 / 取不到读数 ⇒ 不该写一个字）；
 *   ② **把红写成静默**（`--no-block` 只许改退码，不许改「那句话有没有被打出来」）；
 *   ③ **落点**（有 PR ⇒ 评论在 PR 下；没有 ⇒ 建单，且同一格不重复建）。
 *
 * 判据与定性都不在这里重写：喂进去的 `details` 就是 `classifyBuildOutcome()` 认的那份
 * 平台形状，所以断言测的是接线。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { describe, expect, it } from "vitest";

import {
  CODE,
  composeBody,
  decideAction,
  issueTitle,
  main,
  prIidFromUrl,
  resolveTarget,
  titleKey,
} from "../scripts/ci-pr-failure-issue.mjs";

const ROOT = path.resolve(__dirname, "..");

const ENTRY = path.join(ROOT, "scripts", "ci-pr-failure-issue.mjs");

type StageRow = { id: string; name: string; status: string };

type Verdict = "green" | "failed" | "cancelled" | "running";

/** 列表里的一项（这一层只用得上这四个字段）。 */
const build = (
  sn: string,
  event = "pull_request",
  eventUrl = "https://cnb.cool/moon-read/comfy-app-t3/-/pulls/2323",
) => ({
  sn,
  event,
  eventUrl,
  createTime: "2026-10-25T03:08:18.000Z",
  status: "error",
});

/**
 * 逐格详情（`classifyBuildOutcome()` 认的形状）。
 *
 * ⚠️ 状态词用平台原话：`error` / `cancel` / `skipped` / `start`；构建级在跑是 `pending`。
 */
function detail(state: Verdict) {
  const stages: StageRow[] =
    state === "green"
      ? [
          { id: "stage-1", name: "分支守卫", status: "success" },
          { id: "stage-2", name: "类型检查", status: "success" },
        ]
      : state === "running"
        ? [
            { id: "stage-1", name: "分支守卫", status: "success" },
            { id: "stage-2", name: "类型检查", status: "start" },
          ]
        : [
            { id: "stage-1", name: "分支守卫", status: "success" },
            {
              id: "stage-2",
              name: "类型检查",
              status: state === "cancelled" ? "cancel" : "error",
            },
            { id: "stage-3", name: "受影响用例", status: "skipped" },
            { id: "stage-4", name: "重档静态判据", status: "skipped" },
          ];
  const status =
    state === "green" ? "success" : state === "running" ? "pending" : "error";
  return {
    data: {
      status,
      pipelinesStatus: { p1: { id: "p1", name: "质量门禁", status, stages } },
    },
  };
}

describe("认「这一跑是谁」：PR 号只从不猜的字段取", () => {
  it("环境变量里有 PR 号 ⇒ 直接用它（人推了 PR 才会有它）", () => {
    const t = resolveTarget({
      env: { CNB_PULL_REQUEST_IID: "2323" },
      list: [build("sn-1")],
      sn: "sn-1",
    });
    expect(t.prIid).toBe(2323);
    expect(t.why).toBeNull();
  });

  it("环境变量不在场 ⇒ 从列表那一项的 eventUrl 取；两种 URL 形状都认", () => {
    expect(prIidFromUrl("https://cnb.cool/a/b/-/pulls/2323")).toBe(2323);
    expect(prIidFromUrl("https://cnb.cool/a/b/-/pull/2323")).toBe(2323);
    expect(prIidFromUrl("https://cnb.cool/a/b/-/builds/123")).toBeNull();
    const t = resolveTarget({
      env: {},
      list: [build("sn-1")],
      sn: "sn-1",
    });
    expect(t.prIid).toBe(2323);
  });

  it("push / 定时那几跑不归这一格管，而且给的是原因、不是失败", () => {
    const t = resolveTarget({
      env: {},
      list: [build("sn-2", "push", "")],
      sn: "sn-2",
    });
    expect(t.why).toContain("不是 pull_request");
    expect(t.why).toContain("没有 PR");
  });

  it("列表里查不到这一跑、环境变量也没有 ⇒ 不给 PR 号（也不猜一个）", () => {
    /* 列表里那一条自带 PR 的 eventUrl，但它**不是这一跑**（sn 对不上）⇒ 那条信息
     * 与 sn-x 无关，不许拿来给 sn-x 记一个 PR 号。 */
    const t = resolveTarget({ env: {}, list: [build("其他")], sn: "sn-x" });
    expect(t.prIid).toBeNull();
    expect(t.why).toContain("不是 pull_request");
  });
});

/**
 * `--lane`：桌面成品包那一档（ISSUE #2550）。
 *
 * 这一单例外是**显式声明**的那一半：定时 / 手点那两跑没有 PR 可挂，而它们同样要有人
 * 把红说出来。所以这里钉的是三件事 —— ① 不给 `--lane` 时那些跑仍然一概不写；
 * ② 给了才认进来；③ 标题与去重键按档分开（两族混起来就是「同一格各红一次只立一张」）。
 */
describe("`--lane`：只有显式声明的那一档才认非 PR 事件", () => {
  it("不给 `--lane` ⇒ 定时那一跑照旧不归这一格管（那一刀今天仍然要留着）", () => {
    const t = resolveTarget({
      env: {},
      list: [build("sn-pkg", "crontab: 0 2 * * *", "")],
      sn: "sn-pkg",
    });
    expect(t.why).toContain("不是 pull_request");
    expect(t.lane).toBeNull();
  });

  it("给了 `--lane package` ⇒ 认进来，且没有 PR 号（PR 那一支路仍然走不到）", () => {
    const t = resolveTarget({
      env: {},
      list: [build("sn-pkg", "crontab: 0 2 * * *", "")],
      sn: "sn-pkg",
      lane: "package",
    });
    expect(t.why).toBeNull();
    expect(t.lane).toBe("package");
    expect(t.prIid).toBeNull();
  });

  it("标题与去重键按档分开：同一格在两档各红一次 ⇒ 两件事、两张单", () => {
    const pr = titleKey("类型检查");
    const pkg = titleKey("打包·桌面成品构建", "package");
    expect(pr).toBe("ci(pr): PR 档红在「类型检查」");
    expect(pkg).toBe("ci(package): 桌包档红在「打包·桌面成品构建」");
    /* 反过来：PR 那一族的旧形状不许被改写（历史单子还在同一族里）。 */
    expect(issueTitle("类型检查")).toContain("ci(pr): PR 档红在「类型检查」");
    expect(issueTitle("打包·桌面成品构建", "package")).toContain(
      "ci(package): 桌包档红在「打包·桌面成品构建」",
    );
  });

  it("落点：这一档没有 PR 可挂 ⇒ 按格名建单（同一格已有 open 单则追加，不新建）", () => {
    const fresh = decideAction({
      state: "failed",
      failedNames: ["打包·桌面成品构建"],
      prIid: null,
      existing: [],
      lane: "package",
    });
    expect(fresh.action).toBe("write");
    expect(fresh.stages[0]?.number).toBeUndefined();
    const again = decideAction({
      state: "failed",
      failedNames: ["打包·桌面成品构建"],
      prIid: null,
      existing: [{ number: 9, title: issueTitle("打包·桌面成品构建", "package") }],
      lane: "package",
    });
    expect(again.action).toBe("write");
    expect(again.stages[0]?.number).toBe(9);
  });

  it("正文要说得出是哪一档的哪一跑（不写「PR 那一跑」，也不许多说一句因果）", () => {
    const body = composeBody({
      slug: "moon-read/comfy-app-t3",
      target: {
        sn: "sn-pkg",
        event: "crontab: 0 2 * * *",
        eventUrl: "",
        prIid: null,
        lane: "package",
      },
      stage: "打包·壳工具链自证",
      skipped: ["打包·桌面成品构建"],
      readout: ["L3 (cargo 不可用)"],
      handle: "ci-pr",
    });
    expect(body).toContain("## 症状（这一跑红了，本段只含读数）");
    expect(body).not.toContain("PR 那一跑红了");
    expect(body).toContain("没有 PR 可挂");
    expect(body).toContain("crontab: 0 2 * * *");
    expect(body).toContain("打包·壳工具链自证");
    expect(body).toContain("根因：**未判定**");
  });
});

describe("决定写不写：①「没结论」一律不落成红字", () => {
  it("绿 ⇒ 不写；被取消 ⇒ 不写，且话术不许把「没跑完」说成产物坏了", () => {
    const g = decideAction({
      state: "green",
      failedNames: [],
      prIid: 1,
      existing: [],
    });
    expect(g.action).toBe("none");
    expect(g.reason).toContain("绿的");
    const c = decideAction({
      state: "cancelled",
      failedNames: [],
      prIid: 1,
      existing: [],
    });
    expect(c.action).toBe("none");
    expect(c.reason).toContain("没有结论");
  });

  it("判成真失败却认不出是哪一格 ⇒ 不动账（「取不到」不是「没有红」）", () => {
    const act = decideAction({
      state: "failed",
      failedNames: [],
      prIid: 1,
      existing: [],
    });
    expect(act.action).toBe("no-fact");
    expect(act.reason).toContain("认不出");
  });

  it("没有 PR 可挂、又取不到开着的单 ⇒ 不新建（否则多一张重复单）", () => {
    const act = decideAction({
      state: "failed",
      failedNames: ["类型检查"],
      prIid: null,
      existing: null,
    });
    expect(act.action).toBe("no-fact");
    expect(act.reason).toContain("不等于");
  });

  it("unknown（详情那份读不懂）⇒ 同样不写", () => {
    const act = decideAction({
      state: "unknown",
      failedNames: ["类型检查"],
      prIid: 1,
      existing: [],
    });
    expect(act.action).toBe("no-fact");
  });
});

describe("决定写不写：②落点（PR 评论 vs 建单）与去重", () => {
  it("有 PR ⇒ 评论在那张 PR 下，一格一段（不查开着的单）", () => {
    const act = decideAction({
      state: "failed",
      failedNames: ["类型检查", "受影响用例"],
      prIid: 2323,
      existing: null,
    });
    expect(act.action).toBe("recommend");
    expect(act.stages).toEqual([
      { stage: "类型检查" },
      { stage: "受影响用例" },
    ]);
  });

  it("没有 PR ⇒ 按格名建单；同一格已有 open 单则追加，不新建", () => {
    const act = decideAction({
      state: "failed",
      failedNames: ["类型检查", "受影响用例"],
      prIid: null,
      existing: [{ number: 2200, title: issueTitle("类型检查") }],
    });
    expect(act.action).toBe("write");
    expect(act.stages).toEqual([
      { stage: "类型检查", number: 2200 },
      { stage: "受影响用例" },
    ]);
  });

  it("人工写的单只要带同一串前缀就自动进这一族", () => {
    const human = "ci(pr): PR 档红在「类型检查」—— 上一跑整格 skipped 的那一笔";
    expect(human).toContain(titleKey("类型检查"));
    const act = decideAction({
      state: "failed",
      failedNames: ["类型检查"],
      prIid: null,
      existing: [{ number: 2201, title: human }],
    });
    expect(act.stages[0]?.number).toBe(2201);
  });
});

describe("正文只含读数，不含因果", () => {
  const target = {
    sn: "cnb-0j2-1k5ogfi0l",
    event: "pull_request",
    eventUrl: "",
    prIid: 2323,
  };
  const body = composeBody({
    slug: "moon-read/comfy-app-t3",
    target,
    stage: "类型检查",
    skipped: ["受影响用例", "重档静态判据"],
    readout: [
      "── 失败格：类型检查（stage-2）",
      "L88 src/x.ts(3,5): error TS2322",
    ],
    handle: "ci-pr",
  });

  it("症状 / 读数 / 出处 / 出口四件都在，且明写「根因未判定」", () => {
    expect(body.startsWith("**[评论人：ci-pr]**")).toBe(true);
    expect(body).toContain("cnb-0j2-1k5ogfi0l");
    expect(body).toContain("PR #2323");
    expect(body).toContain("「类型检查」");
    expect(body).toContain(
      "被它带下去、**根本没跑**的格：受影响用例、重档静态判据",
    );
    expect(body).toContain("L88 src/x.ts(3,5): error TS2322");
    expect(body).toContain("## 根因：**未判定**");
    expect(body).toContain("pnpm ship --diagnose cnb-0j2-1k5ogfi0l");
    expect(body).toContain(
      "https://cnb.cool/moon-read/comfy-app-t3/-/build/logs/cnb-0j2-1k5ogfi0l",
    );
    // 落点是 PR 时，那句「一条诉求一张单」必须写出来，不然下一个人会去另开单。
    expect(body).toContain("落点是这张 PR");
  });

  it("负控制：不许出现替人说「谁的错 / 为什么红」那类因果句", () => {
    for (const banned of ["因为", "由于", "根因是", "造成的", "是它的错"]) {
      expect(body, `正文里出现了未经验证的因果句：${banned}`).not.toContain(
        banned,
      );
    }
  });

  it("日志取不到时念「取不到」，不许念成「日志里没有失败行」", () => {
    const empty = composeBody({
      slug: "s/x",
      target: { ...target, prIid: null },
      stage: "类型检查",
      skipped: [],
      readout: [],
      handle: "ci-pr",
    });
    expect(empty).toContain("**取不到**");
    // 没有 PR 那一支要给的是「同一格不重复建单」的口径。
    expect(empty).toContain("不新建");
  });
});

describe("跑生产入口本身（真起进程，`--from` 离线档）", () => {
  /** 每份用例自带目录，别往仓库里落东西。 */
  function fixture(payload: unknown) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pr-failure-issue-"));
    const file = path.join(dir, "read.json");
    fs.writeFileSync(file, JSON.stringify(payload), "utf8");
    return { dir, file };
  }

  const run = (args: string[], extraEnv: Record<string, string> = {}) => {
    const env = { ...process.env, ...extraEnv };
    for (const [k, v] of Object.entries(extraEnv)) if (v === "") delete env[k];
    return spawnSync(process.execPath, [ENTRY, ...args], {
      cwd: ROOT,
      encoding: "utf8",
      env,
    });
  };

  it("离线档强制只读：念出要评论在哪张 PR 下，一条都不写", () => {
    const f = fixture({
      sn: "sn-1",
      list: [build("sn-1")],
      details: [{ sn: "sn-1", json: detail("failed") }],
    });
    try {
      /* ⚠️ `CNB_PULL_REQUEST_IID: ""`：这一条跑在平台上的时候，进程本身就带着**这一跑
       * 所在的 PR 号**。不清掉它，「sn-1 属于哪张 PR」会读成用例所在那一跑 —— 断言就变成
       * 「跑在哪张 PR 上期望值就跟着变」，本地绿、CI 红（本 PR 首跑就是这么红的）。
       * 这类「环境变量泄漏进夹具」的形态在本档正是要挡的：PR 号只从**对得上 sn 的**那一项取。 */
      const r = run(["--from", f.file], { CNB_PULL_REQUEST_IID: "" });
      const out = `${r.stdout}\n${r.stderr}`;
      expect(r.status, out).toBe(CODE.DONE);
      expect(out).toContain("强制只读");
      expect(out).toContain("评论在 PR #2323 下");
      expect(out).toContain("一条都没写");
      expect(out).toContain("被带下去 2 格");
    } finally {
      fs.rmSync(f.dir, { recursive: true, force: true });
    }
  });

  it("这一跑是绿的 ⇒ 一句话讲清为什么没写，且不构成「失败」", () => {
    const f = fixture({
      sn: "sn-2",
      list: [build("sn-2")],
      details: [{ sn: "sn-2", json: detail("green") }],
    });
    try {
      const r = run(["--from", f.file], { CNB_PULL_REQUEST_IID: "" });
      expect(r.status).toBe(CODE.DONE);
      expect(`${r.stdout}${r.stderr}`).toContain("这一跑是绿的");
    } finally {
      fs.rmSync(f.dir, { recursive: true, force: true });
    }
  });

  /**
   * `--no-block` 的全部风险在这里：它把「没结论」的退码改成 0，
   * 而唯一能挡住它变成静默的东西，是那句话说出来 + 这一条用例钉住。
   */
  it("没有 sn ⇒ 不带旗标退 2（没结论），带 `--no-block` 退 0 但那句话照打", () => {
    /* ⚠️ `CNB_BUILD_ID: ""` 是**必须显式给**的：这一条用例自己的进程本身就活在一条
     * CI 构建里（平台给每一格都注入了 `CNB_BUILD_ID`），不给它的话「离线档没写 sn」
     * 会静默落回**这一条用例所在那一跑**的号 —— 那是读别人的读数，也正是本档
     * 「不猜这一跑是谁」要挡的形状。 */
    const f = fixture({ list: [], details: [] });
    try {
      const strict = run(["--from", f.file], {
        CNB_BUILD_ID: "",
        CNB_PULL_REQUEST_IID: "",
      });
      expect(strict.status, `${strict.stdout}\n${strict.stderr}`).toBe(
        CODE.NO_FACT,
      );
      const loose = run(["--from", f.file, "--no-block"], {
        CNB_BUILD_ID: "",
        CNB_PULL_REQUEST_IID: "",
      });
      expect(loose.status).toBe(CODE.DONE);
      const out = `${loose.stdout}\n${loose.stderr}`;
      expect(out).toContain("不拦路");
      expect(out).toContain("别把它改成静默 return");
      expect(out).toContain("不按时间挑一条");
    } finally {
      fs.rmSync(f.dir, { recursive: true, force: true });
    }
  });

  it("--from 那个路径不存在 ⇒ 退 2，而不是「没有红」", () => {
    const r = run([
      "--from",
      path.join(os.tmpdir(), "definitely-not-here-2332.json"),
    ]);
    expect(r.status).toBe(CODE.NO_FACT);
    expect(`${r.stdout}${r.stderr}`).toContain("不构成结论（不是「没有红」）");
  });

  /**
   * `--lane` 的两种坏形状（ISSUE #2550）：档名进去重键，所以「写在 .cnb.yml 里、
   * 但没在此常量下登记」会得到一个随机的标题前缀 —— 同一格在各跑各红一次，账上却是两张
   * 互不相认的单。它必须是**入口自己的退 2**，而不是变成「默认落到 pr 那一族」。
   */
  it("`--lane` 没给值 / 没登记 ⇒ 退 2 且一次都不写（不许退化成默认那档）", () => {
    const heard: string[] = [];
    const boom = () => {
      throw new Error("这一行走到我 ⇒ 这一格在还没判完之前就联网了");
    };
    const noValue = main({
      argv: ["--lane"],
      slug: "moon-read/comfy-app-t3",
      env: { CNB_BUILD_ID: "sn-pkg" },
      log: (s: string) => heard.push(s),
      run: boom,
    });
    expect(noValue).toBe(CODE.NO_FACT);
    expect(heard.join("\n")).toContain("`--lane` 没给值");
    const unknown = main({
      argv: ["--lane", "desktop"],
      slug: "moon-read/comfy-app-t3",
      env: { CNB_BUILD_ID: "sn-pkg" },
      log: (s: string) => heard.push(s),
      run: boom,
    });
    expect(unknown).toBe(CODE.NO_FACT);
    expect(heard.join("\n")).toContain("不在 LANE_PREFIX 那张表里");
    /* 而登记过的那一档要能往下走：这一跑的事件是 `crontab: 0 2 * * *`，没有 `--lane`
     * 会被判成「不归本格管」，给了它就该继续往下读（详情那份刻意不含 `pipelinesStatus`
     * ⇒ 认不出格名 ⇒ 落在「没结论」，同样不是「不写」）。 */
    heard.length = 0;
    const calls: string[] = [];
    const ok = main({
      argv: ["--lane", "package", "--dry-run"],
      slug: "moon-read/comfy-app-t3",
      env: { CNB_BUILD_ID: "sn-pkg", CNB_PULL_REQUEST_IID: "" },
      log: (s: string) => heard.push(s),
      run: (cmd: string, args: string[]) => {
        const key = args.join(" ");
        calls.push(`${cmd} ${key}`);
        const data = key.includes("get-build-logs")
          ? [build("sn-pkg", "crontab: 0 2 * * *", "")]
          : key.includes("get-build-status")
            ? { status: "error", pipelinesStatus: {} }
            : {};
        return {
          status: 0,
          stdout: JSON.stringify({ status: 200, data }),
          stderr: "",
          error: null,
        };
      },
    });
    /* 列表那一跳**不带** `--event`：那一档没有 PR 事件可查，按 `pull_request` 过滤
     * 就等于查不到自己（ISSUE #2550 的现场：事件念成 `(取不到)`、`self` 为 null）。 */
    const listCall = calls.find((c) => c.includes("get-build-logs"));
    expect(listCall, `没有查列表：${calls.join(" / ")}`).toBeTruthy();
    expect(listCall).not.toContain("--event");
    /* 读链真的走了（不是靠 `--from` 绕过去的），且一个写命令都没发。 */
    expect(calls.some((c) => c.includes("get-build-status"))).toBe(true);
    expect(
      calls.some((c) => c.includes("create-issue")),
      `写了平台：${calls.join(" / ")}`,
    ).toBe(false);
    /* 详情喂的是一份「没有 pipelinesStatus」的形状 ⇒ 格名认不出，落在 no-fact
     * 而不是「不归本格管」 —— 差别就是「我不知道该不该写」与「我不写」。 */
    expect(ok).toBe(CODE.NO_FACT);
    expect(heard.join("\n")).toContain("档 package");
    expect(heard.join("\n")).not.toContain("不是 pull_request");
  });

  /**
   * 生产网络路径的**默认出口**：注入一台会应答的假执行者，走的是与平台那一跳同一条链
   * （列表 → 逐格详情 → 逐格日志 → PR 评论），断言 `--dry-run` 一个写命令都不发。
   */
  it("--dry-run 走完整条读链，一次 post-pull-comment / create-issue 都不发", () => {
    const calls: string[] = [];
    const heard: string[] = [];
    const code = main({
      argv: ["--dry-run"],
      slug: "moon-read/comfy-app-t3",
      env: { CNB_BUILD_ID: "sn-live", CNB_PULL_REQUEST_IID: "2323" },
      log: (s: string) => heard.push(s),
      run: (cmd: string, args: string[]) => {
        const key = args.join(" ");
        calls.push(`${cmd} ${key}`);
        const json = (data: unknown) => ({
          status: 0,
          stdout: JSON.stringify({ status: 200, data }),
          stderr: "",
          error: null,
        });
        if (key.includes("get-build-logs")) return json([build("sn-live")]);
        if (key.includes("get-build-status"))
          return json(detail("failed").data);
        return json({});
      },
    });
    const out = heard.join("\n");
    expect(code).toBe(CODE.DONE);
    expect(out).toContain("这一跑 sn-live");
    expect(out).toContain("判定 failed");
    expect(out).toContain("--dry-run：「类型检查」→ 评论在 PR #2323 下");
    expect(
      calls.some(
        (c) => c.includes("post-pull-comment") || c.includes("create-issue"),
      ),
      `dry-run 却发了写命令：${calls.join(" / ")}`,
    ).toBe(false);
    // 读链真的走到了逐格日志那一层（不是靠 --from 绕过去的）。
    expect(calls.some((c) => c.includes("get-build-stage"))).toBe(true);
  });
});

describe("平台配置：这一格是 Pipeline 级 `endStages`，不是 `stages` 里的一格", () => {
  const CONFIG = fs.readFileSync(path.join(ROOT, ".cnb.yml"), "utf8");

  /* 正控：真的读到了那一格（否则下面几条断言会在「配置里没有它」上以别的名义绿掉）。 */
  it("`.cnb.yml` 里有这一格，入口是脚本而不是裸命令", () => {
    expect(CONFIG).toContain("    - name: PR 失败立案");
    expect(CONFIG).toContain("node scripts/ci-pr-failure-issue.mjs --no-block");
    const at = CONFIG.indexOf("    - name: PR 失败立案");
    expect(CONFIG.slice(at, at + 800)).toContain("timeout: 5m");
  });

  /**
   * 「红也要跑」这件事**不能**靠 `stages` 里的某一格：本仓 `stages` 是串行链，
   * 前面哪里一红后面整片 `skipped`（实测 `cnb-dbu-1k5ohq6p4`：`受影响用例` 红 ⇒
   * 它后面 23 格全是 skipped）。平台原生那一档是 Pipeline 级 `endStages`
   * （`zh/build/grammar.md`：「无论 stages 是否成功，endStages 都将执行」）。
   *
   * 这条判据守的是**位置**：有人把它挪回 `*gates`（那个 stage 数组锚点）里，
   * 它就又变回「红了 = 不跑」，而这两种形态在 diff 上只差两行缩进。
   */
  it("它挂在 `endStages` 下，而不是 `stages: *gates` 的那个数组里", () => {
    const gatesAt = CONFIG.indexOf(".gates: &gates");
    const masterAt = CONFIG.indexOf("\nmaster:");
    expect(gatesAt).toBeGreaterThan(0);
    expect(masterAt).toBeGreaterThan(gatesAt);
    expect(
      CONFIG.slice(gatesAt, masterAt),
      "`PR 失败立案` 出现在 `*gates` 里 —— 那个数组是串行链，前面一红它就会被 skipped，" +
        "而「红了要有人知道」正是它唯一的用途。它属于 Pipeline 级 `endStages`。",
    ).not.toContain("PR 失败立案");

    const anchorAt = CONFIG.indexOf(".pr-fail-stage: &pr_fail_stage");
    expect(anchorAt).toBeGreaterThan(0);
    expect(CONFIG.slice(anchorAt, anchorAt + 200)).toContain("endStages:");
  });

  it("PR 那条流水线真的引入了这个锚点（写了锚点却没人引用 = 永远不跑）", () => {
    const at = CONFIG.indexOf("  pull_request:");
    const body = CONFIG.slice(at, at + 500);
    /* 两个锚点合在**一个**合并键里：同一层写两行 `<<:` 是非法 YAML（`yaml` 解析器当场
     * `Map keys must be unique`），而它坏掉的方式是静默的 —— 两个键只有一个生效。
     * 所以这里钉的是流式形态，不是「两行」。 */
    expect(body).toContain("- <<: [*common, *pr_fail_stage]");
  });

  it("锚点真的落在流水线项那一层（写了锚点却没人引用 = 永远不跑）", () => {
    const at = CONFIG.indexOf("  pull_request:");
    expect(at).toBeGreaterThan(0);
    const body = CONFIG.slice(at, CONFIG.indexOf("\n  push:", at));
    expect(
      body,
      "`pull_request` 那条流水线没有引用 `*pr_fail_stage` —— 锚点写了也是白写",
    ).toContain("- <<: [*common, *pr_fail_stage]");
    expect(body, "`*gates`（串行链）也不许把它带回来").not.toContain(
      "PR 失败立案",
    );
  });

  /**
   * 缩进是**语义**：`endStages:` 挂在哪一层，决定平台认不认它是这条流水线的收尾档。
   *
   * 前面那些断言判的是「文本里有那段字」，而缩进错一格在它们眼里是**绿**的 ——
   * 它会变成一个谁也不认识的字段，平台照读照跑，这一格永远不执行。
   * 判据按锚点里那一层的缩进认：`endStages:` 是 2 空格（锚点展开进流水线项那一层），
   * 它的格是 4 空格。
   */
  it("锚点里 `endStages:` 的缩进是流水线项那一层，格在它下面一层", () => {
    const anchorAt = CONFIG.indexOf(".pr-fail-stage: &pr_fail_stage");
    expect(anchorAt).toBeGreaterThan(0);
    const lines = CONFIG.slice(anchorAt).split("\n");
    const endAt = lines.findIndex((l) => l === "  endStages:");
    expect(
      endAt,
      "`*pr_fail_stage` 里没有 2 空格的 `endStages:` —— 它被挂到了错的那一层",
    ).toBeGreaterThan(0);
    expect(lines[endAt + 1]).toBe("    - name: PR 失败立案");
  });

  it("**不是** `failStages`：那一档只在红时跑，「这一格自己挂了」会一起消失", () => {
    const anchorAt = CONFIG.indexOf(".pr-fail-stage: &pr_fail_stage");
    const block = CONFIG.slice(anchorAt, anchorAt + 400);
    expect(block).not.toContain("failStages");
    expect(block).not.toContain("ifModify");
    /* 那两条没被验证过的条件语法也不许回来当「红也跑」的手段 —— 第一版写成
     * `run: always()`，实测那一格仍然是 `skipped`。`run:` 更不是 Stage 的字段
     * （`grammar.md` 的配置项表里没有它），写上去会被静默忽略（#2335 的 CI 红就是
     * 配置与断言一起写错了这个词）。 */
    expect(block).not.toContain("always()");
    expect(block).not.toContain("when:");
    expect(block).not.toContain("run:");
  });
});
