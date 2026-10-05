/**
 * 「启动日志」跨运行切分的契约（ISSUE #1326）。
 *
 * 这一层的两个判据各自对应一类会**静默出错**的现场：
 *   1. 正文切片剪错 → 用户点开「上一次」看到的是别次运行的输出，而界面上
 *      看不出任何异常（只是内容不对）；
 *   2. 基准缺失（包被保留策略删了）时**猜**一个基准 → 把真实内容切掉，
 *      用户以为自己那次什么都没输出。
 * 所以两条都按「多显示可以、切错不行」立判据。
 */
import { describe, expect, it } from "vitest";

import {
  buildRunOptions,
  formatRunLabel,
  isRunPackId,
  packNameOf,
  packNameToMs,
  runPackId,
  runSlice,
  type RunPack,
  type RuntimeLogRunOption,
} from "./log-run-sessions";

/** 造一个运行包（`hasSource` 与切片无关，但下游要按它过滤空包）。 */
function pack(over: Partial<RunPack> & { name: string }): RunPack {
  return { startedAt: null, crashed: false, hasSource: true, ...over };
}

describe("runSlice：包内正文 = 当前包 − 前一包", () => {
  it("有基准时从基准长度起（剪掉前几次运行累积的内容）", () => {
    expect(runSlice(1000, 400)).toEqual({ from: 400, baselineMissing: false });
  });

  it("基准不可得（最早那包 / 前面被保留策略删了）→ 整份给出，且**不标记**异常", () => {
    /* 不标记是刻意的：「本来就没有基准」是正常情形，不是故障。把它标成
     * baselineMissing 会让每一次都能看到的提示变成噪声。 */
    expect(runSlice(1000, null)).toEqual({ from: 0, baselineMissing: false });
    expect(runSlice(1000, undefined)).toEqual({
      from: 0,
      baselineMissing: false,
    });
  });

  it("基准比当前还长（前缀关系不成立）→ 整份给出并**标记**出来", () => {
    /* 这是「哪里不对」的信号：与「本来就没有基准」必须分开 —— 前者要提示，
     * 后者不该提示。混成一个状态 = 其中一种情形必然被说错。 */
    expect(runSlice(100, 400)).toEqual({ from: 0, baselineMissing: true });
    expect(runSlice(100, 100)).toEqual({ from: 0, baselineMissing: true });
  });

  it("空基准 / 非法数字按「没有基准」处理（不产生 NaN 偏移）", () => {
    expect(runSlice(1000, 0)).toEqual({ from: 0, baselineMissing: false });
    expect(runSlice(1000, Number.NaN)).toEqual({
      from: 0,
      baselineMissing: false,
    });
  });

  it("切出来的长度正好等于本次新增（这是「剪对了」的判据本身）", () => {
    const slice = runSlice(1000, 400);
    expect(1000 - slice.from).toBe(600);
  });
});

describe("packNameToMs：时刻从**名字**读，不靠 mtime", () => {
  it("解析归档目录名里的本地时刻", () => {
    const ms = packNameToMs("2026-09-30_193612-a1b2c3");
    expect(ms).toBe(new Date(2026, 8, 30, 19, 36, 12).getTime());
  });

  it("形态不符返回 null（不从垃圾字符串里猜一个时刻出来）", () => {
    for (const bad of [
      "",
      "2026-09-30",
      "2026-09-30_193612",
      "2026-09-30_1936-a1b2c3",
      "2026-09-30_193612-A1B2C3", // runId 大写：归档写的是小写十六进制
      "latest.txt",
    ]) {
      expect(packNameToMs(bad), bad).toBeNull();
    }
  });
});

describe("会话 id 形态", () => {
  it("运行包 id 带 run: 前缀，能还原回目录名", () => {
    const id = runPackId("2026-09-30_193612-a1b2c3");
    expect(isRunPackId(id)).toBe(true);
    expect(packNameOf(id)).toBe("2026-09-30_193612-a1b2c3");
  });

  it("行号 id（横幅那套）不会被误认成运行包", () => {
    expect(isRunPackId("42")).toBe(false);
    expect(isRunPackId("legacy")).toBe(false);
    expect(packNameOf("42")).toBeNull();
  });
});

describe("buildRunOptions：本次在最上面、历史按时间倒序", () => {
  const current: RuntimeLogRunOption = {
    id: "run:current",
    title: "",
    startedAt: new Date(2026, 9, 5, 9, 0, 0).getTime(),
    scope: "current",
    crashed: false,
  };

  it("顺序最新在前（与 log-sessions 的旧→新刻意相反）", () => {
    const options = buildRunOptions(current, [
      pack({ name: "2026-09-28_100000-aaaaaa" }),
      pack({ name: "2026-09-30_100000-bbbbbb" }),
      pack({ name: "2026-09-29_100000-cccccc" }),
    ]);
    expect(options.map((o) => o.id)).toEqual([
      "run:current",
      "run:2026-09-30_100000-bbbbbb",
      "run:2026-09-29_100000-cccccc",
      "run:2026-09-28_100000-aaaaaa",
    ]);
  });

  it("展示时刻取 run.json 的 startedAt，读不到时退回名字里的时刻", () => {
    const options = buildRunOptions(null, [
      pack({
        name: "2026-09-30_100000-aaaaaa",
        startedAt: new Date(2026, 8, 30, 10, 0, 7).getTime(),
      }),
      pack({ name: "2026-09-29_100000-bbbbbb" }),
    ]);
    /* 最新那包在最上面 —— 它的时刻取 run.json 的（秒级精度更高） */
    expect(options[0]!.id).toBe("run:2026-09-30_100000-aaaaaa");
    expect(options[0]!.startedAt).toBe(
      new Date(2026, 8, 30, 10, 0, 7).getTime(),
    );
    /* 次新那包没有 run.json 的时刻 → 用名字里那 1 秒粒度的 */
    expect(options[1]!.startedAt).toBe(
      new Date(2026, 8, 29, 10, 0, 0).getTime(),
    );
  });

  it("没有本次运行（runs/ 有包但 current 空）时只列历史，不插空项", () => {
    const options = buildRunOptions(null, [
      pack({ name: "2026-09-30_100000-aaaaaa" }),
    ]);
    expect(options).toHaveLength(1);
    expect(options[0]!.scope).toBe("runs");
  });
});

describe("formatRunLabel：缺一个字段都会让用户挑错", () => {
  const mk = (over: Partial<RuntimeLogRunOption>): RuntimeLogRunOption => ({
    id: "run:2026-09-30_193612-a1b2c3",
    title: "",
    startedAt: new Date(2026, 8, 30, 19, 36, 12).getTime(),
    scope: "runs",
    crashed: false,
    ...over,
  });

  it("历史包：日期 + 时刻 + 退出形态 + runId", () => {
    expect(formatRunLabel(mk({}))).toBe("09-30 19:36:12 · 正常退出 · a1b2c3");
  });

  it("崩溃那次标「异常退出」（那种日志的形态与正常退出完全不同）", () => {
    expect(formatRunLabel(mk({ crashed: true }))).toBe(
      "09-30 19:36:12 · 异常退出 · a1b2c3",
    );
  });

  it("本次运行标「本次运行」，不冒充退出形态（它还没退出）", () => {
    expect(formatRunLabel(mk({ scope: "current" }))).toBe(
      "09-30 19:36:12 · 本次运行 · a1b2c3",
    );
  });

  it("读不到时刻时不给假时刻（只留退出形态与 runId）", () => {
    expect(formatRunLabel(mk({ startedAt: null }))).toBe("正常退出 · a1b2c3");
  });
});
