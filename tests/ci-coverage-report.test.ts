/**
 * 平台侧覆盖率上报那一步的判据（ISSUE #1990）。
 *
 * 守的是**一个已经发生过两次的静默形态**：「洞察 → 单元测试覆盖率」页面读的是平台侧
 * 读数，而写那份读数的是上报这一步 —— 它在 #623 删旧版流水线时被一起拿走、#1959 重建
 * 时没被带回来。于是一整页永远是「无 / 无」，而**没有任何一步会红**（少一条 stage 与
 * 「还没人跑过」在配置里长得一模一样）。
 *
 * 这里判两件事，都在 `scripts/ci-coverage-report.mjs` 的纯函数面上：
 *   ① 「有没有报告」由它自己答（缺报告 / 空报告 ⇒ 只跳过）。这不是宽容 ——
 *      `单元测试` 此刻是临时停用的，报告本来就不存在，把它判红等于让停用这件事
 *      连带把整条流水线拦死；
 *   ② 报出去的是 `coverage/lcov.info`（与 `vitest.config.ts` 的 `lcov` reporter 同一份
 *      口径），且**不带任何阈值** —— 平台阈值是绝对百分比，与本仓「按目录记门槛 +
 *      棘轮」的口径冲突。
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  decideReport,
  REPORT_REL,
  reportArgs,
} from "../scripts/ci-coverage-report.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

describe("平台侧覆盖率上报（ISSUE #1990）", () => {
  it("报告不在盘上时**跳过**，空报告同样跳过", () => {
    expect(decideReport({ exists: false, size: 0 }).report).toBe(false);
    expect(decideReport({ exists: true, size: 0 }).report).toBe(false);
  });

  it("跳过时给出可读的理由（不然日志里只有沉默）", () => {
    expect(decideReport({ exists: false, size: 0 }).reason).toContain(
      "没有报告",
    );
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
    expect(existsSync(path.join(ROOT, "scripts/ci-coverage-report.mjs"))).toBe(
      true,
    );
  });
});
