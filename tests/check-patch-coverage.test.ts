/**
 * patch coverage 判据自测（ISSUE #2687 / §11.7 读数档）。
 *
 * 这一格判的是「这次 diff 的新增/改动行 ∩ 未被覆盖的行」—— #2669 撤掉整体门槛后
 * 覆盖率维度唯一的可行动红。三条契约在这里钉死：
 *   ① 分母口径写死在判据里（src/ 的 ts/tsx，不含测试自身 / 声明 / 生成物）；
 *   ② 「lcov 整份缺失」的文件 = 全部改动行未覆盖（「没进报告」≠「测过了」）；
 *   ③ 读数档默认退 0（哪怕 0%），`--strict` 显式在场才判红。
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { gitSandboxEnv } from "./helpers/git-sandbox-env";
import {
  computePatchCoverage,
  inDenominator,
  main,
  mergeLcovMaps,
  parseLcov,
} from "../scripts/check-patch-coverage.mjs";

const tmpDirs: Array<string> = [];
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** 一段最小的 lcov 文本。 */
function lcov(entries: Array<[string, Array<[number, number]>]>): string {
  return entries
    .map(([file, das]) =>
      [`SF:${file}`, ...das.map(([ln, h]) => `DA:${ln},${h}`), "end_of_record"].join("\n"),
    )
    .join("\n");
}

/** 一段最小的 unified=0 diff 文本（每份文件一个 hunk，从 newStart 起 n 行）。 */
function diffOf(files: Array<{ file: string; lines: Array<string>; newStart: number }>): string {
  return files
    .map((f) =>
      [
        `diff --git a/${f.file} b/${f.file}`,
        `--- a/${f.file}`,
        `+++ b/${f.file}`,
        `@@ -1,0 +${f.newStart},${f.lines.length} @@`,
        ...f.lines.map((l) => `+${l}`),
        "",
      ].join("\n"),
    )
    .join("\n");
}

describe("patch coverage —— 分母口径（写死在判据里，#2687）", () => {
  it("src/ 的 ts/tsx 在分母内；测试自身 / 声明 / 生成物不在", () => {
    expect(inDenominator("src/lib/foo.ts")).toBe(true);
    expect(inDenominator("src/components/ui/bar.tsx")).toBe(true);
    expect(inDenominator("src/lib/foo.test.ts")).toBe(false);
    expect(inDenominator("tests/lib/foo.test.ts")).toBe(false);
    expect(inDenominator("src/lib/types.d.ts")).toBe(false);
    expect(inDenominator("src/generated/whatever.ts")).toBe(false);
    expect(inDenominator("docs/api/marker.ts")).toBe(false);
    expect(inDenominator("scripts/tool.mjs")).toBe(false);
  });

  it("分母 = 代码行（空行与纯注释剔除）；有 DA 交点的档由 DA 再剔一层", () => {
    const diffText = diffOf([
      {
        file: "src/lib/x.ts",
        newStart: 11,
        lines: ["const a = 1;", "", "// 注释行", "const b = 2; // 行尾注释算代码"],
      },
    ]);
    const lcovMaps = [
      parseLcov(
        lcov([
          [
            "src/lib/x.ts",
            [
              [11, 1],
              [13, 0],
              [14, 2],
            ],
          ],
        ]),
      ),
    ];
    const r = computePatchCoverage({ diffText, lcovMaps });
    expect(r.perFile).toHaveLength(1);
    /* 整行注释出局（即使夹具给它塞了 DA 条目——真 lcov 不会有，形状口径不靠它）；
     * 行尾注释算代码行。分母 = 11 与 14 两行，都有命中 ⇒ 全覆盖。 */
    expect(r.perFile[0]?.changed).toBe(2);
    expect(r.perFile[0]?.uncoveredLines).toEqual([]);
    expect(r.total).toBe(2);
    expect(r.covered).toBe(2);
  });
});

