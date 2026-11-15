/**
 * 会话汇报骨架的自测（ISSUE #3165 / §12.20）。
 *
 * 工具是**编排 + 计时**：判定全归既有执行者（每一步都是那几份 check-* 的原值），
 * 所以这里钉的三件事是它自己唯一的三件事 —— 排版各节在场且顺序稳定 /
 * 红的步骤必须点名（不许冒充「全过」）/ 计时在场的形状。
 * `collectCommits` 那一组用真 git 临时仓库（事实段的形状是它的契约）。
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { gitSandboxEnv } from "./helpers/git-sandbox-env";
import { collectCommits, formatReport, runSteps } from "../scripts/session-report.mjs";

const SCRIPT = join(process.cwd(), "scripts", "session-report.mjs");
const tmpDirs: Array<string> = [];
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** @returns {string} 真 git 临时仓库 */
function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "session-report-"));
  tmpDirs.push(dir);
  execFileSync("git", ["init", "-q", "-b", "main", "."], { cwd: dir, env: gitSandboxEnv() });
  execFileSync("git", ["config", "user.email", "t@t"], { cwd: dir, env: gitSandboxEnv() });
  execFileSync("git", ["config", "user.name", "t"], { cwd: dir, env: gitSandboxEnv() });
  return dir;
}

/** @returns {{stdout: string, status: number}} */
function runScript(args: Array<string>, cwd: string) {
  try {
    return {
      stdout: execFileSync(process.execPath, [SCRIPT, ...args], {
        cwd,
        encoding: "utf8",
        env: gitSandboxEnv(),
      }),
      status: 0,
    };
  } catch (error) {
    /* execFileSync 失败抛的是带 status/stdout/stderr 的普通对象。#3167 开的
     * no-unsafe-type-assertion 只放行「守卫后收窄」——所以这里用谓词而不是断言。 */
    const isExecError = (v: unknown): v is { status?: number; stderr?: string; stdout?: string } =>
      typeof v === "object" && v !== null;
    const e = isExecError(error) ? error : {};
    return {
      stdout: String(e.stdout ?? "") + String(e.stderr ?? ""),
      status: e.status ?? -1,
    };
  }
}

const GREEN_STEP = { label: "一定绿的步骤", argv: ["node", "-e", "process.exit(0)"] };
const RED_STEP = { label: "一定红的步骤", argv: ["node", "-e", "process.exit(3)"] };

