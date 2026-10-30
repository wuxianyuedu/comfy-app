/**
 * `scripts/check-daily-attendance.mjs` —— 「每日那一跑到底有没有执行」那条判据的判断面
 * （ISSUE #2114 出路 1；口径在规范 §13.5.23 末节）。
 *
 * ## 它守的是什么
 *
 * 三档重档与 `ESLint 零警告` 的唯一执行者是平台上的每日那一跑，而「唯一执行者」这件事
 * 此前只有**在册**那一半有人判（`no-platform-ci-config` 数的是格名在不在清单里）。
 * 五派发零跑完的那四天里账面全绿 —— 于是那几档的本地豁免挂在一个没有任何判据在守的事实上。
 * 本文件判的是补上之后的那一半：**结论必须跟着读数走，而不是跟着「配置里有这格」走**。
 *
 * ## 这里能判什么、不能判什么
 *
 * **不能**判「平台今天有没有把那一跑派出来」—— 那要网络，而判据自身不做网络请求
 * （§13.5.13 同口径）。所以这里全部用**注入的读数**：真实命令的那一跳由
 * `--from` 那条用例真起一次进程（读一份落盘的 JSON，不碰网络），
 * 剩下的形状判断都在纯函数上做。
 *
 * **能**判的五件：
 *   ① 绿的一次派发 = 出勤；
 *   ② 四种「没跑成」的死法各自落到**正确的档**（真失败 1 / 被取消 2 / 没有派发 1 /
 *     取不到逐格 2）—— 尤其「被取消」不许落在 1：那一跑没验证过任何产物，
 *     说它红就是替平台编一个不存在的产物问题（同 `ci-build-readout.mjs` 那条口径）；
 *   ③ 绿的但超出窗口 = 缺勤（这是「每天一次」这件事本身的账）；
 *   ④ **哪些事件算每日派发**：按 `crontab:` 前缀认（时刻 10-22 一天换过两次，
 *     写死钟点的判据第二天就会自己漂），三条触发口都算，而
 *     `pull_request` / `push` / 单跑口**都不算** —— 否则「有人手点过一次单跑构建」
 *     会被读成「每日档出勤了」，那正是本判据要拦的那种假绿；
 *   ⑤ 逐格判定住在他处（`ci-build-readout`），这里不重抄一份。
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  CODE,
  DEFAULT_WINDOW_HOURS,
  FETCH_MAX_PAGES,
  FETCH_PAGE_SIZE,
  fetchBuildsCoveringWindow,
  isDailyDispatch,
  judgeAttendance,
  latestDailyDispatch,
  main,
  readOffline,
} from "../scripts/check-daily-attendance.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const SCRIPT = path.join(ROOT, "scripts/check-daily-attendance.mjs");

/** 2026-10-23 00:00 那一跑的真形状（第一次 `0 0` 派发，11 格全 success）。 */
const GREEN_STAGES = [
  { name: "Prepare", status: "success", duration: 31547 },
  { name: "每日工具链自证", status: "success", duration: 13324 },
  { name: "每日安装依赖", status: "success", duration: 256363 },
  { name: "每日 Python 可用性", status: "success", duration: 3550 },
  { name: "每日 Python 探针读数", status: "success", duration: 4177 },
  { name: "每日同步数据库表结构", status: "success", duration: 20448 },
  { name: "每日生产构建", status: "success", duration: 128856 },
  { name: "每日 ESLint 零警告", status: "success", duration: 333521 },
  { name: "每日浏览器安装", status: "success", duration: 2771 },
  { name: "每日全量E2E", status: "success", duration: 100865 },
  { name: "每日单元测试", status: "success", duration: 658594 },
  { name: "BeforeEnd", status: "success", duration: 4 },
  { name: "DebugDetection", status: "skipped", duration: 0 },
  { name: "End", status: "success", duration: 83 },
];

/** 平台一份 stage 记录里我们要造的那几栏。 */
interface StageFixture {
  name: string;
  status: string;
  duration: number;
}

/**
 * 造一份「sn + `get-build-status -v` 那个形状」的配对（判据吃的就是这一形）。
 *
 * `id` 按平台真那份补上（`stage-0` / `stage-1` …，平台自带的 `Prepare` / `BeforeEnd` /
 * `End` / `DebugDetection` 没有这个形状）—— `classifyStages` 只把 `stage-N` 那一族算成
 * 「本仓的格」，所以不给 id 的夹具走的是它「认不出形状就全收」的兜底支，两条路都得有样本。
 */