describe("patch coverage —— lcov 形状", () => {
  it("lcov 整份缺失的文件 = 全部改动代码行未覆盖（「没进报告」≠「测过了」）", () => {
    const diffText = diffOf([
      { file: "src/lib/y.ts", newStart: 6, lines: ["const b = 2;", "const c = 3;"] },
    ]);
    const r = computePatchCoverage({ diffText, lcovMaps: [parseLcov(lcov([]))] });
    expect(r.perFile[0]?.missing).toBe(true);
    expect(r.perFile[0]?.uncoveredCount).toBe(2);
    expect(r.covered).toBe(0);
  });

  it("多份 lcov（逐块跑）合并：同一行取最大命中（任一块命中过即算覆盖）", () => {
    const m1 = parseLcov(lcov([["src/lib/a.ts", [[10, 0]]]]));
    const m2 = parseLcov(lcov([["src/lib/a.ts", [[10, 2]]]]));
    const merged = mergeLcovMaps([m1, m2]);
    expect(merged.get("src/lib/a.ts")?.get(10)).toBe(2);
    const r = computePatchCoverage({
      diffText: diffOf([{ file: "src/lib/a.ts", newStart: 10, lines: ["const a = 1;"] }]),
      lcovMaps: [m1, m2],
    });
    expect(r.covered).toBe(1);
    expect(r.perFile[0]?.uncoveredCount).toBe(0);
  });

  it("不在分母的文件直接出局（tests/ 自己改了不算账）", () => {
    const diffText = diffOf([
      { file: "tests/helpers/probe.test.ts", newStart: 1, lines: ['it("x", () => {})'] },
    ]);
    const r = computePatchCoverage({ diffText, lcovMaps: [] });
    expect(r.total).toBe(0);
    expect(r.perFile).toHaveLength(0);
  });
});

describe("patch coverage —— CLI 三态", () => {
  it("lcov 读不到 ⇒ 退 2（没跑起来，不许读成「没有未覆盖行」）", () => {
    const repo = mkdtempSync(join(tmpdir(), "patch-cov-"));
    tmpDirs.push(repo);
    const code = main(["--lcov", "no-such/lcov.info"], repo);
    expect(code).toBe(2);
  });

  it("真仓端到端：读数档默认退 0（哪怕 0%）；--strict 在场且低于阈值才退 1", () => {
    const repo = mkdtempSync(join(tmpdir(), "patch-cov-repo-"));
    tmpDirs.push(repo);
    const git = (...args: Array<string>) =>
      execFileSync("git", args, { cwd: repo, env: gitSandboxEnv(), encoding: "utf8" }).trim();
    execFileSync("git", ["init", "-q", "-b", "main", "."], { cwd: repo, env: gitSandboxEnv() });
    execFileSync("git", ["config", "user.email", "t@t"], { cwd: repo, env: gitSandboxEnv() });
    execFileSync("git", ["config", "user.name", "t"], { cwd: repo, env: gitSandboxEnv() });
    execFileSync("git", ["commit", "--allow-empty", "-q", "-m", "base"], {
      cwd: repo,
      env: gitSandboxEnv(),
    });
    const base = git("rev-parse", "HEAD");
    mkdirSync(join(repo, "src"), { recursive: true });
    writeFileSync(join(repo, "src", "probe.ts"), "export const p = 1;\n", "utf8");
    execFileSync("git", ["add", "-A"], { cwd: repo, env: gitSandboxEnv() });
    execFileSync("git", ["commit", "-q", "-m", "feat: probe"], { cwd: repo, env: gitSandboxEnv() });
    // lcov：该文件没有条目（从未被加载）⇒ 改动行全部未覆盖 = 0%
    const lcovDir = join(repo, "coverage");
    mkdirSync(lcovDir, { recursive: true });
    writeFileSync(join(lcovDir, "lcov.info"), lcov([]), "utf8");
    const readout = main(["--lcov", "coverage/lcov.info", "--base", base], repo);
    expect(readout, "读数档默认不判红").toBe(0);
    const strict = main(["--lcov", "coverage/lcov.info", "--base", base, "--strict", "80"], repo);
    expect(strict, "0% < 80% ⇒ 显式开的阈值判红").toBe(1);
  });
});
