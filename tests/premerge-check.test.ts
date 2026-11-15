/**
 * 「**合并前的固定动作**」的唯一入口（规范 §13.6.2 + §13.5.4；ISSUE #1611 拍板）。存在理由只有一个：**把「记住跑全三件事」从纪律变成一条命令** —— 平台侧 squash 合并**不跑本地钩子**、#623 之后**也无 CI 兜底**，「我的分支绿 → master 绿」那一跳的三条判据都天然跑不进 pre-commit，唯一执行者是「合并前敲一次」的人，而三种漏法（漏跑 / 顺序反 / 只跑记得那条）都不报错。
 * 所以本文件判**编排**那几件容易静默失效的事：①每段各自在、且**不发明第二套实现**（`base` 走 `baseCheckMany`，其余走既有脚本 —— 抄一份就会漂，§12.18 / §12.12）；②总码「没跑起来」(2) 压过「红了」(1)（拿无法归因的读数下判决是把人往错方向送，§13.6.2）。
 * ③ `base` 段的四态 ⇄ 退出码折算只在**一处**（`current-green`=0、`yours`/`baseline-red`=1、`inconclusive`=2）；④ `--only` / `--skip-*` 开关真的在筛段，且**筛空 = 2**（不许「各段全跳过」却报全绿）；跳过清单按 `SEGMENTS` 推，不硬写段数。
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { isRecord, isUnknownArray } from "~/lib/is-record";

import { gitSandboxEnv } from "./helpers/git-sandbox-env";

import {
  combineCodes,
  lastSummary,
  SEGMENTS,
  scriptsInCommands,
} from "../scripts/premerge-check.mjs";

const SCRIPT = join(process.cwd(), "scripts", "premerge-check.mjs");

/**
 * 本检出 `HEAD` 的 sha —— 当**显式**的改动面基线（ISSUE #2799）。`run()` 已用 `gitSandboxEnv()` 剥过平台那一族，剥完后「哪一条是基线」只剩「宿主有没有 `master` 引用」—— 那是这台机器的事实，不是被测行为；平台节点只 fetch 协商后的单 ref（`.cnb.yml` 注释），于是本机绿、平台整组红成 `expected 2 to be 0`（PR #2784 现场）。
 * 显式传 `HEAD` 的 sha 是刻意的：分叉点 == HEAD ⇒ 待审那一批为空 ⇒ `check-commit-claims.mjs` 说「无可审，不是判过」并退 0（本仓对这一档的定义），于是这一组判的是**编排**（筛段 / JSON / 旗标），不掺任何宿主状态。
 * 判据行为一个字没动：取不到基线仍然退 2（「没判 ≠ 绿」，§13.6.2）—— 那条由「算不出锚点时**退 2 并说明**」守着，两种机器上都照旧。
 */
function headBaseline(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: process.cwd(),
    encoding: "utf8",
  }).trim();
}

/**
 * 跑一次入口脚本 —— **子进程里跑**，但不是「裸」跑。每段都在**真检出**上敲 git（`resolveForkBaseline` 与两段各自起的 `check-commit-claims.mjs` / `check-merged-side-loss.mjs`），所以它对仓库**位置**极其敏感，而继承环境会把它指到别处：`GIT_DIR` / `GIT_INDEX_FILE` 一族（git 导给钩子，pre-commit 里的 vitest 一路继承，见 `git-sandbox-env.ts` 文件头）；`CNB_PULL_REQUEST_TARGET_SHA` / `CNB_COMMIT` / `CNB_PULL_REQUEST_MERGE_SHA`（平台那一跑的改动面读数，ISSUE #2787）—— 于是「分叉点是哪一条」本地与平台上**不是同一个问题**。
 * `tests/setup.ts` 已在 worker 启动时剥过一次，但夹具**自己**起的这一次不该指望上游清理（与 `gate-repo.ts`「共享夹具要自带隔离」同一条口径）。剥法复用 `gitSandboxEnv()`（唯一一份清单，§12.18），顺带注入「禁签名 + 身份」；基线与平台变量**一律显式给** —— 剥干净后只剩「宿主恰好有什么」，那正是 #2799 的症状。
 * @param args 交给入口的旗标 @param baseline 这一次的改动面基线（默认本检出 HEAD 的 sha）
 */
