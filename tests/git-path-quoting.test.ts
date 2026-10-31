/**
 * 「读 git 路径」必须拿到**原样路径**（ISSUE #2272）。
 *
 * ## 它守的是什么
 *
 * git 输出**含非 ASCII 字符**的路径时，默认（`core.quotePath=true`，git 的默认值）
 * 按 C 风格转义并**加引号** —— 实测输出是
 * `M\t"docs/standards/15-\351\231\204\345\275\225.md"`。本仓**38 份被跟踪文件的
 * 文件名带非 ASCII**（全在 `docs/` 下）⇒ 不关掉它，判决面里那一条就与真实路径对不上。
 *
 * ## 为什么这一族必须写成「机器之间不许有差别」
 *
 * 机器之间**本来就有差别**：本机全局配了 `core.quotepath=false`，而 CI runner 的 git
 * 是**全默认**（runner 检出后只 `git config --local` 配了身份与凭据，一条
 * `core.quotePath` 都没有 ⇒ 它的宿主**没有**全局 `.gitconfig`）。
 *
 * ⇒ 同一份代码，本机绿、平台红，而**红的那条读数完全正常**（"OK：本次没有……"）——
 * 这正是 ISSUE #2272 的现场（PR #2270 的「受影响用例」在平台上红 1 条，本机全绿）。
 *
 * 所以本文件的用例**不许依赖宿主机的 git 配置**：它们**强制** `core.quotePath=true`
 * （git 的默认值，也是 runner 的形态）再跑一遍 —— 复现靠配置，不靠「这台机器恰好
 * 配了什么」。
 *
 * ## 三条口径
 *
 *   ① **改动面**（`scripts/changed-scope.mjs`）——「受影响用例」选例、重档静态判据的
 *      按面收窄、`check-doc-mirror-pairing.cjs --base` 的判决面，全走它。
 *   ② **暂存面**（`scripts/gate-scan-read.cjs` 的 `readStagedPaths()`）——`--staged` 族
 *      门禁的「没命中扫描面就跳过」用它；路径被转义过 ⇒ **判据在场却没跑**。
 *   ③ **静态**：凡是读 git 路径的调用，必须带 `-c core.quotePath=false`（或 `-z`，
 *      NUL 分隔那一族天然不加引号）；豁免逐条登记并写明理由。
 */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { changedFilesForBaseRef } from "../scripts/changed-scope.mjs";
import { readStagedPaths } from "../scripts/gate-scan-read.cjs";
import { gitSandboxEnv } from "./helpers/git-sandbox-env";
import { stripComments } from "./helpers/strip-comments";

const ROOT = path.resolve(import.meta.dirname, "..");

/** 本仓带非 ASCII 文件名的那一份（`docs/standards/` 下有 21 份中文名规范文档）。 */
const CN_SOURCE = "docs/standards/15-附录.md";
const CN_TWIN = "docs/generated/15-附录.md";

/**
 * 强制 git 走**默认**那套路径转义（`core.quotePath=true`）。
 *
 * 用 git 自己的 `GIT_CONFIG_COUNT` 机制注入：**它压得住全局 `.gitconfig`**，而
 * `git -c`（我们给的守卫）**又压得住它** —— 两层都验过（实测输出见文件头）。
 */
function forceGitQuotePath(on: boolean): void {
  if (!on) {
    delete process.env.GIT_CONFIG_COUNT;
    delete process.env.GIT_CONFIG_KEY_0;
    delete process.env.GIT_CONFIG_VALUE_0;
    return;
  }
  process.env.GIT_CONFIG_COUNT = "1";
  process.env.GIT_CONFIG_KEY_0 = "core.quotepath";
  process.env.GIT_CONFIG_VALUE_0 = "true";
}

