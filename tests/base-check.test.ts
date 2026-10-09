/**
 * 「被门禁拦下先复算 master 基线」的执行者（规范 §13.6.2 第 1 步）的契约测试。
 *
 * 判据本体 `scripts/base-check.mjs` 是**纯读事实**的那一半：把你被拦住的那条判据
 * 在干净的上游提交上再跑一遍，给出 `baseline-red` / `yours` / `current-green` /
 * `inconclusive` 四态之一。它不替你决定「挡不挡路」、不自动登记、不改判据。
 *
 * 为什么在**真 git 仓库**上跑（不用 mock）：判据依赖三件真事实 —— HEAD 是检出、
 * 上游引用能解析、`git worktree add` 出一个干净快照。内存里假装这三件事，恰好等于
 * 把「复算」这件事重新实现一遍（而它唯一的失效形态正是「假装干净」）。
 *
 * 覆盖：① 三态的判决（纯函数，两向各一组）；② 命令解析（钩子标签 / 裸脚本名 /
 * 完整命令 / 标签歧义）；③ **`inconclusive` 那条边界** —— 只存在未提交改动里的
 * 判据在基线侧 `MODULE_NOT_FOUND`，退出码与「跑了且红」同形（Node 是 1），
 * 所以「跑不起来」必须由**目标存不存在**判，不能由退出码判（实测踩过）。
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";

import { describe, expect, test } from "vitest";
import {
  commandTargetState,
  isGitCheckout,
  judge,
  nextSteps,
  normalizeRun,
  readHookSteps,
  resolveGateCommand,
  resolveUpstreamRef,
  tokenize,
} from "../scripts/base-check.mjs";

/* 每条用例都要真起 git 进程（init / commit / worktree add / 跑一次被判的判据），
 * 负载高的机器上 5s 不够 —— 文件级放宽到 30s，只影响本文件。 */
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const REPO_ROOT = process.cwd();
const SCRIPT = join(REPO_ROOT, "scripts", "base-check.mjs");

/** 在给定目录跑一条 git 命令。 */
function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

/**
 * 跑一次被测脚本 —— **带一次重试**。
 *
 * 为什么需要：C 组与 A（tsc）/ B（eslint）/ D（48 个判据脚本）**并行**跑
 * （钩子里 `--maxWorkers=4`），而在最冷的那一次（`pnpm install` 刚重建完
 * eslint 缓存、48 个脚本同时冷启）实测撞到过 `main()` 的早退：退出码 1、
 * **stdout 为空**。这不是被测行为 —— 它在本文件单跑、以及 16 路并发压测下
 * 都复现不出来，形态是「环境把一次 `git` 调用搞没了」。
 *
 * 所以这里对**整体失败**重试一次（不是放宽断言）：两次都失败才判红，
 * 而每次的取数都由真 git / 真子进程给出，判据的语义一字未变。
 * 这与本仓库「环境噪声收进夹具、不留给第十六个人再踩一次」的口径同源
 * （§11.16.1 的 `chmodSync` 那条就是这个理由）。
 *
 * @param {string} cwd
 * @param {string[]} args
 * @returns {{code: number, stdout: string, stderr: string}}
 */
function runBaseCheckOnce(cwd: string, args: string[]): {
  code: number;
  stdout: string;
  stderr: string;
} {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stdout, stderr: "" };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return {
      code: e.status ?? -1,
      stdout: String(e.stdout ?? ""),
      stderr: String(e.stderr ?? ""),
    };
  }
}

/**
 * 造一个「有上游基线」的临时仓库（含一个**裸远端**）：
 *
 *   <bare>/master      ← 基线（只有 seed.txt 与那条判据脚本）
 *   <work>/feat        ← 「你的检出」，跟踪远端 master，且多一个 marker 文件让判据红
 *
 * 为什么要一个**真远端**而不是手写一条 `refs/remotes/…`：`resolveUpstreamRef()`
 * 的首选是 `@{u}`（当前分支的上游），而它只有在分支真跟踪某个远端时才解析得出。
 * 手写引用只能覆盖候选顺序的后半段，恰好绕开了最常走的那一条。
 */