function run(args: Array<string> = [], baseline: string = headBaseline()) {
  try {
    const output = execFileSync(process.execPath, [SCRIPT, ...args], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: gitSandboxEnv({ CNB_PULL_REQUEST_TARGET_SHA: baseline }),
    });
    return { code: 0, output };
  } catch (error) {
    /* 失败形状用运行时守卫取字段，不走 `as` 断言（B5 清账）。 */
    const e: { status?: unknown; stderr?: unknown; stdout?: unknown } =
      typeof error === "object" && error !== null ? error : {};
    return {
      code: typeof e.status === "number" ? e.status : 1,
      output: `${typeof e.stdout === "string" ? e.stdout : ""}${
        typeof e.stderr === "string" ? e.stderr : ""
      }`,
    };
  }
}

/**
 * 「这一段没有结论」不是「这条判据红了」—— **锚点取不到**时的统一读法（PR #2784 现场）。`claims` / `mergeLoss` 两段的锚点是 `git merge-base(<要并进去的那条>, HEAD)`，而入口跑在**真检出**上：仓库冻结在合并态（`MERGE_HEAD` 在场、合并未落地）时 `merge-base` 退 1、stdout 空；要并进去的那条不在（平台节点只 fetch 协商后的单 ref）也算不出。
 * 两种情形下入口都如实记 **2（没跑起来）**，那是**正确的读数** —— 分叉点确实不可知。错的是下面三条用例：它们问的是「`--only` / `--json` / `--full` 有没有生效」，却用字面 `0` 钉死，把这个与题面无关的前提一起钉住 —— 本机绿、平台红，报错只说得出一句 `expected 2 to be +0`。
 * 所以豁免只有**一格**：读数必须是 2 **且**输出里那句正是「取不到 / 算不出锚点」；别的 2（参数不认识、段名不存在……）照旧红。@param code 入口的退出码 @param output 入口的输出（两流合并）
 */
function expectAnchorMissRead(code: number, output: string): void {
  const merged = existsSync(join(process.cwd(), ".git", "MERGE_HEAD"));
  if (code === 0) {
    /* 绿就对了 —— 锚点算得出（合并态、目标引用在不在都不重要）。 */
    return;
  }
  /* 非 0：只放行「锚点取不到」这一形，其余照旧红。 */
  expect(
    code,
    `这一跳的读数不是「没结论」，是别的东西 —— 换成 0 才说明 ` +
      `\`--only\` / \`--json\` / \`--full\` 生效了（合并态=${merged}）：\n${output}`,
  ).toBe(2);
  expect(output).toMatch(/算不出|取不到要并进去的那条/);
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
  test("各段全被跳过 ⇒ 退 2，**不许**报全绿", () => {
    /* 「什么都没复算」与「复算过且全绿」必须分开 —— 同 §11.23.1：静默的绿比没有更坏（它让人以为这件事有人管）。⚠️ 跳过清单**从 `SEGMENTS` 推**，不硬写。
     * 硬写那版在 #2022 加出 `unitTests` 段后变成环境依赖的用例：它跳了 3/4 段，剩下那段的「没跑起来」把结论词从「各段全被跳过」换成「有段没跑起来」，于是能算出改动清单的检出绿、算不出的红。
     * 从段表推 ⇒ 以后加一段，这里不跟着处理就当场红。 */
    const allSkips = Object.keys(SEGMENTS).flatMap((key) => [`--skip-${key}`]);
    expect(
      allSkips.length,
      "SEGMENTS 是空的 —— 这条用例就没有对象了，别让它绿着骗人",
    ).toBeGreaterThan(0);
    const { code, output } = run(allSkips);
    expect(code).toBe(2);
    expect(output).toContain("全被跳过");
  });

  test("`--only` 点名不存在的段 ⇒ 退 2 并说明", () => {
    const { code } = run(["--only=nonexistent"]);
    expect(code).toBe(2);
  });

  test("`--only=claims` 只跑那一段（不跑复算那一大段）", () => {
    const { code, output } = run(["--only=claims"]);
    expectAnchorMissRead(code, output);
    expect(code).toBe(0);
    expect(output).toContain("提交信息里的机械可核声明");
    /* 复算那一段的标签不该出现 —— 出现了说明 `--only` 没筛住。 */
    expect(output).not.toContain("合并前复算（钩子里那批全仓判据）");
  });

  test("`--json` 给出逐段结论（机器可读那一半）", () => {
    const { code, output } = run(["--only=claims", "--json"]);
    expectAnchorMissRead(code, output);
    expect(code).toBe(0);
    const parsed: unknown = JSON.parse(output);
    if (!isRecord(parsed) || !isUnknownArray(parsed.segments)) {
      throw new Error("--json 输出形状不对（缺 segments 数组）");
    }
    expect(parsed.code).toBe(0);
    expect(parsed.segments).toHaveLength(1);
    const firstSegment = parsed.segments[0];
    if (!isRecord(firstSegment) || firstSegment.key !== "claims") {
      throw new Error("--json 的第一段不是 claims");
    }
  });
});

