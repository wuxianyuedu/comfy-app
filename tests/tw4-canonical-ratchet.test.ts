/**
 * canonical / spacing 两份棘轮基线的形状与语义守卫（ISSUE #1451 要求 2 / 规范 §13.5.12）。
 *
 * 为什么这对判据需要**单独**守：两份工具都起 Tailwind 引擎、单次约 6s，因此
 * **不进 pre-commit**（判的是「CSS 等价改写」而非正确性）—— 执行者是 03 章那句
 * 「按需跑一次」与台账里的按需召唤登记。而「按需跑」最大的失效形态是
 * **有人为了让 `--check` 变绿去放宽基线**：把 `total` 抬高或往里塞几条 `files`
 * 条目，下一次回潮就被静默放行。这一族不在任何钩子步骤的 import 面上
 * （它是 JSON 数据文件，import 图一概追不到），所以与本次暂存改动无关也必须响。
 *
 * 断言形状为什么是「读 JSON + 读源码」，而不是「真跑一次 --check」：
 * 真跑要 6s×2，而这条用例每次提交都执行（固定清单）；判据要守的是
 * 「基线没被放宽」与「判定档还在」，两者都是**静态事实**，读文本足够、且不会
 * 因为机器慢而在 CI / 本地超时。真跑红/绿的现场已由本文件的兄弟用例
 * `tests/gate-executors.test.ts` 那族覆盖（用临时工作区造情形，不付引擎成本）。
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(".");
const CANON_BASELINE = join(REPO_ROOT, "scripts", ".tw4-canonical-baseline.json");
const SPACING_BASELINE = join(REPO_ROOT, "scripts", ".tw4-spacing-baseline.json");
const CANON_SCRIPT = join(REPO_ROOT, "scripts", "tw4-canonical-report.mjs");
const SPACING_SCRIPT = join(REPO_ROOT, "scripts", "tw4-spacing-canonical.mjs");

/**
 * 读棘轮基线：`total` 与按文件的账要一致（账记歪了棘轮就会算错）。
 * @param {string} file
 * @returns {{total: number, files: Record<string, number>}}
 */
function readBaseline(file: string) {
  const raw: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (typeof raw !== "object" || raw === null)
    return { total: -1, files: {} };
  const rec = raw as { total?: unknown; files?: unknown };
  return {
    total: typeof rec.total === "number" ? rec.total : -1,
    files:
      typeof rec.files === "object" && rec.files !== null
        ? (rec.files as Record<string, number>)
        : {},
  };
}

describe.each([
  ["canonical", CANON_BASELINE, CANON_SCRIPT, "--check"],
  ["spacing", SPACING_BASELINE, SPACING_SCRIPT, "--check"],
])("%s 棘轮基线（ISSUE #1451 要求 2）", (_name, baseline, script, flag) => {
  it("基线文件在场且形状正确（total 与按文件的账一致）", () => {
    expect(existsSync(baseline), `${baseline} 不在了`).toBe(true);
    const { total, files } = readBaseline(baseline);
    const sum = Object.values(files).reduce((a, b) => a + b, 0);
    expect(total, "total 与 files 的数对不上（棘轮的账记歪了）").toBe(sum);
    expect(total, "基线不是 0 就把存量塞回了 master").toBe(0);
  });

  it("判定档还在（--check 分支真的会 exit 1，被改成只提醒就红）", () => {
    const src = readFileSync(script, "utf8");
    // 这条守的是「判定档没被摘回手动档」：脚本必须有 --check 的解析与它自己的
    // 非零退出，而不是只打一行「超过基线」就完事（历史形态：10.6 的某些脚本
    // 写着「超过基线」却退 0，表现是判据在场、没人被拦）。
    expect(src).toContain("--check");
    expect(src).toMatch(/process\.exit\(1\)/);
  });

  it("收紧档与报告档的语义分得开（--update 重写基线、--report 不判失败）", () => {
    const src = readFileSync(script, "utf8");
    expect(src).toContain(flag);
    expect(src, "--update 是治理后收紧基线的动作").toContain("--update");
  });

  it("执行者与「为什么不进钩子」登记在台账里（不进钩子 ≠ 没人管）", () => {
    const ledger: unknown = JSON.parse(
      readFileSync(join(REPO_ROOT, "scripts", ".gate-executor-ledger.json"), "utf8"),
    );
    const onDemand =
      (ledger as { onDemand?: Record<string, unknown> }).onDemand ?? {};
    const hits = Object.keys(onDemand).filter((k) =>
      script.endsWith(k) || k === script.split("/").pop(),
    );
    expect(
      hits.length,
      `台账里没有 ${script.split("/").pop()} —— 不进钩子的判据必须登记` +
        "「为什么不能进钩子」与「谁按需跑」，否则它就是零执行者（规范 §13.5.12）",
    ).toBe(1);
  });
});
