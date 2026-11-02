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
 * 完整命令 / 标签歧义）；③ **`inconclusive` 的三条入口** —— 只存在未提交改动里的
 * 判据在基线侧 `MODULE_NOT_FOUND`，退出码与「跑了且红」同形（Node 是 1），
 * 所以「跑不起来」必须由**目标存不存在**判，不能由退出码判（实测踩过）；
 * 另一条是**一条用例都没收集到**（`Tests  no tests` / `Cannot find package`，
 * ISSUE #1652）—— 它同样是退出码 1，而「目标存不存在」看不见它（目标在、是它
 * 运行时的依赖链断了），所以这一族必须由**输出指纹**判，且两向都要钉住
 * （真红 `1 failed / 3 failed tests` 不许被吞成 `inconclusive`）。
 * 第三条是**判据自己退 2**（ISSUE #2791）：三态口径里那是「这一跳没有结论」，
 * 而它与 1 只差一个码位 —— 过去同权，于是「什么都没判」被报成「别线的红」。
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi, describe, expect, test } from "vitest";

import { gitSandboxEnv } from "./helpers/git-sandbox-env";
import {
  commandTargetState,
  didNotRunSide,
  groupSteps,
  isDidNotRunShaped,
  isTimeoutShaped,
  judge,
  mayDecideOnCleanSnapshot,
  nextSteps,
  nextStepsMany,
  normalizeRun,
  readHookSteps,
  resolveAttributionRef,
  resolveGateCommand,
  resolveMergeBaseRef,
  resolveMergeBatch,
  resolveUpstreamRef,
  runState,
  summarizeRows,
  tokenize,
} from "../scripts/base-check.mjs";

/* 每条用例都要真起 git 进程（init / commit / worktree add / 跑一次被判的判据），
 * 负载高的机器上会比「内存里翻转状态」那类慢一个量级 —— 本文件实测单条最慢约 4.9s
 * （load ≈65 下），所以给它自己的 hook 预算收到 30s（全局 hookTimeout 是 45s，
 * 那是给 `theme` 那种「真编一遍 CSS」的 beforeAll 留的，本文件用不满）。
 *
 * ⚠️ `testTimeout` 这里**不写**：全局已经是 30_000（`vitest.config.ts`），
 * 再写一遍是同值的死代码 —— 而它上一版就长这样，注释还写着「5s 不够」，
 * 读起来像「本条把预算放宽了」，实际一个字都没改（口径同 §11.13：
 * 要写就把**为什么是这个数**写出来，别留一条不生效的声明）。 */
vi.setConfig({ hookTimeout: 30_000 });

const REPO_ROOT = process.cwd();
const SCRIPT = join(REPO_ROOT, "scripts", "base-check.mjs");

/** 在给定目录跑一条 git 命令。
 * @param cwd 工作目录
 * @param args git 的子命令与参数
 * @returns stdout */
function git(cwd: string, ...args: Array<string>): string {
  /* 走 `gitSandboxEnv()`：本文件的夹具仓库里 `git add` 几十次，而宿主若开着
   * `core.autocrlf=true`，每一次都往 stderr 打一行 `LF will be replaced by CRLF`
   * —— 那批噪音会盖满 CI 日志，且与任何判据结论无关（见 `git-sandbox-env.ts` 文件头）。 */
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: gitSandboxEnv(),
  });
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
function runBaseCheckOnce(
  cwd: string,
  args: Array<string>,
): {
  code: number;
  stderr: string;
  stdout: string;
} {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stdout, stderr: "" };
  } catch (error) {
    /* SAFETY: 类型断言已复核 */
    const e = error as {
      status?: number;
      stderr?: string;
      stdout?: string;
    };
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
function makeRepo(opts: { markerOnBase?: boolean; noTestsOnBase?: boolean } = {}): {
  bare: string;
  work: string;
} {
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
      String.raw`process.stdout.write(has ? "[gate] 命中\n" : "[gate] 干净\n");`,
      "process.exit(has ? 1 : 0);",
      "",
    ].join("\n"),
  );
  writeFileSync(join(work, "seed.txt"), "seed\n");
  /* 「违规已经落进主干」那一档：基线上就带着 marker ⇒ 两侧都红。 */
  if (opts.markerOnBase) {
    writeFileSync(join(work, "marker.txt"), "x\n");
  }
  /* 「基线侧一条用例都没收集到」那一档（ISSUE #1652）：判据脚本在**基线之后**被
   * 改成会收集用例的形态，于是基线那一版的 `node gate.cjs` 打印一段
   * vitest 形态的 `Tests  no tests` 并退 **1** —— 与「判据跑了且红」逐字同形。 */
  if (opts.noTestsOnBase) {
    writeFileSync(
      join(work, "gate.cjs"),
      [
        String.raw`process.stdout.write("Test Files  1 failed (1)\n     Tests  no tests\n");`,
        "process.exit(1);",
        "",
      ].join("\n"),
    );
  }
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
  if (opts.noTestsOnBase) {
    /* 本检出这一版的判据**真跑**（收集到用例、断言真红）：基线那版收集不到、
     * 这一版真红 ⇒ 两侧退出码同为 1，只有输出分得开。 */
    writeFileSync(
      join(work, "gate.cjs"),
      [
        String.raw`process.stdout.write("Test Files  1 failed (1)\n     Tests  1 failed (1)\n");`,
        String.raw`process.stdout.write("[gate] 真红\n");`,
        "process.exit(1);",
        "",
      ].join("\n"),
    );
    git(work, "add", ".");
    git(work, "commit", "-qm", "fix(gate): 用真断言代替收集失败");
  }
  return { work, bare };
}

/** 清掉一对（work + bare）临时目录。 */
function dropRepo(r: { bare: string; work: string }): void {
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
  args: Array<string>,
): { code: number; stderr: string; stdout: string } {
  const first = runBaseCheckOnce(cwd, args);
  if (first.code === 0 || first.stdout || first.stderr) {
    return first;
  }
  return runBaseCheckOnce(cwd, args);
}

describe("base-check —— judge() 判决（纯函数，两向各一组）", () => {
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
    /* SAFETY: 类型断言已复核 */
    for (const verdict of [
      "current-green",
      "baseline-red",
      "yours",
      "inconclusive",
      "load-flake",
    ] as const) {
      const steps = nextSteps(verdict, { ref: "origin/master" });
      expect(steps.length).toBeGreaterThan(0);
      expect(steps.join("\n")).not.toMatch(/undefined/);
    }
  });
});

