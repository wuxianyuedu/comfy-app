/**
 * coverage-readout 读数（ISSUE #2689）：登记处单源、聚合口径、三态。
 * 不跑全量覆盖率：纯函数层（`readRegisteredThresholds` / `aggregateForGlob` /
 * `buildCoverageReadout`）用合成 reports 与真实登记的 vitest.config.ts 核。
 */
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  aggregateForGlob,
  buildCoverageReadout,
  readRegisteredThresholds,
} from "../scripts/coverage-readout.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

describe("coverage-readout", () => {
  it("登记处直接 import vitest.config.ts（单源、零正则），共 150 条对象", async () => {
    const t = await readRegisteredThresholds();
    expect(Object.keys(t).length).toBe(150);
    for (const v of Object.values(t)) {
      expect(typeof v.lines).toBe("number");
      expect(typeof v.branches).toBe("number");
    }
  });

  it("aggregateForGlob 把匹配文件的 covered/total 聚合后算 pct", () => {
    const files = {
      "src/lib/a.ts": {
        lines: { total: 10, covered: 8 },
        statements: { total: 10, covered: 8 },
        functions: { total: 2, covered: 1 },
        branches: { total: 4, covered: 2 },
      },
      "src/lib/b.ts": {
        lines: { total: 10, covered: 5 },
        statements: { total: 10, covered: 5 },
        functions: { total: 2, covered: 2 },
        branches: { total: 4, covered: 1 },
      },
    };
    const agg = aggregateForGlob("src/lib/**", files);
    expect(agg.matched).toBe(2);
    // lines covered/total = 13/20 = 65
    expect(agg.pct!.lines).toBeCloseTo(65, 1);
    expect(agg.pct!.branches).toBeCloseTo(37.5, 1);
  });

  it("脱转义后 glob 能匹配带括号的路径", () => {
    const files = {
      "src/app/(main)/x.ts": {
        lines: { total: 1, covered: 1 },
        statements: { total: 1, covered: 1 },
        functions: { total: 1, covered: 1 },
        branches: { total: 0, covered: 0 },
      },
    };
    const agg = aggregateForGlob(String.raw`src/app/\(main\)/**`, files);
    expect(agg.matched).toBe(1);
  });

  it("没报告时走 no-report 三态，且只读数不判红（registeredCount 仍是全量）", async () => {
    const r = await buildCoverageReadout({
      root: ROOT,
      summaryPath: path.join(ROOT, "coverage", "definitely-not-there-2697.json"),
    });
    expect(r.state).toBe("no-report");
    expect(r.registeredCount).toBe(150);
    expect(r.rows).toEqual([]);
  });
});
