/**
 * `planSeparatedLaunches` / `resolveAffectedSegment` 与 `runChunk` 透传 `filterLine` 的判据。
 *
 * 这条分离是为了把「固定清单（含最吵的 a11y 故事测试）」与「受影响用例」分到不同的 vitest
 * 启动里，让噪音被收进固定清单那一段、且两块各有独立抬头（见 `run-affected-tests.mjs` 文件头）。
 * 判据守住两条：① 分离后**不丢不重**（并集逐字等于输入）；② 两遍 spawn 都把 `filterLine`
 * 透传下去（本地不设 `COMFY_AFFECTED_NOISE_FILTER` 时第三参数为空，与改动前逐字一致）。
 * 段开关（ISSUE #2845）把两段升级成两个 CI stage：`resolveAffectedSegment` 那一组钉它的
 * 取值面 —— 不设=both（逐字旧行为）、认不出=invalid（不许静默吞成 both）。
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { FIXED_STRUCTURAL_TESTS } from "../scripts/fixed-structural-tests.mjs";
import { planSeparatedLaunches, resolveAffectedSegment } from "../scripts/affected-launch-segments.mjs";
import { runChunk } from "../scripts/run-affected-tests.mjs";
import { isNoiseLine } from "../scripts/affected-launch-noise-reporter.mjs";

describe("planSeparatedLaunches 的固定段分块帽（ISSUE #2863）", () => {
  it("超出帽的固定段切成多块，且不丢不重、每块不超帽", () => {
    const files = FIXED_STRUCTURAL_TESTS.slice(0, 30); // 30 份真固定清单成员 > 帽 24
    const plan = planSeparatedLaunches(files);
    const fixedChunks = plan.filter((c) => c.kind === "fixed");
    expect(fixedChunks.length).toBeGreaterThan(1);
    for (const c of fixedChunks) expect(c.files.length).toBeLessThanOrEqual(24);
    expect(fixedChunks.flatMap((c) => c.files).sort()).toEqual([...files].sort());
  });

  it("帽内（≤24 份）仍是一块 —— 既有形态不因新帽改变", () => {
    const plan = planSeparatedLaunches(FIXED_STRUCTURAL_TESTS.slice(0, 10));
    expect(plan.filter((c) => c.kind === "fixed")).toHaveLength(1);
  });

  it("fixedChunkFiles: 0 显式关帽 ⇒ 回到纯预算分块的旧行为", () => {
    const files = FIXED_STRUCTURAL_TESTS.slice(0, 30);
    const plan = planSeparatedLaunches(files, { fixedChunkFiles: 0 });
    expect(plan.filter((c) => c.kind === "fixed")).toHaveLength(1);
  });

  it("受影响段不戴帽：合成面再大也按预算一体分块", () => {
    const synth = Array.from({ length: 30 }, (_, i) => `src/lib/__sep__/x${i}.test.ts`);
    const plan = planSeparatedLaunches(synth);
    expect(plan).toHaveLength(1);
    expect(plan[0]?.kind).toBe("affected");
  });
});

describe("resolveAffectedSegment —— 段开关（ISSUE #2845，两段拆两个 CI stage）", () => {
  it("不设 / 空 ⇒ both（本地与既有跑法逐字一致），且不打读数", () => {
    expect(resolveAffectedSegment(undefined)).toEqual({ mode: "both", note: null });
    expect(resolveAffectedSegment("")).toEqual({ mode: "both", note: null });
  });

  it("fixed / affected ⇒ 对应段，且读数把段名说出口", () => {
    const fx = resolveAffectedSegment("fixed");
    expect(fx.mode).toBe("fixed");
    expect(fx.note).toContain("固定结构用例");
    const af = resolveAffectedSegment("affected");
    expect(af.mode).toBe("affected");
    expect(af.note).toContain("受影响用例");
  });

  it("认不出的值 ⇒ invalid（不许静默吞成 both）", () => {
    for (const bad of ["Fixed", "both ", "fixed,x", "1"]) {
      expect(resolveAffectedSegment(bad).mode, `值「${bad}」必须被判成没看懂`).toBe("invalid");
    }
  });
});

describe("planSeparatedLaunches", () => {
  it("固定清单与受影响用例分开，且不丢不重", () => {
    const fixed0 = FIXED_STRUCTURAL_TESTS[0]!;
    const affected = "src/lib/__sep_test__/zzz.test.ts";
    const files = [affected, fixed0]; // 故意打乱顺序
    const plan = planSeparatedLaunches(files);
    const all = plan.flatMap((c) => c.files);
    expect(all.sort()).toEqual([affected, fixed0].sort());
    expect(plan.find((c) => c.kind === "fixed")!.files).toContain(fixed0);
    expect(plan.find((c) => c.kind === "affected")!.files).toContain(affected);
  });

  it("固定清单先跑、受影响用例后跑", () => {
    const plan = planSeparatedLaunches([FIXED_STRUCTURAL_TESTS[0]!, "src/lib/__x__/a.test.ts"]);
    expect(plan[0]!.kind).toBe("fixed");
    expect(plan.at(-1)!.kind).toBe("affected");
  });

  it("全是被固定清单覆盖的文件时，只有 fixed 段", () => {
    const plan = planSeparatedLaunches([FIXED_STRUCTURAL_TESTS[0]!, FIXED_STRUCTURAL_TESTS[1]!]);
    expect(plan.length).toBeGreaterThan(0);
    expect(plan.every((c) => c.kind === "fixed")).toBe(true);
  });

  it("全是受影响文件时，只有 affected 段", () => {
    const plan = planSeparatedLaunches(["src/lib/__x__/a.test.ts", "src/lib/__x__/b.test.ts"]);
    expect(plan.every((c) => c.kind === "affected")).toBe(true);
  });
});

describe("runChunk 透传 filterLine 到两遍 spawn", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  /** 与 `spawnVitest(entry, args, options)` 的形状对齐（scripts/affected-launch-spawn.mjs）。 */
  type SpawnOpts = { timeoutMs?: number; filterLine?: (line: string) => boolean };
  type SpawnFn = (
    entry: string,
    args: string[],
    opts?: SpawnOpts,
  ) => { status: number | null; output: string; signal?: string | null };
  const baseDeps = (spawn: SpawnFn) => ({
    entry: "vitest.mjs",
    workers: 2,
    chunkId: 0,
    junitDir: dir,
    spawn,
    settle: async () => ({ settled: true, load: 0, waitedMs: 0 }),
    stageBudget: { deadline: 0, budgetMs: 0 },
    waitBudget: { deadline: 0 },
  });

  it("首遍 status 0：把 filterLine 透传给 spawn 的第三参数，且不复跑", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "sep-"));
    const calls: { args: string[]; opts?: SpawnOpts }[] = [];
    const code = await runChunk([FIXED_STRUCTURAL_TESTS[0]!], {
      ...baseDeps((_entry: string, args: string[], opts?: SpawnOpts) => {
        calls.push({ args, opts });
        return { status: 0, output: "" };
      }),
      filterLine: isNoiseLine,
    });
    expect(code).toBe(0);
    expect(calls.length).toBe(1);
    expect(calls[0]!.opts?.filterLine).toBe(isNoiseLine);
  });

  it("filterLine 不给时第三参数里没有 filterLine（与改动前逐字一致）", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "sep-"));
    const calls: { args: string[]; opts?: SpawnOpts }[] = [];
    const code = await runChunk([FIXED_STRUCTURAL_TESTS[0]!], {
      ...baseDeps((_entry: string, args: string[], opts?: SpawnOpts) => {
        calls.push({ args, opts });
        return { status: 0, output: "" };
      }),
    });
    expect(code).toBe(0);
    expect(calls[0]!.opts?.filterLine).toBeUndefined();
  });
});