/* ── inconclusive 的第二条入口：一条用例都没收集到（ISSUE #1652）──────
 *
 * 现场（真事）：被 C 组拦下一条 `tests/check-a11y-rules.test.ts` 的 30s 超时，
 * 按 §13.6.4 去复算，第一次报 `inconclusive`（两侧 127），第二次却报了
 * `baseline-red`（「别线的红」）—— 依据是基线那一侧这段输出：
 *
 *     FAIL  node  tests/check-a11y-rules.test.ts
 *       `Cannot find package '@adobe/css-tools'`（在 jest-dom 的 matchers-*.mjs 上）
 *     Test Files  1 failed (1)
 *          Tests  no tests     ← 这个「收集到 0 条」的读数就是指纹
 *
 * 注意最后两行：**一个用例都没收集到**。这不是「判据跑了且红」，是**跑不起来**，
 * 而它退的是 1（vitest 收集失败），与「跑了且红」逐字同形；`commandTargetState`
 * 那条静态判据也看不见它（目标文件在，是它运行时的依赖链断了）。
 *
 * 走错这一档的代价不是「结论难看」，是**下一动作相反**：`baseline-red` 要人去就地修
 * 或按 §11.12 登记 `KNOWN_FAILED_FILES`，而这次根本没有「一条有主的账」可登 ——
 * 下一次它不红，从此没人解释得清它为什么在那儿（同 §13.6.4 反对把负载假红读成
 * `baseline-red` 的理由，只是换了触发原因）。
 */
describe("base-check —— 没收集到用例：inconclusive 的第二条入口", () => {
  /* 基线那一侧的真实现场（原文形态，不是构造的）。 */
  const NO_TESTS = [
    "FAIL  node  tests/check-a11y-rules.test.ts [ tests/check-a11y-rules.test.ts ]",
    "Error: Cannot find package '@adobe/css-tools' imported from",
    "  /tmp/x/node_modules/.pnpm/@testing-library+jest-dom@7/node_modules/@testing-library/jest-dom/dist/matchers-abc.mjs",
    "Test Files  1 failed (1)",
    "     Tests  no tests",
  ].join("\n");
  /* 真红：收集到了用例、断言挂了 —— 这一族**必须**仍是 `baseline-red`。 */
  const REAL_RED = [
    "FAIL  node  tests/check-a11y-rules.test.ts > 台账双向",
    "AssertionError: expected 3 to be 4",
    "Test Files  1 failed (1)",
    "     Tests  3 failed | 5 passed (8)",
  ].join("\n");

  test("基线侧「1 failed / no tests」⇒ inconclusive（不是 baseline-red）", () => {
    expect(
      judge({
        currentCode: 1,
        baseCode: 1,
        currentOutput: "AssertionError: 我这条真红",
        baseOutput: NO_TESTS,
      }),
    ).toBe("inconclusive");
  });

  test("本检出那一侧收集不到 ⇒ 同样 inconclusive（这时问的不是「谁的红」）", () => {
    expect(
      judge({
        currentCode: 1,
        baseCode: 1,
        currentOutput: NO_TESTS,
        baseOutput: REAL_RED,
      }),
    ).toBe("inconclusive");
  });

  test("真红不吞：收集到了用例的那一侧仍判 baseline-red（假阳性闸）", () => {
    expect(
      judge({
        currentCode: 1,
        baseCode: 1,
        currentOutput: REAL_RED,
        baseOutput: REAL_RED,
      }),
    ).toBe("baseline-red");
    expect(isDidNotRunShaped(REAL_RED)).toBe(false);
  });

  test("runState 把四种形态分开，且指纹优先于退出码", () => {
    expect(runState({ code: 1, output: NO_TESTS })).toBe("did-not-run");
    expect(runState({ code: 0, output: "Tests  8 passed" })).toBe("ran");
    expect(runState({ code: 1, output: REAL_RED })).toBe("ran");
    expect(runState({ code: 127, output: "" })).toBe("did-not-run");
    expect(runState({ code: 7, output: "看不懂的输出" })).toBe("unknown");
    /* 退 **2** = 判据跑了、但它自己答「这一跳没有结论」（本仓三态口径）。
     * 它必须与 `ran` 分开：与 1 同权过一次，于是被读成 `baseline-red`（ISSUE #2791）。 */
    expect(runState({ code: 2, output: "× 这一跑的前提不成立" })).toBe("no-conclusion");
    /* 判序仍是「指纹优先于退出码」：一条用例都没收集到且退 2 时，说的是**那一种**形态，
     * 不是"它声明没有结论"—— 两者的下一动作不同（前者修命令，后者清前置）。 */
    expect(runState({ code: 2, output: NO_TESTS })).toBe("did-not-run");
  });

  test("指纹表认的是真见到的原文，不含「跑了且红」的形态", () => {
    for (const sample of [
      "Tests  no tests",
      "Test Files  1 failed (1)\n     Tests  no tests",
      "Error: Cannot find package 'x' imported from y",
      "Cannot find module 'z'",
      "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'a'",
      "Error: Cannot find module 'b'\nRequire stack:\n- /tmp/c.js\n code: 'MODULE_NOT_FOUND'",
    ]) {
      expect(isDidNotRunShaped(sample), sample).toBe(true);
    }
    for (const sample of [
      REAL_RED,
      "Tests  662 passed (662)",
      "Test Files  1 failed (1)",
      "× 多了一行 — 3 个文件里 1 处命中",
      "",
    ]) {
      expect(isDidNotRunShaped(sample), JSON.stringify(sample)).toBe(false);
    }
    expect(isDidNotRunShaped(undefined)).toBe(false);
  });

  test("报告点名是哪一侧、哪一种形态（退出码同形，只有输出分得开）", () => {
    expect(
      didNotRunSide({
        cur: 1,
        curOutput: "ran",
        base: { code: 1, output: NO_TESTS },
      }),
    ).toContain("基线：一条用例都没收集到");
    expect(
      didNotRunSide({
        cur: 127,
        curOutput: "",
        base: { code: 0, output: "" },
      }),
    ).toContain("本检出：127");
    /* 退 2 那一形也要点得出**是哪一侧**——两侧都是 2 时（#2791 的现场），
     * 只报一句「没跑起来」会让人去查本检出的命令，而两边都没坏。 */
    expect(
      didNotRunSide({
        cur: 2,
        curOutput: "× 这一跑的前提不成立",
        base: { code: 2, output: "× 这一跑的前提不成立" },
      }),
    ).toBe(
      "本检出：退 2（判据自己声明这一跳没有结论，不是红）；基线：退 2（判据自己声明这一跳没有结论，不是红）",
    );
  });

  test("整批：任一条收集不到用例 ⇒ 整批 inconclusive（压过 baseline-red）", () => {
    expect(
      summarizeRows([
        { currentCode: 1, baseCode: 1, output: REAL_RED, baseOutput: REAL_RED },
        {
          currentCode: 1,
          baseCode: 1,
          output: "ran",
          baseOutput: NO_TESTS,
        },
      ]),
    ).toBe("inconclusive");
  });

  test("「跑了但 0 条用例、退 0」⇒ inconclusive —— 不许与真绿同形（ISSUE #2400）", () => {
    expect(judge({ currentCode: 0, baseCode: 1, currentOutput: NO_TESTS })).toBe("inconclusive");
    expect(judge({ currentCode: 0, baseCode: 1, currentOutput: "all good" })).toBe("current-green");
  });

  test("整批：段绿 + 逐条里混着一条「0 码没收集到」 ⇒ inconclusive（ISSUE #2400）", () => {
    expect(
      summarizeRows([
        { currentCode: 0, baseCode: 0, output: "8 checks ok" },
        { currentCode: 0, baseCode: 1, output: NO_TESTS },
      ]),
    ).toBe("inconclusive");
  });

  test("这一态的下一步动作给出环境侧出口（依赖链法 / Windows 形态）", () => {
    const text = nextSteps("inconclusive", { ref: "origin/master" }).join("\n");
    expect(text).toContain("pnpm install --frozen-lockfile");
    expect(text).toMatch(/同一(个盘|个根)|--keep/);
    expect(text).toContain("pnpm");
    /* 不许把它读成别线的红 —— 那正是这次要修的那一格。 */
    expect(text).toMatch(/不构成.*别线的红/);
  });
});