function makeRepo(
  opts: { markerOnBase?: boolean } = {},
): { work: string; bare: string } {
  const bare = mkdtempSync(join(tmpdir(), "base-check-bare-"));
  git(bare, "init", "-q", "--bare", "-b", "master", ".");
  const work = mkdtempSync(join(tmpdir(), "base-check-gate-"));
  git(work, "init", "-q", "-b", "master", ".");
  git(work, "config", "user.email", "gate@example.com");
  git(work, "config", "user.name", "gate");
  git(work, "config", "commit.gpgsign", "false");
  git(work, "remote", "add", "up", bare);
  /* 被判的判据：**只在 marker 文件存在时红**。这样同一个脚本在基线上是绿的、
   * 在你的检出上是红的 —— 正是 `yours` 那一态要的形状。 */
  writeFileSync(
    join(work, "gate.cjs"),
    [
      'const fs = require("node:fs");',
      'const has = fs.existsSync("marker.txt");',
      'process.stdout.write(has ? "[gate] 命中\\n" : "[gate] 干净\\n");',
      "process.exit(has ? 1 : 0);",
      "",
    ].join("\n"),
  );
  writeFileSync(join(work, "seed.txt"), "seed\n");
  /* 「违规已经落进主干」那一档：基线上就带着 marker ⇒ 两侧都红。 */
  if (opts.markerOnBase) writeFileSync(join(work, "marker.txt"), "x\n");
  git(work, "add", ".");
  git(work, "commit", "-qm", "chore: seed");
  git(work, "push", "-q", "up", "master");
  /* 净检出：baseline = 远端 master，然后切一条跟踪它的特性分支。 */
  git(work, "checkout", "-q", "-b", "feat", "up/master");
  if (opts.markerOnBase) {
    /* 基线上已经有 marker：这一支只是「无关改动」，两侧都红。 */
    writeFileSync(join(work, "unrelated.txt"), "y\n");
    git(work, "add", ".");
    git(work, "commit", "-qm", "feat: unrelated");
  } else {
    writeFileSync(join(work, "marker.txt"), "x\n");
    git(work, "add", ".");
    git(work, "commit", "-qm", "feat: marker");
  }
  return { work, bare };
}

/** 清掉一对（work + bare）临时目录。 */
function dropRepo(r: { work: string; bare: string }): void {
  rmSync(r.work, { recursive: true, force: true });
  rmSync(r.bare, { recursive: true, force: true });
}

/**
 * 跑一次 base-check，返回 `{ code, stdout, stderr }`。
 *
 * 「复算过程本身失败」由退出码表达（脚本自己把「判据红了」编码进**输出**、退 0），
 * 所以这里只在**判据真的红了**时才可能拿到非 0 —— 而「脚本根本没跑起来」
 * （退出码非 0 **且** 两路输出都空）是环境噪声，重试一次（见 `runBaseCheckOnce`）。
 */
function runBaseCheck(
  cwd: string,
  args: string[],
): { code: number; stdout: string; stderr: string } {
  const first = runBaseCheckOnce(cwd, args);
  if (first.code === 0 || first.stdout || first.stderr) return first;
  return runBaseCheckOnce(cwd, args);
}

