/**
 * 固定清单的输入面登记（ISSUE #2022）：pre-commit 超 5 分钟的实际后果是 `--no-verify`。实测只改 14 个文件的提交组 C
 * 545.4s，四条工具自检约 260s 且不随业务代码漂；机制沿用平台侧 `ifModify`（§13.5.20）。最危险是**悄悄不跑** —— 面写窄
 * 或路径打错就永久缺席，日志与「这次不需要跑」同形；用例设防：登记必在清单、模式真命中被跟踪路径、名单封闭、两向都测（#2802）。
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import { resolveAffectedTests, wideReasonFor } from "../scripts/affected-tests.mjs";
import { FIXED_STRUCTURAL_TESTS } from "../scripts/fixed-structural-tests.mjs";
import {
  INPUT_FACES,
  faceHits,
  faceMatches,
  selectFixedByFace,
} from "../scripts/fixed-gate-input-faces.mjs";

/** 被跟踪路径的全集 —— ② 那一条的事实来源（本地 `git ls-files`，不走网络）。 */
function trackedPaths(): Array<string> {
  return execFileSync("git", ["ls-files"], { encoding: "utf8" })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

const ROOT = path.resolve(import.meta.dirname, "..");
const MODULE_EXTS = [
  "",
  ".ts",
  ".tsx",
  ".mts",
  ".js",
  ".jsx",
  ".mjs",
  ".json",
  "/index.ts",
  "/index.tsx",
  "/index.mjs",
];

/**
 * 一份用例里**真正的**静态 `import` / `export … from` 说明符。
 * 为什么走语法树而不是正则：夹具文本里本来就会写 `import x from "./…"`（如 `tests/storybook-tsc-input.test.ts`
 * 的模块标识符常量），那是被测输入而非本文件依赖；正则分不开这两种形状，语法树里只有前者是 ImportDeclaration。
 */
function importSpecifiersOf(rel: string): Array<string> {
  const text = readFileSync(path.join(ROOT, rel), "utf8");
  const source = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const specs: Array<string> = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specs.push(node.moduleSpecifier.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return specs;
}

/** 相对说明符 → 被跟踪的仓库路径（按 `tsconfig` 的候选扩展名逐个试；裸包名与别名回 `null`）。 */
function resolveRelative(spec: string, from: string, tracked: Set<string>): string | null {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
  for (const ext of MODULE_EXTS) {
    const candidate = base + ext;
    if (tracked.has(candidate)) {
      return candidate;
    }
  }
  return null;
}

describe("输入面登记的形状", () => {
  it("每一条都在固定清单里（不然那是一条永不生效的死面）", () => {
    const orphans = INPUT_FACES.filter((entry) => !FIXED_STRUCTURAL_TESTS.includes(entry.test)).map(
      (entry) => entry.test,
    );
    expect(
      orphans,
      "这些登记不在 FIXED_STRUCTURAL_TESTS 里 —— 它们本来就走 import 图（有条件跑），" +
        "再写一道面只会让「谁决定它跑不跑」变成两处",
    ).toEqual([]);
  });

  it("每一个模式都至少命中一个被跟踪的路径（判死拼写错误与改名后没跟着改的面）", () => {
    const tracked = trackedPaths();
    const dead = [];
    for (const entry of INPUT_FACES) {
      for (const pattern of entry.face) {
        if (!tracked.some((file) => faceMatches(file, pattern))) {
          dead.push(`${entry.test} :: ${pattern}`);
        }
      }
    }
    expect(
      dead,
      "这些面在仓库里一个路径都不匹配 —— 它永远不会命中，等于把那条判据从固定清单里删掉，" +
        "而这件事在日志里没有任何区别",
    ).toEqual([]);
  });

  it("每一个模式都不许整条落在宽面触发上（那种条件永远到不了筛这一层）", () => {
    const tracked = trackedPaths();
    const dead = [];
    for (const entry of INPUT_FACES) {
      for (const pattern of entry.face) {
        const matched = tracked.filter((file) => faceMatches(file, pattern));
        if (matched.length > 0 && matched.every((file) => wideReasonFor(file) !== null)) {
          dead.push(`${entry.test} :: ${pattern}（命中的 ${matched.length} 份全是宽面触发）`);
        }
      }
    }
    expect(
      dead,
      "这些模式命中的每一份路径都在 `WIDE_TRIGGERS` 里 —— 它们一改，整档就先退回「固定清单全跑」，" +
        "输入面这一层根本轮不到问。写成这样只会让面看起来更宽（`base-check` 的 `.githooks/**` 就是这一格）",
    ).toEqual([]);
  });

  it("用例直接 import 的每一份仓库文件都在它自己的面里（面自称「它读什么」就不许有假话）", () => {
    const tracked = new Set(trackedPaths());
    const gaps: Array<string> = [];
    const unresolved: Array<string> = [];
    for (const entry of INPUT_FACES) {
      for (const spec of importSpecifiersOf(entry.test)) {
        if (!spec.startsWith(".")) {
          continue;
        }
        const rel = resolveRelative(spec, entry.test, tracked);
        if (rel === null) {
          unresolved.push(`${entry.test} :: ${spec}`);
          continue;
        }
        if (!faceHits(entry, [rel])) {
          gaps.push(`${entry.test} :: ${spec} → ${rel}`);
        }
      }
    }
    expect(
      unresolved,
      "这些相对 import 在索引里找不到对应文件 —— 要么是面要盯着的一份还没入库的文件，要么是判据的解析漏了扩展名形态",
    ).toEqual([]);
    expect(
      gaps,
      "这些文件是用例直接 import 的，却没写进它的面 —— 面少一份输入，改到那一份时这条判据就会「按面静默跳过」；" +
        "今天 import 图还会把它点回来（两套机制是并集），可那句「它读什么」已经有一处是假的",
    ).toEqual([]);
  });

  it("名单是封闭的那一份：加一条要人来签字", () => {
    expect(INPUT_FACES.map((entry) => entry.test).sort()).toEqual([
      "tests/a11y-axe-stories.test.ts",
      "tests/a11y-rules-gate.test.ts",
      "tests/base-check.test.ts",
      "tests/changed-scope.test.ts",
      "tests/changelog-versions-gate.test.ts",
      "tests/check-bundle-budget.test.ts",
      "tests/check-commit-claims.test.ts",
      "tests/check-merge-parents.test.ts",
      "tests/ci-env-probe.test.ts",
      "tests/eslint-exemption-staleness.test.ts",
      "tests/eslint-gate-canary.test.ts",
      "tests/gate-executors.test.ts",
      "tests/merge-changelog-anchor.test.ts",
      "tests/precommit-timing.test.ts",
      "tests/scripts-typecheck-ratchet.test.ts",
      "tests/storybook-tsc-input.test.ts",
      "tests/tw4-hardgate-behaviour.test.ts",
    ]);
    /* 每条都得说清「它读什么」—— 没有 why 的面，下一条只会照着猜着改宽。 */
    for (const entry of INPUT_FACES) {
      expect(entry.why.length, `${entry.test} 缺「它读什么」`).toBeGreaterThan(20);
      expect(entry.face.length).toBeGreaterThan(1);
    }
  });
});

describe("模式匹配的三种形状", () => {
  it("精确路径、目录前缀、同段通配各自的行为", () => {
    expect(faceMatches("eslint.config.js", "eslint.config.js")).toBe(true);
    expect(faceMatches("src/App.tsx", "eslint.config.js")).toBe(false);
    expect(faceMatches(".githooks/pre-commit", ".githooks/**")).toBe(true);
    expect(faceMatches(".githooks/x/y", ".githooks/**")).toBe(true);
    /* 目录前缀不许吞同名兄弟：`scripts/x/**` 不匹配 `scripts/x2/y` —— 那种漂法会把
     * 不相干的判据一路点进来，面就悄悄变宽了。 */
    expect(faceMatches("scripts/x2/y", "scripts/x/**")).toBe(false);
    expect(faceMatches("scripts/tw4-a.json", "scripts/tw4-*.json")).toBe(true);
    expect(faceMatches("scripts/deep/tw4-a.json", "scripts/tw4-*.json")).toBe(false);
  });

  it("空模式与「整仓库通配」一律不命中（那种写法等于没写面）", () => {
    for (const pattern of ["", "*", "**", "./**"]) {
      expect(faceMatches("src/app/page.tsx", pattern), pattern).toBe(false);
    }
  });

  it("改判据自己的测试文件必须命中（不然改测试看不到效果）", () => {
    for (const entry of INPUT_FACES) {
      expect(faceHits(entry, [entry.test]), entry.test).toBe(true);
      expect(faceHits(entry, ["docs/README.md"]), entry.test).toBe(false);
    }
  });
});

describe("切分与接线", () => {
  it("没命中的固定条目被跳过，且**逐条点名**（悄悄不跑是本仓最狠的那族）", () => {
    const got = selectFixedByFace(FIXED_STRUCTURAL_TESTS, ["docs/README.md"]);
    expect(got.skipped.map((s) => s.test).sort()).toEqual(
      INPUT_FACES.map((entry) => entry.test).sort(),
    );
    for (const one of got.skipped) {
      expect(one.why.length, `${one.test} 的跳过原因要说清它读什么`).toBeGreaterThan(20);
    }
    expect(got.keep).toEqual(
      FIXED_STRUCTURAL_TESTS.filter((t) => !INPUT_FACES.some((entry) => entry.test === t)),
    );
  });

  it("改了被测工具 ⇒ 那一条回到清单里", () => {
    const got = selectFixedByFace(FIXED_STRUCTURAL_TESTS, ["scripts/base-check.mjs"]);
    expect(got.keep).toContain("tests/base-check.test.ts");
    expect(got.skipped.map((s) => s.test)).not.toContain("tests/base-check.test.ts");
    /* 其余三条不该被它带起来：面是各判各的。 */
    expect(got.skipped.map((s) => s.test)).toContain("tests/a11y-rules-gate.test.ts");
  });

  it("后补面的四条各按自己的触发面回来，且不互相带起（#2793）", () => {
    const cases: Array<[string, string]> = [
      ["eslint.config.js", "tests/eslint-gate-canary.test.ts"],
      ["scripts/check-commit-claims.mjs", "tests/check-commit-claims.test.ts"],
      ["scripts/changed-scope.mjs", "tests/changed-scope.test.ts"],
      ["src/components/ui/button.tsx", "tests/a11y-axe-stories.test.ts"],
    ];
    for (const [changed, test] of cases) {
      const got = selectFixedByFace(FIXED_STRUCTURAL_TESTS, [changed]);
      expect(got.keep, `${changed} 应当把 ${test} 点回来`).toContain(test);
      for (const other of cases.map(([, one]) => one).filter((one) => one !== test)) {
        expect(
          got.skipped.map((s) => s.test),
          `${changed} 不该带起 ${other}`,
        ).toContain(other);
      }
    }
    /* 自指那一条**不许**开面：它在清单里的理由是「解析器的缺陷只有它能发现」。 */
    expect(INPUT_FACES.map((entry) => entry.test)).not.toContain("tests/affected-tests.test.ts");
  });

  it("这一批九条各按自己的触发面回来，且不把四条业务自检带进来（#2798）", () => {
    const cases: Array<[string, string]> = [
      ["scripts/base-check/verdict.mjs", "tests/base-check.test.ts"],
      ["scripts/quality-gate.mjs", "tests/gate-executors.test.ts"],
      ["scripts/check-merge-parents.mjs", "tests/check-merge-parents.test.ts"],
      ["scripts/merge-changelog-fragments.mjs", "tests/merge-changelog-anchor.test.ts"],
      [".storybook/preview.tsx", "tests/storybook-tsc-input.test.ts"],
      ["scripts/check-eslint-exemptions.cjs", "tests/eslint-exemption-staleness.test.ts"],
      ["scripts/check-scripts-typecheck.cjs", "tests/scripts-typecheck-ratchet.test.ts"],
      ["scripts/precommit-timing.mjs", "tests/precommit-timing.test.ts"],
      [".cnb.yml", "tests/ci-env-probe.test.ts"],
      ["scripts/check-changelog-versions.cjs", "tests/changelog-versions-gate.test.ts"],
    ];
    const untouchable = [
      "tests/a11y-axe-stories.test.ts",
      "tests/a11y-rules-gate.test.ts",
      "tests/check-bundle-budget.test.ts",
      "tests/tw4-hardgate-behaviour.test.ts",
    ];
    for (const [changed, test] of cases) {
      const got = selectFixedByFace(FIXED_STRUCTURAL_TESTS, [changed]);
      expect(got.keep, `${changed} 应当把 ${test} 点回来`).toContain(test);
      for (const other of untouchable) {
        expect(
          got.skipped.map((s) => s.test),
          `${changed} 不该带起 ${other}`,
        ).toContain(other);
      }
    }
  });

  it("增量档（subset）过筛，并把跳过记进 reasons.__faceSkipped", () => {
    const res = resolveAffectedTests({
      changedPaths: ["docs/README.md"],
      testFiles: [...FIXED_STRUCTURAL_TESTS],
      sourceFiles: [],
      readText: () => null,
    });
    expect(res.mode).toBe("subset");
    expect(res.tests).not.toContain("tests/base-check.test.ts");
    expect(String(res.reasons.__faceSkipped ?? "")).toContain("tests/a11y-rules-gate.test.ts");
  });

  it("改动清单为空 ⇒ 一条都不跳（「不知道」不等于「没变」，与装依赖那档同一口径）", () => {
    const res = resolveAffectedTests({
      changedPaths: [],
      testFiles: [...FIXED_STRUCTURAL_TESTS],
      sourceFiles: [],
      readText: () => null,
    });
    expect(res.mode).toBe("subset");
    expect(res.reasons.__faceSkipped).toBeUndefined();
    for (const entry of INPUT_FACES) {
      expect(res.tests, `${entry.test} 在拿不到清单时必须照跑`).toContain(entry.test);
    }
  });

  it("放弃收窄那一档**完全不过筛**：那一刻的前提就是别信筛出来的结果", () => {
    /* `vitest.config.ts` 在宽面名单里（全局测试配置）⇒ 整步退回「只跑固定清单」。 */
    const res = resolveAffectedTests({
      changedPaths: ["vitest.config.ts"],
      testFiles: [...FIXED_STRUCTURAL_TESTS],
      sourceFiles: [],
      readText: () => null,
    });
    expect(res.mode).toBe("all");
    expect(res.reasons.__faceSkipped).toBeUndefined();
    for (const entry of INPUT_FACES) {
      expect(res.tests, `${entry.test} 在 wide 档必须照跑`).toContain(entry.test);
    }
  });
});
