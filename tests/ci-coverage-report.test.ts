/**
 * 平台侧覆盖率上报判据（ISSUE #1990）。守的是一个发生过两次的静默形态：「洞察 → 单元测试覆盖率」读平台读数，
 * 写它的是上报这一步 —— #623 删旧版流水线时被拿走、#1959 重建时没带回来，于是整页永远「无 / 无」且无一步会红。
 * 判两件事：①缺 / 空报告只跳过（单元测试临时停用，判红会连带拦死流水线）；②报 `coverage/lcov.info` 同 `vitest.config.ts` 的 lcov，且不带阈值（平台绝对百分比与按目录门槛 + 棘轮冲突）。
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { decideReport, REPORT_REL, reportArgs } from "../scripts/ci-coverage-report.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

describe("平台侧覆盖率上报（ISSUE #1990）", () => {
  it("报告不在盘上时**跳过**，空报告同样跳过", () => {
    expect(decideReport({ exists: false, size: 0 }).report).toBe(false);
    expect(decideReport({ exists: true, size: 0 }).report).toBe(false);
  });

  it("跳过时给出可读的理由（不然日志里只有沉默）", () => {
    expect(decideReport({ exists: false, size: 0 }).reason).toContain("没有报告");
    expect(decideReport({ exists: true, size: 0 }).reason).toContain("空");
  });

  it("有报告就报 —— 且报的是 lcov.info（与 vitest 的 reporter 同一份口径）", () => {
    expect(decideReport({ exists: true, size: 1024 }).report).toBe(true);
    expect(REPORT_REL).toBe("coverage/lcov.info");
    expect(reportArgs()).toContain(REPORT_REL);
  });

  it("不带任何阈值：门槛在本仓的 `thresholds` 里，这一档只上报", () => {
    const args = reportArgs().join(" ");
    for (const forbidden of ["--lines", "--diff-lines", "--threshold"]) {
      expect(args).not.toContain(forbidden);
    }
  });

  it("报告路径与 `vitest.config.ts` 的 reporter 对得上（两处只写一侧就会静默）", () => {
    /* `lcov` reporter 产出 `coverage/lcov.info`。判据只钉「配置里有 lcov」这件事 ——
     * 具体输出路径是 vitest 的约定，本仓没有第三处声明它。 */
    const src = readFileSync(path.join(ROOT, "vitest.config.ts"), "utf8");
    expect(src).toContain('"lcov"');
  });

  it("点名的入口真的在盘上（`.cnb.yml` 不可能因为写错路径而红）", () => {
    expect(existsSync(path.join(ROOT, "scripts/ci-coverage-report.mjs"))).toBe(true);
  });
});
