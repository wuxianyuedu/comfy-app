/**
 * 「跨包翻转」的**纯判据**（ISSUE #1326，用户原话「保留跨包翻转」）。
 *
 * 这一层守的是三条「漂开就静默出错」的契约：
 *   1. **id 不撞**：两个包里同名的份必须能分开（`<包名>/<文件名>`）；
 *   2. **顺序**：本次运行恒在最前、其后各包新→旧 —— 用户是拿这个下拉
 *      定位一次运行的（runId 是 `grep` 的入口、退出形态是「该不该看」的第一判据），
 *      混成一条扁平的时刻序会让「本次运行的第 1 次启动」夹在两个历史包之间；
 *   3. **文案三段**：日期+时刻（同一次启动的份要靠它区分）、退出形态（崩溃那次的
 *      形态完全不同，先标出来才知道在看什么）、runId（跨包 `grep` 的唯一入口）。
 */
import { describe, expect, it } from "vitest";

import {
  buildRunScopedOptions,
  formatScopedLabel,
  packNameToMs,
  packScopedId,
  parsePackScopedId,
  sortPackNames,
  type PackLogFile,
  type RunPack,
} from "./log-run-packs";

/** 造一份包内日志（只带判据用到的字段）。 */
function file(name: string, startedAt: number | null): PackLogFile {
  return { name, startedAt, title: `时刻:${startedAt ?? "none"}` };
}

/** 造一个包（`files` 按旧→新，与 IO 那层的输出同序）。 */
function pack(name: string, files: PackLogFile[], crashed = false): RunPack {
  return { name, startedAt: packNameToMs(name), crashed, files };
}

describe("包目录名解析", () => {
  it("形态与 run.mjs 的 runDirName 同源（<日期>_<时分秒>-<runId>）", () => {
    expect(packNameToMs("2026-09-30_193612-a1b2c3")).toBe(
      new Date(2026, 8, 30, 19, 36, 12).getTime(),
    );
  });

  it("形态不符回 null（`.zip` 包、别的目录一律不认）", () => {
    for (const bad of [
      "2026-09-30_193612-a1b2c3.zip",
      "2026-09-30-a1b2c3",
      "archive",
      "",
    ]) {
      expect(packNameToMs(bad)).toBeNull();
    }
  });
});

describe("会话 id 的两种形态", () => {
  it("归档份的 id 是 <包名>/<文件名>", () => {
    expect(packScopedId("2026-09-30_193612-a1b2c3", "x.log")).toBe(
      "2026-09-30_193612-a1b2c3/x.log",
    );
  });

  it("解析出的包名与文件名可反拼回原 id", () => {
    const parsed = parsePackScopedId("2026-09-30_193612-a1b2c3/x.log");
    expect(parsed).toEqual({
      packName: "2026-09-30_193612-a1b2c3",
      fileName: "x.log",
    });
  });

  it("裸文件名不是归档 id（本次运行的份就是文件名本身）", () => {
    for (const bare of [
      "comfyui-runtime-20261005-093612.log",
      "comfyui-runtime.log",
      "",
      "/x.log",
    ]) {
      expect(parsePackScopedId(bare)).toBeNull();
    }
  });

  it("包名不是真实包形态时不算归档 id（脏 id 不许拼出路径）", () => {
    for (const bad of [
      "not-a-pack/x.log",
      "../etc/passwd",
      "a/b/c.log",
      "2026-09-30_193612-a1b2c3/",
    ]) {
      expect(parsePackScopedId(bad)).toBeNull();
    }
  });
});

describe("列表顺序：本次运行在最前，其后各包新→旧", () => {
  const b = pack("2026-10-04_140000-bbbbbb", [file("b.log", 1000)]);
  const a = pack("2026-10-03_100000-aaaaaa", [file("a.log", 2000)]);

  it("本次运行的份排在最前（倒序，最新那次启动在最上面）", () => {
    const { sessions } = buildRunScopedOptions(
      [file("c1.log", 10), file("c2.log", 20)],
      [b, a],
      30,
      4,
    );
    expect(sessions.map((s) => s.id)).toEqual([
      "c2.log",
      "c1.log",
      "2026-10-04_140000-bbbbbb/b.log",
      "2026-10-03_100000-aaaaaa/a.log",
    ]);
  });

  it("本次运行恒在最前，即使历史包的时刻更晚", () => {
    const future = pack("2026-10-09_235959-ffffff", [file("f.log", 9000)]);
    const { sessions } = buildRunScopedOptions(
      [file("c.log", 1)],
      [future],
      30,
      2,
    );
    expect(sessions[0]!.id).toBe("c.log");
    expect(sessions[0]!.scope).toBe("current");
  });

  it("没有本次运行的份时列表全是历史包（退化成纯历史视图）", () => {
    const { sessions } = buildRunScopedOptions([], [b, a], 30, 2);
    expect(sessions.map((s) => s.id)).toEqual([
      "2026-10-04_140000-bbbbbb/b.log",
      "2026-10-03_100000-aaaaaa/a.log",
    ]);
  });

  it("一个都没有 → 空列表（界面据此显示空态）", () => {
    const { sessions, total } = buildRunScopedOptions([], [], 30, 0);
    expect(sessions).toEqual([]);
    expect(total).toBe(0);
  });

  it("按 name 字典序排包 = 时间序（与 runs/ 目录名的设计同源）", () => {
    expect(
      sortPackNames([
        "2026-10-04_140000-bbbbbb",
        "2026-09-30_193612-a1b2c3",
        "2026-10-03_100000-aaaaaa",
      ]),
    ).toEqual([
      "2026-09-30_193612-a1b2c3",
      "2026-10-03_100000-aaaaaa",
      "2026-10-04_140000-bbbbbb",
    ]);
  });
});

describe("列表上限与 total", () => {
  it("超过上限时取**最新**的那些条", () => {
    const current = [1, 2, 3].map((i) => file(`c${i}.log`, i));
    const { sessions } = buildRunScopedOptions(current, [], 2, 3);
    expect(sessions.map((s) => s.id)).toEqual(["c3.log", "c2.log"]);
  });

  it("total 不受上限影响（界面据此说明「更早的启动不在列表里」）", () => {
    const current = [1, 2, 3].map((i) => file(`c${i}.log`, i));
    const { total } = buildRunScopedOptions(current, [], 2, 30);
    expect(total).toBe(30);
  });
});

describe("下拉文案：时刻 · 退出形态 · runId", () => {
  it("三段都拼上", () => {
    expect(formatScopedLabel("10-04 14:00:00", "正常退出", "bbbbbb")).toBe(
      "10-04 14:00:00 · 正常退出 · bbbbbb",
    );
  });

  it("空段跳过（旧固定名读不出时刻，不该留一个空档）", () => {
    expect(formatScopedLabel("", "本次运行", null)).toBe("本次运行");
  });

  it("全空时给「—」而不是空串（空标题在下拉里是一行看不见的可点区域）", () => {
    expect(formatScopedLabel("", "", null)).toBe("—");
  });

  it("本次运行的项标「本次运行」，归档份标退出形态", () => {
    const crashed = pack(
      "2026-10-04_140000-bbbbbb",
      [file("b.log", 1000)],
      true,
    );
    const { sessions } = buildRunScopedOptions(
      [file("c.log", 10)],
      [crashed],
      30,
      2,
    );
    expect(sessions[0]!.title).toContain("本次运行");
    expect(sessions[0]!.crashed).toBe(false);
    expect(sessions[1]!.title).toContain("异常退出");
    expect(sessions[1]!.crashed).toBe(true);
    expect(sessions[1]!.title).toContain("bbbbbb");
  });
});
