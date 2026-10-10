/**
 * 「**合并前的固定动作**」的唯一入口（规范 §13.6.2 + §13.5.4；ISSUE #1611 拍板）。
 *
 * 这条东西的存在理由只有一个：**把「记住跑全三件事」从纪律变成一条命令**。
 * 平台侧 squash 合并**不跑本地钩子**、#623 之后**也无 CI 兜底**，所以
 * 「我的分支绿 → master 绿」那一跳的三条判据**都天然跑不进 pre-commit** ——
 * 它们唯一的执行者就是「合并前敲一次」这个人的动作。而纪律的三种漏法
 * （漏跑一步 / 顺序反了 / 只跑了自己记得的那条）**都不报错**。
 *
 * 所以本文件判的是**编排**那几件容易静默失效的事：
 *   ① 三段各自在、且**不发明第二套实现**（`base` 段走 `base-check.mjs` 的既有
 *      `baseCheckMany`，另外两段走既有脚本 —— 抄一份就会漂，§12.18 / §12.12）；
 *   ② 总码的合成口径：**「没跑起来」(2) 压过「红了」(1)** —— 拿一个无法归因的
 *      读数下判决是把人往错方向送（§13.6.2）；
 *   ③ `base` 段的四态 ⇄ 退出码的折算只在**一处**（`current-green`=0、
 *      `yours`/`baseline-red`=1、`inconclusive`=2）；
 *   ④ `--only` / `--skip-*` 开关真的在筛段，且**筛空 = 2**（不许「三段全跳过」
 *      却报全绿 —— 那是本仓库最怕的那种静默）。
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { combineCodes, lastSummary } from "../scripts/premerge-check.mjs";

const SCRIPT = join(process.cwd(), "scripts", "premerge-check.mjs");

/** 跑一次入口脚本。 */
function run(args: string[] = []) {
  try {
    const output = execFileSync(process.execPath, [SCRIPT, ...args], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, output };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return {
      code: typeof e.status === "number" ? e.status : 1,
      output: `${e.stdout ?? ""}${e.stderr ?? ""}`,
    };
  }
}

describe("premerge-check —— 总码合成（纯函数）", () => {
  test("全 0 ⇒ 0", () => {
    expect(combineCodes([0, 0, 0])).toBe(0);
  });

  test("有 1 ⇒ 1（有段红了）", () => {
    expect(combineCodes([0, 1, 0])).toBe(1);
  });

  test("**有 2 压过有 1** ⇒ 2（没跑起来的那段不许被当结论）", () => {
    /* 这条是纯函数里最要紧的一条：127 / 未跑起来与「跑了且红」在退出码上同形，
     * 拿它下判决等于替人决定了一个判据答不了的问题（§13.6.2 实测踩过）。 */
    expect(combineCodes([1, 2, 0])).toBe(2);
    expect(combineCodes([2])).toBe(2);
  });

  test("空数组 ⇒ 0（调用点保证不会出现；这里只钉「不炸」）", () => {
    expect(combineCodes([])).toBe(0);
  });
});

describe("premerge-check —— 从 base-check 的报告里读回结论词", () => {
  test("按 `结论：` 那一行取，不被正文里的同一个词命中", () => {
    /* 为什么必须按行取：`base-check` 的正文里会出现「不许把 127 读成 baseline-red」
     * 这类**说明**，全文匹配会读出那个假结论 —— 而假结论的下一动作与真结论相反。 */
    const report = [
      "[base-check] 合并前复算：53 条判据 —— 红 1 条（基线 origin/master @ abc1234）",
      "  · 红  tsc --noEmit（本检出 1 / 基线 0）",
      "[base-check] 结论：yours",
      "[base-check] 干净基线上是绿的 ⇒ 这是**你的改动**引入的。",
      "[base-check] 别把 inconclusive 读成 baseline-red。",
    ].join("\n");
    expect(lastSummary(report)).toBe("yours");
  });

  test("四种结论词都认得", () => {
    for (const v of ["current-green", "inconclusive", "baseline-red", "yours"]) {
      expect(lastSummary(`[base-check] 结论：${v}\n`)).toBe(v);
    }
  });

  test("没有那一行 ⇒ null（不猜、不默认成绿）", () => {
    expect(lastSummary("[base-check] 只说了些别的\n")).toBeNull();
  });
});

