/**
 * 「已知基线失败登记的**粒度是用例**」的判据（ISSUE #1282 收尾）。
 *
 * 这条机制曾经是文件级（`vitest run --exclude <文件>`），代价在 2026-10-05 那次登记上
 * 量清了：`tests/theme-dark-token-cascade.test.ts` 一条断言红，整份文件被排除，
 * **同文件另外 17 条已绿的断言一起被摘掉**。静默跳过比红更糟 —— 红会挡住提交，
 * 静默跳过什么都不会说。所以这一条判的是三件事，缺一即退回那个状态：
 *
 *   ① **排除参数长什么样**：`-t '<负前瞻正则>'`，全名按 `" > "` 连接（vitest 的
 *      `getFullName` 分隔符）。这里钉死形态，因为拿空格拼就一条都不排除、且**静默**
 *      —— 错误形态与「本来就没有基线失败」长得一模一样。
 *   ② **模式能真的只跳那一条**（真起 vitest 跑一个夹具文件）：红的那条 skipped、
 *      绿的照跑。这条是「量具没坏」的那一半，少了它上面那条可以在毫无效果时也绿。
 *   ③ **增量层不再把文件剔出去**：`resolveAffectedTests` 对登记文件保留在清单里，
 *      只回一个 `excludeArgs`（`tests/affected-tests.test.ts` 钉的是收窄规则本身，
 *      这里钉「文件留下、用例跳掉」这个新形状）。
 */
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import {
  escapeRegExp,
  vitestExcludeArgs,
  vitestNameExcludePattern,
} from "../scripts/quality-gate-shared.mjs";
import { resolveAffectedTests } from "../scripts/affected-tests.mjs";

/** 夹具登记项：全名刻意含 `" > "`、全角括号与正则元字符（`(` `)` `/` `#`）。 */
const CASE = {
  file: "tests/x.test.ts",
  fullName: "主题别名（ISSUE #609） > .bg-card 编成 var() 取值"
    ,
  why: "夹具",
};

describe("排除模式的形态（拿空格拼就一条都不排除，且静默）", () => {
  it("空表 ⇒ 没有参数（不给 vitest 加任何东西）", () => {
    expect(vitestNameExcludePattern([])).toBeUndefined();
    expect(vitestExcludeArgs([])).toEqual([]);
  });

  it("全名按 `\" > \"` 连出去，且用负前瞻锚定整条", () => {
    const p = vitestNameExcludePattern([CASE]);
    expect(p).toBe(
      `^(?!(主题别名（ISSUE #609） > \\.bg-card 编成 var\\(\\) 取值)$).*$`,
    );
  });

  it("正则元字符被转义（`.` 不转义会把 `.bg-card` 变成「任意一字符」）", () => {
    expect(escapeRegExp("a.b(c)[d]")).toBe("a\\.b\\(c\\)\\[d\\]");
    expect(escapeRegExp(CASE.fullName)).toContain("\\.");
    expect(escapeRegExp(CASE.fullName)).toContain("\\(");
  });

  it("多条登记 ⇒ 一条模式里用 `|` 合起来（仍然是「除这些以外全跑」）", () => {
    const p = vitestNameExcludePattern([
      CASE,
      { file: "tests/y.test.ts", fullName: "outer > b", why: "夹具" },
    ]);
    expect(p).toBe(
      `^(?!(主题别名（ISSUE #609） > \\.bg-card 编成 var\\(\\) 取值|outer > b)$).*$`,
    );
  });

  it("参数形状是 `[\"-t\", 模式]`（消费方不许自己拼）", () => {
    const args = vitestExcludeArgs([CASE]);
    expect(args[0]).toBe("-t");
    expect(args[1]).toBe(vitestNameExcludePattern([CASE]));
  });
});

describe("模式真的只跳那一条（起一次真 vitest 验形态，不是「源码长这样」）", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "known-failed-granularity-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("夹具：红的那条 skipped、同文件另一条照跑", () => {
    const fullName = "outer > the red one";
    writeFileSync(
      path.join(dir, "fixture.test.ts"),
      [
        'import { describe, expect, it } from "vitest";',
        'describe("outer", () => {',
        '  it("the red one", () => { expect(1).toBe(2); });',
        '  it("the green one", () => { expect(1).toBe(1); });',
        "});",
      ].join("\n"),
      "utf8",
    );
    const args = vitestExcludeArgs([
      { file: "fixture.test.ts", fullName, why: "夹具" },
    ]);
    // 起真 vitest：入口经 `import.meta.resolve` 解析，别写死 node_modules 布局
    // （pnpm 的真身在 `.pnpm/vitest@…/`，顶层那个只是链接）。
    const vitest = spawnSync(
      process.execPath,
      [
        vitestEntry(),
        "run",
        "--root",
        dir,
        "--no-file-parallelism",
        ...args,
        "fixture.test.ts",
      ],
      { encoding: "utf8" },
    );
    const out = `${vitest.stdout}${vitest.stderr}`;
    // 绿的照跑、红的被跳过 ⇒ 「1 passed | 1 skipped」。若模式拼错（例如用空格
    // 代替 `" > "`），这里会是「2 passed」—— 红的那条没被排除，看起来像没登记。
    expect(vitest.status, out).toBe(0);
    expect(out).toMatch(/1 passed/);
    expect(out).toMatch(/1 skipped/);
  });
});

/** vitest 的 ESM 入口（与 `run-affected-tests.mjs` 同口径，不写死 pnpm 布局）。 */
function vitestEntry(): string {
  const pkg = fileURLToPath(import.meta.resolve("vitest/package.json"));
  const meta = JSON.parse(readFileSync(pkg, "utf8")) as {
    bin?: string | Record<string, string>;
  };
  const bin = meta.bin;
  const rel = typeof bin === "string" ? bin : bin?.vitest;
  if (typeof rel !== "string") {
    throw new Error("vitest 包没有 bin.vitest");
  }
  return path.join(path.dirname(pkg), rel);
}

describe("增量层：文件留下、用例跳掉（ISSUE #1282 收尾的形状）", () => {
  it("登记文件仍在跑单里，只多一个 excludeArgs", () => {
    const caseItem = {
      file: "tests/x.test.ts",
      fullName: "outer > the red one",
      why: "夹具",
    };
    const res = resolveAffectedTests({
      changedPaths: ["tests/x.test.ts"],
      testFiles: ["tests/x.test.ts", "tests/other.test.ts"],
      sourceFiles: [],
      readText: () => null,
      knownFailedCases: [caseItem],
    });
    // ① 文件**没有**被剔除（旧行为是 `picked.delete(文件)` ⇒ 另外 17 条绿的一起消失）。
    expect(res.tests).toContain("tests/x.test.ts");
    // ② 只跳登记的那一条。
    expect(res.excludeArgs).toEqual(
      vitestExcludeArgs([caseItem]),
    );
    expect(res.reasons.__skipped).toContain(caseItem.fullName);
  });

  it("登记项的文件不在本次跑单里 ⇒ 不加排除参数（免得模式空转）", () => {
    const res = resolveAffectedTests({
      changedPaths: ["src/lib/media.ts"],
      testFiles: ["tests/other.test.ts"],
      sourceFiles: ["src/lib/media.ts"],
      readText: () => null,
      knownFailedCases: [
        { file: "tests/x.test.ts", fullName: "outer > red", why: "夹具" },
      ],
    });
    expect(res.tests).not.toContain("tests/x.test.ts");
    expect(res.excludeArgs).toBeUndefined();
  });
});
