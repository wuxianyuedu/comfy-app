/**
 * `scripts/ci-mirror-egress-issue.mjs` 的契约（ISSUE #3278 方案 B）：
 * 每日档自动把「窗口里出现过 GitHub 镜像 egress」变成一张单，且**不改**出勤判据的三态退码、
 * **不降级**镜像格与判决链。用例全部注入 `collect` / `existing` / `run`，一条平台命令都不发。
 *
 * 两种危险失效各有一组：① 把「没取满窗口 / 开着的单取不到」写成「今天没有环境红」（§13.6.3）；
 * ② 把 `--no-block` 写成静默 return（那句红话不许消失）。
 */
import { describe, expect, it } from "vitest";

import { judgeMirrorAttendance } from "../scripts/check-mirror-attendance.mjs";
import {
  ENVIRONMENT_RED_MARK,
  EGRESS_ISSUE_TITLE,
  EGRESS_ISSUE_TITLE_KEY,
  ISSUE_CODE,
  composeEgressBody,
  decideEgressAction,
  main,
} from "../scripts/ci-mirror-egress-issue.mjs";

const NOW = Date.parse("2026-11-07T01:00:00.000Z");
const IN_WINDOW = new Date(NOW - 2 * 3_600_000).toISOString();

/** 用**真判据**造 `out`，不在这里手写一份假判决（§12.12）。 */
function judge(shapes: string[]) {
  return judgeMirrorAttendance({
    builds: shapes.map((_, i) => ({
      createTime: IN_WINDOW,
      eventUrl: "https://cnb.cool/o/r/-/pull/1",
      sn: `cnb-${String(i)}`,
    })),
    now: NOW,
    readings: shapes.map((shape, i) => ({
      evidence: "",
      found: true,
      shape,
      sn: `cnb-${String(i)}`,
    })),
    windowHours: 24,
  });
}

/** `collectMirrorAttendance()` 交回来的形状；`payload` 本档不用，留空即可。 */
function readingOf(out: ReturnType<typeof judge>) {
  return {
    asked: ["cnb-0", "cnb-1"],
    coverage: "取满窗口（24h）：1 页 / 8 条 · 已到列表末尾",
    ok: true as const,
    out,
    payload: {},
    windowBuilds: 8,
  };
}

/** `collect` 那一跳的两种返回形状（判别联合，不给 `any` 留缝）。 */
type Collected = ReturnType<typeof readingOf>;
type CollectFn = () => Collected | { ok: false; why: string };

/** 假执行者：这一档的用例一条平台命令都不发，`run` 只是占位。 */
const fakeRun = () => ({ error: null, stderr: "", stdout: "", status: 0 });

/** `main()` 的注入面：`existing` 给空数组 ⇒ 走「新建」那一支，`--dry-run` ⇒ 一个字都不写。 */
function runMain(opts: {
  argv?: string[];
  collect?: CollectFn;
  existing?: Array<{ number: number; title: string }> | null;
  out?: ReturnType<typeof judge>;
}) {
  const lines: string[] = [];
  const out = opts.out ?? judge(["present", "egress"]);
  const collect: CollectFn = opts.collect ?? (() => readingOf(judge(["present", "egress"])));
  const code = main({
    argv: opts.argv ?? ["--dry-run"],
    collect,
    existing: opts.existing === undefined ? [] : opts.existing,
    log: (s: string) => lines.push(s),
    now: NOW,
    run: fakeRun,
    slug: "o/r",
  });
  return { code, lines, out };
}

describe("decideEgressAction：四道门，不许把「没结论」写成「没有环境红」", () => {
  it("现场 6 present + 2 egress ⇒ 仍 `code=0`，但按信号立案", () => {
    const out = judge([
      "present",
      "present",
      "present",
      "present",
      "present",
      "present",
      "egress",
      "egress",
    ]);
    expect(out.code).toBe(0);
    const d = decideEgressAction({ existing: [], out });
    expect(d.action).toBe("write");
    expect(d.number).toBeUndefined();
  });

  it("同一族已有 open 单 ⇒ 追加、不新建（#2251 一条诉求一张单）", () => {
    const out = judge(["present", "egress"]);
    const d = decideEgressAction({
      existing: [{ number: 3278, title: `${EGRESS_ISSUE_TITLE_KEY}（环境红）` }],
      out,
    });
    expect(d.action).toBe("write");
    expect(d.number).toBe(3278);
  });

  it("零 egress 的稳定窗口 ⇒ 不写", () => {
    const d = decideEgressAction({ existing: [], out: judge(["present", "present"]) });
    expect(d.action).toBe("none");
    expect(d.reason).toContain("signal=stable");
  });

  it("缺勤但不是出网（令牌那族）⇒ 不立 egress 单，交缺勤判决自己交账", () => {
    const d = decideEgressAction({ existing: [], out: judge(["token-scope", "repo-missing"]) });
    expect(d.action).toBe("none");
    expect(d.reason).toContain("other-absent");
  });

  it("判据没给结论 ⇒ no-fact，不写、不判绿", () => {
    const out = judgeMirrorAttendance({
      builds: [],
      now: NOW,
      readings: [{ evidence: "", found: false, shape: "no-cell", sn: "cnb-a" }],
      windowHours: 24,
    });
    expect(out.code).toBe(2);
    expect(decideEgressAction({ existing: [], out }).action).toBe("no-fact");
  });

  it("开着的单取不到 ⇒ no-fact：不知道该新建还是追加，一次都不写", () => {
    const out = judge(["present", "egress"]);
    /* 三态退码仍是 0，但「写不写」这一跳没有事实源 —— 不能被读成「可以新建」。 */
    expect(out.code).toBe(0);
    const d = decideEgressAction({ existing: null, out });
    expect(d.action).toBe("no-fact");
    expect(d.reason).toContain("不重复建单");
  });
});