describe("premerge-check —— 段的筛选", () => {
  test("三段全被跳过 ⇒ 退 2，**不许**报全绿", () => {
    /* 「什么都没复算」与「复算过且全绿」必须分开 —— 同 §11.23.1 那条：
     * 静默的绿比没有更坏（它让人以为这件事有人管）。 */
    const { code, output } = run(["--skip-base", "--skip-claims", "--skip-mergeLoss"]);
    expect(code).toBe(2);
    expect(output).toContain("全被跳过");
  });

  test("`--only` 点名不存在的段 ⇒ 退 2 并说明", () => {
    const { code } = run(["--only=nonexistent"]);
    expect(code).toBe(2);
  });

  test("`--only=claims` 只跑那一段（不跑复算那一大段）", () => {
    const { code, output } = run(["--only=claims"]);
    expect(code).toBe(0);
    expect(output).toContain("提交信息里的机械可核声明");
    /* 复算那一段的标签不该出现 —— 出现了说明 `--only` 没筛住。 */
    expect(output).not.toContain("合并前复算（钩子里那批全仓判据）");
  });

  test("`--json` 给出逐段结论（机器可读那一半）", () => {
    const { code, output } = run(["--only=claims", "--json"]);
    expect(code).toBe(0);
    const parsed = JSON.parse(output) as {
      code: number;
      segments: Array<{ key: string; code: number }>;
    };
    expect(parsed.code).toBe(0);
    expect(parsed.segments).toHaveLength(1);
    expect(parsed.segments[0]!.key).toBe("claims");
  });
});

describe("premerge-check —— 不发明第二套实现（面的来源）", () => {
  test("`base` 段走 base-check 的既有实现，不自己建快照 / 不自己算四态", () => {
    /* 这条是**形态判据**、不是文本判据：本入口必须 `import` 既有实现。
     * 抄一份「建 worktree / 链依赖 / 四态归属」就是 §12.12 的字面孪生，
     * 而它漂掉的方式完全静默（合并前那一跳的结论会与 §13.6.2 的处置口径分家）。 */
    const source = execFileSync(
      process.execPath,
      [
        "-e",
        `process.stdout.write(require("node:fs").readFileSync(${JSON.stringify(
          SCRIPT,
        )}, "utf8"))`,
      ],
      { encoding: "utf8" },
    );
    expect(source).toContain('from "./base-check.mjs"');
    expect(source).toContain("baseCheckMany");
    expect(source).toContain("resolveMergeBatch");
    /* 反面：不许自己再拼一遍 worktree / 快照 / 判据清单。 */
    expect(source).not.toContain("worktree add");
    expect(source).not.toContain("readHookSteps");
  });

  test("另外两段走既有脚本（子进程），不把它们的判据逻辑抄进来", () => {
    const source = execFileSync(
      process.execPath,
      [
        "-e",
        `process.stdout.write(require("node:fs").readFileSync(${JSON.stringify(
          SCRIPT,
        )}, "utf8"))`,
      ],
      { encoding: "utf8" },
    );
    expect(source).toContain('script: "check-commit-claims.mjs"');
    expect(source).toContain('script: "check-merged-side-loss.mjs"');
  });
});