/** 临时仓：一份中文名的文档源 + 它的镜像。 */
function makeRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "git-path-quoting-"));
  const git = (...args: Array<string>) =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8", env: gitSandboxEnv() });
  git("init", "-q");
  mkdirSync(path.join(dir, "docs", "standards"), { recursive: true });
  mkdirSync(path.join(dir, "docs", "generated"), { recursive: true });
  writeFileSync(path.join(dir, CN_SOURCE), "# 附录\n\n正文。\n", "utf8");
  writeFileSync(path.join(dir, CN_TWIN), "# 附录\n\n正文。\n", "utf8");
  git("add", "--", ".");
  git("commit", "-q", "-m", "基线");
  return dir;
}

describe("改动面：机器把非 ASCII 路径转义加引号时仍给出原样路径", () => {
  let dir = "";

  beforeEach(() => {
    forceGitQuotePath(true);
    dir = makeRepo();
  });

  afterEach(() => {
    forceGitQuotePath(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it("相对基线改了什么 ⇒ 那条中文路径原样回来", () => {
    writeFileSync(path.join(dir, CN_SOURCE), "# 附录\n\n改了正文。\n", "utf8");
    execFileSync("git", ["add", "--", "."], {
      cwd: dir,
      encoding: "utf8",
      env: gitSandboxEnv(),
    });
    execFileSync("git", ["commit", "-q", "-m", "改了源"], {
      cwd: dir,
      encoding: "utf8",
      env: gitSandboxEnv(),
    });

    const got = changedFilesForBaseRef("HEAD~1", { cwd: dir });
    expect(got.ok, JSON.stringify(got)).toBe(true);
    if (!got.ok) {
      return;
    }
    /* 转义过的形态是 `"docs/standards/15-\351\231\204\345\275\225.md"` —— 它与真实路径
     * 对不上，于是「改了文档源、镜像没同批带上」在平台上永远判不出来。 */
    expect(got.files).toContain(CN_SOURCE);
    expect(got.files.some((f) => f.includes("\\"))).toBe(false);
  });
});

describe("暂存面：同一台机器上暂存清单也要原样", () => {
  let dir = "";

  beforeEach(() => {
    forceGitQuotePath(true);
    dir = makeRepo();
  });

  afterEach(() => {
    forceGitQuotePath(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it("暂存清单里的中文路径原样回来（`skipUnlessStagedTouches` 靠它比扫描根）", () => {
    writeFileSync(path.join(dir, CN_SOURCE), "# 附录\n\n改了正文。\n", "utf8");
    execFileSync("git", ["add", "--", "."], {
      cwd: dir,
      encoding: "utf8",
      env: gitSandboxEnv(),
    });

    const staged = readStagedPaths(dir);
    expect(staged).toContain(CN_SOURCE);
  });
});

/* ── 静态：读 git 路径的调用必须带守卫（防复发）───────────────────────────────── */

/** 会输出**路径**的 git 旗标（`-z` 那一族天然不加引号，见下）。 */
const PATH_FLAG_TOKENS = /* SAFETY: 类型断言已复核 */ [
  "--name-only",
  "--name-status",
  "ls-files",
  "--porcelain",
  "ls-tree",
] as const;

/**
 * 豁免登记：**每一条都要写清为什么这一处不需要守卫**。
 *
 * 登记项是「文件 + 处数」的粒度（与条件性 skip 那套登记同型）：处数对不上就红 ——
 * 偷偷多一处没登记会红，登记了却已经修好也要红（豁免是负债，不是赦免名单）。
 */
const EXEMPT: Array<{ count: number; file: string; why: string }> = [
  {
    file: "scripts/check-known-failed-stale.mjs",
    count: 1,
    why:
      "那一处是 `git ls-files --error-unmatch -- <路径>`：**只看退出码**（这个路径被跟踪吗），" +
      "不读输出 ⇒ 路径被不被转义与判断无关。",
  },
];

/** 一个数组字面量里是不是带了守卫（`-z` 或 `core.quotePath=false`）。 */
function hasGuard(slice: string): boolean {
  return slice.includes("core.quotePath=false") || /["']-z["']/.test(slice);
}

/**
 * 找出「读 git 路径」的调用点：数组字面量里有那个旗标、而数组里**没有**守卫。
 *
 * 取「**最内层**的数组」：`["-c", "core.quotePath=false", "diff", "--name-only", …]`
 * 这种形态里，旗标与守卫必须在**同一个**数组里 —— 而外层那个数组（`attempts = [ … ]`）
 * 装着好几条命令，不该替其中一条背书。
 */
function unguardedSites(source: string): Array<string> {
  const out: Array<string> = [];
  for (const token of PATH_FLAG_TOKENS) {
    const needle = `"${token}"`;
    let at = source.indexOf(needle);
    while (at !== -1) {
      /* 最内层数组：往前找最近的 `[`，往后找最近的 `]`。 */
      const open = source.lastIndexOf("[", at);
      const close = source.indexOf("]", at);
      const slice = open !== -1 && close !== -1 ? source.slice(open, close + 1) : "";
      if (!hasGuard(slice)) {
        const line = source.slice(0, at).split("\n").length;
        out.push(`${line}: ${source.split("\n")[line - 1]?.trim() ?? ""}`);
      }
      at = source.indexOf(needle, at + needle.length);
    }
  }
  return out;
}

/** `scripts/**` 下的源码文件清单（跳过依赖与产物）。 */
function scriptFiles(dir: string, found: Array<string> = []): Array<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".git", ".next", "target", "dist", "build"].includes(entry.name)) {
      continue;
    }
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scriptFiles(abs, found);
    } else if (/\.(mjs|cjs|js)$/.test(entry.name)) {
      found.push(abs);
    }
  }
  return found;
}

describe("静态：读 git 路径的调用必须带守卫（防复发）", () => {
  it("每一处读路径的 git 调用都带 `-c core.quotePath=false` 或 `-z`", () => {
    const problems: Array<string> = [];
    for (const abs of scriptFiles(path.join(ROOT, "scripts"))) {
      const rel = path.relative(ROOT, abs).split(path.sep).join("/");
      const exempt = EXEMPT.find((e) => e.file === rel);
      /* 剥注释再扫：注释里正当会出现 `--name-only` 这类字样（那是散文，不是调用）。 */
      const source = stripComments(readFileSync(abs, "utf8"));
      const bad = unguardedSites(source);
      if (bad.length === 0) {
        continue;
      }
      if (exempt) {
        /* 豁免只覆盖**登记的那几处**：多出来的调用仍然要拦。 */
        if (bad.length !== exempt.count) {
          problems.push(`${rel}：豁免登记 ${exempt.count} 处，实测 ${bad.length} 处 —— 对不上`);
        }
        continue;
      }
      problems.push(`${rel}：${bad.join(" / ")}`);
    }
    expect(
      problems,
      "读 git 路径的调用必须带 `-c core.quotePath=false`（或 `-z`）；" +
        "豁免要登记在 EXEMPT 里并写清理由（ISSUE #2272）",
    ).toEqual([]);
  });

  it("豁免登记里不许有失效的旧账（那一处已经带上守卫了就撤掉）", () => {
    const stale: Array<string> = [];
    for (const e of EXEMPT) {
      const abs = path.join(ROOT, e.file);
      if (!existsSync(abs)) {
        stale.push(`${e.file}：文件不在了`);
        continue;
      }
      const source = stripComments(readFileSync(abs, "utf8"));
      const bad = unguardedSites(source).length;
      if (bad !== e.count) {
        stale.push(`${e.file}：登记 ${e.count} 处，实测 ${bad} 处 —— 该改登记或该撤豁免`);
      }
    }
    expect(stale).toEqual([]);
  });

  it("豁免的理由不许是空话（写清「为什么这一处不需要」）", () => {
    for (const e of EXEMPT) {
      expect(e.why.trim().length, `${e.file} 的豁免理由太短`).toBeGreaterThan(10);
      expect(e.count, `${e.file} 的豁免处数不合法`).toBeGreaterThan(0);
    }
  });
});