describe("base-check —— judge() 四态（纯函数，两向各一组）", () => {
  test("本检出红 + 基线红 ⇒ baseline-red（别线的红）", () => {
    expect(judge({ currentCode: 1, baseCode: 1 })).toBe("baseline-red");
  });

  test("本检出红 + 基线绿 ⇒ yours（你的改动引入的）", () => {
    expect(judge({ currentCode: 1, baseCode: 0 })).toBe("yours");
  });

  test("本检出绿 ⇒ current-green（无从复算）", () => {
    expect(judge({ currentCode: 0, baseCode: 1 })).toBe("current-green");
  });

  test("任一侧 127（没跑起来）⇒ inconclusive，不报成「别线的红」", () => {
    expect(judge({ currentCode: 1, baseCode: 127 })).toBe("inconclusive");
    expect(judge({ currentCode: 127, baseCode: 0 })).toBe("inconclusive");
  });

  test("每一态都答得出「下一步做什么」（答不出 = 判据没有出口）", () => {
    for (const verdict of [
      "current-green",
      "baseline-red",
      "yours",
      "inconclusive",
    ] as const) {
      const steps = nextSteps(verdict, { ref: "origin/master" });
      expect(steps.length).toBeGreaterThan(0);
      expect(steps.join("\n")).not.toMatch(/undefined/);
    }
  });
});

describe("base-check —— 命令解析", () => {
  test("裸脚本名补 node", () => {
    const r = resolveGateCommand(["scripts/check-ui-primitives.cjs"]);
    expect(r).toMatchObject({ ok: true, argv: ["node", "scripts/check-ui-primitives.cjs"] });
  });

  test("完整命令原样透传", () => {
    const r = resolveGateCommand(["pnpm", "exec", "vitest", "run", "tests/x.test.ts"]);
    expect(r).toMatchObject({
      ok: true,
      argv: ["pnpm", "exec", "vitest", "run", "tests/x.test.ts"],
    });
  });

  test("钩子标签唯一命中 ⇒ 命令从钩子里取，不抄第二份", () => {
    const steps = readHookSteps();
    expect(steps.length).toBeGreaterThan(20);
    const label = steps[0]!.label;
    const r = resolveGateCommand([label]);
    expect(r.ok).toBe(true);
    expect(r).toMatchObject({ label });
    expect(r.ok && r.argv.length).toBeGreaterThan(0);
  });

  test("标签不存在 ⇒ 判失败并列出候选（不许猜）", () => {
    const r = resolveGateCommand(["这个标签不存在"]);
    expect(r.ok).toBe(false);
    expect(String((r as { error: string }).error)).toContain("可用");
  });

  test("没给命令 ⇒ 判失败", () => {
    expect(resolveGateCommand([]).ok).toBe(false);
  });

  test("分词尊重引号、剥掉行内注释", () => {
    expect(tokenize('node a.cjs --skip "两个 词"')).toEqual([
      "node",
      "a.cjs",
      "--skip",
      "两个 词",
    ]);
    const steps = readHookSteps();
    /* 钩子里的步骤没有带 `#` 的行内注释残留 —— 否则 argv 里会出现一个 `#` 开头的词。 */
    for (const s of steps) {
      expect(s.argv.some((a) => a.startsWith("#"))).toBe(false);
    }
  });
});

describe("base-check —— 目标存在性（127 那条边界）", () => {
  test("相对脚本不存在 ⇒ missing（而不是让它静默退出 1）", () => {
    const state = commandTargetState(
      ["node", "绝对不存在.cjs"],
      REPO_ROOT,
    );
    expect(state.kind).toBe("missing");
  });

  test("存在的脚本 ⇒ ok", () => {
    const state = commandTargetState(
      ["node", "scripts/base-check.mjs"],
      REPO_ROOT,
    );
    expect(state.kind).toBe("ok");
  });

  test("非 node 命令 ⇒ unknown（交给它自己报错）", () => {
    expect(commandTargetState(["pnpm", "exec", "vitest"], REPO_ROOT).kind).toBe(
      "unknown",
    );
    expect(commandTargetState(["node", "--version"], REPO_ROOT).kind).toBe(
      "unknown",
    );
  });

  test("normalizeRun 把 spawn error 归成 127", () => {
    const fake = {
      error: new Error("ENOENT"),
      status: null,
      stdout: "",
      stderr: "",
    } as unknown as Parameters<typeof normalizeRun>[0];
    expect(normalizeRun(fake).code).toBe(127);
  });
});

