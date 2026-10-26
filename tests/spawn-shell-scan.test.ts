/**
 * `scripts/spawn-shell-scan.mjs` / `scripts/package-bin-entry.mjs` 的判据（ISSUE #2453）。
 *
 * ── 为什么这两条要进固定清单 ──────────────────────────────────────────────
 *
 * ISSUE #2445 把 typedoc 那一处「开 shell 起 `.cmd` 垫片」改掉了，而**第二处**
 * （`scripts/storybook.mjs`）是靠 grep 肉眼找到的 —— 没有判据，第三处还会长出来，
 * 而且它的失效形态是**只在换台机器 / 换 Node 大版本时才响**（DEP0190 是警告不是错误、
 * 引号是「换台机器跑不起来」）。
 *
 * 触发它的改动面是「某个 `scripts/*.mjs` 里新加一句 `shell: true`」—— 那条改动
 * **不在这两个文件的 import 图里**，于是「只在受影响时才跑」等于让它随下一次新增
 * spawn 过去 ⇒ 与 `tests/git-dir-literal-scan.test.ts` 同因，进
 * `scripts/fixed-structural-tests.mjs` 固定清单（改那些脚本不会把这条带进受影响集）。
 *
 * ── 形状判据为什么钉得这么细 ──────────────────────────────────────────────
 *
 * 第一版剥注释写成「整个文件一个状态机」，被一处游离引号卡在字符串状态里跑飞 ——
 * 之后几百行全被当成字符串，块注释不再被认，判据把**正在教人别这么写的注释**
 * 报成违例（`hook-steps.mjs` 那几行）。那条假阳性的代价不是「多修一次」，而是
 * 「下一个人学会给判据加白名单」。所以这里钉两件事：注释真的被剥掉、以及
 * `shell: false` 这类**明确关掉**的写法不被判（判它就是把写清楚的人一起罚）。
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  stripComments,
} from "../scripts/spawn-shell-scan.mjs";
import {
  binRelativePath,
  resolvePackageBinEntry,
} from "../scripts/package-bin-entry.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("scripts/spawn-shell-scan.mjs", () => {
  it("scripts/** 里没有「起子进程开 shell」的形态（DEP0190 + 手工引号）", () => {
    // 这一条是 #2453 的护栏：#2445 修掉 typedoc 那一处之后，第二处（storybook）
    // 是肉眼找到的。不进固定清单就等于「发现第三处靠运气」。
    let stdout = "";
    expect(() => {
      stdout = execFileSync(
        process.execPath,
        ["scripts/spawn-shell-scan.mjs"],
        { cwd: ROOT, encoding: "utf8" },
      );
    }).not.toThrow();
    expect(stdout).toContain("OK");
  });

  it("剥注释：块注释与行注释都不算违例（教人别这么写的那句话不许被判）", () => {
    const src = [
      "const a = 1; // shell: true  ← 行注释里的话不算",
      "/* shell: true ← 块注释里的话不算 */",
      "const b = 2;",
    ].join("\n");
    expect(stripComments(src)).not.toContain("shell");
    // 代码里那一句**要**留着
    expect(stripComments("spawn(x, { shell: true });")).toContain("shell: true");
  });

  it("明确关掉的那几种不被判（shell: false / null / 字符串值）", () => {
    const cases = [
      "spawn(a, b, { shell: false });",
      "spawn(a, b, { shell: null });",
      "const kinds = { shell: \"shell\" };",
    ];
    for (const line of cases) {
      expect(findShellOptionsIn(line), line).toEqual([]);
    }
  });

  it("真要拦的那三种形状会被判出来", () => {
    for (const line of [
      "spawn(a, b, { shell: true });",
      "spawn(a, b, { shell: process.platform === \"win32\" });",
      "spawnSync(bin, args, { shell: needsShell(cmd) });",
    ]) {
      expect(findShellOptionsIn(line).length, line).toBe(1);
    }
  });
});

/** 与 `spawn-shell-scan.mjs` 同一口径：剥注释 → 逐行过那一条正则。 */
const SHELL_OPTION_RE = /\bshell\s*:(?!\s*(?:false\b|null\b|undefined\b|["'`]))/;

/**
 * 一段源码里的违例行（形状用例走字符串，不必落盘成临时脚本）。
 *
 * @param src 源码
 * @returns 违例行
 */
function findShellOptionsIn(src: string): string[] {
  return stripComments(src)
    .split("\n")
    .filter((l) => SHELL_OPTION_RE.test(l));
}

describe("scripts/package-bin-entry.mjs", () => {
  it("本仓三个 CLI 都解析得到包真身（不在 .bin 垫片下）", () => {
    for (const pkg of ["typedoc", "vitest", "storybook"]) {
      const entry = resolvePackageBinEntry(pkg);
      expect(entry, `${pkg} 解析不到`).toBeTruthy();
      const rel = entry!.replace(/\\/g, "/");
      expect(rel, `${pkg} 指到了 .bin 垫片`).not.toContain("/node_modules/.bin/");
    }
  });

  it("没装 / 仓库根是空目录 ⇒ null（不抛，调用方只认起不起来）", () => {
    expect(resolvePackageBinEntry("这个包一定不存在-2453")).toBeNull();
  });

  it("bin 的两种形状都接得住：字符串与对象", () => {
    expect(binRelativePath("./dist/bin/x.js", "x")).toBe("./dist/bin/x.js");
    expect(binRelativePath({ typedoc: "bin/typedoc" }, "typedoc")).toBe(
      "bin/typedoc",
    );
    expect(binRelativePath({ typedoc: "bin/typedoc" }, "别的键")).toBeNull();
    expect(binRelativePath(undefined, "x")).toBeNull();
  });
});