describe("composeEgressBody：只报读数，机器标记单独成行", () => {
  const out = judge(["present", "egress"]);
  const body = composeEgressBody({
    batch: "2026-11-07T01:00:00.000Z",
    handle: "ci-daily:CodeBuddy",
    out,
    reading: readingOf(out),
    slug: "o/r",
    windowHours: 24,
  });

  it("带机器标记、signal 与「环境红 ≠ 内容红」那句，并明写退码未改", () => {
    expect(body).toContain(ENVIRONMENT_RED_MARK);
    expect(body).toContain("signal=intermittent-egress");
    expect(body).toContain("环境红 ≠ 内容红");
    expect(body).toContain("code=0 / verdict=present");
    expect(body).toContain("退码一字未改");
  });

  it("不代写根因，并给出仓库改不了的下一动作与可粘贴出口", () => {
    expect(body).toContain("根因：**未判定**");
    expect(body).toContain("白名单 / 代理 / 换 runner");
    expect(body).toContain("pnpm check:mirror-attendance --json");
    expect(body).toContain("仓库改不了");
  });

  it("明写镜像格与判决链仍承重，不许被读成「本单降级了谁」", () => {
    expect(body).toContain("维持承重");
    expect(body).toContain("断流时 PR 仍会红");
    expect(body).toContain("#3046");
  });
});

describe("main：--no-block 只改退码，不改那句话有没有被打出来", () => {
  it("取数没盖住窗口 ⇒ 本地退 2、一行都不写，日志里给得出因由", () => {
    const { code, lines } = runMain({
      argv: [],
      collect: () => ({ ok: false, why: "取数没盖住 24h 窗口 —— 只回到 2 页" }),
    });
    expect(code).toBe(ISSUE_CODE.NO_FACT);
    expect(lines.join("\n")).toContain("取数没盖住 24h 窗口");
    expect(lines.join("\n")).toContain("不写单");
  });

  it("带 --no-block ⇒ 退 0，但那句「本该以退码 2 结束」原样打出来", () => {
    const { code, lines } = runMain({
      argv: ["--no-block"],
      collect: () => ({ ok: false, why: "取不到构建列表" }),
    });
    expect(code).toBe(ISSUE_CODE.DONE);
    const all = lines.join("\n");
    expect(all).toContain("本该以退码 2 结束");
    expect(all).toContain("取不到构建列表");
    expect(all).toContain("别把它改成静默 return");
  });

  it("稳定窗口 ⇒ 退 0、日志给 signal=stable，一条都不写", () => {
    const out = judge(["present", "present"]);
    const { code, lines } = runMain({
      argv: ["--dry-run"],
      collect: () => readingOf(out),
    });
    expect(code).toBe(ISSUE_CODE.DONE);
    expect(lines.join("\n")).toContain("signal=stable");
    expect(lines.join("\n")).toContain("无事可立");
  });

  it("间歇性断流 + --dry-run ⇒ 只打印将写什么，机器标记与标题都在", () => {
    const out = judge(["present", "egress"]);
    const { code, lines } = runMain({
      argv: ["--dry-run"],
      collect: () => readingOf(out),
    });
    expect(code).toBe(ISSUE_CODE.DONE);
    const all = lines.join("\n");
    expect(all).toContain("signal=intermittent-egress");
    expect(all).toContain(EGRESS_ISSUE_TITLE);
    expect(all).toContain("一条都没写");
  });

  it("已有旧单 ⇒ 打印「追加」，不打印「新建」", () => {
    const out = judge(["present", "egress"]);
    const { lines } = runMain({
      argv: ["--dry-run"],
      existing: [{ number: 3278, title: `${EGRESS_ISSUE_TITLE_KEY}（环境红）` }],
      collect: () => readingOf(out),
    });
    const all = lines.join("\n");
    expect(all).toContain("在 #3278 下追加");
    expect(all).not.toContain(`新建「${EGRESS_ISSUE_TITLE}」`);
  });

  it("开着的单取不到 + --no-block ⇒ 折 0，但 red 话术照打", () => {
    const out = judge(["present", "egress"]);
    const { code, lines } = runMain({
      argv: ["--no-block"],
      existing: null,
      collect: () => readingOf(out),
    });
    expect(code).toBe(ISSUE_CODE.DONE);
    expect(lines.join("\n")).toContain("取不到「开着的单」列表");
  });
});
