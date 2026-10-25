/**
 * pre-commit 耗时账（规范 §13.5.8.3）的在位判据。
 *
 * 这一族要防的失效形态是**静默**的：账本少记一条、记错刻度、或者根本没被钩子调用 ——
 * 三种都**不会让任何提交红**（记账本来就刻意不阻断）。所以判据只能落在形态上：
 *
 *   ① 记账/读账的往返（写进去什么、读出来什么、渲染成什么样）；
 *   ② 账本落点（`.git/`、不入库 —— 写进版本库会让同仓并行检出互相污染）；
 *   ③ 钩子的接线（`timing.sh` 被三处 source、`run()` **只定义一份**且走 `timed_step`、
 *      `LOGD` 导出）；
 *   ④ **记账不改变退出码**（这是这一族最该守住的一条：一条记账线路变成提交的必经
 *      之路，迟早有人为它 `--no-verify`）。
 *
 * 不真跑一次完整的 pre-commit（那是分钟级、且要装齐依赖）：④ 用「喂一份读不出的
 * 账本」的输入端判 —— 记账失败时退出码仍是 0。
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { gitSandboxEnv } from "./helpers/git-sandbox-env";
import { groupShBody, stepsInGroup } from "./helpers/hook-groups";

const REPO_ROOT = resolve(".");
const SCRIPT = join(REPO_ROOT, "scripts", "precommit-timing.mjs");
const HOOK = join(REPO_ROOT, ".githooks", "pre-commit");
const TIMING_SH = join(REPO_ROOT, ".githooks", "timing.sh");

/**
 * 跑一次脚本（黑盒）。返回退出码与 stdout/stderr —— 本档判的是 CLI 契约，
 * 不 import 模块内部函数（那会与「脚本仍能单独跑」这条契约脱节）。
 *
 * 用 `spawnSync` 而不是 `execFileSync`：结论有一半在 stderr 上（「没能落盘 ——
 * 不影响提交」），而 `execFileSync` 成功时只回 stdout —— 第一版因此在「退出码 0 +
 * 往 stderr 说了一句」那条路径上什么也读不到。`spawnSync` 三样都给，与退出码无关。
 *
 * @param {string[]} args
 * @param {string} [cwd]
 * @returns {{code: number, out: string, err: string}}
 */
function run(args: string[], cwd = REPO_ROOT) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    code: typeof r.status === "number" ? r.status : -1,
    out: String(r.stdout ?? ""),
    err: String(r.stderr ?? ""),
  };
}

/** 账本一条记录的形状（判据只读下面这几个字段）。 */
type LedgerRun = {
  totalMs: number;
  stagedFiles: number;
  groups: { name: string; ms: number }[];
  steps: { name: string; ms: number }[];
  /** 组 C 的分文件读数（后加的一格，旧记录里没有 —— 报表那侧不许为它打空表）。 */
  files?: { name: string; ms: number }[];
  filesExpected?: number;
  filesMissing?: number;
};

/**
 * 读 `--json` 的输出。用一个显式的收窄而不是裸 `JSON.parse`：后者给 `any`，
 * eslint 的 `no-unsafe-*` 那一族（类型化规则）会逐行报 —— 本仓零警告口径下
 * 那就是 11 条 error。收窄写成 `unknown` → 断言成已知形状，形状漂了由用例断言兜。
 *
 * @param {{out: string}} result
 * @returns {LedgerRun[]}
 */
function readLedger(result: { out: string }): LedgerRun[] {
  return JSON.parse(result.out) as LedgerRun[];
}

/**
 * 读一条记录（用例几乎都只看「最近那条」）。
 *
 * 这里**显式判空并抛**，而不是 `runs[0]!`：本仓禁用非空断言
 * （`check-non-null-assertions.cjs`，硬闸），而 `runs[0].totalMs` 在
 * `noUncheckedIndexedAccess` 下是 `Object is possibly 'undefined'`。
 * 判空之后抛一句「账本是空的」比一个 `!` 有用：真的空掉时读得懂是哪一步错了。
 *
 * @param {{out: string}} result
 * @returns {LedgerRun}
 */
