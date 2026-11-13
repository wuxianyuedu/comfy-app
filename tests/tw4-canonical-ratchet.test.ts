/**
 * canonical / spacing 两份「CSS 等价改写」判据的形态守卫（ISSUE #1451 要求 2 / #1811 翻硬闸）。工具各起 Tailwind 引擎约 6s，
 * 故不进 pre-commit；最大失效形态是有人为让 `--check` 变绿放宽判据：翻闸前抬 `total`/塞 `files`，翻闸后无基线可放宽而摘回
 * 手动档或加回基线。本族是文本/JSON、不在钩子 import 面，暂存无关也必须响；读文本只守「判定档还在」等静态事实，真跑见 `tests/ratchet-update-guards.test.ts`。
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { isRecord } from "~/lib/is-record";

import { stripComments } from "./helpers/strip-comments";

const REPO_ROOT = resolve(".");
const CANON_BASELINE = join(REPO_ROOT, "scripts", ".tw4-canonical-baseline.json");
const SPACING_BASELINE = join(REPO_ROOT, "scripts", ".tw4-spacing-baseline.json");
const CANON_SCRIPT = join(REPO_ROOT, "scripts", "tw4-canonical-report.mjs");
const SPACING_SCRIPT = join(REPO_ROOT, "scripts", "tw4-spacing-canonical.mjs");
/** 两份脚本共享的扫描内核：注释剥离就住在这里（`!row` 那条误报的修法）。 */
const SCAN_CORE = join(REPO_ROOT, "scripts", "tw4-scan-core.mjs");

/* SAFETY: 类型断言已复核 */
describe.for([
  ["canonical", CANON_BASELINE, CANON_SCRIPT],
  ["spacing", SPACING_BASELINE, SPACING_SCRIPT],
] as const)("%s 判据（ISSUE #1451 要求 2 / #1811 翻硬闸）", ([_name, baseline, script]) => {
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
    const code = stripComments(src);
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
    /* 台账按 unknown 读（B5 清账）：onDemand 缺席当空映射。 */
    const onDemand: Record<string, unknown> =
      isRecord(ledger) && isRecord(ledger.onDemand) ? ledger.onDemand : {};
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