/* ── 第五态：负载假红（ISSUE #1641）────────────────────────────────────
 *
 * 这一族的现场（实测）：同一份代码、同一个提交，8 核空闲时 66 个结构判据
 * 31.9s 全绿；把机器压到 load≈42 时 `tests/check-a11y-rules.test.ts` 报
 * `Test timed out in 30000ms`，隔离重跑立刻全绿。四态里没有它 —— 两侧都红
 * ⇒ 报 `baseline-red`，而照那个动作走会把一次调度抖动登记进 `KNOWN_FAILED_FILES`。 */
/* ── inconclusive 的第三条入口：判据自己退 2（ISSUE #2791）─────────────────
 *
 * 现场（本检出，被 §13.6.2 那条路撞出来）：
 *
 *     $ node scripts/base-check.mjs "node scripts/ci-affected-tests.mjs"
 *     [base-check] 结论：baseline-red（本检出 2，origin/master @ 224a5a3d 2）
 *     [base-check] 基线那次输出的末尾：… ※ 这一档**不算绿也不算红** …
 *
 * 两侧都是 **2**（本仓三态口径里的「这一跳没有结论」：0 绿 / 1 事实红 / 2 没结论，
 * 且 2 压 1 —— 同口径见 `check-daily-attendance` 的「退 2 不算绿」）。而 `judge()`
 * 过去只看「非零」，于是 2 与 1 逐字同权。后果不是难看，是**下一动作相反**：
 * `baseline-red` 要人把这条红记进历史（就地修 / 登记 `KNOWN_FAILED_FILES`），
 * 而这一次什么都没判 —— 登记的是一条不存在的账。
 */
describe("base-check —— inconclusive 的第三条入口：判据自己退 2", () => {
  const NO_PREMISE =
    "[deps-probe] × 这一跑的**前提**不成立（不是用例红）：\n" +
    "  · 环境里串进来了 1 个 npm_config_*（npm_config_cache）……\n" +
    "※ 这一档不算绿也不算红：拿它当「用例红」去查代码，查的是一件没发生的事。";

  test("两侧都退 2 ⇒ inconclusive（这一格曾报 baseline-red）", () => {
    expect(
      judge({
        currentCode: 2,
        baseCode: 2,
        currentOutput: NO_PREMISE,
        baseOutput: NO_PREMISE,
      }),
    ).toBe("inconclusive");
  });

  test("只有一侧退 2 也算没结论（两个方向各钉一条）", () => {
    expect(
      judge({ currentCode: 2, baseCode: 1, currentOutput: NO_PREMISE, baseOutput: "gate red" }),
    ).toBe("inconclusive");
    expect(
      judge({ currentCode: 1, baseCode: 2, currentOutput: "gate red", baseOutput: NO_PREMISE }),
    ).toBe("inconclusive");
  });

  test("反方向对照：两侧都退 1 且无超时指纹 ⇒ 仍是 baseline-red", () => {
    /* 这一条挡的是"修过头"：把「2 才算没结论」写成「非 0 都算没结论」，就会把真·别线的红
     * 吞成 inconclusive —— 比原来那格错得更坏（红彻底看不见，而人会以为无需处理）。 */
    const real = "× 多了一行 — 3 个文件里 1 处命中";
    expect(judge({ currentCode: 1, baseCode: 1, currentOutput: real, baseOutput: real })).toBe(
      "baseline-red",
    );
  });

  test("inconclusive 的话术点得出退 2 与它的下一动作（不是登记进历史）", () => {
    const steps = nextSteps("inconclusive", { ref: "origin/master" }).join("\n");
    expect(steps).toContain("退 2");
    expect(steps).toContain("KNOWN_FAILED_FILES");
  });

  test("整批：混着一条退 2 ⇒ 整批 inconclusive（压过那一批 baseline-red）", () => {
    expect(
      summarizeRows([
        { currentCode: 1, baseCode: 1, output: "gate red", baseOutput: "gate red" },
        { currentCode: 2, baseCode: 2, output: NO_PREMISE, baseOutput: NO_PREMISE },
      ]),
    ).toBe("inconclusive");
  });
});

