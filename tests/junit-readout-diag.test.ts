/**
 * junit 落点三态话术（ISSUE #2697）：把「没落盘」与「落了但我按这个路径读不到」与
 * 「落了也读到了但解析 0 份」分开说。否则读数缺失会被读成一句含糊的「没有」
 * （§13.6.4.1「拿不到测量 ≠ 测量结果是 0」的反面）。
 */
import { describe, expect, it } from "vitest";

import { junitMissingLine } from "../scripts/junit-readout-diag.mjs";

describe("junit 落点三态话术（#2697）", () => {
  it("落点目录是链接 ⇒ 点名 realpath，报「没落盘」", () => {
    const [line] = junitMissingLine("分文件耗时", "/x/y.xml", {
      dirIsLink: true,
      realDir: "Z:/real",
      exists: false,
    });
    expect(line).toContain("没落盘");
    expect(line).toContain("链接");
    expect(line).toContain("Z:/real");
  });

  it("报告在盘但解析 0 份 ⇒ 报「落盘了但解析出 0 份」而非「没落盘」", () => {
    const [line] = junitMissingLine("分文件耗时", "/x/y.xml", {
      exists: true,
      size: 128,
      mtime: "2026-01-01T00:00:00.000Z",
    });
    expect(line).toContain("落盘了但解析出 0 份");
    expect(line).not.toContain("**没有**");
  });

  it("报告实际落在别处 ⇒ 报「落了但我按原路径读不到」并回退", () => {
    const [line] = junitMissingLine("装载税", "/x/y.xml", {
      foundElsewhere: true,
      actualPath: "/x/z.xml",
    });
    expect(line).toContain("落了但我按原路径读不到");
    expect(line).toContain("/x/z.xml");
  });

  it("没有任何诊断信息 ⇒ 退化为含糊的「没有」（与既有判据同形）", () => {
    const [line] = junitMissingLine("分文件耗时", "/x/y.xml");
    expect(line).toContain("**没有**");
    expect(line).not.toContain("链接");
    expect(line).not.toContain("落盘了但解析出 0 份");
  });
});
