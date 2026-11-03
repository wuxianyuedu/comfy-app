/**
 * worktree 落点契约（ISSUE #2935 / AGENTS 硬规则 30 / 规范 §13.6.2）。
 *
 * `git worktree add` 的目标路径只有两个合法落点：仓内 `.worktrees/`（已入
 * `.gitignore`，检出内容不进库）或系统临时目录（`mkdtempSync(join(tmpdir(), …))`）。
 * **唯独不许落 `.git/` 下**：Vite/vitest 的 `server.fs.deny` 默认把 `.git` 整棵子树
 * 挡在模块加载外（glob 形态见下行红话），落在那下面的检出里 DOM 档用例在加载期就被
 * deny，报错是 "Cannot find module" 族、指不到真实原因（#2935 的现场）；且 `.git/`
 * 是 git 自己的簿记目录，不是放工作树的地方。
 *
 * 本文件扫的是别的文件的**文本**（import 图追不到），所以登记在固定结构清单里。
 * 自匹配边界：被禁形状的夹具一律拼接写出（`".gi" + "t"` / `mustGit${"Dir"}`），
 * 否则本文件自己就在扫描面上、会把自己算成命中（同一族的口径见
 * `tests/probe-restore.test.ts` 那段「被禁形状一律拼接写出来」）。
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { stripComments } from "./helpers/strip-comments.ts";

const REPO_ROOT = resolve(process.cwd());

/**
 * 扫描面：会写 `git worktree add` 调用点的代码目录。文档与 `.ps1` 里的散文形态
 * 不在面上（它们没有「调用点」这个形态）；Rust 壳侧没有任何 worktree 调用。
 */
const SCAN_DIRS = ["scripts", "tests", "src", "e2e", "tools"];
const SCAN_EXT = new Set([".ts", ".tsx", ".mjs", ".cjs"]);

