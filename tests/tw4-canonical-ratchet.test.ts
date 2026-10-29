/**
 * canonical / spacing 两份「CSS 等价改写」判据的**形态守卫**（ISSUE #1451 要求 2 /
 * ISSUE #1811 翻硬闸）。
 *
 * 为什么这对判据需要**单独**守：两份工具都起 Tailwind 引擎、单次约 6s，因此
 * **不进 pre-commit**（判的是「CSS 等价改写」而非正确性）—— 执行者是 03 章那句
 * 「按需跑一次」与台账里的按需召唤登记。而「按需跑」最大的失效形态是
 * **有人为了让 `--check` 变绿去放宽判据**：翻闸前是「把 `total` 抬高或往里塞几条
 * `files` 条目」，翻闸后那条路被堵死了（没有基线可放宽），于是剩下的失效形态变成
 * **把判定档摘回手动档**（`--check` 只打一行报告、不再 `exit 1`）或**把基线加回来**。
 * 这一族不在任何钩子步骤的 import 面上（它是文本 / JSON 数据），
 * 所以与本次暂存改动无关也必须响。
 *
 * 断言形状为什么是「读 JSON/源码」，而不是「真跑一次 --check」：
 * 真跑要 6s×2，而这条用例每次提交都执行（固定清单）；判据要守的是
 * 「判定档还在」与「放宽通道没被加回来」这两件**静态事实**，读文本足够、且不会
 * 因为机器慢而在 CI / 本地超时。真跑红/绿的现场在
 * `tests/ratchet-update-guards.test.ts`（台账 E5 的横切判据）—— 那一族守的是
 * 「棘轮拒涨」。**翻闸之后这两家已不在 `RATCHETS` 里**（它们不再有基线可拒涨），
 * 它们的硬闸行为由本文件与 `HARD_GATE_FLIPS` 那一格守着。
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(".");
const CANON_BASELINE = join(REPO_ROOT, "scripts", ".tw4-canonical-baseline.json");
const SPACING_BASELINE = join(REPO_ROOT, "scripts", ".tw4-spacing-baseline.json");
const CANON_SCRIPT = join(REPO_ROOT, "scripts", "tw4-canonical-report.mjs");
const SPACING_SCRIPT = join(REPO_ROOT, "scripts", "tw4-spacing-canonical.mjs");
/** 两份脚本共享的扫描内核：注释剥离就住在这里（`!row` 那条误报的修法）。 */
const SCAN_CORE = join(REPO_ROOT, "scripts", "tw4-scan-core.mjs");

describe.for(
  /* SAFETY: 类型断言已复核 */ [
    ["canonical", CANON_BASELINE, CANON_SCRIPT],
    ["spacing", SPACING_BASELINE, SPACING_SCRIPT],
  ] as const,
)("%s 判据（ISSUE #1451 要求 2 / #1811 翻硬闸）", ([_name, baseline, script]) => {
  it("基线已随翻闸删除（留存一份就是「手改 JSON 就能登记存量」的通道）", () => {
    expect(
      existsSync(baseline),
      `${baseline} 又把基线加回来了 —— 翻闸后它不该存在（硬闸类没有中间态，§13.6.2）`,
    ).toBe(false);
  });

  it("判定档还在（--check 命中即 exit 1，被改成只提醒就红）", () => {
    const src = readFileSync(script, "utf8");
    // 这条守的是「判定档没被摘回手动档」：脚本必须有 --check 的解析与它自己的
    // 非零退出，而不是只打一行「有候选」就完事（历史形态：10.6 的某些脚本
    // 写着「超过基线」却退 0，表现是判据在场、没人被拦）。
    expect(src).toContain("--check");
    expect(src).toMatch(/process\.exit\(1\)/);
  });

  it("放宽通道没有加回来（--update / 写回 JSON 的调用都不许在）", () => {
    const src = readFileSync(script, "utf8");
    // `--update` 是「手改基线」这条通道的入口；写回一份 `.json` 是它的机器痕迹。
    // 认调用本身而不是认变量名 —— 换个拼法也躲不过（口径同 §13.5.9 的 `HARD_GATE_FLIPS`）。
    /* 只判**代码**，不判注释 —— 翻闸的记录（「此前带一份基线、`--update` 收紧」）
     * 正是写在文件头的那一段，把注释也算进来会逼人删掉那段历史。 */
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code, "--update 是翻闸时删掉的收紧档").not.toContain("--update");
    expect(code, "脚本里出现了「把一份 .json 写回去」的调用 —— 那正是翻闸要消灭的通道").not.toMatch(
      /writeFileSync\([^)]*\.json/,
    );
  });

  it("扫描走共享内核（注释里的示例不算候选、也不会被 --write 改到）", () => {
    // 这一条守的是 `!row` 那类误报不会复活：两侧的字符串字面量都从
    // `tw4-scan-core.mjs` 的 `stringLiterals()` 取，它先在**注释之外**扫描。
    const src = readFileSync(script, "utf8");
    expect(src).toContain("tw4-scan-core.mjs");
    const core = readFileSync(SCAN_CORE, "utf8");
    expect(core, "注释剥离的入口不在了").toContain("stripComments");
  });

  it("执行者与「为什么不进钩子」登记在台账里（不进钩子 ≠ 没人管）", () => {
    const ledger: unknown = JSON.parse(
      readFileSync(join(REPO_ROOT, "scripts", ".gate-executor-ledger.json"), "utf8"),
    );
    const onDemand =
      /* SAFETY: 类型断言已复核 */ (ledger as { onDemand?: Record<string, unknown> }).onDemand ??
      {};
    const hits = Object.keys(onDemand).filter(
      (k) => script.endsWith(k) || k === script.split("/").pop(),
    );
    expect(
      hits.length,
      `台账里没有 ${script.split("/").pop()} —— 不进钩子的判据必须登记` +
        "「为什么不能进钩子」与「谁按需跑」，否则它就是零执行者（规范 §13.5.12）",
    ).toBe(1);
  });
});