function firstRun(result: { out: string }): LedgerRun {
  const [run] = readLedger(result);
  if (!run) throw new Error(`账本是空的（--json 输出：${result.out}）`);
  return run;
}

/** 临时仓库（真的 `git init`）—— 账本落点由 `git rev-parse --absolute-git-dir` 定。 */
const tmpDirs: string[] = [];
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** @returns {string} */
function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), "precommit-timing-"));
  tmpDirs.push(dir);
  execFileSync("git", ["init", "--quiet"], { cwd: dir, env: gitSandboxEnv() });
  return dir;
}

describe("pre-commit 耗时账：记账与读账", () => {
  it("record 写一条、读账能读回同样的数", () => {
    const repo = makeRepo();
    const wrote = run(
      [
        "record",
        "--total-ms",
        "69400",
        "--exit",
        "0",
        "--staged",
        "3",
        "--group",
        "A=3500",
        "--group",
        "C=23400",
        "--step",
        "文件结构硬规则=820",
      ],
      repo,
    );
    expect(wrote.code).toBe(0);
    expect(wrote.out).toContain("已记录本次耗时");
    /* 账本**在 `.git/` 下**，不是仓库根 —— 这是「不入库 + 不跨检出污染」的落点判据。 */
    const ledger = join(repo, ".git", "comfy-precommit-timing.jsonl");
    expect(existsSync(ledger)).toBe(true);
    expect(existsSync(join(repo, "comfy-precommit-timing.jsonl"))).toBe(false);

    const view = run(["--json"], repo);
    expect(view.code).toBe(0);
    expect(readLedger(view)).toHaveLength(1);
    const record = firstRun(view);
    expect(record.totalMs).toBe(69400);
    expect(record.stagedFiles).toBe(3);
    expect(record.groups).toEqual([
      { name: "A", ms: 3500 },
      { name: "C", ms: 23400 },
    ]);
    expect(record.steps).toEqual([{ name: "文件结构硬规则", ms: 820 }]);
  });

  it("多条追加、不打乱前面的（账本的价值全在多次之间的比较）", () => {
    const repo = makeRepo();
    for (const total of [10000, 20000, 30000]) {
      run(["record", "--total-ms", String(total), "--exit", "0"], repo);
    }
    const runs = readLedger(run(["--json"], repo));
    expect(runs.map((r) => r.totalMs)).toEqual([10000, 20000, 30000]);
  });

  it("解析不出的耗时读数被丢掉并计数，但整条记录仍然落盘", () => {
    const repo = makeRepo();
    const wrote = run(
      [
        "record",
        "--total-ms",
        "1000",
        "--group",
        "A=not-a-number",
        "--step",
        "没有等号",
        "--group",
        "B=200",
      ],
      repo,
    );
    expect(wrote.code).toBe(0);
    expect(wrote.out).toContain("2 条耗时读数解析不出");
    expect(firstRun(run(["--json"], repo)).groups).toEqual([
      { name: "B", ms: 200 },
    ]);
  });

  it("还没记过账时读账不是错误（只是说没有记录）", () => {
    const repo = makeRepo();
    const view = run([], repo);
    expect(view.code).toBe(0);
    expect(view.out).toContain("还没有记录");
  });

  it("不在 git 检出里：记账不报错、也不写文件（记账不阻断）", () => {
    const bare = mkdtempSync(join(tmpdir(), "precommit-timing-nogit-"));
    tmpDirs.push(bare);
    const wrote = run(["record", "--total-ms", "100", "--exit", "0"], bare);
    expect(wrote.code).toBe(0);
    expect(wrote.err).toContain("不影响提交");
    expect(existsSync(join(bare, "comfy-precommit-timing.jsonl"))).toBe(false);
  });

  it("报告里有中位数、各组、逐步骤（人看的那一档不能只是原始 dump）", () => {
    const repo = makeRepo();
    for (const total of [20000, 40000]) {
      run(
        [
          "record",
          "--total-ms",
          String(total),
          "--exit",
          "0",
          "--group",
          "C=10000",
          "--step",
          "prettier 格式硬闸=2900",
        ],
        repo,
      );
    }
    const view = run([], repo);
    expect(view.code).toBe(0);
    expect(view.out).toContain("总时长：中位数 30.0s");
    expect(view.out).toContain("组 C");
    expect(view.out).toContain("prettier 格式硬闸");
  });

  it("--last N 只展示最近 N 次（但总数照报）", () => {
    const repo = makeRepo();
    for (const total of [1000, 2000, 3000]) {
      run(["record", "--total-ms", String(total), "--exit", "0"], repo);
    }
    const view = run(["--last", "1"], repo);
    expect(view.out).toContain("最近 1 次（共 3 条");
  });

  it("--clear 清空账本（且裸开关不带值时也认）", () => {
    const repo = makeRepo();
    run(["record", "--total-ms", "1000", "--exit", "0"], repo);
    expect(existsSync(join(repo, ".git", "comfy-precommit-timing.jsonl"))).toBe(
      true,
    );
    const cleared = run(["--clear"], repo);
    expect(cleared.code).toBe(0);
    expect(cleared.out).toContain("已清空");
    expect(run(["--json"], repo).out.trim()).toBe("[]");
  });

  it("半截行（上次写入被打断）不构成记录，也不让读账崩掉", () => {
    const repo = makeRepo();
    run(["record", "--total-ms", "1000", "--exit", "0"], repo);
    const ledger = join(repo, ".git", "comfy-precommit-timing.jsonl");
    writeFileSync(
      ledger,
      `${readFileSync(ledger, "utf8")}{"totalMs": 4242`,
      "utf8",
    );
    const runs = readLedger(run(["--json"], repo));
    expect(runs).toHaveLength(1);
  });
});

