/**
 * `scripts/ci-step-verdict.mjs` 的判据（ISSUE #3102）：治「Actions 上只有 `✗ 分支守卫` + exit code 1、为什么红要翻日志」——① 首条原因压进 `::error::` / `::warning::`，② 退出码 + 命中行 + 末尾写进 `$GITHUB_STEP_SUMMARY`。
 * 最易写错的是 exit 2（本仓「没判」）能否折成非红：**只有子进程自己打了那段不判结论**才折；无条件折会把「判据没跑起来」（`ci-heavy-gates.mjs` 的 missing 也走 2）读成绿。
 * 两向都钉：带标记 ⇒ exit 0 + `::warning::`；不带标记 ⇒ 原样红 + `::error::`。
 */
import { execFileSync } from "node:child_process";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import {
  escapeAnnotation,
  mapExit,
  parseCli,
  pickReasonLines,
  renderJobSummary,
  renderSummary,
} from "../scripts/ci-step-verdict.mjs";

const SCRIPT = join(process.cwd(), "scripts", "ci-step-verdict.mjs");

/** 外来值先落 `unknown`，过这道守卫才谈读字段（不用类型断言）。 */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 跑外壳，返回退出码与 stdout（不碰真实判据，只喂合成子进程）。 */
function runShell(args: string[]): { code: number; output: string } {
  try {
    const output = execFileSync(process.execPath, [SCRIPT, ...args], {
      encoding: "utf8",
      cwd: process.cwd(),
    });
    return { code: 0, output };
  } catch (error) {
    /* `execFileSync` 失败时抛的是「带 `status` / `stdout` / `stderr` 的错」：
     * 逐字段收窄，缺的那几项按既有默认回落（退出码 1、输出空串）。 */
    const e: Record<string, unknown> = isRecord(error) ? error : {};
    const status = e.status;
    const stdout = e.stdout;
    const stderr = e.stderr;
    const code = typeof status === "number" ? status : 1;
    const out = typeof stdout === "string" ? stdout : "";
    const err = typeof stderr === "string" ? stderr : "";
    return { code, output: out + err };
  }
}