describe("base-check —— load-flake：时间型判据在负载下的误红", () => {
  const TIMEOUT = "Test timed out in 30000ms.";
  const REAL_RED = "AssertionError: expected 3 to be 4";

  test("两侧都红、且两侧输出都是超时形态 ⇒ load-flake（不是 baseline-red）", () => {
    expect(
      judge({
        currentCode: 1,
        baseCode: 1,
        currentOutput: TIMEOUT,
        baseOutput: TIMEOUT,
      }),
    ).toBe("load-flake");
  });

  test("只在单侧出现超时形态 ⇒ 不降这一档（更像「你的改动让它变慢了」）", () => {
    expect(
      judge({
        currentCode: 1,
        baseCode: 1,
        currentOutput: TIMEOUT,
        baseOutput: REAL_RED,
      }),
    ).toBe("baseline-red");
    expect(
      judge({
        currentCode: 1,
        baseCode: 1,
        currentOutput: REAL_RED,
        baseOutput: TIMEOUT,
      }),
    ).toBe("baseline-red");
  });

  test("真断言红（两侧都不带超时指纹）⇒ 仍是 baseline-red（假阳性闸）", () => {
    expect(
      judge({
        currentCode: 1,
        baseCode: 1,
        currentOutput: REAL_RED,
        baseOutput: REAL_RED,
      }),
    ).toBe("baseline-red");
  });

  test("`inconclusive` 仍然压过它（127 说明这一条没跑起来）", () => {
    expect(
      judge({
        currentCode: 1,
        baseCode: 127,
        currentOutput: TIMEOUT,
        baseOutput: TIMEOUT,
      }),
    ).toBe("inconclusive");
  });

  test("指纹表认的是本仓库真见过的原文，不是猜的形状", () => {
    for (const sample of [
      "Test timed out in 30000ms.",
      "Hook timed out in 45000ms.",
      "[vitest-pool]: Failed to start forks worker",
      "Timeout waiting for worker to respond",
      "Exceeded timeout of 120000 ms",
      "Error: Timeout - Async callback was not invoked",
      "加载超时（25s）",
    ]) {
      expect(isTimeoutShaped(sample), sample).toBe(true);
    }
  });

  test("真断言的输出不许命中指纹（否则每一族红都会被误降档）", () => {
    for (const sample of [
      REAL_RED,
      "expected [] to deeply equal [ ... ]",
      "P80：视图层 `w-N` 与 `h-N` 同值应换 `size-N`",
      "多了一行 — 3 个文件里 1 处命中",
      "",
    ]) {
      expect(isTimeoutShaped(sample), JSON.stringify(sample)).toBe(false);
    }
    expect(isTimeoutShaped(undefined)).toBe(false);
  });

  test("整批优先级：yours 压过 load-flake，load-flake 压过 baseline-red", () => {
    expect(
      summarizeRows([
        { currentCode: 1, baseCode: 0, currentOutput: REAL_RED },
        {
          currentCode: 1,
          baseCode: 1,
          currentOutput: TIMEOUT,
          baseOutput: TIMEOUT,
        },
      ]),
    ).toBe("yours");
    expect(
      summarizeRows([
        { currentCode: 1, baseCode: 1, currentOutput: REAL_RED },
        {
          currentCode: 1,
          baseCode: 1,
          currentOutput: TIMEOUT,
          baseOutput: TIMEOUT,
        },
      ]),
    ).toBe("load-flake");
  });

  test("整批：本检出那侧的全文单独也能判（行里只有 `output` 时）", () => {
    expect(
      summarizeRows([{ currentCode: 1, baseCode: 1, output: TIMEOUT, baseOutput: TIMEOUT }]),
    ).toBe("load-flake");
  });

  test("这一态的下一步动作点名「先隔离复跑」，且不许照 baseline-red 处置", () => {
    const text = nextSteps("load-flake", { ref: "origin/master" }).join("\n");
    expect(text).toContain("--no-file-parallelism");
    expect(text).toContain("KNOWN_FAILED_FILES");
    expect(text).toMatch(/不要.*baseline-red/);
  });
});

describe("base-check —— 命令解析", () => {
  test("裸脚本名补 node", () => {
    const r = resolveGateCommand(["scripts/check-ui-primitives.cjs"]);
    expect(r).toMatchObject({
      ok: true,
      argv: ["node", "scripts/check-ui-primitives.cjs"],
    });
  });

  test("整条命令当一个参数给进来 ⇒ 按空白切成 argv（不许把整串当路径）", () => {
    /* 现场：`node scripts/base-check.mjs "node scripts/x.cjs"` 与
     * `--base "…"` 两种走法都只有**一个**数组元素。此前那条「裸脚本名」分支会把它
     * 当成文件名 → `["node", "node scripts/x.cjs"]` → `commandTargetState` 拼出
     * `<cwd>/node scripts/x.cjs` → 恒「不存在」→ 每条判据都读成 127（没跑起来），
     * 于是「复算」这件事给不出任何结论（ISSUE #2293 的现场就是被它挡住的）。 */
    expect(resolveGateCommand(["node scripts/x.cjs"])).toMatchObject({
      ok: true,
      argv: ["node", "scripts/x.cjs"],
    });
    expect(resolveGateCommand(["node scripts/x.cjs --base origin/master"])).toMatchObject({
      ok: true,
      argv: ["node", "scripts/x.cjs", "--base", "origin/master"],
    });
    expect(resolveGateCommand(["pnpm exec vitest run tests/x.test.ts"])).toMatchObject({
      ok: true,
      argv: ["pnpm", "exec", "vitest", "run", "tests/x.test.ts"],
    });
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
    /* SAFETY: 类型断言已复核 */
    expect(String((r as { error: string }).error)).toContain("可用");
  });

  test("没给命令 ⇒ 判失败", () => {
    expect(resolveGateCommand([]).ok).toBe(false);
  });

  test("分词尊重引号、剥掉行内注释", () => {
    expect(tokenize('node a.cjs --skip "两个 词"')).toEqual(["node", "a.cjs", "--skip", "两个 词"]);
    const steps = readHookSteps();
    /* 钩子里的步骤没有带 `#` 的行内注释残留 —— 否则 argv 里会出现一个 `#` 开头的词。 */
    for (const s of steps) {
      expect(s.argv.some((a) => a.startsWith("#"))).toBe(false);
    }
  });
});

