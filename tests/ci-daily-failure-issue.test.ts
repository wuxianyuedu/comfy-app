/**
 * `scripts/ci-daily-failure-issue.mjs` 的契约（ISSUE #2274）。
 *
 * 这一格是「**每天那一跑红了 ⇒ 自动变成一张单**」的执行者。它最危险的失效形态有两种，
 * 本文件各有一组用例对着：
 *
 *   ① **把没结论写成红**（被取消 / 取不到读数 / 认不出哪一格 ⇒ 不该写一个字）；
 *   ② **把红写成静默**（`--no-block` 只允许改变退码，不允许改变「那句话有没有被打出来」）。
 *
 * 判据与定性都不在这里重写：喂进去的 `details` 就是 `classifyBuildOutcome()` 认的那份平台形状
 * （`data.status` + `pipelinesStatus.<id>.stages[]`），所以断言测的是接线，不是第二份判决。
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
  pickPreviousDaily,
  titleKey,
} from "../scripts/ci-daily-failure-issue.mjs";

const ROOT = path.resolve(__dirname, "..");
const ENTRY = path.join(ROOT, "scripts", "ci-daily-failure-issue.mjs");

/** 构建列表那一项（这一层只用得到四个字段）。 */
type ListBuild = { sn: string; event: string; createTime: string; status: string };

type StageRow = { id: string; name: string; status: string };

/** `get-build-status -v` 那份读数的最小形状（`classifyBuildOutcome()` 认的就是它）。 */
type DetailJson = {
  data: {
    status: string;
    pipelinesStatus: Record<
      string,
      { id: string; name: string; status: string; stages: StageRow[] }
    >;
  };
};

type Verdict = "green" | "failed" | "cancelled" | "running";

/**
 * `pickPreviousDaily()` 的返回是判别联合（要么挑到、要么给一句为什么挑不到）。
 * 这里要的只是「读哪个字段」的形状，不是再写一套判决 —— 一次 `as`，字段全在这。
 */
type PickedLike = { sn?: string; none?: string; outcome?: { state: string } };
const asPicked = (p: unknown): PickedLike => p as PickedLike;

/** 一条每日派发的列表项。 */
const build = (sn: string, event = "crontab: 0 0 * * *"): ListBuild => ({
  sn,
  event,
  createTime: "2026-10-23T16:00:17.000Z",
  status: "success",
});

/**
 * 逐格详情那份读数。
 *
 * ⚠️ 状态词用的是平台原话：`error` / `cancel` / `skipped` / `start`（格在跑），构建级在跑是
 * `pending` —— 换掉任何一个词，`classifyBuildOutcome()` 就读成别的档，用例会在「判决变了」
 * 这件事上红，而不是在「夹具写错了」上红。
 */
function detail(state: Verdict): DetailJson {
  const stages: StageRow[] =
    state === "green"
      ? [
          { id: "stage-1", name: "每日工具链自证", status: "success" },
          { id: "stage-2", name: "每日生产构建", status: "success" },
        ]
      : state === "running"
        ? [
            { id: "stage-1", name: "每日工具链自证", status: "success" },
            { id: "stage-2", name: "每日生产构建", status: "start" },
          ]
        : [
            { id: "stage-1", name: "每日工具链自证", status: "success" },
            {
              id: "stage-2",
              name: "每日生产构建",
              status: state === "cancelled" ? "cancel" : "error",
            },
            { id: "stage-3", name: "每日 ESLint 零警告", status: "skipped" },
            { id: "stage-4", name: "每日浏览器安装", status: "skipped" },
            { id: "stage-5", name: "每日全量E2E", status: "skipped" },
            { id: "stage-6", name: "每日单元测试", status: "skipped" },
          ];
  const status =
    state === "green" ? "success" : state === "running" ? "pending" : "error";
  return {
    data: {
      status,
      pipelinesStatus: { p1: { id: "p1", name: "每日生产构建", status, stages } },
    },
  };
}

/** 一份 `{sn, json}` 详情（`fetchDailyDetails()` 原样吐的形状）。 */
const d = (sn: string, state: Verdict) => ({ sn, json: detail(state) });