describe("ci-step-verdict.mjs（一步红了，为什么）", () => {
  test("参数解析：-- 之后一个字都不动（子命令参数里有 --label 也不能被吃掉）", () => {
    const parsed = parseCli([
      "--label",
      "分支守卫",
      "--inconclusive-marker",
      "[branch-guard] 结论：不判",
      "--",
      "node",
      "scripts/check-branch-guard.cjs",
      "--pr-check",
      "--target",
      "master",
    ]);
    expect(parsed.label).toBe("分支守卫");
    expect(parsed.marker).toBe("[branch-guard] 结论：不判");
    expect(parsed.cmd).toEqual([
      "node",
      "scripts/check-branch-guard.cjs",
      "--pr-check",
      "--target",
      "master",
    ]);
  });

  test("退出码折算：2 + 标记 ⇒ 0(没判)；2 无标记 ⇒ 原样 2(判据没跑起来)；1 ⇒ 1", () => {
    expect(mapExit(2, true)).toEqual({ code: 0, inconclusive: true });
    expect(mapExit(2, false)).toEqual({ code: 2, inconclusive: false });
    expect(mapExit(1, true)).toEqual({ code: 1, inconclusive: false });
    expect(mapExit(0, false)).toEqual({ code: 0, inconclusive: false });
    expect(mapExit(null, false)).toEqual({ code: 1, inconclusive: false });
  });

  test("原因行优先取判决形状的行，不按词表猜", () => {
    const lines = [
      "安装依赖…",
      "[红] 钩子注册表 ⇄ declared-hook-steps.mjs",
      "[重档] 合计：红 1、没判 0、判过 60",
      "done",
    ];
    expect(pickReasonLines(lines)).toEqual([
      "[红] 钩子注册表 ⇄ declared-hook-steps.mjs",
      "[重档] 合计：红 1、没判 0、判过 60",
    ]);
  });

  test("摘要写的是「没判」而不是「通过」，且点名 PR 形态仍会红", () => {
    const md = renderSummary({
      label: "分支守卫",
      code: 0,
      rawCode: 2,
      inconclusive: true,
      lines: ["[branch-guard] 结论：不判 —— 触发形态是 workflow_dispatch"],
    });
    expect(md).toContain("没判（退出码 2");
    expect(md).toContain("不是通过");
    expect(md).toContain("PR 形态下同一判据仍会红");
  });

  test("注解转义：换行 / % 不破行（GitHub 的 ::error:: 是单行协议）", () => {
    expect(escapeAnnotation("a%b\nc")).toBe("a%25b%0Ac");
  });

  test("子进程 exit 1 ⇒ 外壳红，注解里带首条原因", () => {
    const { code, output } = runShell([
      "--label",
      "合成失败",
      "--",
      process.execPath,
      "-e",
      "console.log('[红] 第一处判据失败: x'); process.exit(1)",
    ]);
    expect(code).toBe(1);
    expect(output).toContain("::error::合成失败 红（退出码 1）：[红] 第一处判据失败: x");
  });

  test("子进程 exit 2 + 打了不判标记 ⇒ 外壳不红，注解是 warning", () => {
    const { code, output } = runShell([
      "--label",
      "合成没判",
      "--inconclusive-marker",
      "结论：不判",
      "--",
      process.execPath,
      "-e",
      "console.log('[branch-guard] 结论：不判'); process.exit(2)",
    ]);
    expect(code).toBe(0);
    expect(output).toContain("::warning::合成没判 不判（退出码 2）");
  });

  test("子进程 exit 2 但没打标记 ⇒ 仍然红（判据没跑起来不许读成绿）", () => {
    const { code, output } = runShell([
      "--label",
      "合成缺件",
      "--inconclusive-marker",
      "结论：不判",
      "--",
      process.execPath,
      "-e",
      "console.log('[重档] 合计：红 0、没判 0、判过 0（共 61 条）'); process.exit(2)",
    ]);
    expect(code).toBe(2);
    expect(output).toContain("::error::合成缺件 红（退出码 2）");
  });

  /* ── 摘要版式（2026-11-09 对齐 GA 摘要实测乱象）────────────────────────
   * 那一页当时有四个形状：两段数字互相矛盾的 `Vitest Test Report`（vitest 的
   * github-actions reporter 每进程各写一份，vitest.config.ts 已关）、
   * 「命中行」与「末尾 15 行」逐字相同、通过格也印一行 `ok`、多格平铺没有总览。
   * 下面这组把「修掉之后长什么样」钉住 —— 改版式先改这里。 */
  test("版式：命中行与末尾段逐字相同时，末尾段不重复出现", () => {
    const md = renderSummary({
      label: "合成失败",
      code: 1,
      rawCode: 1,
      inconclusive: false,
      lines: ["[红] 第一处判据失败: x"],
    });
    expect(md).toContain("命中行");
    expect(md).not.toContain("末尾");
  });

  test("版式：末尾段只在命中行之外还有内容时出现（且不重复命中行）", () => {
    const md = renderSummary({
      label: "分支守卫",
      code: 1,
      rawCode: 1,
      inconclusive: false,
      lines: [
        "[branch-guard] 复核开始",
        "[branch-guard] 阻断:源分支就是 master",
        "[branch-guard] master 只接受 PR 变更",
      ],
    });
    expect(md).toContain("末尾 15 行");
    const hit = md.indexOf("命中行");
    const tail = md.indexOf("末尾 15 行");
    expect(tail).toBeGreaterThan(hit);
    // 末尾段里包含命中行那一句是正常的（它是输出的一部分），但**不许只有它**
    const tailBlock = md.slice(tail);
    expect(tailBlock).toContain("复核开始");
    expect(tailBlock).toContain("master 只接受 PR 变更");
  });

  test("版式：通过的格不印「命中行」（一行 ok 不是证据）", () => {
    const md = renderSummary({
      label: "固定结构用例",
      code: 0,
      rawCode: 0,
      inconclusive: false,
      lines: ["ok", "done 60"],
    });
    expect(md).toContain("通过");
    expect(md).not.toContain("命中行");
    expect(md).not.toContain("末尾");
  });

  test("版式：三态图标各就各位（没判刻意不是 ❌ —— 它不是红也不是通过）", () => {
    const pass = renderSummary({ label: "a", code: 0, rawCode: 0, inconclusive: false, lines: [] });
    const nofact = renderSummary({
      label: "b",
      code: 0,
      rawCode: 2,
      inconclusive: true,
      lines: [],
    });
    const red = renderSummary({ label: "c", code: 1, rawCode: 1, inconclusive: false, lines: [] });
    expect(pass).toContain("✅ a — 通过");
    expect(nofact).toContain("⚠️ b — 没判（退出码 2");
    expect(red).toContain("❌ c — 红（退出码 1）");
  });

  test("汇总：空数组给空串（不写空壳标题）", () => {
    expect(renderJobSummary([])).toBe("");
  });

  test("汇总：一格只要一行结论 + 正文，不出只有一行的表", () => {
    const md = renderJobSummary([
      {
        label: "分支守卫",
        code: 1,
        rawCode: 1,
        inconclusive: false,
        lines: ["[branch-guard] 阻断:x"],
      },
    ]);
    expect(md).toContain("## 本 step 判据：❌ **1 格红**");
    expect(md).not.toContain("| 结论 |");
    expect(md).toContain("### ❌ 分支守卫 — 红（退出码 1）");
  });

  test("汇总：多格给总览表，结论行「有红先报红」，没判不是通过", () => {
    const md = renderJobSummary(
      [
        {
          label: "分支守卫",
          code: 1,
          rawCode: 1,
          inconclusive: false,
          lines: ["[branch-guard] 阻断:x"],
        },
        { label: "固定结构用例", code: 0, rawCode: 0, inconclusive: false, lines: ["ok"] },
        {
          label: "受影响用例",
          code: 0,
          rawCode: 2,
          inconclusive: true,
          lines: ["[affected] 结论：不判"],
        },
      ],
      { title: "PR 判据" },
    );
    expect(md).toContain("## PR 判据：❌ **1 格红** · ⚠️ 1 格没判 · ✅ 1 格通过");
    expect(md).toContain("| ❌ 红 | 分支守卫 | 退出码 1 |");
    expect(md).toContain("| ✅ 通过 | 固定结构用例 | — |");
    expect(md).toContain("| ⚠️ 没判 | 受影响用例 | 退出码 2 |");
  });

  test("汇总：一次 job 全绿 ⇒ 结论行是「全部通过」，不是「0 格红」", () => {
    const md = renderJobSummary([
      { label: "a", code: 0, rawCode: 0, inconclusive: false, lines: [] },
      { label: "b", code: 0, rawCode: 0, inconclusive: false, lines: [] },
    ]);
    expect(md).toContain("✅ **全部通过**（2 格）");
    expect(md).not.toContain("0 格红");
  });

  test("参数：--summary-title 被认出并透传（认不出的参数仍然报错）", () => {
    expect(
      parseCli(["--summary-title", "PR 判据", "--label", "x", "--", "node", "-v"]).summaryTitle,
    ).toBe("PR 判据");
    expect(() => parseCli(["--nope"])).toThrow(/认不出的参数/);
  });
});