describe("session-report —— 排版：五节在场、顺序稳定（他人照着汇报的格式契约）", () => {
  it("全绿批：五节按序、步骤表带耗时与退码、总行写「全过」", () => {
    const md = formatReport({
      range: { before: "aaa11111", after: "bbb22222" },
      commits: [
        {
          sha: "30500c64e0000000000000000000000000000000",
          subject: "chore(lint): 按预设开 171 条零命中规则 (#3164)",
          pr: "3164",
          files: 37,
          ins: 812,
          del: 340,
        },
      ],
      steps: {
        results: [
          {
            label: "文件结构硬规则",
            argv: "node scripts/check-file-structure.cjs",
            ms: 1300,
            code: 0,
            tail: "",
          },
          {
            label: "CP936 字形登记",
            argv: "node scripts/check-cp936-glyphs.cjs",
            ms: 2400,
            code: 0,
            tail: "",
          },
        ],
        totalMs: 3700,
      },
    });
    const at = (s: string) => md.indexOf(s);
    expect(at("# 开发汇报（aaa11111..bbb22222）")).toBe(0);
    expect(at("## 一、本次做了什么")).toBeGreaterThan(-1);
    expect(at("## 二、验证读数（哪步执行 · 消耗多少时间）")).toBeGreaterThan(at("## 一、"));
    expect(at("## 三、开发总结")).toBeGreaterThan(at("## 二、"));
    expect(at("## 四、经验与可复用")).toBeGreaterThan(at("## 三、"));
    expect(at("## 五、本轮发现与已立案")).toBeGreaterThan(at("## 四、"));
    /* 事实段：sha / PR 号 / 变更面都是机器填的。 */
    expect(md).toContain("`30500c64` chore(lint): 按预设开 171 条零命中规则 (#3164) —— PR #3164");
    expect(md).toContain("（37 份文件，+812 −340）");
    /* 验证段：耗时与退码逐条在场，总行带墙钟与「全过」。 */
    expect(md).toContain("| 1 | 文件结构硬规则 | 1.3s | 0 |");
    expect(md).toContain("| 2 | CP936 字形登记 | 2.4s | 0 |");
    expect(md).toContain("总墙钟 3.7s · 绿 2/2 —— 全过");
    /* 判断段：三节是人填的骨架，不是机器代笔。 */
    expect(md).toContain("<!-- 人填：这一轮做了什么");
    expect(md).toContain("pnpm ship --new-issue");
    /* 第五节是「发现即立案」，不是「要不要提单」的询问（ISSUE #3560）：
     * 骨架要给出立案命令，并逐字写清「不在这里问要不要提单」，防止被改回待办清单。 */
    expect(md).toContain("当场**立案");
    expect(md).toContain("不在这里问");
    expect(md).toContain("别留空，也别攒成没有号的建议清单");
    expect(md).not.toContain("是否提单");
  });

  it("红的步骤 ⇒ 「红的步骤」节点名 + 输出末尾转述，总行不许写「全过」", () => {
    const md = formatReport({
      range: { before: "aaa11111", after: "bbb22222" },
      commits: [],
      steps: {
        results: [
          {
            label: "文件结构硬规则",
            argv: "node scripts/check-file-structure.cjs",
            ms: 1300,
            code: 0,
            tail: "",
          },
          {
            label: "脚本档类型检查",
            argv: "node scripts/check-scripts-typecheck.cjs",
            ms: 12_400,
            code: 1,
            tail: "scripts/x.mjs(1,1): error TS7006: 基线 0 → 当前 1（新增 1 处）",
          },
        ],
        totalMs: 13_700,
      },
    });
    expect(md).toContain("红的在下面点名");
    expect(md).toContain("### 红的步骤");
    expect(md).toContain("[红] 脚本档类型检查（12.4s，退码 1）");
    expect(md).toContain("error TS7006");
    expect(md).not.toContain("—— 全过");
    expect(md).toContain("不许写成「全过」");
  });
});

describe("session-report —— runSteps：编排既有执行者，计时与转述在场的形状", () => {
  it("每步计时、退码与末尾转述都落行，顺序保持", () => {
    let calls = 0;
    const { results, totalMs } = runSteps([GREEN_STEP, RED_STEP], {
      cwd: process.cwd(),
      runner: (argv) => {
        calls += 1;
        const isRed = argv.includes("process.exit(3)");
        return {
          status: isRed ? 3 : 0,
          stdout: isRed ? "" : "ok\n",
          stderr: isRed ? "boom-line-1\nboom-line-2" : "",
        };
      },
    });
    expect(calls).toBe(2);
    expect(results.map((r) => r.label)).toEqual(["一定绿的步骤", "一定红的步骤"]);
    expect(results[0]?.code).toBe(0);
    expect(results[1]?.code).toBe(3);
    /* 计时在场：两步各自的 ms 都被记下，总墙钟 ≥ 它们之和。 */
    expect(results[0]?.ms).toBeGreaterThanOrEqual(0);
    expect(results[1]?.ms).toBeGreaterThanOrEqual(0);
    expect(totalMs).toBeGreaterThanOrEqual((results[0]?.ms ?? 0) + (results[1]?.ms ?? 0));
    /* stderr 完整转述进末尾 —— 转述型工具丢 stderr 是这一族最重的事故（§12.20）。 */
    expect(results[1]?.tail).toContain("boom-line-2");
  });
});

