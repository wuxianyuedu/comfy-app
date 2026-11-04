/**
 * `scripts/ci-step-verdict.mjs` 的判据（ISSUE #3102）：治「Actions 上只有 `✗ 分支守卫` + exit code 1、为什么红要翻日志」——① 首条原因压进 `::error::` / `::warning::`，② 退出码 + 命中行 + 末尾写进 `$GITHUB_STEP_SUMMARY`。
 * 最易写错的是 exit 2（本仓「没判」）能否折成非红：**只有子进程自己打了那段不判结论**才折；无条件折会把「判据没跑起来」（`ci-heavy-gates.mjs` 的 missing 也走 2）读成绿。
 * 两向都钉：带标记 ⇒ exit 0 + `::warning::`；不带标记 ⇒ 原样红 + `::error::`。
 */
import { execFileSync } from "node:child_process";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { escapeAnnotation, mapExit, parseCli, pickReasonLines, renderSummary } from "../scripts/ci-step-verdict.mjs";

const SCRIPT = join(process.cwd(), "scripts", "ci-step-verdict.mjs");

/** 跑外壳，返回退出码与 stdout（不碰真实判据，只喂合成子进程）。 */
function runShell(args: string[]): { code: number; output: string } {
  try {
    const output = execFileSync(process.execPath, [SCRIPT, ...args], {
      encoding: "utf8",
      cwd: process.cwd(),
    });
    return { code: 0, output };
  } catch (error) {
    const e = error as { status?: number; stderr?: string; stdout?: string };
    return { code: e.status ?? 1, output: `${e.stdout ?? ""}${e.stderr ?? ""}` };
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
});
