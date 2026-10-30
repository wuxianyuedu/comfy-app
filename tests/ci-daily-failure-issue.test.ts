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
  laneStages,
  main,
  pickPreviousDaily,
  titleKey,
} from "../scripts/ci-daily-failure-issue.mjs";
import {
  BUNDLE_BASELINE_STALE_COMMITS,
  BUNDLE_GATE_MARKERS,
  BUNDLE_GATE_RED_STREAK_DAYS,
  BUNDLE_GATE_STAGE,
  composeEscalation,
  fetchBundleRedStreak,
  judgeBundleEscalation,
  readBundleAccount,
} from "../scripts/ci-daily-bundle-escalation.mjs";

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
      { id: string; name: string; status: string; stages: Array<StageRow> }
    >;
  };
};

type Verdict = "green" | "failed" | "cancelled" | "running";

/**
 * `pickPreviousDaily()` 的返回是判别联合（要么挑到、要么给一句为什么挑不到）。
 * 这里要的只是「读哪个字段」的形状，不是再写一套判决 —— 一次 `as`，字段全在这。
 */
type PickedLike = { sn?: string; none?: string; outcome?: { state: string } };
const asPicked = (p: unknown): PickedLike => /* SAFETY: 类型断言已复核 */ p as PickedLike;

/** 建单标题（去重键只认格名那一段，构建号 / 事件 / 时刻只给读者看 — ISSUE #2399）。 */
const titleOf = (stage: string, sn = "sn-t", at = "2026-10-24T11:40:05.000Z") =>
  issueTitle({ sn, event: "crontab: 0 0 * * *", at, stage });

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
  const stages: Array<StageRow> =
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
  const status = state === "green" ? "success" : state === "running" ? "pending" : "error";
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

/**
 * ISSUE #2595：02:00 那条流水线的事件名同样是 `crontab:` 前缀 —— 只按事件名挑「上一跑」，
 * 桌包那一档的红就会被记到每日档头上（现场：`cnb-7g8-1k60e2jk5` 红在 `打包·壳工具链自证`，
 * 标题写成 `ci(daily): … 红在「打包·壳工具链自证」`）。归属取平台自己写的流水线名。
 */