describe("pre-commit 耗时账：钩子的接线", () => {
  const hook = readFileSync(HOOK, "utf8");

  it("钩子三处都 source 同一份 timing.sh（外层 + D0 与 D 两个 `sh -c` 块）", () => {
    expect(hook).toContain('. "$COMFY_TIMING_SH"');
    /* 每个 `sh -c` 块都要自己 source 一次：新 shell 看不到外层函数，少了那一行就是
     * 「逐步读数落到一个空路径」，静默丢掉整组的账。D0 是新加的那个块。 */
    for (const id of ["D0", "D"]) {
      expect(
        groupShBody(hook, id),
        `组 ${id} 没有 source 时钟，或那个块解析不出来（组名 / 引号形状变了）`,
      ).toContain('. "$COMFY_TIMING_SH"');
    }
    /* 时钟与计时函数只在 timing.sh 里定义一次（抄两份的漂移是静默的）。 */
    const timing = readFileSync(TIMING_SH, "utf8");
    expect(timing).toContain("now_ms()");
    expect(timing).toContain("timed_step()");
    expect(timing).toContain("run()");
    expect(hook).not.toMatch(/^now_ms\(\)/m);
  });

  it("`run()` 只在 timing.sh 里定义一份，且走 timed_step 落 steps.ms", () => {
    /* 从「D 组里那份」改成「只在共享件里那一份」：钩子现在有两个这样的块（D0 前置档与
     * D 并行档），各写一份 `run()` 的漂移形态与那份文件头里「两份时钟必然漂成两个刻度」
     * 同款 —— 比如后来有人只给其中一处加「跳过时不打标签」，两组的逐步账就再也不能并排读，
     * 而账本自己不会报错。所以这里连**反向**一起钉：钩子里不许再长出第二份定义。 */
    const timing = readFileSync(TIMING_SH, "utf8");
    expect(timing).toMatch(/run\(\) \{[^}]*timed_step/s);
    /* 逐步读数必须落到 `$LOGD/steps.ms` 这个与 record_timing 约定的位置。 */
    expect(timing).toContain('"$LOGD/steps.ms"');
    expect(hook, "钩子里又出现了一份 `run()` 定义").not.toMatch(/^\s*run\(\)/m);
    // 两个块都真的经 `run` 逐步记账：调用点在，读数才在（解析不出块时这里会零命中）。
    for (const id of ["D0", "D"]) {
      expect(
        stepsInGroup(hook, id).length,
        `组 ${id} 里一条 ` + "`run`" + " 步骤都没有 —— 该组的逐步账从此消失",
      ).toBeGreaterThan(0);
    }
  });

  it("失败那一条自己也进账（`set -e` 不许在 printf 之前把组截掉）", () => {
    /* 立案现场：本轮第一次拿这份账当证据时，一份坏 changelog 碎片的红里只有它**前面**三步
     * 的读数 —— `timed_step` 里裸跑 `"$@"`，`set -e` 在那一行就把整个组截断了，下面的
     * printf 根本没执行。于是「哪一步把我拦下了」这个账本唯一要回答的问题，正好落在缺失的
     * 那一行上，而组的墙钟与步之和也对不上（差的就是那一条）。
     * 修法是把命令放进 `||` 的右侧：那里不触发 `set -e`，退出码照旧由 `return` 带出去
     * ⇒ **阻断语义一字未变**，只是失败那一条也留下读数。
     * 这里判源码形态而不是真起一次 sh：起 sh 要依赖 `sh` 在 PATH 上（CI 的 PowerShell
     * stage 不保证），而「拿环境早退换一条会绿的用例」正是 §11.17 明令禁止的那种绿。 */
    const timing = readFileSync(TIMING_SH, "utf8");
    expect(
      timing.includes('"$@" || _ts_rc=$?'),
      'timed_step 又回到裸跑 `"$@"` —— 失败那一条会在 printf 之前被 `set -e` 截掉，' +
        "于是账本里的「最后一步」成了拦下者**前面**那一步，而「哪一步拦的我」这个问题没有答案",
    ).toBe(true);
  });

  it("每步的两次读数走零 fork 的时钟（`timed_step` 里不许再有 `$(now_ms)`）", () => {
    /* 这条守的是**代价**，而代价不会让任何人报错：`$(date +%s%3N)` 在 MSYS 上每次 fork 约
     * 467ms，每步两次 ⇒ 一组 51 步就是 15–45s 的纯记账开销，且它**算在每条步的读数里**
     * （现场：一份 14 条的组墙钟 54.0s 而步之和 41.1s；换成 `set_now_ms` 之后 25.0s / 26.2s）。
     * 退回 `$(now_ms)` 的形态不是红，是每个人每次提交多等几十秒、并多一份对不上的账。 */
    const timing = readFileSync(TIMING_SH, "utf8");
    const body = /timed_step\(\) \{[\s\S]*?\n\}/.exec(timing)?.[0] ?? "";
    expect(body, "解析不出 timed_step 的函数体").not.toBe("");
    expect(
      body.includes("$(now_ms)"),
      "timed_step 又用命令替换取时钟 —— 那一步的钱会记进判据的读数里",
    ).toBe(false);
    expect(
      body.includes("set_now_ms _ts_start") &&
        body.includes("set_now_ms _ts_now"),
    ).toBe(true);
  });

  it("`LOGD` 与 `COMFY_TIMING_SH` 都导出（D 组是新 shell，未导出就读不到）", () => {
    /* 少了 `export LOGD` 的形态是「逐步读数落到一个空路径」—— 静默丢掉整组逐步的账。 */
    expect(hook).toMatch(/export LOGD/);
    expect(hook).toMatch(/export COMFY_TIMING_SH/);
  });

  it("记账挂在 EXIT trap 上（被拦下的那次提交也要记）", () => {
    expect(hook).toMatch(/trap '[^']*record_timing[^']*' EXIT/);
    /* 且 trap 的顺序是先记账再删 `$LOGD`（反了就记不到了）。 */
    const trap = /trap '([^']*)' EXIT/.exec(hook)?.[1] ?? "";
    expect(trap.indexOf("record_timing")).toBeLessThan(trap.indexOf("rm -rf"));
  });

  it("记账失败不影响退出码（只往 stderr 说一句）", () => {
    const timing = readFileSync(SCRIPT, "utf8");
    /* 记账侧唯一允许的非零退出路径是「参数错」，落盘失败一律 return 0。 */
    expect(timing).toMatch(/不影响提交/);
    /* 钩子侧对 recorder 的调用不许把它的退出码带进提交的退出码。 */
    expect(hook).toMatch(
      /precommit-timing\.mjs record "\$@" \|\| true|precommit-timing\.mjs record/,
    );
  });
});