describe("session-report —— collectCommits：事实段的契约（真 git 临时仓库）", () => {
  it("区间内的提交逐条带 sha / 标题 / PR 号 / numstat 计数", () => {
    const repo = makeRepo();
    const git = (...args: Array<string>) =>
      /* ⚠️ `execFileSync` **不 trim**（那是 `execSync` 的行为）：`rev-parse` 的尾随
       * 换行进了区间串，git log 当场解析不了 —— 取回的 sha 一律收口。 */
      execFileSync("git", args, { cwd: repo, env: gitSandboxEnv(), encoding: "utf8" }).trim();
    writeFileSync(join(repo, "base.ts"), "export const base = 0;\n");
    git("add", "-A");
    git("commit", "-q", "-m", "chore: 基线（区间起点之外）");
    writeFileSync(join(repo, "a.ts"), "export const a = 1;\n");
    git("add", "-A");
    git("commit", "-q", "-m", "feat(x): 第一笔 (#3164)");
    writeFileSync(join(repo, "b.ts"), "export const b = 2;\n");
    git("add", "-A");
    git("commit", "-q", "-m", "fix(x): 第二笔（无 PR 尾号）");
    /* 区间语义是「可达差」：`HEAD~1..HEAD` 只含一笔 —— 要两笔就得再往回一格。 */
    const before = git("rev-parse", "HEAD~2");
    const after = git("rev-parse", "HEAD");
    const rows = collectCommits(repo, { before, after });
    /* 主面 tsc 对 rows 的 `Array | null` 不收窄 —— 先把「取得到」钉成显式前提，
     * 取不到是取数的锅，不是断言的事。 */
    if (!rows) {
      throw new Error("collectCommits 取不到 —— 先修取数，不是断言的事");
    }
    expect(rows).toHaveLength(2);
    /* `--reverse` 没用，序随 git log（新 → 旧）：第一行是第二笔。 */
    expect(rows[0]?.subject).toContain("第二笔");
    expect(rows[0]?.pr).toBe("");
    expect(rows[0]?.files).toBe(1);
    expect(rows[1]?.pr).toBe("3164");
    expect(rows[1]?.files).toBe(1);
    expect(rows[1]?.ins).toBe(1);
  });
});

describe("session-report —— CLI：边界与端到端", () => {
  it("缺 --range ⇒ 退 2（「本次」的边界必须显式给，工具不猜）", () => {
    const repo = makeRepo();
    const r = runScript([], repo);
    expect(r.status).toBe(2);
    expect(r.stdout).toContain("用法");
  });

  it("端到端：temp 仓库 + 自定义验证批 ⇒ 汇报落 stdout，五节都在", () => {
    const repo = makeRepo();
    execFileSync(
      "git",
      ["commit", "--allow-empty", "-q", "-m", "chore: 更早的一笔（占住 HEAD~1）"],
      {
        cwd: repo,
        env: gitSandboxEnv(),
      },
    );
    execFileSync("git", ["commit", "--allow-empty", "-q", "-m", "chore: 一次批次 (#3165)"], {
      cwd: repo,
      env: gitSandboxEnv(),
    });
    const stepsFile = join(repo, "steps.json");
    writeFileSync(
      stepsFile,
      JSON.stringify({ steps: [{ label: "必绿探针", argv: ["node", "-e", "process.exit(0)"] }] }),
      "utf8",
    );
    const r = runScript(["--range", "HEAD~1..HEAD", "--steps-file", stepsFile], repo);
    expect(r.status, r.stdout).toBe(0);
    expect(r.stdout).toContain("# 开发汇报（");
    expect(r.stdout).toContain("## 一、本次做了什么");
    expect(r.stdout).toContain("chore: 一次批次 (#3165) —— PR #3165");
    expect(r.stdout).toContain("| 1 | 必绿探针 |");
    expect(r.stdout).toContain("## 五、本轮发现与已立案");
  });
});