describe("按流水线名认「这一跑是不是这一档的」", () => {
  /** 一份桌包档的读数（流水线名与 `.cnb.yml` 的 `桌面成品包` 逐字相同）。 */
  const packageDetail = (): DetailJson => ({
    data: {
      status: "error",
      pipelinesStatus: {
        p1: {
          id: "p1",
          name: "桌面成品包",
          status: "error",
          stages: [
            { id: "stage-0", name: "打包·安装依赖", status: "success" },
            { id: "stage-1", name: "打包·壳工具链自证", status: "error" },
            { id: "stage-2", name: "打包·桌包工具预置", status: "skipped" },
          ],
        },
      },
    },
  });

  it("桌包那一跑的事件名同样是 `crontab:` ⇒ 不按档过滤时会误挑它（现场形状）", () => {
    const pkg = build("cnb-7g8", "crontab: 0 2 * * *");
    const picked = asPicked(
      pickPreviousDaily({
        list: [pkg],
        details: [{ sn: "cnb-7g8", json: packageDetail() }],
      }),
    );
    // 这就是缺陷本身：不给 lane 时它会把桌包那一跑当成每日档的「上一跑」。
    expect(picked.sn).toBe("cnb-7g8");
  });

  it("给了 lane ⇒ 桌包那一跑不算，且那句是「别的档」，不是「没有红」", () => {
    const pkg = build("cnb-7g8", "crontab: 0 2 * * *");
    const picked = asPicked(
      pickPreviousDaily({
        list: [pkg],
        details: [{ sn: "cnb-7g8", json: packageDetail() }],
        lanes: laneStages("每日生产构建"),
      }),
    );
    expect(picked.sn).toBeUndefined();
    expect(picked.none).toContain("别的档");
    expect(picked.none).toContain("每日生产构建");
  });

  it("每日档那一跑照旧被认出来（正路没被过滤掉）", () => {
    const picked = asPicked(
      pickPreviousDaily({
        list: [build("sn-previous")],
        details: [d("sn-previous", "failed")],
        lanes: laneStages("每日生产构建"),
      }),
    );
    expect(picked.sn).toBe("sn-previous");
  });

  it("两跑都在 ⇒ 只挑本档的那一跑，不挑更新的那条别人的", () => {
    const picked = asPicked(
      pickPreviousDaily({
        list: [build("cnb-pkg", "crontab: 0 2 * * *"), build("cnb-daily", "crontab: 0 0 * * *")],
        details: [{ sn: "cnb-pkg", json: packageDetail() }, d("cnb-daily", "failed")],
        lanes: laneStages("每日生产构建"),
      }),
    );
    expect(picked.sn).toBe("cnb-daily");
    expect(picked.outcome?.state).toBe("failed");
  });

  it("`--lane` 的值词表只有一处：认得出每日档，认不出的给空名单", () => {
    expect(laneStages("每日生产构建")).toEqual(["每日生产构建"]);
    expect(laneStages("每日构建")).toEqual([]);
    expect(laneStages(null)).toEqual([]);
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

describe("决定写不写：②去重键是「格名」，不是整条标题", () => {
  it("同一格已有 open 单 ⇒ 只追加读数，不新建", () => {
    const act = decideAction({
      state: "failed",
      failedNames: ["每日生产构建"],
      existing: [{ number: 2273, title: titleOf("每日生产构建") }],
    });
    expect(act.stages).toEqual([{ stage: "每日生产构建", number: 2273 }]);
  });

  it("人工写的那张单，只要带同一串格名就自动进这一族（#2273 的真实标题）", () => {
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

  /**
   * ISSUE #2399：同一格**每天**都红的时候，标题必须能自证是哪一跑。
   * 两条一起才是完整判据 —— 一条钉「换了构建号仍认得出同一张单」，
   * 一条钉「标题里真的带上了那三件原值」。
   */
  it("标题带构建号 / 事件 / 时刻，但键只认格名 ⇒ 同一格的第二天不新建第二张", () => {
    const day1 = titleOf("每日单元测试", "cnb-aaa-111", "2026-10-24T11:40:05.000Z");
    const day2 = titleOf("每日单元测试", "cnb-bbb-222", "2026-10-25T16:00:22.000Z");
    expect(day2).not.toBe(day1);
    for (const want of ["cnb-bbb-222", "crontab: 0 0 * * *", "2026-10-25T16:00:22.000Z"]) {
      expect(day2).toContain(want);
    }
    expect(day2).toContain(titleKey("每日单元测试"));
    const act = decideAction({
      state: "failed",
      failedNames: ["每日单元测试"],
      existing: [{ number: 2314, title: day1 }],
    });
    expect(act.stages).toEqual([{ stage: "每日单元测试", number: 2314 }]);
  });

  it("去重键里不含构建号 / 事件 / 时刻（它们只能进标题）", () => {
    for (const part of ["cnb-", "crontab", "T11:40"]) {
      expect(titleKey("每日单元测试")).not.toContain(part);
    }
  });

  it("换了另一格红 ⇒ 新建一张（一格一单，不往别人的单上记）", () => {
    const act = decideAction({
      state: "failed",
      failedNames: ["每日全量E2E", "每日单元测试"],
      existing: [{ number: 2273, title: titleOf("每日生产构建") }],
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
    readout: ["── 失败格：每日生产构建（stage-2）", "L1212 [bundle-budget] 违规（阻断）："],
    handle: "ci-daily",
  });

  it("症状 / 读数 / 出处 / 出口四件都在，且明写「根因未判定」", () => {
    expect(body.startsWith("**[评论人：ci-daily]**")).toBe(true);
    expect(body).toContain("cnb-8r8-1k5knrl91");
    expect(body).toContain("「每日生产构建」");
    expect(body).toContain("被它带下去、**根本没跑**的格：每日 ESLint 零警告、每日单元测试");
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
  function fixture(list: Array<ListBuild>, details: Array<{ sn: string; json: DetailJson }>) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "daily-failure-issue-"));
    const file = path.join(dir, "read.json");
    fs.writeFileSync(file, JSON.stringify({ list, details }), "utf8");
    return { dir, file };
  }

  const run = (args: Array<string>) =>
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
    const calls: Array<string> = [];
    const heard: Array<string> = [];
    const code = main({
      argv: ["--dry-run"],
      slug: "moon-read/comfy-app-t3",
      log: (s: string) => heard.push(s),
      run: (cmd: string, args: Array<string>) => {
        const key = args.join(" ");
        calls.push(`${cmd} ${key}`);
        const json = (data: unknown) => ({
          status: 0,
          stdout: JSON.stringify({ status: 200, data }),
          stderr: "",
          error: null,
        });
        if (key.includes("get-build-logs")) {
          return json([build("sn-live")]);
        }
        if (key.includes("get-build-status")) {
          return json(detail("failed").data);
        }
        if (key.includes("list-issues")) {
          return json([]);
        }
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
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

  /** 造一整页（新→旧）：默认全是 PR 事件，`extra` 排在最前。 */
  function pageRows(count: number, newestH: number, oldestH: number, extra: Array<ListBuild> = []) {
    const rows: Array<ListBuild> = [...extra];
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
    pages: Record<number, Array<ListBuild> | null>;
    detailsBySn: Record<string, Verdict>;
    openIssues: Array<{ number: number; title: string }>;
    comments?: Array<string>;
  }) {
    /** @type {string[]} */
    const calls: Array<string> = [];
    const run = (_cmd: string, args: Array<string>) => {
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
        if (rows === null || rows === undefined) {
          return { status: 1, stdout: "", stderr: "boom", error: null };
        }
        return json({ total: rows.length, data: rows });
      }
      if (key.includes("get-build-status")) {
        const sn = String(args[args.indexOf("--sn") + 1] ?? "");
        return json(detail(input.detailsBySn[sn] ?? "running").data);
      }
      if (key.includes("list-issues")) {
        return json(input.openIssues);
      }
      if (key.includes("list-issue-comments")) {
        return json((input.comments ?? ["sn-prev"]).map((body) => ({ body })));
      }
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
      openIssues: [{ number: 2344, title: `${titleKey("每日生产构建")}—— 人工开的那张` }],
    });
    const heard: Array<string> = [];
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
    const pages: Record<number, Array<ListBuild> | null> = {};
    for (let p = 1; p <= 20; p += 1) {
      pages[p] = pageRows(60, 0.1, 8, [live]);
    }
    const { run, calls } = fakePlatform({
      pages,
      detailsBySn: { "sn-live": "running" },
      openIssues: [],
    });
    const heard: Array<string> = [];
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

/**
 * 预算账陈旧度触发器（ISSUE #2639）：只认判据自己打的那两句判决行。
 *
 * 这一格最危险的失效形态是「把没测读成没事」—— 暂撤（#2634）、正文取不到、归因行读不出，
 * 三种都必须落在「不升级」，且**各说各的**：混成一句，读的人就分不出「没事」与「没测」。
 */
describe("读预算账：只认判据自己的判决行", () => {
  /** 判据现场那一形（`check-bundle-budget.cjs` 的归因行）。 */
  const enforcedText =
    "L1212 [bundle-budget] 违规（阻断）：总字节超预算\n" +
    "基线修订号：dd8d4647（其后本检出上有 87 次提交）";

  it("真红 + 归因行 ⇒ enforced，陈旧度读成 87 次提交", () => {
    const a = readBundleAccount(enforcedText);
    expect(a.marker).toBe("enforced");
    expect(a.stale).toEqual({ kind: "commits", n: 87, rev: "dd8d4647" });
  });

  it("「读数（不参与判定）」⇒ suspended，不是红（#2634 的开发期暂撤）", () => {
    const a = readBundleAccount(
      `${BUNDLE_GATE_MARKERS.suspended}：总字节超 3.1%\n基线修订号：abc12345（其后本检出上有 9 次提交）`,
    );
    expect(a.marker).toBe("suspended");
    expect(a.stale).toMatchObject({ kind: "commits", n: 9 });
  });

  it("两句判决行同时在（改稿中途的形态）⇒ unknown，不替你挑一句", () => {
    const a = readBundleAccount(
      `${BUNDLE_GATE_MARKERS.enforced}\n${BUNDLE_GATE_MARKERS.suspended}`,
    );
    expect(a.marker).toBe("unknown");
    expect(a.note).toContain("两句判决行同时在");
  });

  it("日志里没有判决行 ⇒ none；正文取不到 ⇒ unknown（不是 none）", () => {
    expect(readBundleAccount("全部通过").marker).toBe("none");
    expect(readBundleAccount(null).marker).toBe("unknown");
    expect(readBundleAccount("   ").note).toContain("没取到");
  });

  it("归因走「按日期」第二通道时认 source-commits；读不出时不是 0", () => {
    const byDate = readBundleAccount(
      `${BUNDLE_GATE_MARKERS.enforced}：总字节超预算\n` +
        "改按基线日期 2026-08-14 归因：src/ 侧其后有 52 次主干提交",
    );
    expect(byDate.stale).toEqual({ kind: "source-commits", n: 52, rev: null });
    const bare = readBundleAccount(`${BUNDLE_GATE_MARKERS.enforced}：总字节超预算`);
    expect(bare.marker).toBe("enforced");
    expect(bare.stale.kind).toBe("unknown");
  });
});

describe("升级判不判：门限可注入，读不出不构成结论", () => {
  const enforced = (n: number) =>
    readBundleAccount(
      `${BUNDLE_GATE_MARKERS.enforced}：总字节超预算\n` +
        `基线修订号：dd8d4647（其后本检出上有 ${n} 次提交）`,
    );
  const noStreak = { days: "unknown" as const, note: "离线档不联网" };
  const redStreak = (d: number) => ({ days: d, note: `连红 ${d} 天` });

  it("陈旧度到门限 ⇒ 升，正文带两条出口", () => {
    const j = judgeBundleEscalation({
      account: enforced(BUNDLE_BASELINE_STALE_COMMITS),
      streak: noStreak,
    });
    expect(j.fired).toBe(true);
    expect(j.reason).toContain("基线已陈旧");
    const section = String(j.section);
    expect(section).toContain("该有人出面了");
    expect(section).toContain("认账");
    expect(section).toContain("压回");
    expect(section).toContain("--allow-increase");
  });

  it("连续天数到门限（陈旧度读不出也算数）⇒ 升", () => {
    const j = judgeBundleEscalation({
      account: readBundleAccount(`${BUNDLE_GATE_MARKERS.enforced}：超预算`),
      streak: redStreak(BUNDLE_GATE_RED_STREAK_DAYS),
    });
    expect(j.fired).toBe(true);
    expect(j.reason).toContain("连续红");
  });

  it("两个门限都差一点 ⇒ 不升，念「还没到门限」而不是「没事」", () => {
    const j = judgeBundleEscalation({
      account: enforced(BUNDLE_BASELINE_STALE_COMMITS - 1),
      streak: redStreak(BUNDLE_GATE_RED_STREAK_DAYS - 1),
    });
    expect(j.fired).toBe(false);
    expect(j.reason).toContain("还没到门限");
    expect(j.reason).toContain(`14/${BUNDLE_BASELINE_STALE_COMMITS}`);
  });

  it("暂撤 / 没红 / 认不出：三档都不升级，但三句话必须不同", () => {
    const suspended = judgeBundleEscalation({
      account: readBundleAccount(`${BUNDLE_GATE_MARKERS.suspended}：超预算`),
      streak: noStreak,
    });
    const none = judgeBundleEscalation({
      account: readBundleAccount("全部通过"),
      streak: noStreak,
    });
    const unknown = judgeBundleEscalation({
      account: readBundleAccount(null),
      streak: noStreak,
    });
    for (const j of [suspended, none, unknown]) expect(j.fired).toBe(false);
    expect(suspended.reason).toContain("#2634");
    expect(none.reason).toContain("没有违规读数");
    expect(unknown.reason).toContain("不构成结论");
    expect(new Set([suspended.reason, none.reason, unknown.reason]).size).toBe(3);
  });

  it("判了红但两个门限都读不出 ⇒ 明说「不构成结论（不是「没过门限」）」", () => {
    const j = judgeBundleEscalation({
      account: readBundleAccount(`${BUNDLE_GATE_MARKERS.enforced}：超预算`),
      streak: noStreak,
    });
    expect(j.fired).toBe(false);
    expect(j.reason).toContain("两个门限都读不出");
    expect(j.reason).toContain("不是「没过门限」");
  });

  it("门限以参数为准（注入值真的生效，边界钉在 >= 上）", () => {
    const at = judgeBundleEscalation({
      account: enforced(5),
      streak: redStreak(8),
      staleCommits: 5,
      streakDays: 9,
    });
    expect(at.fired).toBe(true);
    const below = judgeBundleEscalation({
      account: enforced(4),
      streak: redStreak(8),
      staleCommits: 5,
      streakDays: 9,
    });
    expect(below.fired).toBe(false);
  });
});

describe("正文里的升级段：两种归因都要念成人话", () => {
  const enforced = readBundleAccount(
    `${BUNDLE_GATE_MARKERS.enforced}：总字节超预算\n` +
      "基线修订号：dd8d4647（其后本检出上有 87 次提交）",
  );
  const byDate = readBundleAccount(
    `${BUNDLE_GATE_MARKERS.enforced}：总字节超预算\n` +
      "改按基线日期 2026-08-14 归因：src/ 侧其后有 52 次主干提交",
  );
  const section = composeEscalation({
    account: enforced,
    streak: { days: "unknown", note: "离线档不联网" },
    why: ["基线已陈旧 87 次提交（门限 15）"],
  });

  it("修订号 + 次数念得出来；读不出的连续天数明说读不出", () => {
    expect(section).toContain("`dd8d4647` 其后**87 次提交**");
    expect(section).toContain("连续：**读不出**（离线档不联网）");
    expect(section).toContain("触发原因：基线已陈旧 87 次提交（门限 15）");
  });

  it("按日期归因那一形带上「src/ 侧主干提交」的出处", () => {
    const s = composeEscalation({
      account: byDate,
      streak: { days: 3, note: "连红 3 天" },
      why: ["src/ 侧其后 52 次主干提交（门限 15）"],
    });
    expect(s).toContain("`(按日期归因)`");
    expect(s).toContain("**52 次提交**（src/ 侧主干提交）");
    expect(s).toContain("连续红 **3 天**");
  });

  it("带升级段时它插在读数与「根因未判定」之间；不带时一个字都不多", () => {
    const base = {
      slug: "moon-read/comfy-app-t3",
      build: build("cnb-esc-1"),
      sn: "cnb-esc-1",
      stage: "每日生产构建",
      skipped: [] as Array<string>,
      readout: ["── 失败格：每日生产构建（stage-2）"],
      handle: "ci-daily",
    };
    const withSection = composeBody({ ...base, escalation: section });
    expect(withSection).toContain(section);
    expect(withSection.indexOf(section)).toBeGreaterThan(
      withSection.indexOf("## 当场读数"),
    );
    expect(withSection.indexOf(section)).toBeLessThan(
      withSection.indexOf("## 根因：**未判定**"),
    );
    expect(composeBody(base)).not.toContain("该有人出面");
  });
});

describe("判决行与判据那一侧对账（改词要两边一起改）", () => {
  it("BUNDLE_GATE_MARKERS 的两句都能在 check-bundle-budget.cjs 的源码里找到", () => {
    const src = fs.readFileSync(
      path.join(ROOT, "scripts", "check-bundle-budget.cjs"),
      "utf8",
    );
    for (const marker of Object.values(BUNDLE_GATE_MARKERS))
      expect(src, `判据那侧没有这句判决行：${marker}`).toContain(marker);
  });
});

/**
 * 连续红天数：逐日回看，**读不出不是 0**。
 *
 * 这一格与主取数共用 `fetchBuildsCoveringWindow()`（窗口按门限天数算）——
 * 用例喂的是同一份平台形状，测的是「哪几跑算看过」与「什么时候必须放弃结论」。
 */
describe("连续红天数：逐日回看，读不出不是 0", () => {
  type FakeDay = { text: string; status?: string };

  /** 假平台：列表按页答（`null` = 那一页取不到），逐格详情按 sn 答。 */
  function fakePlatform(input: {
    page: (n: number) => Array<ListBuild> | null;
    days: Record<string, FakeDay>;
  }) {
    const calls: Array<string> = [];
    const run = (_cmd: string, args: Array<string>) => {
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
        const rows = input.page(Number(args[at + 1] ?? "1"));
        if (rows === null) return { status: 1, stdout: "", stderr: "boom", error: null };
        return json({ total: rows.length, data: rows });
      }
      if (key.includes("get-build-status")) {
        const sn = String(args[args.indexOf("--sn") + 1] ?? "");
        const day = input.days[sn] ?? { text: "" };
        const stage = {
          id: "stage-2",
          name: BUNDLE_GATE_STAGE,
          status: day.status ?? "error",
        };
        return json({
          status: "error",
          pipelinesStatus: {
            p1: { id: "p1", name: BUNDLE_GATE_STAGE, status: "error", stages: [stage] },
          },
        });
      }
      if (key.includes("get-build-stage")) {
        const sn = String(args[args.indexOf("--sn") + 1] ?? "");
        return json({ status: "error", content: input.days[sn]?.text ?? "" });
      }
      return json({});
    };
    return { run, calls };
  }

  const red = `${BUNDLE_GATE_MARKERS.enforced}：总字节超预算`;
  const off = `${BUNDLE_GATE_MARKERS.suspended}：总字节超预算`;
  const green = "全部通过";
  const sns = ["sn-d0", "sn-d1", "sn-d2"];
  const list = () => sns.map((sn) => build(sn));

  it("今天 + 昨天都判红 ⇒ 2 天（门限就是 2）", () => {
    const { run } = fakePlatform({
      page: () => list(),
      days: {
        "sn-d0": { text: red },
        "sn-d1": { text: red },
        "sn-d2": { text: green },
      },
    });
    const r = fetchBundleRedStreak({
      run,
      slug: "s/x",
      lanes: [BUNDLE_GATE_STAGE],
      fromSn: "sn-d0",
      need: 2,
    });
    expect(r.days).toBe(2);
  });

  it("昨天没红 ⇒ 连续在断点截断（1），不是「今天红所以 2」", () => {
    const { run } = fakePlatform({
      page: () => list(),
      days: {
        "sn-d0": { text: red },
        "sn-d1": { text: off },
        "sn-d2": { text: red },
      },
    });
    const r = fetchBundleRedStreak({
      run,
      slug: "s/x",
      lanes: [BUNDLE_GATE_STAGE],
      fromSn: "sn-d0",
      need: 2,
    });
    expect(r.days).toBe(1);
    expect(r.note).toContain("断");
  });

  it("某一天读数认不出 ⇒ unknown（不拿它当绿也不当红）", () => {
    const { run } = fakePlatform({
      page: () => list(),
      days: { "sn-d0": { text: red }, "sn-d1": { text: "" } },
    });
    const r = fetchBundleRedStreak({
      run,
      slug: "s/x",
      lanes: [BUNDLE_GATE_STAGE],
      fromSn: "sn-d0",
      need: 2,
    });
    expect(r.days).toBe("unknown");
    expect(r.note).toContain("认不出");
  });

  it("某一天那一格没跑（skipped）⇒ unknown，连续天数不猜", () => {
    const { run } = fakePlatform({
      page: () => list(),
      days: {
        "sn-d0": { text: red },
        "sn-d1": { text: "", status: "skipped" },
      },
    });
    const r = fetchBundleRedStreak({
      run,
      slug: "s/x",
      lanes: [BUNDLE_GATE_STAGE],
      fromSn: "sn-d0",
      need: 2,
    });
    expect(r.days).toBe("unknown");
    expect(r.note).toContain("skipped");
  });

  it("盖不住宽窗口 ⇒ unknown（不是 0）", () => {
    const recent = (i: number): ListBuild => ({
      sn: `pr-${i}`,
      event: "pull_request",
      createTime: new Date(Date.now() - 60_000).toISOString(),
      status: "success",
    });
    const { run } = fakePlatform({
      page: (n) => (n === 1 ? Array.from({ length: 60 }, (_, i) => recent(i)) : null),
      days: {},
    });
    const r = fetchBundleRedStreak({
      run,
      slug: "s/x",
      lanes: [BUNDLE_GATE_STAGE],
      fromSn: "sn-d0",
      need: 2,
    });
    expect(r.days).toBe("unknown");
    expect(r.note).toContain("没盖住");
  });

  it("本档派发不足门限跑数 ⇒ unknown，不把「看到几跑」当成连续天数", () => {
    const { run } = fakePlatform({
      page: () => [build("sn-d0")],
      days: { "sn-d0": { text: red } },
    });
    const r = fetchBundleRedStreak({
      run,
      slug: "s/x",
      lanes: [BUNDLE_GATE_STAGE],
      fromSn: "sn-d0",
      need: 2,
    });
    expect(r.days).toBe("unknown");
    expect(r.note).toContain("只有 1 跑");
  });
});

/**
 * 离线档（`--from`）把整条接线跑一遍：判决行来自 `stageLogs`，升级与否那句话必须打出来。
 *
 * 为什么钉这句日志：升级段只进正文，而离线档不打印正文 —— 「看不见」正是这一格唯一的失效形态。
 */
describe("离线档跑生产入口：升级与否必须念出来", () => {
  function fixtureWithLogs(text: string) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "daily-escalation-"));
    const file = path.join(dir, "read.json");
    fs.writeFileSync(
      file,
      JSON.stringify({
        list: [build("sn-esc")],
        details: [d("sn-esc", "failed")],
        stageLogs: { "sn-esc": text },
      }),
      "utf8",
    );
    return { dir, file };
  }

  const run = (args: Array<string>) =>
    spawnSync(process.execPath, [ENTRY, ...args], { cwd: ROOT, encoding: "utf8" });

  it("真红 + 基线其后 87 次提交 ⇒ 念「↑ 升级」且原因点名陈旧度", () => {
    const f = fixtureWithLogs(
      `${BUNDLE_GATE_MARKERS.enforced}：总字节超预算\n` +
        "基线修订号：dd8d4647（其后本检出上有 87 次提交）",
    );
    try {
      const r = run(["--from", f.file]);
      const out = `${r.stdout}\n${r.stderr}`;
      expect(r.status, out).toBe(CODE.DONE);
      expect(out).toContain("格日志 1 份");
      expect(out).toContain("预算账触发器：↑ 升级");
      expect(out).toContain("基线已陈旧 87 次提交");
    } finally {
      fs.rmSync(f.dir, { recursive: true, force: true });
    }
  });

  it("暂撤那一跑（读数、不参与判定）⇒ 不升级，并说清是 #2634", () => {
    const f = fixtureWithLogs(
      `${BUNDLE_GATE_MARKERS.suspended}：总字节超 3.1%\n` +
        "基线修订号：dd8d4647（其后本检出上有 87 次提交）",
    );
    try {
      const r = run(["--from", f.file]);
      const out = `${r.stdout}\n${r.stderr}`;
      expect(r.status, out).toBe(CODE.DONE);
      expect(out).toContain("预算账触发器：不升级");
      expect(out).toContain("#2634");
    } finally {
      fs.rmSync(f.dir, { recursive: true, force: true });
    }
  });

  it("判了红但归因行读不出 ⇒ 「两个门限都读不出」，不冒充「没过门限」", () => {
    const f = fixtureWithLogs(`${BUNDLE_GATE_MARKERS.enforced}：总字节超预算`);
    try {
      const r = run(["--from", f.file]);
      const out = `${r.stdout}\n${r.stderr}`;
      expect(r.status, out).toBe(CODE.DONE);
      expect(out).toContain("预算账触发器：不升级");
      expect(out).toContain("两个门限都读不出");
      expect(out).toContain("不是「没过门限」");
    } finally {
      fs.rmSync(f.dir, { recursive: true, force: true });
    }
  });
});