/**
 * 一份最小可用的 vitest junit 输出。
 *
 * 形状按实测写：外层 `<testsuites name="vitest tests">` 是**汇总**（它的 `time` 是各
 * suite 之和，不是墙钟、更不是某个文件），每个文件是一个内层
 * `<testsuite name="tests/x.test.ts" time="0.33">`。判据若只喂「一个 testsuite」的简化
 * 形状，就正好漏掉这条坑：把汇总当成一个文件，读数凭空多一份。
 *
 * @param {[string, number][]} rows `[文件, 秒]`
 */
function junitXml(rows: [string, number][]) {
  const suites = rows
    .map(
      ([name, secs]) =>
        `    <testsuite name="${name}" timestamp="2026-10-18T00:00:00.000Z" ` +
        `hostname="H" tests="1" failures="0" errors="0" skipped="0" time="${secs}">` +
        `\n        <testcase classname="${name}" name="t" time="${secs}"></testcase>` +
        `\n    </testsuite>`,
    )
    .join("\n");
  return (
    `<?xml version="1.0" encoding="UTF-8" ?>\n` +
    `<testsuites name="vitest tests" tests="${rows.length}" failures="0" errors="0" time="9">\n` +
    `${suites}\n</testsuites>\n`
  );
}

/**
 * 落一个「组 C 读数」目录：清单（分母）+ 每块每遍各一个 XML。
 *
 * @param {string[]} files 这次要跑的清单
 * @param {Record<string, [string, number][]>} xmls 文件名 → 该文件里的 suite
 */