describe("挑「上一跑」：正在跑的那一跑不能当对象", () => {
  it("最新一条在跑 ⇒ 取它之前最近那条有终态的", () => {
    const picked = asPicked(
      pickPreviousDaily({
        list: [build("sn-running"), build("sn-previous")],
        details: [d("sn-running", "running"), d("sn-previous", "failed")],
      }),
    );
    expect(picked.sn).toBe("sn-previous");
    expect(picked.outcome?.state).toBe("failed");
  });

  it("全是「在跑」⇒ 不给结论，而不是判成绿或判成红", () => {
    const picked = asPicked(
      pickPreviousDaily({
        list: [build("sn-running")],
        details: [d("sn-running", "running")],
      }),
    );
    expect(picked.none).toContain("终态");
  });

  it("详情取不到的那一跑不算「跑坏了」，也不能拿来立案", () => {
    const picked = asPicked(pickPreviousDaily({ list: [build("sn-x")], details: [] }));
    expect(picked.none).toContain("拿得到");
  });

  it("列表里没有每日类派发（PR 事件不算）⇒ 一句原因，不猜", () => {
    const picked = asPicked(
      pickPreviousDaily({
        list: [build("x", "pull_request")],
        details: [d("x", "failed")],
      }),
    );
    expect(picked.none).toContain("没有每日类派发");
  });
});

describe("决定写不写：①「没结论」一律不落成红字", () => {
  it("绿 ⇒ 不写；被取消 ⇒ 不写，且话术不许把「没跑完」说成产物坏了", () => {
    const g = decideAction({ state: "green", failedNames: [], existing: [] });
    expect(g.action).toBe("none");
    expect(g.stages).toEqual([]);
    expect(g.reason).toContain("绿的");
    const c = decideAction({ state: "cancelled", failedNames: [], existing: [] });
    expect(c.action).toBe("none");
    expect(c.reason).toContain("没有结论");
  });

  it("判成真失败却认不出是哪一格 ⇒ 不动账（「取不到」不是「没有红」）", () => {
    const act = decideAction({ state: "failed", failedNames: [], existing: [] });
    expect(act.action).toBe("no-fact");
    expect(act.reason).toContain("不知道往哪张单上记");
  });

  it("开着的单取不到 ⇒ 不新建 —— 否则每天多一张重复单", () => {
    const act = decideAction({
      state: "failed",
      failedNames: ["每日生产构建"],
      existing: null,
    });
    expect(act.action).toBe("no-fact");
    expect(act.reason).toContain("不等于");
  });

  it("unknown（详情那份读不懂）⇒ 同样不写", () => {
    const act = decideAction({
      state: "unknown",
      failedNames: ["每日生产构建"],
      existing: [],
    });
    expect(act.action).toBe("no-fact");
  });
});

describe("决定写不写：②去重键是「前缀 + 格名」，不是整条标题", () => {
  it("同一格已有 open 单 ⇒ 只追加读数，不新建", () => {
    const act = decideAction({
      state: "failed",
      failedNames: ["每日生产构建"],
      existing: [{ number: 2273, title: issueTitle("每日生产构建") }],
    });
    expect(act.stages).toEqual([{ stage: "每日生产构建", number: 2273 }]);
  });

  it("人工按规范写的那张单，只要带同一串前缀就自动进这一族（#2273 的真实标题）", () => {
    const human =
      "ci(daily): 每日档红在「每日生产构建」—— bundle-budget +33 B（六天内第五笔同类账）";
    expect(human).toContain(titleKey("每日生产构建"));
    const act = decideAction({
      state: "failed",
      failedNames: ["每日生产构建"],
      existing: [{ number: 2273, title: human }],
    });
    expect(act.stages[0]?.number).toBe(2273);
  });

  it("换了另一格红 ⇒ 新建一张（一格一单，不往别人的单上记）", () => {
    const act = decideAction({
      state: "failed",
      failedNames: ["每日全量E2E", "每日单元测试"],
      existing: [{ number: 2273, title: issueTitle("每日生产构建") }],
    });
    expect(act.stages).toEqual([{ stage: "每日全量E2E" }, { stage: "每日单元测试" }]);
  });
});

