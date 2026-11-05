/**
 * `planSeparatedLaunches` / `resolveAffectedSegment` 与 `runChunk` 透传 `filterLine` 的判据：固定清单（含最吵的 a11y 故事测试）与受影响用例分开启动，
 * 噪音收进固定清单那段（见 `run-affected-tests.mjs` 头注）。守住两条：① 分离后**不丢不重**（并集逐字等于输入）；② 两遍 spawn 都透传 `filterLine`。
 * 段开关（ISSUE #2845）钉 `resolveAffectedSegment` 的取值面：不设=both（逐字旧行为）、认不出=invalid（不许静默吞成 both）。
 */
import fs, { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { FIXED_STRUCTURAL_TESTS } from "../scripts/fixed-structural-tests.mjs";
import {
  planSeparatedLaunches,
  resolveAffectedSegment,
} from "../scripts/affected-launch-segments.mjs";
import { runChunk } from "../scripts/run-affected-tests.mjs";
import {
  BATCH_SORT_TIER,
  mergeTimingLedger,
  orderByKnownDuration,
  readTimingLedger,
  sortTier,
} from "../scripts/affected-launch-duration-order.mjs";
import { isNoiseLine } from "../scripts/affected-launch-noise-reporter.mjs";

describe("planSeparatedLaunches 的固定段分块帽（ISSUE #2863）", () => {
  it("超出帽的固定段切成多块，且不丢不重、每块不超帽", () => {
    const files = FIXED_STRUCTURAL_TESTS.slice(0, 30); // 30 份真固定清单成员 > 帽 24
    const plan = planSeparatedLaunches(files);
    const fixedChunks = plan.filter((c) => c.kind === "fixed");
    expect(fixedChunks.length).toBeGreaterThan(1);
    for (const c of fixedChunks) {
      expect(c.files.length).toBeLessThanOrEqual(24);
    }
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

/** 台账一条读数的形状（与 `readTimingLedger()` 的产出同一个）—— `new Map([...])` 会把
 * 对象字面量的 `source` 拓宽成 `string`，所以这里给出**具名**的构造口，别在每个用例里
 * 各写一遍类型断言。 */
type TimingEntry = { ms: number; source: "isolated" | "batch" };

/** 造一份台账（纯内存，不碰盘）。 */
function ledgerOf(entries: Record<string, TimingEntry>): Map<string, TimingEntry> {
  return new Map(Object.entries(entries));
}

describe("耗时台账排序（ISSUE #2863 的 ③：重块排前）", () => {
  it("known 按毫秒降序排前，unknown 保持原相对顺序垫后", () => {
    const ledger = ledgerOf({
      "tests/a.test.ts": { ms: 100, source: "isolated" },
      "tests/b.test.ts": { ms: 500, source: "isolated" },
      "tests/c.test.ts": { ms: 250, source: "isolated" },
    });
    expect(
      orderByKnownDuration(
        [
          "tests/x.test.ts",
          "tests/a.test.ts",
          "tests/y.test.ts",
          "tests/b.test.ts",
          "tests/c.test.ts",
        ],
        ledger,
      ),
    ).toEqual([
      "tests/b.test.ts",
      "tests/c.test.ts",
      "tests/a.test.ts",
      "tests/x.test.ts",
      "tests/y.test.ts",
    ]);
  });

  it("空台账（冷启动）⇒ 原序返回，不 throw", () => {
    const files = ["tests/b.test.ts", "tests/a.test.ts"];
    expect(orderByKnownDuration(files, new Map())).toEqual(files);
  });

  it("台账读写闭环：不在账的键新增、同名覆盖、本跑没跑的保留、坏文件从空建起", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "timing-"));
    try {
      expect(mergeTimingLedger(dir, []).written).toBe(false); // 空读数不落盘
      fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
      fs.writeFileSync(
        path.join(dir, "scripts", ".test-file-timing.json"),
        JSON.stringify({
          generatedAt: "old",
          /* 老形状（裸数字）⇒ 回读成 `batch`；两种形状混在一份台账里要能各读各的。 */
          files: { "tests/old.test.ts": 999, "tests/a.test.ts": 5 },
        }),
      );
      expect(
        mergeTimingLedger(dir, [
          { name: "tests/a.test.ts", ms: 7.4, source: "batch" },
          { name: "tests/new.test.ts", ms: 0.2, source: "batch" },
          { name: "tests/broken.test.ts", ms: Number.NaN },
        ]).written,
      ).toBe(true);
      /* SAFETY: 类型断言已复核 */
      const j = JSON.parse(
        fs.readFileSync(path.join(dir, "scripts", ".test-file-timing.json"), "utf8"),
      ) as { files: Record<string, { ms: number; source: string }> };
      expect(j.files["tests/a.test.ts"]).toEqual({ ms: 7, source: "batch" }); // 覆盖 + 取整
      expect(j.files["tests/new.test.ts"]).toEqual({ ms: 0, source: "batch" });
      expect(j.files["tests/old.test.ts"]).toEqual({ ms: 999, source: "batch" }); // 保留（老形状按 batch 读）
      expect(j.files["tests/broken.test.ts"]).toBeUndefined(); // 脏读数不进账
      /* 回读面与排序面同一个源；而这两份此刻都是 `batch`（老形状）⇒ 并列、保持原序
       * —— 「不知道谁更重」不许被排成一个序（ISSUE #3030）。 */
      expect(
        orderByKnownDuration(["tests/a.test.ts", "tests/old.test.ts"], readTimingLedger(dir)),
      ).toEqual(["tests/a.test.ts", "tests/old.test.ts"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/* 量纲那一格（ISSUE #3030）：钉的不是数值，是「两个量纲不同的数不许直接比较」—— 失效形态是静默的，
 * 排序照旧在跑，只是把便宜的文件供到了前面。现场读数（同一批文件、同一台机）：`tests/check-commit-claims.test.ts`
 * 批跑 169.1s / 隔离 1.8s，`tests/gate-executors.test.ts` 48.1s / 2.7s —— 前者整段排第三，实测却最便宜，判据反了。 */
describe("耗时台账的量纲：批跑墙钟当不了单份成本（ISSUE #3030）", () => {
  it("`isolated` 给实测档位，`batch` 落在**比任何实测都低**的那一档", () => {
    expect(sortTier({ ms: 1800, source: "isolated" })).toBe(1800);
    expect(sortTier({ ms: 169_100, source: "batch" })).toBe(BATCH_SORT_TIER);
    /* 关键：它不是「一个更大的数」。第一版取上界常数，结果「批跑的 169.1s」照样压过
     * 「单跑的 8.3s」—— 判据反了的形态只是换了方向回来（本单自己的用例把它推翻的）。 */
    expect(BATCH_SORT_TIER).toBeLessThan(0);
    expect(
      sortTier({ ms: 169_100, source: "batch" }),
      "batch 不许压过任何 isolated（含最便宜的一份）",
    ).toBeLessThan(sortTier({ ms: 1, source: "isolated" }));
  });

  it("一笔便宜的 batch 读数不许把贵的 isolated 记录顶到后面（这就是判据反了的那个形态）", () => {
    /* 现场形状：同一块里 check-commit-claims 记 169.1s「批跑」、a11y-axe-stories 记 8.3s「单跑」。
     * 按字面比较会把前者排在前面 —— 而它是 1.8s 的那一份。 */
    const ledger = ledgerOf({
      "tests/check-commit-claims.test.ts": { ms: 169_100, source: "batch" },
      "tests/a11y-axe-stories.test.ts": { ms: 8300, source: "isolated" },
    });
    /* `isolated` 那一份先（8.3s 是真实成本），`batch` 那一份退到上界那一档。
     * 注意这里比的是**量纲**，不是数字：169.1s > 8.3s 反而排后，正是因为前者不知道
     * 「这一份自己要多久」。 */
    expect(
      orderByKnownDuration(
        ["tests/a11y-axe-stories.test.ts", "tests/check-commit-claims.test.ts"],
        ledger,
      ),
    ).toEqual(["tests/a11y-axe-stories.test.ts", "tests/check-commit-claims.test.ts"]);
    /* 反过来给也一样 —— 判决跟着量纲走，不跟着入参顺序走。 */
    expect(
      orderByKnownDuration(
        ["tests/check-commit-claims.test.ts", "tests/a11y-axe-stories.test.ts"],
        ledger,
      ),
    ).toEqual(["tests/a11y-axe-stories.test.ts", "tests/check-commit-claims.test.ts"]);
  });

  it("全是 batch 时不假装知道谁更重：保持原序（不知道不许被排成一个序）", () => {
    const ledger = ledgerOf({
      "tests/a.test.ts": { ms: 500, source: "batch" },
      "tests/b.test.ts": { ms: 100, source: "batch" },
    });
    expect(orderByKnownDuration(["tests/a.test.ts", "tests/b.test.ts"], ledger)).toEqual([
      "tests/a.test.ts",
      "tests/b.test.ts",
    ]);
    /* 但「已知的排在未知的前面」仍成立：那一位信息是真的。 */
    expect(orderByKnownDuration(["tests/z.test.ts", "tests/a.test.ts"], ledger)).toEqual([
      "tests/a.test.ts",
      "tests/z.test.ts",
    ]);
  });

  it("老形状（裸数字）按 `batch` 读 —— 它是 junit 抄来的，量纲就是批跑墙钟", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "timing-legacy-"));
    try {
      fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
      fs.writeFileSync(
        path.join(dir, "scripts", ".test-file-timing.json"),
        JSON.stringify({ generatedAt: "old", files: { "tests/a.test.ts": 169_100 } }),
      );
      expect(readTimingLedger(dir).get("tests/a.test.ts")).toEqual({
        ms: 169_100,
        source: "batch",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("一笔 batch 读数不许覆盖已有的 isolated 记录（且那一次要被点名）", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "timing-mix-"));
    try {
      fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
      fs.writeFileSync(
        path.join(dir, "scripts", ".test-file-timing.json"),
        JSON.stringify({
          generatedAt: "old",
          files: { "tests/a.test.ts": { ms: 1800, source: "isolated" } },
        }),
      );
      const got = mergeTimingLedger(dir, [
        { name: "tests/a.test.ts", ms: 169_100, source: "batch" },
        { name: "tests/b.test.ts", ms: 900, source: "batch" },
      ]);
      expect(got.written).toBe(true);
      expect(got.rejected).toEqual(["tests/a.test.ts"]);
      const after = readTimingLedger(dir);
      expect(after.get("tests/a.test.ts")).toEqual({ ms: 1800, source: "isolated" });
      expect(after.get("tests/b.test.ts")).toEqual({ ms: 900, source: "batch" });
      /* 反方向可以：isolated 是更强的量纲，它盖掉 batch 是对的。 */
      expect(
        mergeTimingLedger(dir, [{ name: "tests/b.test.ts", ms: 700, source: "isolated" }]).rejected,
      ).toEqual([]);
      expect(readTimingLedger(dir).get("tests/b.test.ts")).toEqual({ ms: 700, source: "isolated" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
    if (dir !== undefined && dir !== "") {
      rmSync(dir, { recursive: true, force: true });
    }
    dir = undefined;
  });

  /** 与 `spawnVitest(entry, args, options)` 的形状对齐（scripts/affected-launch-spawn.mjs）。 */
  type SpawnOpts = { filterLine?: (line: string) => boolean; timeoutMs?: number };
  type SpawnFn = (
    entry: string,
    args: Array<string>,
    opts?: SpawnOpts,
  ) => { output: string; signal?: string | null; status: number | null };
  const baseDeps = (spawn: SpawnFn) => ({
    entry: "vitest.mjs",
    workers: 2,
    chunkId: 0,
    junitDir: dir,
    spawn,
    settle: () => Promise.resolve({ settled: true, load: 0, waitedMs: 0 }),
    stageBudget: { deadline: 0, budgetMs: 0 },
    waitBudget: { deadline: 0 },
  });

  it("首遍 status 0：把 filterLine 透传给 spawn 的第三参数，且不复跑", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "sep-"));
    const calls: Array<{ args: Array<string>; opts?: SpawnOpts }> = [];
    const code = await runChunk([FIXED_STRUCTURAL_TESTS[0]!], {
      ...baseDeps((_entry: string, args: Array<string>, opts?: SpawnOpts) => {
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
    const calls: Array<{ args: Array<string>; opts?: SpawnOpts }> = [];
    const code = await runChunk([FIXED_STRUCTURAL_TESTS[0]!], {
      ...baseDeps((_entry: string, args: Array<string>, opts?: SpawnOpts) => {
        calls.push({ args, opts });
        return { status: 0, output: "" };
      }),
    });
    expect(code).toBe(0);
    expect(calls[0]!.opts?.filterLine).toBeUndefined();
  });
});