describe("premerge-check —— 带锚点的那一段真的在跑（不许恒退 2）", () => {
  test("`mergeLoss` 段自己算出锚点：/ --baseline 不再是「缺参」", () => {
    /* **这是本文件最要紧的一条回归**：早先 `SEGMENTS.mergeLoss` 是裸 `script` +
     * `args: []`，而 `check-merged-side-loss.mjs` 缺 `--baseline` 会**直接 exit 2**
     * —— 于是这一段恒退 2、整个入口恒报「不构成证据（退 2）」，**一次事实都没复算**。
     * 它恰好是这套编排要消灭的那类静默失效：看着在跑，结论永远是「没跑起来」。
     * 判据：这一段不许以「缺少 --baseline」结尾。 */
    const { code, output } = run(["--only=mergeLoss"]);
    expect(output).not.toContain("缺少 --baseline");
    /* 它要么绿（0）、要么真报「需要人工看」（1）；「没跑起来」（2）只允许由
     * 取不到 merge target / 浅克隆这一族原因给出，且必须在输出里说清原因。 */
    expect([0, 1, 2]).toContain(code);
    if (code === 2) expect(output).toContain("[premerge] ");
  });

  test("锚点 = **分叉点**（`merge-base` 要并进去的那条 vs HEAD），不是上游的尖端", async () => {
    /* 为什么必须是分叉点：判据说的是「结果版退回了**基线之前**的某一版」。
     * 拿上游的**尖端**当基线，会把分支侧自己的正当改动整片读成差异 ——
     * 而那个方向上的误报会让这条判据被学会绕开。
     *
     * **必须在真的分叉仓库里判**：本检出的 `merge-base(master, HEAD)` 恰好等于
     * `origin/master`（HEAD 直接长在它上面），拿它当夹具的话「取尖端」这个变异
     * 也能通过 —— 那是一条**看起来在判、实际判不出**的用例。 */
    const repo = mkdtempSync(join(tmpdir(), "premerge-anchor-"));
    try {
      const g = (...args: string[]) =>
        execFileSync(
          "git",
          [
            "-c",
            "user.email=t@t",
            "-c",
            "user.name=t",
            /* 宿主可能全局开了签名（实测报 `gpg failed to sign the data`）——
             * 不就地关掉，夹具会在 `commit` 这一步失败、报错还指不到夹具。 */
            "-c",
            "commit.gpgsign=false",
            ...args,
          ],
          { cwd: repo, encoding: "utf8" },
        ).trim();
      g("init", "-q", "-b", "master");
      writeFileSync(join(repo, "a.txt"), "1\n");
      g("add", "-A");
      g("commit", "-qm", "c1");
      const fork = g("rev-parse", "HEAD");

      /* 本地线（HEAD 所在）从分叉点往前走一笔 —— `resolveMergeBaseRef` 取的是
       * `<remote>/master` 或**本地 master**，所以工作线必须**不是** master。 */
      g("checkout", "-q", "-b", "work");
      writeFileSync(join(repo, "b.txt"), "1\n");
      g("add", "-A");
      g("commit", "-qm", "mine");

      /* 上游 / 本地 master 再往前走两笔 ⇒ 尖端 ≠ 分叉点。 */
      g("checkout", "-q", "master");
      for (const n of ["u1", "u2"]) {
        writeFileSync(join(repo, `${n}.txt`), "1\n");
        g("add", "-A");
        g("commit", "-qm", n);
      }
      const tip = g("rev-parse", "master");
      g("checkout", "-q", "work");

      const { resolveLossBaseline } = await import("../scripts/premerge-check.mjs");
      const got = resolveLossBaseline(repo);
      expect(got.ok).toBe(true);
      if (!got.ok) return;
      /* 关键：它得停在**分叉点**，不是上游尖端。 */
      expect(got.baseline).toBe(fork);
      expect(got.baseline).not.toBe(tip);
        } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("算不出锚点时**退 2 并说明**，绝不静默退 0（静默的绿比没有更坏）", async () => {
    /* 这一格与上面那条是一对：上面判「锚点在的时候真跑」，这条判「锚点不在的时候
     * 不许装作跑过」。混成一档的后果实测过 —— 「这个动作天天报不构成证据」之后
     * 就没人看了，而真正的故障正好被那层噪声淹没。 */
    const repo = mkdtempSync(join(tmpdir(), "premerge-noanchor-"));
    try {
      const g = (...args: string[]) =>
        execFileSync(
          "git",
          [
            "-c",
            "user.email=t@t",
            "-c",
            "user.name=t",
            "-c",
            "commit.gpgsign=false",
            ...args,
          ],
          { cwd: repo, encoding: "utf8" },
        ).trim();
      g("init", "-q", "-b", "work");
      writeFileSync(join(repo, "a.txt"), "1\n");
      g("add", "-A");
      g("commit", "-qm", "c1");
      /* 没有 `origin/master`、也没有本地 `master` ⇒ `resolveMergeBaseRef` 给 null。 */
      const { resolveLossBaseline } = await import("../scripts/premerge-check.mjs");
      const got = resolveLossBaseline(repo);
      expect(got.ok).toBe(false);
      if (!got.ok) expect(got.reason).toContain("取不到要并进去的那条");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("三段全跑时，`mergeLoss` 段不是「没跑起来」", () => {
    /* 上一条判的是单段；这条判的是**编排**那一半：整跑时第三段也得真跑。 */
    const { output } = run(["--skip-base"]);
    expect(output).toContain("合并有没有把一侧整份覆盖掉");
    expect(output).not.toContain("缺少 --baseline");
  });
});