describe("正文只含读数，不含因果", () => {
  const body = composeBody({
    slug: "moon-read/comfy-app-t3",
    build: build("cnb-8r8-1k5knrl91"),
    sn: "cnb-8r8-1k5knrl91",
    stage: "每日生产构建",
    skipped: ["每日 ESLint 零警告", "每日单元测试"],
    readout: [
      "── 失败格：每日生产构建（stage-2）",
      "L1212 [bundle-budget] 违规（阻断）：",
    ],
    handle: "ci-daily",
  });

  it("症状 / 读数 / 出处 / 出口四件都在，且明写「根因未判定」", () => {
    expect(body.startsWith("**[评论人：ci-daily]**")).toBe(true);
    expect(body).toContain("cnb-8r8-1k5knrl91");
    expect(body).toContain("「每日生产构建」");
    expect(body).toContain(
      "被它带下去、**根本没跑**的格：每日 ESLint 零警告、每日单元测试",
    );
    expect(body).toContain("L1212 [bundle-budget] 违规（阻断）：");
    expect(body).toContain("## 根因：**未判定**");
    expect(body).toContain("pnpm ship --diagnose cnb-8r8-1k5knrl91");
    expect(body).toContain(
      "https://cnb.cool/moon-read/comfy-app-t3/-/build/logs/cnb-8r8-1k5knrl91",
    );
  });

  it("负控制：不许出现替人说「谁的错 / 为什么红」那类因果句", () => {
    for (const banned of ["因为", "由于", "根因是", "造成的", "是它的错"]) {
      expect(body, `正文里出现了未经验证的因果句：${banned}`).not.toContain(banned);
    }
  });

  it("日志取不到时念「取不到」，不许念成「日志里没有失败行」", () => {
    const empty = composeBody({
      slug: "s/x",
      build: build("sn-1"),
      sn: "sn-1",
      stage: "每日生产构建",
      skipped: [],
      readout: [],
      handle: "ci-daily",
    });
    expect(empty).toContain("**取不到**");
  });
});

