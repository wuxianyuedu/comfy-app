/**
 * 「读数取不到时，屏幕上必须读得到那句原因」（ISSUE #2675）。
 *
 * 这一格存在的理由是本仓反复记过的那一型：**判据在场、执行者不在场**。
 * `Reading.note` 由 `emptyReading()` 写、由成功那一路写空串，函数头还挂着
 * 「附一句原因（不静默、不冒充绿）」—— 而打印那一圈只念六个字段，那句原因
 * 从没被念出来过。于是「不静默」是一句**没有读者的自我声明**：拿读数的人看到的
 * 只有 `status=(取不到)`，分不出「响应不是 JSON」「响应里没有 data」「cnb 起不来」
 * 这三件下一动作完全不同的事。
 *
 * 所以本文件不判「源码里有没有 `note` 这个词」（那一族整档字面量断言的作用域是整份
 * 文件，等价改写会判红、字面量落在注释里会假绿 —— 见 ISSUE #2660），而是**调用真实
 * 的打印出口**：`report()` 的第三个参数就是取数那一格的出口，喂进一份「取不到」的
 * 读数，判它打到屏幕上的那一行。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { formatReadingRow, report } from "../scripts/ci-probe-lock-readout.mjs";

/** 成功那一路的形状（`readBuild` 命中时给的就是这一形：note 是空串）。 */
const OK = {
  sn: "cnb-abc-1",
  status: "success",
  createTime: "2026-10-29T08:00:00.000Z",
  startTime: "2026-10-29T08:00:05.000Z",
  endTime: "2026-10-29T08:12:00.000Z",
  title: "质量门禁",
  note: "",
};

/** 取不到那一路：三个原因的下一动作各不相同，所以要能当场分出来。 */
const UNAVAILABLE = [
  {
    label: "响应不是 JSON",
    reading: {
      ...OK,
      sn: "cnb-aaa-1",
      status: "(取不到)",
      note: "响应不是 JSON（前 120 字：<html>502 Bad Gateway</html>）",
    },
  },
  {
    label: "响应里没有 data",
    reading: {
      ...OK,
      sn: "cnb-bbb-2",
      status: "(取不到)",
      note: "响应里没有 data",
    },
  },
];

describe("读数取不到时的那句原因要念在结论同一行", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("正向：`report()` 打出的那一行末尾带得上那句原因", () => {
    const spy = vi
      .spyOn(console, "log")
      .mockImplementation(() => undefined);
    for (const { reading } of UNAVAILABLE) {
      report("moon-read/comfy-app-t3", [reading.sn], () => reading);
    }
    const lines = spy.mock.calls.map((c) => String(c[0]));
    const hit = lines.filter((l) => l.startsWith("[probe] ") && l.includes("status=(取不到)"));
    expect(hit).toHaveLength(UNAVAILABLE.length);
    for (const { reading } of UNAVAILABLE) {
      const line = hit.find((l) => l.includes(reading.sn));
      expect(
        line,
        `取不到读数的那一行要把原因念出来，实际打的是：${JSON.stringify(line)}`,
      ).toContain(`（${reading.note}）`);
    }
  });

  it("反向锚点：成功那一路（note 是空串）行尾不出现空括号", () => {
    // 豁免不放过散文、拼接不许造出一对空括号 —— 后者会让「有原因」与「没原因」
    // 在屏幕上长得一样，而那正是本件要修的那个读感。
    const spy = vi
      .spyOn(console, "log")
      .mockImplementation(() => undefined);
    report("moon-read/comfy-app-t3", [OK.sn], () => OK);
    const line = spy.mock.calls
      .map((c) => String(c[0]))
      .find((l) => l.includes(OK.sn));
    expect(line).toBeDefined();
    expect(line).not.toContain("（）");
    expect(line).toContain("title=质量门禁");
  });

  it("三个原因给出三行互不相同的读数（可定位，不是同一句「取不到」）", () => {
    const rows = [
      ...UNAVAILABLE.map((u) => u.reading),
      { ...OK, sn: "cnb-abc-3", status: "(取不到)", note: "cnb 起不来：ENOENT" },
    ];
    const lines = rows.map((r) => formatReadingRow(r));
    expect(new Set(lines).size).toBe(rows.length);
    for (const [i, r] of rows.entries()) {
      expect(lines[i]).toContain(r.note);
    }
  });

  it("逐对相交与「还没到终态」那两行照旧打：本次只动第一行的拼接", () => {
    // 反向钉住改动面：注入两行仍在跑的读数，除了原因那半句，其余输出形状不许变。
    const spy = vi
      .spyOn(console, "log")
      .mockImplementation(() => undefined);
    const running = { ...OK, status: "running", endTime: "" };
    report("moon-read/comfy-app-t3", ["a1", "a2"], (sn) => ({
      ...running,
      sn,
    }));
    const lines = spy.mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.includes("×") && l.includes("⇒"))).toBe(true);
    expect(lines.some((l) => l.includes("还没到终态"))).toBe(true);
  });
});