function detail(
  sn: string,
  event: string,
  createTime: string,
  stages: Array<StageFixture>,
  pipelineStatus = "success",
) {
  let seq = 0;
  const withIds = stages.map((s: StageFixture) => {
    const mine = /^(每日|单跑)/.test(String(s.name));
    return {
      ...s,
      id: mine ? `stage-${(seq += 1) - 1}` : String(s.name).toLowerCase(),
    };
  });
  return {
    sn,
    json: {
      data: {
        sn,
        event,
        createTime,
        status: pipelineStatus === "success" ? "success" : "error",
        pipelinesStatus: {
          [`${sn}-001`]: {
            id: `${sn}-001`,
            name: "每日生产构建",
            status: pipelineStatus,
            labels: [{ key: "cpus", value: ["16"] }],
            stages: withIds,
          },
        },
      },
    },
  };
}

/** 列表里的一项（`get-build-logs` 的形状）。 */
function listed(sn: string, event: string, createTime: string, status = "success") {
  return { sn, event, createTime, status };
}

const NOW = Date.parse("2026-10-23T02:00:00.000Z");
const RECENT = "2026-10-22T16:00:17.000Z"; // = 本地 10-23 00:00:17

describe("daily-attendance：出勤结论跟着读数走", () => {
  it("窗口内一次逐格全绿的派发 = 出勤（退 0）", () => {
    const got = judgeAttendance({
      builds: [listed("cnb-hk7-1k5i5euak", "crontab: 0 0 * * *", RECENT)],
      details: [detail("cnb-hk7-1k5i5euak", "crontab: 0 0 * * *", RECENT, GREEN_STAGES)],
      now: NOW,
    });
    expect(got.code, got.headline).toBe(CODE.PRESENT);
    expect(got.verdict).toBe("present");
    expect(got.headline).toContain("出勤 ✓");
    /* 「几格有结论」只数工作格：`stage-N` 那一族 + `prepare`（11 格）。
     * `prepare` 从 ISSUE #2406 起算在里面 —— 它不是「平台自带的噪声」，而是
     * 「一格都没跑到」时唯一有读数的格；`BeforeEnd` / `End` / `DebugDetection`
     * 仍然不计入，否则读数会把「十一格」念成永远对不上的数。 */
    expect(got.evidence.join("\n")).toContain("11 格有结论");
    /* `DebugDetection` 是平台自带那一档（永远 skipped），不许被算成「有格没跑」。 */
    expect(got.evidence.join("\n")).not.toContain("DebugDetection");
  });

  it("绿的但已经超出窗口 = 缺勤（每天一次这件事本身就是账）", () => {
    const stale = "2026-10-20T16:00:17.000Z"; // 距 now 54 小时
    const got = judgeAttendance({
      builds: [listed("cnb-old", "crontab: 0 0 * * *", stale)],
      details: [detail("cnb-old", "crontab: 0 0 * * *", stale, GREEN_STAGES)],
      now: NOW,
    });
    expect(got.code, got.headline).toBe(CODE.ABSENT);
    expect(got.headline).toContain("没有下一次");
  });

  it("被取消那一跑落在「没结论」而不是「红」（#2114 那条锁退化的形状）", () => {
    const stages = [
      { name: "Prepare", status: "success", duration: 29083 },
      { name: "单跑构建·安装依赖", status: "success", duration: 214977 },
      { name: "单跑构建·同步数据库表结构", status: "cancel", duration: 86 },
      { name: "单跑构建·生产构建", status: "skipped", duration: 0 },
      { name: "BeforeEnd", status: "success", duration: 3 },
      { name: "End", status: "success", duration: 81 },
    ];
    const got = judgeAttendance({
      builds: [listed("cnb-lm1-1k5h1otqt", "crontab: 0 0 * * *", RECENT, "error")],
      details: [detail("cnb-lm1-1k5h1otqt", "crontab: 0 0 * * *", RECENT, stages, "cancel")],
      now: NOW,
    });
    expect(got.code, got.headline).toBe(CODE.NO_VERDICT);
    expect(got.headline).toContain("被取消");
    expect(got.headline).toContain("不是去查产物");
    /* 「下面那格根本没跑」必须被点名 —— 它才是这条读数的人话部分。 */
    expect(got.evidence.join("\n")).toContain("根本没跑的格");
  });

  it("起步即败（整条只跑到 Prepare）= 缺勤，不是「取不到」", () => {
    const stages = [
      { name: "Prepare", status: "error", duration: 300 },
      { name: "每日工具链自证", status: "skipped", duration: 0 },
      { name: "每日安装依赖", status: "skipped", duration: 0 },
    ];
    const got = judgeAttendance({
      builds: [listed("cnb-7kr-1k5as018h", "crontab: 0 4 * * *", RECENT, "error")],
      details: [detail("cnb-7kr-1k5as018h", "crontab: 0 4 * * *", RECENT, stages, "error")],
      now: NOW,
    });
    expect(got.code, got.headline).toBe(CODE.ABSENT);
    expect(got.verdict).toBe("absent");
  });

  it("列表里根本没有每日派发 = 缺勤，并且说清认的是哪三个事件", () => {
    const got = judgeAttendance({
      builds: [listed("cnb-x", "pull_request", RECENT), listed("cnb-y", "push", RECENT)],
      details: [],
      now: NOW,
    });
    expect(got.code, got.headline).toBe(CODE.ABSENT);
    expect(got.headline).toContain("一次每日类派发都没有");
  });

  it("最近那一次取不到逐格读数 = 未校验（拿不到测量 ≠ 红的）", () => {
    const got = judgeAttendance({
      builds: [listed("cnb-z", "api_trigger_daily", RECENT)],
      details: [],
      now: NOW,
    });
    expect(got.code, got.headline).toBe(CODE.NO_VERDICT);
    expect(got.headline).toContain("未校验");
  });

  /**
   * 认事件的这一半单独钉：它决定这条判据会不会自己漂。
   *
   * `crontab` 的事件名**含小时**，而 2026-10-22 一天里换了两次（`0 4` → `0 2` → `0 0`）——
   * 任何按整串名字写的判据在第二次换时刻时就会静默变成「永远读不到派发」。
   */
  it("按前缀认每日派发；单跑与 PR 跑绿都不算出勤", () => {
    for (const event of [
      "crontab: 0 4 * * *",
      "crontab: 0 2 * * *",
      "crontab: 0 0 * * *",
      "web_trigger_daily",
      "api_trigger_daily",
    ]) {
      expect(isDailyDispatch({ event }), event).toBe(true);
    }
    for (const event of [
      "pull_request",
      "push",
      "api_trigger_build",
      "web_trigger_build",
      "api_trigger_daily_x", // 前缀相似但不是那一口：整串相等才算
    ]) {
      expect(isDailyDispatch({ event }), event).toBe(false);
    }
    /* 多条里挑最近的那一条 —— 拿旧的当「上一次」会把缺勤读成出勤。 */
    const picked = /* SAFETY: 类型断言已复核 */ latestDailyDispatch([
      listed("old", "crontab: 0 4 * * *", "2026-10-20T16:00:00.000Z"),
      listed("new", "crontab: 0 0 * * *", RECENT),
      listed("pr", "pull_request", "2026-10-23T01:00:00.000Z"),
    ]) as { sn: string } | null;
    expect(picked?.sn).toBe("new");
  });
});