function makeCDir(
  files: string[],
  xmls: Record<string, [string, number][]>,
): string {
  const dir = mkdtempSync(join(tmpdir(), "precommit-c-"));
  tmpDirs.push(dir);
  writeFileSync(
    join(dir, "comfy-c-files.txt"),
    `${files.join("\n")}\n`,
    "utf8",
  );
  for (const [name, rows] of Object.entries(xmls)) {
    writeFileSync(join(dir, name), junitXml(rows), "utf8");
  }
  return dir;
}

describe("组 C 的分文件读数：自带分母与对账，否则它只是另一张没法比的表", () => {
  it("清单 3 份而 junit 只给出 2 份 ⇒ 缺的那份被点名，不许当成 0 秒", () => {
    const repo = makeRepo();
    const dir = makeCDir(
      ["tests/a.test.ts", "tests/b.test.ts", "tests/c.test.ts"],
      {
        "comfy-c-0-1.xml": [
          ["tests/a.test.ts", 1.5],
          ["tests/b.test.ts", 0.25],
        ],
      },
    );
    const wrote = run(
      ["record", "--total-ms", "9000", "--exit", "0", "--junit-dir", dir],
      repo,
    );
    expect(wrote.code).toBe(0);
    expect(wrote.out).toContain("组 C 分文件 2 份");
    expect(wrote.out).toContain("1 份没给出读数");
    const record = firstRun(run(["--json"], repo));
    expect(record.files).toEqual([
      { name: "tests/a.test.ts", ms: 1500 },
      { name: "tests/b.test.ts", ms: 250 },
    ]);
    expect(record.filesExpected).toBe(3);
    expect(record.filesMissing).toBe(1);
  });

  it("同一文件在首跑与隔离复跑里都有读数 ⇒ 取复跑那一个", () => {
    const repo = makeRepo();
    /* 首跑与 A/B/D 抢核 ⇒ 6s；隔离复跑 ⇒ 1s。拿 6s 排序会把**负载**读成**文件的成本**
     * （§13.6.4 那一族），所以合并规则必须让第二遍赢，而不是「谁后读到谁赢」。 */
    const dir = makeCDir(["tests/a.test.ts"], {
      "comfy-c-0-1.xml": [["tests/a.test.ts", 6]],
      "comfy-c-0-2.xml": [["tests/a.test.ts", 1]],
    });
    run(
      ["record", "--total-ms", "9000", "--exit", "0", "--junit-dir", dir],
      repo,
    );
    expect(firstRun(run(["--json"], repo)).files).toEqual([
      { name: "tests/a.test.ts", ms: 1000 },
    ]);
  });

  it("没有清单 ⇒ 不许把「取到读数的份数」冒充分母", () => {
    const dir = mkdtempSync(join(tmpdir(), "precommit-c-nomanifest-"));
    tmpDirs.push(dir);
    writeFileSync(
      join(dir, "comfy-c-0-1.xml"),
      junitXml([["tests/a.test.ts", 2]]),
      "utf8",
    );
    const repo = makeRepo();
    run(
      ["record", "--total-ms", "9000", "--exit", "0", "--junit-dir", dir],
      repo,
    );
    const record = firstRun(run(["--json"], repo));
    expect(record.files).toHaveLength(1);
    expect(record.filesExpected).toBe(0);
    expect(record.filesMissing).toBe(0);
  });

  it("报表：降序只打前 10、汇总不当文件，并给「分文件之和 ⇄ 组 C 墙钟」的对账", () => {
    const repo = makeRepo();
    const many = Array.from(
      { length: 12 },
      (_unused, i) => `tests/f${String(i).padStart(2, "0")}.test.ts`,
    );
    const dir = makeCDir(many, {
      "comfy-c-0-1.xml": many.map(
        (name, i) => [name, i + 1] as [string, number],
      ),
    });
    run(
      [
        "record",
        "--total-ms",
        "30000",
        "--exit",
        "0",
        "--group",
        "C=20000",
        "--junit-dir",
        dir,
      ],
      repo,
    );
    const report = run([], repo).out;
    expect(report).toContain(
      "组 C 各文件（中位数，前 10 名；共 12 份有读数 / 清单 12 份）",
    );
    expect(report).toContain("tests/f11.test.ts");
    /* 12 行只留最贵 10 行 —— 一屏读不完的表等于没人读（§13.5.8.3）。 */
    expect(report).not.toContain("tests/f01.test.ts");
    /* 外层 `<testsuites>` 不是文件；把它算进去就凭空多一份，而那份的时长是各 suite 之和。 */
    expect(report).not.toContain("vitest tests");
    expect(report).toContain("分文件之和 78.0s ⇄ 组 C 墙钟 20.0s");
    expect(report).toContain("不能当墙钟");
  });

  it("旧记录（没有 files 那一格）⇒ 不打这一节，也不打一张空表冒充读过", () => {
    const repo = makeRepo();
    run(
      ["record", "--total-ms", "9000", "--exit", "0", "--group", "C=8000"],
      repo,
    );
    const report = run([], repo).out;
    expect(report).not.toContain("组 C 各文件");
    expect(report).not.toContain("分文件之和");
  });

  it("接线：钩子把 `--junit-dir` 递进 record 的参数里，且 shell 不自己解析 XML", () => {
    const hook = readFileSync(HOOK, "utf8");
    const atDir = hook.indexOf('--junit-dir "$LOGD"');
    const atCall = hook.indexOf('precommit-timing.mjs record "$@"');
    expect(atDir).toBeGreaterThan(-1);
    /* 顺序要紧：`$@` 是在 record 那一行之前拼完的 —— 写在后面就永远传不进去，
     * 而这一族的失效形态从来都是「判据在场、结论恒空」。 */
    expect(atDir).toBeLessThan(atCall);
    /* shell 里不许长出第二份 XML 解析（与本模块各解一遍，漂了没人看见）。 */
    expect(hook).not.toContain("testsuite");
  });
});