describe("premerge-check —— 旗标解析（#2764）", () => {
  test("拼错的旗标 ⇒ 退 2 并**点名**那一枚（不许静默吞）", () => {
    /* 立案形状：`--full` 在 AGENTS.md 与 ship Skill 里被写成「全套那一档」，而入口的
     * `parseArgs` 没有 else 分支 —— 拼错的旗标既不生效也不报错，于是「我跑的是全套」
     * 这句话没有任何依据。退 2 是这一格唯一的诚实读数：没跑起来 ≠ 跑了且绿。 */
    const { code, output } = run(["--fulll"]);
    expect(code).toBe(2);
    expect(output).toContain("--fulll");
    expect(output).toContain("不认识");
  });

  test("`--full` 是默认档的显式写法，与不给它逐字相同", () => {
    const plain = run(["--only=claims"]);
    const explicit = run(["--only=claims", "--full"]);
    expectAnchorMissRead(plain.code, plain.output);
    expect(plain.code).toBe(0);
    expect(explicit.code).toBe(plain.code);
  });

  test("`--full` 与 `--light` 同时给 ⇒ 退 2（入口不替人挑档）", () => {
    const { code, output } = run(["--full", "--light", "--only=claims"]);
    expect(code).toBe(2);
    expect(output).toContain("--full");
    expect(output).toContain("--light");
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
        `process.stdout.write(require("node:fs").readFileSync(${JSON.stringify(SCRIPT)}, "utf8"))`,
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

  test("除 `base` 之外各段走既有脚本（子进程），不把它们的判据逻辑抄进来", () => {
    const source = execFileSync(
      process.execPath,
      [
        "-e",
        `process.stdout.write(require("node:fs").readFileSync(${JSON.stringify(SCRIPT)}, "utf8"))`,
      ],
      { encoding: "utf8" },
    );
    expect(source).toContain('script: "check-commit-claims.mjs"');
    expect(source).toContain('script: "check-merged-side-loss.mjs"');
  });
});

describe("premerge-check —— 带锚点的那两段真的在跑（不许恒退 2、也不许只审一笔）", () => {
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
    /* 「没跑起来」（2）必须说清原因 —— 条件收进合取式（非 2 即恒真），
     * 断言本体无条件跑（no-conditional-expect）。 */
    expect(code !== 2 || output.includes("[premerge] ")).toBe(true);
  });

  test("`claims` 段的扫描面是**这批**，不是「最新那一笔」（ISSUE #2070）", () => {
    /* 立案形状：`SEGMENTS.claims` 此前是裸 `script` + `args: []`，而 `check-commit-claims.mjs` 不带参数时**只审 HEAD** —— 批次里较早那笔的假声明在推送那一刻没人看，合并之后 HEAD 前进，就再没有第二个执行者重放它（`ad81a912` 就是这么进的主干）。
     * 判据本体一字未改，改的是**取哪些提交**：同一个分叉点锚，交出去的是 `<分叉点>..HEAD`。这里判的是**编排**那一半（取数形状）；行为那一半在 `tests/check-commit-claims.test.ts` 的 ①b 那组。
     */
    /* 段表是 `Record<string, 联合>`，取数形状那一格在各成员上键不同 —— 这里按判据
     * 要问的三样取一个视图，而不是往生产类型里塞可选键。 */
    const claims: { args?: Array<string>; kind: string; shape?: string } = SEGMENTS.claims!;
    expect(claims.kind).toBe("anchored");
    expect(claims.shape).toBe("range");
    /* 反向那半：这一段不许再带回「空 args」的旧形态 —— 那就是缺陷本身。 */
    expect(claims.args).toBeUndefined();
  });

  test("同一次跑里不判两遍：`base` 段跑过的那份脚本不再单跑（#2070 的连带）", () => {
    /* 事实纠正（本单动手时查实）：批次面**早就有执行者** —— `resolveMergeBatch` 的第二个来源（`base-check/chained-steps.mjs`）已经把 `check-commit-claims.mjs --range <base>..HEAD` 收进 base 段那一批。
     * 真正漏的是两处：`--light` 会把那条筛掉（本地档那一串里没有它），以及本文件自己那格 `claims` 只审 HEAD。改成审同一批之后，全档那一跑就可能出现**两遍同样的核对**（带声明的提交单条约 49 秒）。
     */
    const chained = [
      {
        argv: ["node", "scripts/check-commit-claims.mjs", "--range", "x..HEAD"],
      },
      { argv: ["node", "scripts/check-file-structure.cjs"] },
    ];
    const seen = scriptsInCommands(chained);
    expect(seen.has("scripts/check-commit-claims.mjs")).toBe(true);
    expect(seen.has("scripts/check-file-structure.cjs")).toBe(true);

    /* `--light` 筛过之后那一批里**没有**它 —— 这时去重必须不生效，
     * 否则「light 档没跑」会被读成「base 段跑过了」，那正是假绿的形状。 */
    const light = [{ argv: ["node", "scripts/check-file-structure.cjs"] }];
    expect(scriptsInCommands(light).has("scripts/check-commit-claims.mjs")).toBe(false);

    /* 非脚本项（`pnpm run lint` 那一族）不该被当成「跑过某个 .mjs」。 */
    expect(scriptsInCommands([{ argv: ["pnpm", "run", "lint"] }]).size).toBe(0);
    expect(scriptsInCommands([]).size).toBe(0);
  });

  test("`--only=claims` 真跑起来，且不把「这批没带新提交」报成判据坏了", () => {
    /* 在真仓库上跑这一段：区间为空（分叉点 == HEAD）时脚本说「无可审，不是判过」并
     * 退 0；旧形态在那一档说「取不到要审的提交」+ 退 2，于是「刚 fetch 完还没动手」
     * 会被读成「这条判据跑不了」。两种读数不能混（§13.6.2）。 */
    const { code, output } = run(["--only=claims"]);
    expect(output).not.toContain("取不到要审的提交");
    expect([0, 1, 2]).toContain(code);
    /* 两支条件读数收进合取式：2 必须说「没跑起来」的原因、0 必须报得出条数或
     * 「无可审」—— 断言本体无条件跑（no-conditional-expect）。 */
    expect(code !== 2 || output.includes("[premerge] ")).toBe(true);
    expect(code !== 0 || /次提交|无可审/.test(output)).toBe(true);
  });

  test("锚点 = **分叉点**（`merge-base` 要并进去的那条 vs HEAD），不是上游的尖端", async () => {
    /* 为什么必须是分叉点：判据说的是「结果版退回了**基线之前**的某一版」。拿上游的**尖端**当基线，会把分支侧自己的正当改动整片读成差异 —— 而那个方向上的误报会让这条判据被学会绕开。
     * **必须在真的分叉仓库里判**：本检出的 `merge-base(master, HEAD)` 恰好等于 `origin/master`（HEAD 直接长在它上面），拿它当夹具的话「取尖端」这个变异也能通过 —— 那是一条**看起来在判、实际判不出**的用例。
     */
    const repo = mkdtempSync(join(tmpdir(), "premerge-anchor-"));
    try {
      const g = (...args: Array<string>) =>
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
          /* 临时仓库里的 git 自带隔离（同 `run()` 那段：钩子 / 平台那一跑的变量会让
           * 它操作到**别的**仓库，而那类故障在日志里长得像夹具坏了）。 */
          { cwd: repo, encoding: "utf8", env: gitSandboxEnv() },
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

      const { resolveForkBaseline } = await import("../scripts/premerge-check.mjs");
      const got = resolveForkBaseline(repo);
      expect(got.ok).toBe(true);
      if (!got.ok) {
        return;
      }
      /* 关键：它得停在**分叉点**，不是上游尖端。 */
      expect(got.baseline).toBe(fork);
      expect(got.baseline).not.toBe(tip);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("平台上那条线**没有 `master` 引用**时：目标 sha 从 env 进来，分叉点照样算得出", async () => {
    /* 为什么需要这一格：自托管那条流水线**只 fetch 协商后的单 ref**（`refs/heads`
     * 零条 —— 读数就在 `工作区复用读数` 那一格的注释里），所以 `resolveMergeBaseRef`
     * 那套「各 remote 的 master / 本地 master」在平台上未必取得到东西。
     * `claims` 要上平台当第二个执行者（#2070），就得认平台给的那个来源
     * （`CNB_PULL_REQUEST_TARGET_SHA`，`ci-affected-tests.mjs` 用的同一个）。 */
    const repo = mkdtempSync(join(tmpdir(), "premerge-envtarget-"));
    try {
      const g = (...args: Array<string>) =>
        execFileSync(
          "git",
          ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...args],
          /* 临时仓库里的 git 自带隔离（同 `run()` 那段）。 */
          { cwd: repo, encoding: "utf8", env: gitSandboxEnv() },
        ).trim();
      /* 全程不出现任何名为 `master` 的引用 —— 这就是平台检出的形状。 */
      g("init", "-q", "-b", "main");
      writeFileSync(join(repo, "a.txt"), "1\n");
      g("add", "-A");
      g("commit", "-qm", "base");
      const target = g("rev-parse", "HEAD");
      g("checkout", "-q", "-b", "work");
      writeFileSync(join(repo, "b.txt"), "1\n");
      g("add", "-A");
      g("commit", "-qm", "mine");

      const { resolveForkBaseline } = await import("../scripts/premerge-check.mjs");

      /* ① 没有 env：这条路在平台上就是取不到，必须**照实说取不到**（不是编一个基线）。 */
      const without = resolveForkBaseline(repo, {});
      expect(without.ok).toBe(false);

      /* ② 有 env：目标 sha 落在这份对象库里 ⇒ 分叉点算得出来，且是 `merge-base`
       *    而不是那个尖端本身 —— 这里 target 恰好是 HEAD 的祖先，所以两者相同；
       *    关键是它**仍然走了 merge-base**（上一条测试判的是尖端 ≠ 分叉点那一形）。 */
      const withEnv = resolveForkBaseline(repo, {
        CNB_PULL_REQUEST_TARGET_SHA: target,
      });
      expect(withEnv.ok).toBe(true);
      if (!withEnv.ok) {
        return;
      }
      expect(withEnv.baseline).toBe(target);
      /* 交出去的那一批就是「PR 自己的提交」，不多不少一笔。 */
      const batch = execFileSync("git", ["log", "--format=%s", `${withEnv.baseline}..HEAD`], {
        cwd: repo,
        encoding: "utf8",
        env: gitSandboxEnv(),
      })
        .trim()
        .split("\n");
      expect(batch).toEqual(["mine"]);

      /* ③ env 里那个 sha 不在对象库里（浅克隆之外的另一态）⇒ **不**拿它充数，
       *    退回引用那一套、取不到就照实说。宁可「没跑起来」，不要一个假基线。 */
      const bogus = resolveForkBaseline(repo, {
        CNB_PULL_REQUEST_TARGET_SHA: "f".repeat(40),
      });
      expect(bogus.ok).toBe(false);
      if (bogus.ok) throw new Error("unreachable：ok=false 已由上一行断言");
      expect(bogus.reason).toContain("CNB_PULL_REQUEST_TARGET_SHA");
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
      const g = (...args: Array<string>) =>
        execFileSync(
          "git",
          ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...args],
          /* 临时仓库里的 git 自带隔离（同 `run()` 那段）。 */
          { cwd: repo, encoding: "utf8", env: gitSandboxEnv() },
        ).trim();
      g("init", "-q", "-b", "work");
      writeFileSync(join(repo, "a.txt"), "1\n");
      g("add", "-A");
      g("commit", "-qm", "c1");
      /* 没有 `origin/master`、也没有本地 `master` ⇒ `resolveMergeBaseRef` 给 null。 */
      const { anchorMissed, resolveForkBaseline } = await import("../scripts/premerge-check.mjs");
      const got = resolveForkBaseline(repo);
      expect(got.ok).toBe(false);
      if (got.ok) throw new Error("unreachable：ok=false 已由上一行断言");
      {
        expect(got.reason).toContain("取不到要并进去的那条");
        /* **编排那一半也要判**：这一段此前把 `ok:false` 折成 `code: 0` —— 函数契约
         * 对了、接线错了，于是「取不到分叉点」在总读数里是**绿**。`anchorMissed` 是
         * 两段（`claims` / `mergeLoss`）唯一的共用折算点，把它提成纯函数才判得动
         * （`main` 里那一段要真跑 git，用例进不去）。
         * 变异复算：把这里改回 0 ⇒ 本条当场红。 */
        const missed = anchorMissed("某段", got.reason);
        expect(missed.code).toBe(2);
        expect(missed.output).toContain(got.reason);
        expect(missed.output).toContain("没跑起来");
        // 而且 2 压过 1：合成器不许把「没跑起来」降级成「红了」。
        expect(combineCodes([0, missed.code, 1])).toBe(2);
      }
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("平台那一格：目标 sha 只在 env 里时，`claims` 审的是**这批**而不是 `HEAD`（ISSUE #2788）", () => {
    /* 立案现场（第 2784 号 PR 的「提交声明核对」那一格，三轮都 0.5 秒红）：这段此前把 `<分叉点>..HEAD` 当**位置参数**交给 `check-commit-claims.mjs`，而那份脚本只从 **`--range`** 认区间 —— 位置参数被它当成「审这一个 rev」，于是 `git log <sha>..HEAD` 被读成一次提交查询 ⇒ `取不到要审的提交` ⇒ 退 2。
     * 本机绿是因为那份脚本的 `--commit <rev>` 兜底读到了 env 里的 `CNB_PULL_REQUEST_TARGET_SHA`；而平台**节点不 fetch `origin/master`**，本文件算锚点走的是 env，子进程却拿不到同一个来源 —— 两个来源不一致。修法：锚点由本文件算、按 `--range` 显式交出去（区间端点与 HEAD 同库）。
     * 判的是**调用形状**那一半（子进程确实收到 `--range <分叉点>..HEAD`）；「审了几笔」那一半由 `tests/check-commit-claims.test.ts` 的区间那组兜着。 */
    const repo = mkdtempSync(join(tmpdir(), "premerge-claims-args-"));
    try {
      const g = (...args: Array<string>) =>
        execFileSync(
          "git",
          ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...args],
          /* 临时仓库里的 git 自带隔离（同 `run()` 那段）。 */
          { cwd: repo, encoding: "utf8", env: gitSandboxEnv() },
        ).trim();
      g("init", "-q", "-b", "main");
      writeFileSync(join(repo, "a.txt"), "1\n");
      g("add", "-A");
      g("commit", "-qm", "base");
      const target = g("rev-parse", "HEAD");
      g("checkout", "-q", "-b", "work");
      writeFileSync(join(repo, "b.txt"), "1\n");
      g("add", "-A");
      g("commit", "-qm", "mine");

      /* 平台形状：**没有任何 master 引用**，目标 sha 只在 env 里。 */
      const env = { ...gitSandboxEnv(), CNB_PULL_REQUEST_TARGET_SHA: target };
      execFileSync(
        process.execPath,
        [join(process.cwd(), "scripts", "premerge-check.mjs"), "--only=claims"],
        {
          cwd: repo,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          env,
        },
      );
      /* 跑通就说明整条链对上了（旧形状在这里退 2：那边锚点取自安装位置那份检出、
       * 子进程却在 cwd 那份里找端点）。再独立跑一次同一份区间，钉住「审到的就是
       * 这一批、一笔不多一笔不少」—— 只判退出码会让「审了 0 笔却报绿」也通过。 */
      const claims = execFileSync(
        process.execPath,
        [join(process.cwd(), "scripts", "check-commit-claims.mjs"), "--range", `${target}..HEAD`],
        { cwd: repo, encoding: "utf8", env: gitSandboxEnv() },
      );
      expect(claims).toContain("1 次提交");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("整跑时 `mergeLoss` 段不是「没跑起来」", () => {
    /* 上一条判的是单段；这条判的是**编排**那一半：多段一起跑时 `mergeLoss` 也得真跑（按段名说、不按第几段说 —— 段序在 #2022 加出 `unitTests` 那一档时已经挪过一次，2026-10-20 那一档又撤了，按位置说下次还会错）。
     * ⚠️ 这里跳掉 `base` 就够：`unitTests` 段撤了之后，剩下的段全是廉价的纯 git / 文本复查（`claims` / `mergeLoss`），没有哪一段的耗时取决于宿主检出的分支拓扑。 */
    const { output } = run(["--skip-base"]);
    expect(output).toContain("合并有没有把一侧整份覆盖掉");
    expect(output).not.toContain("缺少 --baseline");
  });
});