describe("daily-attendance：命令行那一跳", () => {
  /** 真起进程，读一份落在临时目录里的 JSON —— 不碰网络，但走的是生产入口本身。 */
  function runCli(
    args: Array<string>,
    files?: Record<string, string>,
    /* 「现在」默认钉在 NOW 上：夹具里的派发时刻是**绝对时刻**，而窗口比的是「距现在多久」
     * ⇒ 不钉住，这条离线用例会随真实时间推移自己变红（2026-10-24 现场：真实时间到
     * 10-24 08:21Z 时夹具的 10-22 16:00Z 已隔 40.4h > 36h ⇒ 判成「每日缺勤」，于是
     * 这一档从「离线单测」变成「随时间漂移的平台状态判据」，并把每个把它拉进受影响
     * 面的 PR 一起判红）。判据自己不该去摸真实时间（§13.5.13：什么时候算现在，是
     * 调用者的事）—— 与 `--from` 同一族。传 null 表示「故意不给」，用来钉那条防线。 */
    now: string | null = String(NOW),
  ): { code: number | null; out: string } {
    const dir = mkdtempSync(path.join(tmpdir(), "daily-attendance-"));
    try {
      for (const [name, text] of Object.entries(files ?? {})) {
        writeFileSync(path.join(dir, name), text, "utf8");
      }
      const got = spawnSync(
        process.execPath,
        [
          SCRIPT,
          ...args.map((a: string) => a.replace("@DIR@", dir)),
          ...(now === null ? [] : ["--now", now]),
        ],
        { encoding: "utf8", cwd: ROOT },
      );
      return {
        code: got.status,
        out: `${got.stdout ?? ""}${got.stderr ?? ""}`,
      };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("--from 一份列表：绿的那一次退 0，逐格清单一行不落", () => {
    const body = JSON.stringify({
      data: [listed("cnb-hk7-1k5i5euak", "crontab: 0 0 * * *", RECENT)],
    });
    /* 列表项里没有 pipelinesStatus ⇒ 判「取不到逐格」那一档（退 2），
     * 这一条钉的是「只有一张列表时不许冒充出勤」。 */
    const only = runCli(["--from", "@DIR@/list.json", "--json"], {
      "list.json": body,
    });
    expect(only.code, only.out).toBe(CODE.NO_VERDICT);
    expect(only.out).toContain("取不到逐格读数");

    /* 同一条 sn 换成带逐格的详情 ⇒ 出勤。 */
    const detailFile = runCli(["--from", "@DIR@/one.json", "--json"], {
      "one.json": JSON.stringify(
        detail("cnb-hk7-1k5i5euak", "crontab: 0 0 * * *", RECENT, GREEN_STAGES).json,
      ),
    });
    expect(detailFile.code, detailFile.out).toBe(CODE.PRESENT);
    expect(
      /* SAFETY: 类型断言已复核 */ (JSON.parse(detailFile.out) as { verdict: string }).verdict,
    ).toBe("present");

    /* **真**那份 `get-build-status -v` 只有 `status` + `pipelinesStatus`（实测），
     * 认不出它是哪一类派发、也认不出它是什么时候落的 ⇒ 必须落到「未校验」，
     * 而不是被当成一次出勤 —— 这条钉的是「凑一份形状像的 JSON 就能判绿」这条路被封死。 */
    const realShaped = runCli(["--from", "@DIR@/status-only.json", "--json"], {
      "status-only.json": JSON.stringify({
        data: {
          status: "success",
          pipelinesStatus: { "p-001": { stages: GREEN_STAGES } },
        },
      }),
    });
    expect(realShaped.code, realShaped.out).toBe(CODE.NO_VERDICT);
    expect(realShaped.out).toContain("认不出它是不是每日派发");
  });

  it("--from 指不到文件时退 2 并说清，而不是退 0 什么都不打", () => {
    const got = runCli(["--from", "@DIR@/没有这个文件.json"]);
    expect(got.code, got.out).toBe(CODE.NO_VERDICT);
    expect(got.out).toContain("未校验");
    expect(got.out).toContain("--from 那个路径不存在");
  });

  it("离线档不给「现在」⇒ 退 2 并说清，而不是拿真实时间去判（2026-10-24 现场：它曾随时间推移自己变红）", () => {
    /* 这条钉的是「不许拿真实时间判一个绝对时刻」：夹具里的派发时刻写死在 10-22，
     * 而窗口比的是「距现在多久」⇒ 不钉「现在」，它就会在 36h 之后自己红成
     * 「每日缺勤」（当天现场：真实时间 10-24 08:21Z，夹具已隔 40.4h）。 */
    const body = JSON.stringify({
      data: [listed("cnb-hk7-1k5i5euak", "crontab: 0 0 * * *", RECENT)],
    });
    const got = runCli(["--from", "@DIR@/list.json", "--json"], { "list.json": body }, null);
    expect(got.code, got.out).toBe(CODE.NO_VERDICT);
    expect(got.out).toContain("必须同时钉住");
  });

  it("readOffline 认得列表与单跑两种形状（第三种要出声）", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "daily-attendance-shape-"));
    try {
      const weird = path.join(dir, "weird.json");
      writeFileSync(weird, JSON.stringify({ hello: "world" }), "utf8");
      expect(readOffline(weird).failure).toContain("既不是列表也不是单跑详情");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * 列表项（`createTime` 允许缺 —— 有一条用例判的就是「认不出时刻」这一格）。
 */
type PageRow = {
  sn: string;
  event: string;
  createTime?: string;
  status: string;
};

/**
 * 取数按**时间窗**翻页，不按条数翻页（ISSUE #2392）。
 *
 * 这一族的形状是「判据声明 36h，而取数只拿最近 60 条」—— 60 条折算多久**由当天多忙
 * 决定**：实测会话密集的一天里它只回到约 7.5 小时，于是列表里唯一的每日类派发就是
 * **正在跑的这一跑**，`latestDailyDispatch()` 拿到空 ⇒ 判据念出「缺勤」，而那一跑其实
 * 出勤了。本组用例把两侧都钉住：盖住了才许判，盖不住必须落在「未校验」而不是「缺勤」。
 */
describe("daily-attendance：取数按时间窗翻，不按条数翻", () => {
  /** 造一整页（新→旧）：第一条在 `newestH` 小时前，最后一条在 `oldestH` 小时前。 */
  function pageRows(newestH: number, oldestH: number, count = FETCH_PAGE_SIZE) {
    const rows: Array<PageRow> = [];
    for (let i = 0; i < count; i += 1) {
      const h = newestH + ((oldestH - newestH) * i) / Math.max(1, count - 1);
      rows.push(
        listed(`pr-${newestH}-${i}`, "pull_request", new Date(NOW - h * 3_600_000).toISOString()),
      );
    }
    return rows;
  }

  /** 按 `--page N` 回答的执行者；`pages` 里没点名的页一律回 `null`（取不到）。 */
  function pagerByPage(pages: Record<number, Array<PageRow> | null>) {
    /** @type {string[]} */
    const calls: Array<string> = [];
    const run = (_cmd: string, args: Array<string>) => {
      calls.push(args.join(" "));
      const at = args.indexOf("--page");
      const n = Number(args[at + 1] ?? "1");
      const rows = pages[n] === undefined ? pages[1] : pages[n];
      if (rows === null || rows === undefined) {
        return { status: 1, stdout: "", stderr: "boom", error: null };
      }
      return {
        status: 0,
        stdout: JSON.stringify({
          status: 200,
          data: { total: rows.length, data: rows },
        }),
        stderr: "",
        error: null,
      };
    };
    return { run, calls };
  }

  it("前两页盖不住 36h ⇒ 翻到第三页才算盖住，且盖住后不多翻", () => {
    const { run, calls } = pagerByPage({
      1: pageRows(1, 10),
      2: pageRows(10, 30),
      3: pageRows(30, 40),
      4: pageRows(40, 50),
    });
    const win = fetchBuildsCoveringWindow({
      run,
      slug: "moon-read/comfy-app-t3",
      windowHours: DEFAULT_WINDOW_HOURS,
      now: NOW,
    });
    expect(win.covered).toBe(true);
    expect(win.pages).toBe(3);
    expect(calls.filter((c) => c.includes("get-build-logs"))).toHaveLength(3);
    expect(win.list).toHaveLength(FETCH_PAGE_SIZE * 3);
    expect(win.note).toContain("取满窗口");
  });

  it("不满一页 = 后面没有更多历史 ⇒ 窗口天然盖住，且不再翻页", () => {
    const { run, calls } = pagerByPage({ 1: pageRows(1, 10, 7) });
    const win = fetchBuildsCoveringWindow({
      run,
      slug: "moon-read/comfy-app-t3",
      windowHours: DEFAULT_WINDOW_HOURS,
      now: NOW,
    });
    expect(win.covered, win.note).toBe(true);
    expect(win.pages).toBe(1);
    expect(calls.filter((c) => c.includes("get-build-logs"))).toHaveLength(1);
    expect(win.note).toContain("已到列表末尾");
  });

  it("每页都只盖 10 小时 ⇒ 撞页数上界，covered=false（不是「窗口内没有」）", () => {
    const pages: Record<number, Array<PageRow> | null> = {};
    for (let p = 1; p <= FETCH_MAX_PAGES + 2; p += 1) {
      pages[p] = pageRows(1, 10);
    }
    const { run } = pagerByPage(pages);
    const win = fetchBuildsCoveringWindow({
      run,
      slug: "moon-read/comfy-app-t3",
      windowHours: DEFAULT_WINDOW_HOURS,
      now: NOW,
    });
    expect(win.covered).toBe(false);
    expect(win.pages).toBe(FETCH_MAX_PAGES);
    expect(win.list).not.toBeNull();
    expect(win.note).toContain("没取满");
  });

  it("翻到一半取不到 ⇒ 残页不许当完整历史：covered=false 而列表仍在", () => {
    const { run } = pagerByPage({ 1: pageRows(1, 10), 2: null });
    const win = fetchBuildsCoveringWindow({
      run,
      slug: "moon-read/comfy-app-t3",
      windowHours: DEFAULT_WINDOW_HOURS,
      now: NOW,
    });
    expect(win.covered).toBe(false);
    expect(win.list).not.toBeNull();
    expect(win.note).toContain("第 2 页取不到");
  });

  it("第一页就取不到 ⇒ 列表整体是 null（由调用方念「未校验」）", () => {
    const { run } = pagerByPage({ 1: null });
    const win = fetchBuildsCoveringWindow({
      run,
      slug: "moon-read/comfy-app-t3",
      windowHours: DEFAULT_WINDOW_HOURS,
      now: NOW,
    });
    expect(win.list).toBeNull();
    expect(win.covered).toBe(false);
    expect(win.pages).toBe(0);
  });

  it("列表里没有可读的 createTime ⇒ 没有覆盖依据，covered=false", () => {
    const { run } = pagerByPage({
      1: [{ sn: "x", event: "pull_request", status: "success" }],
    });
    const win = fetchBuildsCoveringWindow({
      run,
      slug: "moon-read/comfy-app-t3",
      windowHours: DEFAULT_WINDOW_HOURS,
      now: NOW,
    });
    // 不满一页 ⇒ 走的是「到列表末尾」那一支：历史确实取尽了，所以这里 covered 是成立的，
    // 而下面那条「满页但没有时刻」才是没依据可判的那一格。
    expect(win.covered).toBe(true);
    const { run: run2 } = pagerByPage({
      1: Array.from({ length: FETCH_PAGE_SIZE }, () => ({
        sn: "x",
        event: "pull_request",
        status: "success",
      })),
    });
    const full = fetchBuildsCoveringWindow({
      run: run2,
      slug: "moon-read/comfy-app-t3",
      windowHours: DEFAULT_WINDOW_HOURS,
      now: NOW,
    });
    expect(full.covered).toBe(false);
    expect(full.oldestMs).toBeNull();
  });

  it("在线那一跳：条数够而时间不够 ⇒ 退「未校验」而不是退「缺勤」（假缺勤的负控制）", () => {
    const pages: Record<number, Array<PageRow> | null> = {};
    for (let p = 1; p <= FETCH_MAX_PAGES; p += 1) {
      pages[p] = pageRows(1, 10);
    }
    const { run, calls } = pagerByPage(pages);
    const heard: Array<string> = [];
    const log = (s: string) => heard.push(s);
    const originalLog = console.log;
    console.log = log;
    let code;
    try {
      code = main([], { run, now: NOW, slug: "moon-read/comfy-app-t3" });
    } finally {
      console.log = originalLog;
    }
    const out = heard.join("\n");
    expect(code, out).toBe(CODE.NO_VERDICT);
    expect(code, "盖不住窗口时不许念成缺勤").not.toBe(CODE.ABSENT);
    expect(out).toContain("取数没盖住窗口");
    expect(calls.filter((c) => c.includes("get-build-logs"))).toHaveLength(FETCH_MAX_PAGES);
  });

  it("在线那一跳：翻页把上一跑捞回来 ⇒ 照常判出勤（修复没有把正路弄瞎）", () => {
    const daily = listed(
      "sn-daily",
      "crontab: 0 0 * * *",
      new Date(NOW - 12 * 3_600_000).toISOString(),
    );
    const first = [daily, ...pageRows(1, 10, FETCH_PAGE_SIZE - 1)];
    const { run } = pagerByPage({ 1: first, 2: pageRows(10, 40) });
    const statusRun = (cmd: string, args: Array<string>) => {
      if (args.includes("get-build-status")) {
        const one = detail("sn-daily", daily.event, daily.createTime, [...GREEN_STAGES]);
        return {
          status: 0,
          stdout: JSON.stringify({ status: 200, data: one.json.data }),
          stderr: "",
          error: null,
        };
      }
      return run(cmd, args);
    };
    const heard: Array<string> = [];
    const originalLog = console.log;
    console.log = (s: string) => heard.push(s);
    let code;
    try {
      code = main([], {
        run: statusRun,
        now: NOW,
        slug: "moon-read/comfy-app-t3",
      });
    } finally {
      console.log = originalLog;
    }
    const out = heard.join("\n");
    expect(code, out).toBe(CODE.PRESENT);
    expect(out).toContain("取数覆盖自证");
    expect(isDailyDispatch(daily)).toBe(true);
  });
});
