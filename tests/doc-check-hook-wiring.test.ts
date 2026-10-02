/**
 * pre-commit D 组里「文档引用与权威源一致」这一步的**在位判据**。
 *
 * 为什么单独成文件、并进 `scripts/affected-tests.mjs` 的 FIXED_STRUCTURAL_TESTS：
 * 这一步的整个价值就是「每次提交都跑」，而改 `.githooks/**` 会让增量层**放弃收窄、
 * 只跑固定清单**（实测 `--changed .githooks/pre-commit` 给出的 17 个里没有按路径引用
 * 它的那份用例）。把这几条留在 `tests/check-doc-references.test.ts` 里，恰好在本该
 * 拦住的那次改动（有人把这一步摘回手动档 / 改了计数陈述）上一条都不跑 ——
 * 判据存在但没有执行者，与没有等价。这里只读两份文本、不起子进程，成本可忽略。
 *
 * 为什么解析 D 组步骤而不是 `toContain(那一行)`：变异实测把那行前面加 `# ` 注掉后，
 * `toContain` 仍然命中（注释行里也含同一段字面），只有 3 条里的计数那条会红。
 * 「把这一步静音」正是这一族要拦的动作（同台账 F13「对编译器按下静音键」）。
 *
 * 同一格先例：`tests/shell-gate.test.ts` 的「新增门禁脚本必须同时接进 pre-commit」、
 * `tests/no-platform-ci-config.test.ts` 的「平台侧兜底在不在」。
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(".");
const HOOK = join(REPO_ROOT, ".githooks", "pre-commit");
const CHECK = join(REPO_ROOT, "scripts", "check-doc-references.cjs");

/**
 * D 组步骤 = 钩子里 `  run "<标签>" <命令>` 那些行（两空格缩进是组内 shell 的形态）。
 * 行首锚定只认真调用：`run() { … }` 的函数定义、被 `#` 注掉的行都不算。
 * @param {string} hookText
 * @returns {{label: string, cmd: string}[]}
 */
function dGroupSteps(hookText: string) {
  const re = /^ {2}run "([^"]+)" (.+)$/gm;
  return [...hookText.matchAll(re)].map((m) => ({
    label: m[1] ?? "",
    cmd: m[2] ?? "",
  }));
}

describe("doc:check 接进 pre-commit（ISSUE #1371 翻档的在位判据）", () => {
  const hook = readFileSync(HOOK, "utf8");
  const steps = dGroupSteps(hook);

  it("钩子 D 组真的执行这一步，且调的就是本脚本（被注释掉的行不算在场）", () => {
    const hit = steps.find((s) =>
      s.cmd.includes("scripts/check-doc-references.cjs"),
    );
    expect(hit, `D 组 ${steps.length} 步里没有 doc:check`).toEqual({
      label: "文档引用与权威源一致",
      cmd: "node scripts/check-doc-references.cjs",
    });
  });

  it("脚本头不许回到「不接 pre-commit（避免过度打扰提交）」那句旧签字", () => {
    const script = readFileSync(CHECK, "utf8");
    expect(script).not.toContain("不接 pre-commit（避免过度打扰提交）");
  });

  it("钩子里那句「D(N 个判据脚本)」的 N 与实际步骤数一致（这数字没有别的判据核）", () => {
    const claimed = /D\((\d+) 个判据脚本\)/.exec(hook);
    expect(claimed, "钩子里的判据计数陈述还在吗？").not.toBeNull();
    expect(
      Number(claimed?.[1]),
      `钩子注释写 ${claimed?.[1]}，实际 ${steps.length}`,
    ).toBe(steps.length);
  });
});