describe("base-check —— 目标存在性（127 那条边界）", () => {
  test("相对脚本不存在 ⇒ missing（而不是让它静默退出 1）", () => {
    const state = commandTargetState(["node", "绝对不存在.cjs"], REPO_ROOT);
    expect(state.kind).toBe("missing");
  });

  test("存在的脚本 ⇒ ok", () => {
    const state = commandTargetState(["node", "scripts/base-check.mjs"], REPO_ROOT);
    expect(state.kind).toBe("ok");
  });

  test("非 node 命令 ⇒ unknown（交给它自己报错）", () => {
    expect(commandTargetState(["pnpm", "exec", "vitest"], REPO_ROOT).kind).toBe("unknown");
    expect(commandTargetState(["node", "--version"], REPO_ROOT).kind).toBe("unknown");
  });

  test("normalizeRun 把 spawn error 归成 127", () => {
    /* SAFETY: 类型断言已复核 */
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

  /**
   * 「PR 分支 + 主干已推进 + 本地合过主干」那份夹具（ISSUE #1913 的现场形状）。
   *
   * 分支**推过一次** ⇒ `@{u}` 就是它自己那条线；随后主干带进一个违规，本地把主干
   * 合了进来（还没推）。此时按旧口径拿 `@{u}` 当基线 = 拿**不含那批合并改动**的
   * 自己跟自己比 ⇒ 主干自带的红会被判成 `yours`，把别线的债算到复算的人头上。
   */
  function makeMergedPrFixture(): { bare: string; work: string } {
    const bare = mkdtempSync(join(tmpdir(), "base-check-pr-bare-"));
    git(bare, "init", "-q", "--bare", "-b", "master", ".");
    const work = mkdtempSync(join(tmpdir(), "base-check-pr-work-"));
    git(work, "init", "-q", "-b", "master", ".");
    git(work, "config", "user.email", "pr@example.com");
    git(work, "config", "user.name", "pr");
    git(work, "config", "commit.gpgsign", "false");
    git(work, "remote", "add", "up", bare);
    writeFileSync(
      join(work, "gate.cjs"),
      [
        'const fs = require("node:fs");',
        'const has = fs.existsSync("marker.txt");',
        String.raw`process.stdout.write(has ? "[gate] 命中\n" : "[gate] 干净\n");`,
        "process.exit(has ? 1 : 0);",
        "",
      ].join("\n"),
    );
    writeFileSync(join(work, "seed.txt"), "seed\n");
    git(work, "add", ".");
    git(work, "commit", "-qm", "chore: seed");
    git(work, "push", "-q", "up", "master");
    git(work, "checkout", "-q", "-b", "feat");
    writeFileSync(join(work, "own.txt"), "mine\n");
    git(work, "add", ".");
    git(work, "commit", "-qm", "feat: 自己的一笔");
    git(work, "push", "-q", "-u", "up", "feat");
    git(work, "checkout", "-q", "master");
    writeFileSync(join(work, "marker.txt"), "x\n");
    git(work, "add", ".");
    git(work, "commit", "-qm", "fix(other): 主干把违规带了进来");
    git(work, "push", "-q", "up", "master");
    git(work, "checkout", "-q", "feat");
    git(work, "merge", "-q", "--no-edit", "up/master");
    return { work, bare };
  }

  test("PR 分支合过主干 ⇒ 基线取主干，并把「取到哪条」说出口", () => {
    /**
     * 这一条判的是**基线选择 + 报告口径**（本次的回归本体），刻意不走建快照那一趟：
     * 快照那一条命令要付 `git worktree add` + 两侧各跑一遍判据，配上这个夹具（比
     * `makeRepo()` 多一次 push 与一次 merge）实测单条 **49s**（本机同时压着 4 个检出的
     * vitest 时），会把 30s 预算吃光；改成走快路后同一台机器上复测 **27.3s** ——
     * 余量仍然不宽，所以这里**不抬预算**，只把代价挪走（§11.13 的口径：预算的出处是实测，
     * 不是为了让颜色变绿而调的旋钮）。
     * 「红落在哪一侧」的判决早有 `judge()` 的单测与上面 `markerOnBase` 那条 CLI 用例在判，
     * 这里重复判一遍只是把同一条链付两次代价。
     *
     * 快路怎么选：给一个**必绿**的门禁 ⇒ `current-green` ⇒ 脚本按设计不建快照，
     * 但「取了哪条基线」那一行照打 —— 正是本回归要钉的东西。
     */
    const r = makeMergedPrFixture();
    try {
      // 前提必须成立：`@{u}` 确实是自己那条线（旧口径拿它当基线正是错的根源）。
      expect(resolveUpstreamRef(r.work)).toBe("up/feat");
      /* 纯函数那一层：主干与 HEAD 不同 ⇒ 取主干，且理由里点名「不是本分支的 upstream」。 */
      const got = resolveAttributionRef(r.work);
      expect(got.ref).toBe("up/master");
      expect(got.why).toContain("基线取的是主干");
      expect(got.why).toContain("up/feat");

      writeFileSync(join(r.work, "green.cjs"), "process.exit(0);\n");
      const { code, stdout, stderr } = runBaseCheck(r.work, ["node", "green.cjs"]);
      expect(code, `stderr=${stderr}`).toBe(0);
      /* 取了哪条基线必须在**真实输出**里看得见：一份写着 `up/feat` 的报告读起来
         像「与主干比过」，而它一个字都没比 —— 那就是本次误判的形态。 */
      expect(stdout, `stdout=${stdout}`).toContain("基线取的是主干");
      expect(stdout).toMatch(/up\/master/);
    } finally {
      dropRepo(r);
    }
  });

  test("主干与 HEAD 是同一份时才退回 `@{u}`（在 master 上直接复算的那种检出）", () => {
    /**
     * 这一向**不复用** `makeMergedPrFixture()`：那个夹具要为「主干与 HEAD 不同」这件事
     * 付一次 push + 一次 merge，而本用例只需要「HEAD 逐字等于主干」这一格 —— 用最少的
     * git 动作造出来就行。判据文件在本仓是并发跑的（C 组与 A/B/D 挤同一台机器），
     * 少造一半夹具就是少一分负载假红。
     */
    const bare = mkdtempSync(join(tmpdir(), "base-check-trunk-bare-"));
    git(bare, "init", "-q", "--bare", "-b", "master", ".");
    const work = mkdtempSync(join(tmpdir(), "base-check-trunk-work-"));
    git(work, "init", "-q", "-b", "master", ".");
    git(work, "config", "user.email", "trunk@example.com");
    git(work, "config", "user.name", "trunk");
    git(work, "config", "commit.gpgsign", "false");
    git(work, "remote", "add", "up", bare);
    writeFileSync(join(work, "seed.txt"), "seed\n");
    git(work, "add", ".");
    git(work, "commit", "-qm", "chore: seed");
    git(work, "push", "-q", "-u", "up", "master");
    try {
      const got = resolveAttributionRef(work);
      expect(got.ref).toBe("up/master");
      expect(got.why).toContain("与主干同一份");
    } finally {
      rmSync(work, { recursive: true, force: true });
      rmSync(bare, { recursive: true, force: true });
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

  test("基线侧一条用例都没收集到 ⇒ inconclusive，且报告点名「哪一侧」", () => {
    /* 端到端那一格：判据在**基线**上收集不到用例（依赖链断在快照里），而本检出上
     * 它真红着 —— 退出码两侧都是 1，只有输出分得开。修之前这一格报 `baseline-red`
     * （「别线的红」），于是人拿着一个「基线其实没跑起来」的结论去走
     * 「就地修 / 登记 KNOWN_FAILED_FILES」那条下一动作（ISSUE #1652）。 */
    const r = makeRepo({ noTestsOnBase: true });
    try {
      const { code, stdout, stderr } = runBaseCheck(r.work, ["node", "gate.cjs"]);
      expect(code, `stderr=${stderr}`).toBe(0);
      expect(stdout).toContain("inconclusive");
      /* 标签从「没跑起来」改成「没跑出结论」：第三条入口（退 2）里命令**跑起来了**，
         是它自己答"没有结论"—— 沿用旧标签会把那一形说成"命令坏了"，而它的下一动作
         是清前置后复算（ISSUE #2791）。 */
      expect(stdout).toContain("没跑出结论：基线：一条用例都没收集到");
      /* 不许再报成「别线的红」—— 那正是这次要修的那一格。 */
      expect(stdout).not.toContain("结论：baseline-red");
      expect(stdout).toContain("pnpm install --frozen-lockfile");
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
    /* **先在临时仓库上判**（下一条的由来就在这段注释里）：这一格要验的是候选表
     * **第三条**（本地 `master`）够得着，所以夹具就该只有「本地 `master`、既没有
     * `@{u}` 也没有任何 remote」这一种形态 —— 拿「本仓库自己的检出」当夹具是错的，
     * 它只在**开发机的检出**上成立。
     *
     * 实测（自托管 CI 的克隆方式）：平台侧是
     * `git init -b master` → `git remote add origin …` → `git fetch … refs/pull/N/merge`
     * → `git checkout -f FETCH_HEAD` —— HEAD **detached**、`refs/heads/*` 一个都没有
     * （`master` 是未诞生的分支）、`@{u}` 更不存在，于是 `resolveUpstreamRef()` 三条
     * 候选全落空、如实回 `null`。也就是说**「取不到上游」在 CI 上是正常状态**，
     * 而原来那条断言把「取得到」写成了本检出的恒真性质 ⇒ 只在 CI 上假红。
     * 出处与克隆形态见规范 §13.5.3（平台侧取自「不可信事件」的源分支）。 */
    const dir = mkdtempSync(join(tmpdir(), "base-check-localmaster-"));
    try {
      git(dir, "init", "-q", "-b", "master", ".");
      git(dir, "config", "user.email", "gate@example.com");
      git(dir, "config", "user.name", "gate");
      git(dir, "config", "commit.gpgsign", "false");
      writeFileSync(join(dir, "a.txt"), "a\n");
      git(dir, "add", ".");
      git(dir, "commit", "-qm", "chore: seed");
      /* 前提必须成立：既没有 `@{u}`、也没有任何 remote —— 否则这条用例验的
       * 就不是「第三条候选够得着」，而是「前两条先兜住了」。 */
      expect(git(dir, "remote").trim()).toBe("");
      expect(resolveUpstreamRef(dir)).toBe("master");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * `--base`：**合并前那一档**（ISSUE #1591）。
 *
 * 这条入口补的是「我的分支绿 → `master` 绿」之间那个**没有任何判据**的跳
 * （平台侧 squash 合并不跑本地钩子、#623 之后无 CI）。它必须成立在四件事上，
 * 缺一件就退化成「看着在守、其实没守」：
 *
 *   ① **面从钩子里现算**，不抄第二份清单（抄一份就会漂）；
 *   ② 只在**干净快照上判得出**的判据才进这一批（`--staged` / 只在改动命中时做事的
 *      那几条进去就等于问一个它们回答不了的问题）；
 *   ③ 整批的结论**优先级正确** —— 任一条「没跑起来」（127）压过「有红」，
 *      因为 127 与「跑了且红」在退出码上同形，拿它下判决是把人往错方向送；
 *   ④ 快照里**链上依赖树** —— 缺它的表现是近一半判据以「红」的形态报错（实测 9 条）。
 */
describe("base-check --base —— 合并前面从钩子现算（不抄第二份清单）", () => {
  test("默认面 = 钩子里的全仓判据，且含 A 组的 tsc 与 B 组的 eslint", () => {
    const r = resolveMergeBatch([]);
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    const labels = r.commands.map((c) => c.label);
    /* 这两条就是 ISSUE #1591 立案的那两条：它们在钩子里是 `run_group`（并行成组）、
     * 不是 `run "<标签>"`，所以只读 `run` 的解析器看不见它们 —— 只读 `run` 会让
     * 「合并前复算」漏掉最该复算的两条，且表现为「静默少两行」。 */
    expect(labels).toContain("tsc --noEmit");
    expect(labels.some((l) => l.includes("eslint"))).toBe(true);
    /* D 组的静态判据也在（面是「那一批」而不是「那一条」）。 */
    expect(r.commands.length).toBeGreaterThan(20);
  });

  test("groupSteps 只认单行的 run_group（多行 sh -c 的 C/D 组不收）", () => {
    const steps = groupSteps();
    const argv = steps.map((s) => s.argv.join(" "));
    /* A / B 两条是单行 `sh -c '…'`。 */
    expect(argv).toContain("pnpm exec tsc --noEmit");
    expect(argv.some((a) => a.includes("run lint"))).toBe(true);
    /* C / D 组是**多行** `sh -c`（内部各自再分派），取不出「一条判据一条命令」
     * 的形状 —— 收进来会变成一条跑不起来的命令（表现为假红）。 */
    expect(argv.some((a) => a.includes("run-affected-tests.mjs"))).toBe(false);
  });

  test("显式点名时按单条解析（钩子标签 / 脚本名 / 整条命令都认）", () => {
    const byLabel = resolveMergeBatch(["文件结构硬规则(R1-R12，R5 硬闸)"]);
    expect(byLabel.ok).toBe(true);
    if (byLabel.ok) {
      expect(byLabel.commands).toHaveLength(1);
      expect(byLabel.commands[0]!.argv).toContain("scripts/check-file-structure.cjs");
    }
    /* 不存在的名字 ⇒ 判失败并列出候选（不许猜，同 `resolveGateCommand`）。 */
    expect(resolveMergeBatch(["这个标签不存在"]).ok).toBe(false);
  });

  test("只在「本次改了啥」上作答的判据不进这一批（干净快照里没有暂存区）", () => {
    expect(mayDecideOnCleanSnapshot(["node", "scripts/check-deps-freshness.mjs", "--staged"])).toBe(
      false,
    );
    expect(mayDecideOnCleanSnapshot(["node", "scripts/storybook-check.mjs", "--changed"])).toBe(
      false,
    );
    /* 它的判决**依赖暂存改动**：干净快照里它立刻返回 0，那行绿是假绿。 */
    expect(mayDecideOnCleanSnapshot(["node", "scripts/shell-gate.mjs"])).toBe(false);
    /* `check-reformat-only.cjs` 带 `--staged` 时不进这一批（按参数形态就认得出）。
     *
     * ⚠️ **不带旗标那一形态现在会进来**（ISSUE #3038，此前因为它在 `CHANGED_SCOPED` 里
     * 而被排除）：它落到「判 `HEAD` 这一次提交」那一支，而那一支的区间由合成提交的
     * 父关系现算（`reformat-preview-range.mjs`）—— 干净快照上这一支读到的是
     * `HEAD~1..HEAD`（一个**与本次改动无关**的区间），与它「只对本次改动作答」的定位
     * 对不上；可它此时又**确实**能从提交历史里算出结论（不是空跑），所以不再算假绿。
     * 两个方向都钉住，免得下一次有人只改一边。 */
    expect(mayDecideOnCleanSnapshot(["node", "scripts/check-reformat-only.cjs", "--staged"])).toBe(
      false,
    );
    expect(mayDecideOnCleanSnapshot(["node", "scripts/check-reformat-only.cjs"])).toBe(true);
    /* 复算里再复算会递归。 */
    expect(mayDecideOnCleanSnapshot(["node", "scripts/base-check.mjs", "x"])).toBe(false);
    /* 全仓判据留下。 */
    expect(mayDecideOnCleanSnapshot(["node", "scripts/check-file-structure.cjs", "--strict"])).toBe(
      true,
    );
  });

  test("默认面里不含任何「只在改动上作答」的判据", () => {
    const r = resolveMergeBatch([]);
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    for (const c of r.commands) {
      expect(mayDecideOnCleanSnapshot(c.argv), c.label).toBe(true);
    }
  });
});

describe("base-check --base —— 整批结论的优先级（纯函数）", () => {
  test("全绿 ⇒ current-green", () => {
    expect(
      summarizeRows([
        { currentCode: 0, baseCode: 0 },
        { currentCode: 0, baseCode: null },
      ]),
    ).toBe("current-green");
  });

  test("任一条「没跑起来」（127）压过「有红」⇒ inconclusive", () => {
    /* 拿一个无法归因的读数下判决 = 把人往错方向送（同 `judge` 那条理由）。 */
    expect(
      summarizeRows([
        { currentCode: 1, baseCode: 1 },
        { currentCode: 1, baseCode: 127 },
      ]),
    ).toBe("inconclusive");
  });

  test("红的那几条基线上同样命中 ⇒ baseline-red", () => {
    expect(
      summarizeRows([
        { currentCode: 0, baseCode: 0 },
        { currentCode: 1, baseCode: 1 },
      ]),
    ).toBe("baseline-red");
  });

  test("红的那几条基线上绿 ⇒ yours", () => {
    /* 这一条原来写的是 `currentCode: 2` —— 那时 2 还没有含义，被当"任意非零"用。
     * 现在 2 = 判据自己声明「这一跳没有结论」⇒ 它落 `inconclusive`（见上面 #2791 那一组），
     * 所以这里必须用**真红** 1，否则测的就不是「你的红」这一档了。 */
    expect(
      summarizeRows([
        { currentCode: 0, baseCode: 0 },
        { currentCode: 1, baseCode: 0 },
      ]),
    ).toBe("yours");
  });

  test("混着「别线的红」与「你的红」时按更严重的一档报（yours）", () => {
    /* 报成 baseline-red 会让人以为整批都与自己无关，而其中一条必须改代码。 */
    expect(
      summarizeRows([
        { currentCode: 1, baseCode: 1 },
        { currentCode: 1, baseCode: 0 },
      ]),
    ).toBe("yours");
  });

  test("空行表 ⇒ inconclusive（不是「全绿」）", () => {
    /* 解析失灵时最容易退化成「0 条、全绿」—— 那是最坏的一种静默。 */
    expect(summarizeRows([])).toBe("inconclusive");
  });

  test("每一态都答得出「下一步做什么」，且红的那几条被点名", () => {
    /* SAFETY: 类型断言已复核 */
    for (const summary of ["current-green", "inconclusive", "baseline-red", "yours"] as const) {
      const lines = nextStepsMany(summary, [{ label: "tsc --noEmit", verdict: "yours" }], {
        ref: "origin/master",
      });
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.join("\n")).not.toMatch(/undefined/);
    }
    const named = nextStepsMany("yours", [{ label: "tsc --noEmit", verdict: "yours" }], {
      ref: "origin/master",
    });
    expect(named[0]).toContain("tsc --noEmit");
  });
});

/**
 * `--base` 的**端到端**：真仓库、真快照、真归属。
 *
 * 为什么必须在真 git 仓库上跑（不能 mock）：这一档的每一条结论都建立在三件真事实
 * 上 —— 钩子里真有一批可复算的步骤、`git worktree` 真出一个干净快照、快照里真看得见
 * 依赖树。内存里假装这三件事，恰好等于把「合并前复算」重新实现一遍，而它唯一的失效
 * 形态正是「假装干净」。
 *
 * 夹具按 `makeRepo` 同款造一对（裸远端 + 工作检出），另外**把一份极小的
 * `.githooks/pre-commit` 与 `node_modules` 放进快照** —— 前者是「面从哪来」，
 * 后者是 `linkDependencies` 那一手要核的东西。
 */
describe("base-check --base —— 真仓库上的端到端", () => {
  /** 一份最小的钩子：两条 `run` + 一条 `run_group`，够核「面从哪来」。 */
  const HOOK = [
    "#!/bin/sh",
    'run "全仓判据甲" node gate-a.cjs',
    'run "只看本次改动" node gate-a.cjs --staged',
    "run_group A \"组里的判据\" sh -c 'node gate-a.cjs'",
    "",
  ].join("\n");

  /**
   * 造一对（裸远端 + 工作检出），钩子与两个判据脚本按需放进**基线提交**。
   *
   * `baselineRed` = 让 `gate-a.cjs` 在基线上就红（marker 文件随基线提交）。
   */
  function makeBatchRepo(opts: { baselineRed?: boolean } = {}) {
    const bare = mkdtempSync(join(tmpdir(), "base-batch-bare-"));
    git(bare, "init", "-q", "--bare", "-b", "master", ".");
    const work = mkdtempSync(join(tmpdir(), "base-batch-gate-"));
    git(work, "init", "-q", "-b", "master", ".");
    git(work, "config", "user.email", "gate@example.com");
    git(work, "config", "user.name", "gate");
    git(work, "config", "commit.gpgsign", "false");
    git(work, "remote", "add", "up", bare);
    mkdirSync(join(work, ".githooks"), { recursive: true });
    writeFileSync(join(work, ".githooks", "pre-commit"), HOOK);
    /* marker 在场即红 —— 用它把「基线上就红」那一档造出来。 */
    writeFileSync(
      join(work, "gate-a.cjs"),
      [
        'const fs = require("node:fs");',
        'const has = fs.existsSync("marker.txt");',
        String.raw`process.stdout.write(has ? "[gate] 命中\n" : "[gate] 干净\n");`,
        "process.exit(has ? 1 : 0);",
        "",
      ].join("\n"),
    );
    if (opts.baselineRed) {
      writeFileSync(join(work, "marker.txt"), "x\n");
    }
    writeFileSync(join(work, "seed.txt"), "seed\n");
    git(work, "add", ".");
    git(work, "commit", "-qm", "chore: seed");
    git(work, "push", "-q", "up", "master");
    git(work, "checkout", "-q", "-b", "feat", "up/master");
    /* 依赖树链进快照那一手要核的东西：一个假 `node_modules`（判据读它）。 */
    mkdirSync(join(work, "node_modules", "fake-dep"), { recursive: true });
    writeFileSync(join(work, "node_modules", "fake-dep", "index.js"), "module.exports = 1;\n");
    return { work, bare };
  }

  test("基线红 / 本检出也红 ⇒ baseline-red，并点名是哪几条", () => {
    const r = makeBatchRepo({ baselineRed: true });
    try {
      /* 本检出里再加一个无关改动 —— 被拦下的正是这个场景。 */
      writeFileSync(join(r.work, "unrelated.txt"), "y\n");
      git(r.work, "add", ".");
      git(r.work, "commit", "-qm", "feat: unrelated");
      const { code, stdout, stderr } = runBaseCheck(r.work, ["--base"]);
      expect(code, `stderr=${stderr}`).toBe(0);
      expect(stdout).toContain("baseline-red");
      expect(stdout).toContain("别线的红");
      /* 红的那几条要**点名**，不然「哪一条挡路」还得人自己找。 */
      expect(stdout).toContain("全仓判据甲");
    } finally {
      dropRepo(r);
    }
  });

  test("快照里看得见依赖树（`linkDependencies` 那一手）", () => {
    const r = makeBatchRepo();
    try {
      /* 一条「本检出绿、快照里跑得起来」的判据：判据自己去 require 那个假依赖 ——
       * 没链上去的表现是 `Cannot find module` 退出 1，与「跑了且红」同形。 */
      writeFileSync(
        join(r.work, "gate-a.cjs"),
        [
          'require("node:fs");',
          'const dep = require("fake-dep");',
          "process.stdout.write(`[gate] dep=${dep}\\n`);",
          "process.exit(dep === 1 ? 0 : 1);",
          "",
        ].join("\n"),
      );
      git(r.work, "add", ".");
      git(r.work, "commit", "-qm", "feat: gate reads dep");
      /* 快照里那份判据要能 require 到 —— 链不上会报 yours（快照侧 1、本检出 0）。 */
      const { stdout } = runBaseCheck(r.work, ["--base", "全仓判据甲"]);
      expect(stdout).toContain("current-green");
    } finally {
      dropRepo(r);
    }
  });

  test("只在「本次改了啥」上作答的判据不进这一批（--staged 那条被滤掉）", () => {
    const r = makeBatchRepo();
    try {
      const { stdout } = runBaseCheck(r.work, ["--base"]);
      /* 钩子里那三条：`--staged` 的滤掉、`run_group` 那条收进来 ⇒ 只剩两条。 */
      expect(stdout).toContain("2 条判据");
    } finally {
      dropRepo(r);
    }
  });

  test("JSON 形状逐条给归属（碎片里要贴的那句事实）", () => {
    const r = makeBatchRepo({ baselineRed: true });
    try {
      const { stdout } = runBaseCheck(r.work, ["--base", "--json"]);
      /* SAFETY: 类型断言已复核 */
      const parsed = JSON.parse(stdout) as {
        ref: string;
        rows: Array<{
          baseCode: number | null;
          label: string;
          verdict: string;
        }>;
        summary: string;
      };
      expect(parsed.summary).toBe("baseline-red");
      expect(parsed.ref).toMatch(/up\/master/);
      const hit = parsed.rows.find((x) => x.label === "全仓判据甲");
      expect(hit?.verdict).toBe("baseline-red");
      expect(hit?.baseCode).toBe(1);
    } finally {
      dropRepo(r);
    }
  });
});

/**
 * 「合并前复算要拿哪条当基线」与「被拦下时复算」是**两个问题**（ISSUE #1591）。
 *
 * 这一条是实测撞出来的：`resolveUpstreamRef()` 的首选是 `@{u}`（我这份检出从哪来），
 * 那对「这红是不是本来就有的」是对的；而 `--base` 问的是「并进 `master` 之后会不会红」，
 * 在 PR 分支上 `@{u}` 就是**你自己的分支** —— 拿它当基线等于自己跟自己比，输出
 * 「50 条全绿」、看起来一切正常，却一个字节都没回答那个问题。
 */
describe("base-check --base —— 基线引用只认「要并进去的那条」", () => {
  test("PR 分支上不拿 `@{u}` 当基线（那是自己的分支）", () => {
    /* 夹具：远端 master + 一条跟踪它的 feat 分支 —— 这正是 PR 分支的形状。 */
    const r = makeRepo();
    try {
      expect(git(r.work, "rev-parse", "--abbrev-ref", "feat@{u}").trim()).toBe("up/master");
      /* 事后复算那一档：认 `@{u}`（它要答的是「我这条线的上游有没有这个红」）。 */
      expect(resolveUpstreamRef(r.work)).toBe("up/master");
      /* 合并前那一档：只认「要并进去的那条」。 */
      expect(resolveMergeBaseRef(r.work)).toBe("up/master");
    } finally {
      dropRepo(r);
    }
  });

  test("取不到「要并进去的那条」时**返回 null**，不退回 `@{u}` 充数", () => {
    /* 一个只有 feature 远端的仓库：`feat` 跟踪 `up/feat`，没有任何 master。 */
    const bare = mkdtempSync(join(tmpdir(), "base-nobase-bare-"));
    const work = mkdtempSync(join(tmpdir(), "base-nobase-"));
    try {
      git(bare, "init", "-q", "--bare", "-b", "feat", ".");
      git(work, "init", "-q", "-b", "feat", ".");
      git(work, "config", "user.email", "gate@example.com");
      git(work, "config", "user.name", "gate");
      git(work, "config", "commit.gpgsign", "false");
      git(work, "remote", "add", "up", bare);
      writeFileSync(join(work, "a.txt"), "a\n");
      git(work, "add", ".");
      git(work, "commit", "-qm", "chore: seed");
      git(work, "push", "-q", "-u", "up", "feat");
      /* `@{u}` 解析得出（up/feat），但那条不是「要并进去的」。 */
      expect(resolveUpstreamRef(work)).toBe("up/feat");
      expect(resolveMergeBaseRef(work)).toBeNull();
    } finally {
      dropRepo({ work, bare });
    }
  });
});