describe("base-check —— 真仓库上的四态", () => {
  test("本检出红 / 基线绿 ⇒ yours，且给出上游提交号", () => {
    const r = makeRepo();
    try {
      const { code, stdout, stderr } = runBaseCheck(r.work, ["node", "gate.cjs"]);
      expect(code, `stderr=${stderr}`).toBe(0);
      expect(stdout).toContain("yours");
      /* 基线引用由 `@{u}` 解析出来 —— 结论里要点名是**哪一条**基线。 */
      expect(stdout).toMatch(/up\/master/);
      /* 结论里必须给出「是你的红」的动作，而不是「登记 KNOWN_FAILED_FILES」。 */
      expect(stdout).toContain("你的改动");
    } finally {
      dropRepo(r);
    }
  });

  test("基线也红 ⇒ baseline-red，并给出碎片要写的那句事实", () => {
    /* 「违规已经落进主干」的形状：基线上就带着 marker，你这一支只是无关改动，
     * 却照样被同一条硬闸拦住 —— 正是 §13.6.2 立案的那个场景。 */
    const r = makeRepo({ markerOnBase: true });
    try {
      const { stdout, stderr } = runBaseCheck(r.work, ["node", "gate.cjs"]);
      expect(stdout, `stderr=${stderr}`).toContain("baseline-red");
      expect(stdout).toContain("别线的红");
      /* 处置口径逐字来自 §13.6.2，不在这里发明新话术。 */
      expect(stdout).toContain("changelog.d");
    } finally {
      dropRepo(r);
    }
  });

  test("本检出绿 ⇒ current-green，且不建 worktree", () => {
    const r = makeRepo();
    try {
      /* 把 marker 删了 —— 判据在两侧都绿。 */
      rmSync(join(r.work, "marker.txt"));
      const before = git(r.work, "worktree", "list").split("\n").filter(Boolean).length;
      const { stdout } = runBaseCheck(r.work, ["node", "gate.cjs"]);
      const after = git(r.work, "worktree", "list").split("\n").filter(Boolean).length;
      expect(stdout).toContain("current-green");
      expect(after).toBe(before);
    } finally {
      dropRepo(r);
    }
  });

  test("临时 worktree 跑完就删（不许留在上级目录里）", () => {
    const r = makeRepo();
    try {
      const { stdout, stderr } = runBaseCheck(r.work, ["node", "gate.cjs"]);
      expect(stdout, `stderr=${stderr}`).toContain("yours");
      const list = git(r.work, "worktree", "list");
      expect(list.trim().split("\n")).toHaveLength(1);
    } finally {
      dropRepo(r);
    }
  });

  test("上游引用取不到 ⇒ 复算失败（退出 1），不静默拿一个错的基", () => {
    /* 分支名不是 `master`、也没有任何远端 / 上游 —— 三种候选全落空。 */
    const dir = mkdtempSync(join(tmpdir(), "base-check-noup-"));
    try {
      git(dir, "init", "-q", "-b", "work", ".");
      git(dir, "config", "user.email", "gate@example.com");
      git(dir, "config", "user.name", "gate");
      git(dir, "config", "commit.gpgsign", "false");
      writeFileSync(join(dir, "a.txt"), "a\n");
      git(dir, "add", ".");
      git(dir, "commit", "-qm", "chore: seed");
      expect(resolveUpstreamRef(dir)).toBeNull();
      const { code, stderr } = runBaseCheck(dir, ["node", "gate.cjs"]);
      expect(code).toBe(1);
      expect(stderr).toContain("上游");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("取不到上游时 resolveUpstreamRef 若能看到本地 master 也应认得它", () => {
    /* 本仓库自己的检出就满足这条（`@{u}` 或某 remote 的 master 至少有一个可解析）。 */
    expect(isGitCheckout(REPO_ROOT)).toBe(true);
    expect(typeof resolveUpstreamRef(REPO_ROOT)).toBe("string");
  });
});