describe("跑生产入口本身（真起进程，`--from` 离线档）", () => {
  /** 写一份离线读数，返回它的路径与目录（每份用例自带目录，别往仓库里落东西）。 */
  function fixture(list: ListBuild[], details: Array<{ sn: string; json: DetailJson }>) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "daily-failure-issue-"));
    const file = path.join(dir, "read.json");
    fs.writeFileSync(file, JSON.stringify({ list, details }), "utf8");
    return { dir, file };
  }

  const run = (args: string[]) =>
    spawnSync(process.execPath, [ENTRY, ...args], {
      cwd: ROOT,
      encoding: "utf8",
    });

  it("离线档强制只读：念出要新建什么，一条都不写", () => {
    const f = fixture([build("sn-1")], [d("sn-1", "failed")]);
    try {
      const r = run(["--from", f.file]);
      const out = `${r.stdout}\n${r.stderr}`;
      expect(r.status, out).toBe(CODE.DONE);
      expect(out).toContain("强制只读");
      expect(out).toContain("→ 新建一张");
      expect(out).toContain("一条都没写");
      // 「被带下去四格」必须被念出来 —— 它正是这张单的成本所在。
      expect(out).toContain("被带下去 4 格");
    } finally {
      fs.rmSync(f.dir, { recursive: true, force: true });
    }
  });

  it("上一跑是绿的 ⇒ 一句话讲清为什么没写，且不构成「失败」", () => {
    const f = fixture([build("sn-2")], [d("sn-2", "green")]);
    try {
      const r = run(["--from", f.file]);
      expect(r.status).toBe(CODE.DONE);
      expect(`${r.stdout}${r.stderr}`).toContain("上一跑是绿的");
    } finally {
      fs.rmSync(f.dir, { recursive: true, force: true });
    }
  });

  /**
   * `--no-block` 的全部风险在这里：它把「没写成」的退码改成 0，
   * 而唯一能挡住它变成静默的东西，是那句话说出来 + 这一条用例钉住。
   */
  it("没有每日派发 ⇒ 不带旗标退 2（没结论），带 `--no-block` 退 0 但那句话照打", () => {
    const f = fixture([build("p", "push")], []);
    try {
      const strict = run(["--from", f.file]);
      expect(strict.status, `${strict.stdout}\n${strict.stderr}`).toBe(CODE.NO_FACT);
      const loose = run(["--from", f.file, "--no-block"]);
      expect(loose.status).toBe(CODE.DONE);
      const out = `${loose.stdout}\n${loose.stderr}`;
      expect(out).toContain("不拦路");
      expect(out).toContain("别把它改成静默 return");
      // 同一份输入、两种退码，但**话术一句不少** —— 「看不见」才是这一格唯一的失效形态。
      expect(out).toContain("列表里没有每日类派发");
    } finally {
      fs.rmSync(f.dir, { recursive: true, force: true });
    }
  });

  it("--from 那个路径不存在 ⇒ 退 2，而不是「没有红」", () => {
    const r = run(["--from", path.join(os.tmpdir(), "definitely-not-here-2274.json")]);
    expect(r.status).toBe(CODE.NO_FACT);
    expect(`${r.stdout}${r.stderr}`).toContain("不构成结论（不是「没有红」）");
  });

  /**
   * 生产网络路径的**默认出口**：注入一台会应答的假执行者，走的是与平台那一跳同一条链
   * （列表 → 逐格详情 → 逐格日志 → 开着的单），断言 `--dry-run` 那一支一个写命令都不发。
   *
   * 为什么不用 `--from` 代替这条：离线档压根不查「开着的单」，它证明不了
   * 「查到了已有单 ⇒ 只追加不新建」这条真实路径上的接线（注入式用例最容易漏的就是默认出口）。
   */
  it("--dry-run 走完整条读链，一次 create-issue / post-issue-comment 都不发", () => {
    /** @type {string[]} */
    const calls: string[] = [];
    const heard: string[] = [];
    const code = main({
      argv: ["--dry-run"],
      slug: "moon-read/comfy-app-t3",
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
        if (key.includes("get-build-status")) return json(detail("failed").data);
        if (key.includes("list-issues")) return json([]);
        return json({});
      },
    });
    const out = heard.join("\n");
    expect(code).toBe(CODE.DONE);
    expect(out).toContain("上一跑 sn-live");
    expect(out).toContain("判定 failed");
    expect(out).toContain("--dry-run：「每日生产构建」→ 新建一张");
    expect(
      calls.some((c) => c.includes("create-issue") || c.includes("post-issue-comment")),
      `dry-run 却发了写命令：${calls.join(" / ")}`,
    ).toBe(false);
    // 读链真的走到了逐格日志那一层（不是靠 --from 绕过去的）。
    expect(calls.some((c) => c.includes("get-build-stage"))).toBe(true);
  });
});

/**
 * 取数按时间窗翻页 —— 「上一跑真红」必须被捞回来（ISSUE #2392）。
 *
 * 今晚的现场：60 条那一页里唯一的每日类派发就是**正在跑的这一跑**，排除之后得到
 * 「有 1 条、无一终态」⇒ 什么都没写，而那一格带 `--no-block`，平台读数是一格 success。
 * 这两条用例一根正路（翻页把红的那一跑捞回来 ⇒ 写通道被真的走到），一根负控制
 * （盖不住窗口 ⇒ 一个字都不写，且不许把「没写」读成「没有红」）。
 */