/** `worktree add` 调用点的两种书写形态：`execFileSync` 数组形与字符串形。 */
const CALL_SITE = /["']worktree["']\s*,\s*["']add["']|\bworktree\s+add\b/g;

/**
 * 落点表达式里「落到 `.git/` 下」的形状：被引号包住、以 `.git` 为路径分量的串
 * （`".git"` / `".git/wt"` / `".git\\wt"`），或 git 目录解析器
 * （`resolveGitDir` / `mustGitDir` / `gitScratchPath`）—— 把 worktree 建进
 * git 的簿记目录只有这几种写法。相邻正当写法（`.worktrees/`、系统临时目录变量）
 * 一个都不命中，由下面的正控钉住。
 */
const GIT_DIR_SHAPE =
  /["'`][^"'`\n]*\.git(?:[/\\"'`]|$)|\b(?:resolveGitDir|mustGitDir|gitScratchPath)\s*\(/;

/** 取一个调用点所在的语句窗：从命中点到下一个 `;`（或 600 字符封顶）。 */
function windowAt(src: string, at: number): string {
  const end = src.indexOf(";", at);
  return src.slice(at, end === -1 || end - at > 600 ? at + 600 : end + 1);
}

/** 判一个调用点语句窗：落点落到 `.git/` 下（或经 git 目录解析器）即违规。 */
function flagsGitDir(statement: string): boolean {
  return GIT_DIR_SHAPE.test(statement);
}

function codeFiles(dir: string): Array<string> {
  const abs = join(REPO_ROOT, dir);
  if (!existsSync(abs)) {
    return [];
  }
  const out: Array<string> = [];
  for (const ent of readdirSync(abs, { withFileTypes: true })) {
    if (ent.isDirectory()) {
      out.push(...codeFiles(join(dir, ent.name)));
    } else if (ent.isFile() && SCAN_EXT.has(ent.name.slice(ent.name.lastIndexOf(".")))) {
      out.push(join(dir, ent.name).replaceAll("\\", "/"));
    }
  }
  return out;
}

/** 全仓 `worktree add` 调用点：相对路径 + 语句窗（先剥注释 —— 叙述里必然出现这四个字）。 */
function collectCallSites(): Array<{ rel: string; window: string }> {
  const out: Array<{ rel: string; window: string }> = [];
  for (const rel of SCAN_DIRS.flatMap(codeFiles)) {
    const src = stripComments(readFileSync(join(REPO_ROOT, rel), "utf8"));
    for (const match of src.matchAll(CALL_SITE)) {
      out.push({ rel, window: windowAt(src, match.index) });
    }
  }
  return out;
}

describe("worktree 落点契约（#2935 / 硬规则 30）", () => {
  it("全仓 worktree 调用点的落点都不在 `.git/` 下", () => {
    const hits = collectCallSites()
      .filter((site) => flagsGitDir(site.window))
      .map((site) => `  · ${site.rel}`);
    expect(
      hits,
      `这几个 worktree 调用点的落点落在 \`.git/\` 下 —— Vite/vitest 的 \`server.fs.deny\` 默认含 \`**/.git/**\`，落进去的检出里 DOM 档用例在模块加载期就被 deny（#2935 的现场）。出路：落仓内 \`.worktrees/\`（已入 .gitignore）或系统临时目录（\`mkdtempSync(join(tmpdir(), …))\`）：\n${hits.join("\n")}`,
    ).toEqual([]);
  });

  it("负控：落 `.git/` 的三种形状各自命中（字面分量 / 字符串形 / git 目录解析器）", () => {
    const GIT = ".gi" + "t";
    const forbidden = [
      `git(["worktree", "add", join(root, "${GIT}", "wt-x")]);`,
      `git("worktree add ${GIT}/wt-x HEAD");`,
      `git(["worktree", "add", join(${["mustGit", "Dir"].join("")}(root), "probe")]);`,
    ];
    const missed = forbidden.filter((src) => !flagsGitDir(src));
    expect(
      missed,
      "这几条被禁写法扫不出来 —— 判据只在**在场的那些**形状上有效，" +
        "认不出 git 目录解析器就等于把「建到 `.git/` 下」放回来（#2935 的现场）。",
    ).toEqual([]);
  });

  it("正控：`.worktrees/` 与系统临时目录落点不误伤（既有实现就是这么做的）", () => {
    const benign = [
      'git(["worktree", "add", ".worktrees/probe-x", "HEAD"]);',
      'git("worktree add .worktrees/probe HEAD");',
      'git(["worktree", "add", "--detach", candidate, ref]);',
      'git(realRoot, ["worktree", "add", "--detach", dir, "HEAD"]);',
    ];
    const wrong = benign.filter((src) => flagsGitDir(src));
    expect(
      wrong,
      "这几条被误伤了 —— 仓内 `.worktrees/` 与系统临时目录都是合法落点，" +
        "把它们一起拦下会让人绕开判据（口径：临时目录或 `.worktrees/` 均可，唯独不许 `.git/`）。",
    ).toEqual([]);
  });

  /**
   * 在册调用点各自钉一行：只靠「全仓扫一遍」不够 —— 扫描面若悄悄归零（目录改名 /
   * 正则失效），全仓那格照样绿。点名到文件，「扫不到任何东西」本身就红。
   */
  it.for([
    ["scripts/base-check.mjs", "合并前复算的临时快照"],
    ["tests/helpers/probe-worktree.ts", "探针隔离的一次性克隆"],
  ] as const)("%s 的 worktree 调用点在场且过契约（%s）", ([rel, what]) => {
    const sites = collectCallSites().filter((site) => site.rel === rel);
    expect(sites.length, `${rel} 的 worktree 调用点扫不到了 —— 扫描面是不是归零了`).toBeGreaterThan(0);
    expect(
      sites.filter((site) => flagsGitDir(site.window)),
      `${rel} 的${what}落到 \`.git/\` 下了`,
    ).toEqual([]);
  });
});