describe("取数窗口：翻页盖住时间窗，立案才有输入", () => {
  /** 若干小时前的 ISO 时刻。 */
  const hoursAgo = (h: number) =>
    new Date(Date.now() - h * 3_600_000).toISOString();

  /** 造一整页（新→旧）：默认全是 PR 事件，`extra` 排在最前。 */
  function pageRows(
    count: number,
    newestH: number,
    oldestH: number,
    extra: ListBuild[] = [],
  ) {
    const rows: ListBuild[] = [...extra];
    for (let i = rows.length; i < count; i += 1) {
      const h = newestH + ((oldestH - newestH) * i) / Math.max(1, count - 1);
      rows.push({
        sn: `pr-${newestH}-${i}`,
        event: "pull_request",
        createTime: hoursAgo(h),
        status: "success",
      });
    }
    return rows;
  }

  /** 一整条假平台：列表按页答，详情按 sn 答，写命令记下来。 */
  function fakePlatform(input: {
    pages: Record<number, ListBuild[] | null>;
    detailsBySn: Record<string, Verdict>;
    openIssues: Array<{ number: number; title: string }>;
    comments?: string[];
  }) {
    /** @type {string[]} */
    const calls: string[] = [];
    const run = (_cmd: string, args: string[]) => {
      const key = args.join(" ");
      calls.push(key);
      const json = (data: unknown) => ({
        status: 0,
        stdout: JSON.stringify({ status: 200, data }),
        stderr: "",
        error: null,
      });
      if (key.includes("get-build-logs")) {
        const at = args.indexOf("--page");
        const n = Number(args[at + 1] ?? "1");
        const rows = input.pages[n];
        if (rows === null || rows === undefined)
          return { status: 1, stdout: "", stderr: "boom", error: null };
        return json({ total: rows.length, data: rows });
      }
      if (key.includes("get-build-status")) {
        const sn = String(args[args.indexOf("--sn") + 1] ?? "");
        return json(detail(input.detailsBySn[sn] ?? "running").data);
      }
      if (key.includes("list-issues")) return json(input.openIssues);
      if (key.includes("list-issue-comments"))
        return json(
          (input.comments ?? ["sn-prev"]).map((body) => ({ body })),
        );
      return json({});
    };
    return { run, calls };
  }

  it("第 2 页里那条真红 ⇒ 翻进去、认出它、把读数**追加到开着的那张号**上", () => {
    const live = build("sn-live"); // 正在跑的这一跑（就是列表第一条）
    const prev: ListBuild = {
      sn: "sn-prev",
      event: "crontab: 0 0 * * *",
      createTime: hoursAgo(24),
      status: "error",
    };
    const { run, calls } = fakePlatform({
      pages: {
        1: pageRows(60, 0.1, 8, [live]),
        2: pageRows(60, 8, 40, [prev]),
      },
      detailsBySn: { "sn-live": "running", "sn-prev": "failed" },
      openIssues: [
        { number: 2344, title: `${titleKey("每日生产构建")}—— 人工开的那张` },
      ],
    });
    const heard: string[] = [];
    const code = main({
      argv: [],
      slug: "moon-read/comfy-app-t3",
      log: (s: string) => heard.push(s),
      run,
    });
    const out = heard.join("\n");
    expect(
      calls.filter((c) => c.includes("get-build-logs")),
      `没有翻页：${calls.join(" / ")}`,
    ).toHaveLength(2);
    expect(out).toContain("取数覆盖自证");
    expect(out).toContain("上一跑 sn-prev");
    expect(out).toContain("判定 failed");
    expect(
      calls.some((c) => c.includes("post-issue-comment") && c.includes("--number 2344")),
      `写通道没被走到：${calls.join(" / ")}`,
    ).toBe(true);
    // 去重那一支：同一格已有开着的单 ⇒ 追加，不新建。
    expect(calls.some((c) => c.includes("create-issue"))).toBe(false);
    expect(code, out).toBe(CODE.DONE);
    expect(out).toContain("sn-prev"); // 写后独立回读认的是这一跑的 sn
  });

  it("翻到上界仍盖不住窗口 ⇒ 一个字都不写，且那句是「没盖住」而不是「没有红」", () => {
    const live = build("sn-live");
    const pages: Record<number, ListBuild[] | null> = {};
    for (let p = 1; p <= 20; p += 1) pages[p] = pageRows(60, 0.1, 8, [live]);
    const { run, calls } = fakePlatform({
      pages,
      detailsBySn: { "sn-live": "running" },
      openIssues: [],
    });
    const heard: string[] = [];
    const code = main({
      argv: [],
      slug: "moon-read/comfy-app-t3",
      log: (s: string) => heard.push(s),
      run,
    });
    const out = heard.join("\n");
    expect(code, out).toBe(CODE.NO_FACT);
    expect(out).toContain("取数没盖住");
    expect(
      calls.some((c) => c.includes("post-issue-comment") || c.includes("create-issue")),
      "盖不住窗口却写了平台",
    ).toBe(false);
  });
});
