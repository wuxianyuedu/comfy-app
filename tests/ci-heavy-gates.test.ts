/**
 * 平台侧「重档静态判据」那一格（`scripts/ci-heavy-gates.mjs`）。治 ISSUE #2224：平台那一格跑在干净快照上
 * （索引里没有本次改动），`shell-gate` 读空清单 ⇒ `touchesShell` 恒假 ⇒ 硬规则 5 两条在平台侧无人执行。
 * 钉三件事：① `--staged` 照旧剥掉；② 只在改动面上的那一步换 `--base` 真判；③ 换不了 ⇒ 退 2，不计入绿。
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
  appendFileSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { CHANGED_SCOPED } from "../scripts/base-check/hook-steps.mjs";
import { COLORS } from "../scripts/ci-log.mjs";
import {
  heavyGateArgv,
  judgmentScriptOf,
  main,
  narrowingDecision,
} from "../scripts/ci-heavy-gates.mjs";
import { syntheticMergeRange } from "../scripts/reformat-preview-range.mjs";
import { createGateRepo, type GateRepo } from "./helpers/gate-repo";
import {
  faceTouched,
  INCREMENTAL_GATES,
  narrowingEntryForScript,
} from "../scripts/ci-incremental-gates.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

/** 沙箱仓库的起步形态：`master` 上一笔有内容的提交（两种检出形态都从这里分叉）。 */
function initSandboxRepo(repo: GateRepo): void {
  repo.git("init", "-q", "-b", "master", ".");
  repo.git("config", "user.email", "gate@example.com");
  repo.git("config", "user.name", "gate");
  repo.git("config", "commit.gpgsign", "false");
  repo.write("a.txt", "1\n");
  repo.git("add", ".");
  repo.commit("base");
}
const HOOK = path.join(ROOT, ".githooks", "pre-commit");

const temps: Array<string> = [];
afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** 一个「有钩子、但不是 git 检出」的目录：钩子在，取基线取不到。 */
function dirWithHook(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "heavy-gates-hook-"));
  temps.push(dir);
  mkdirSync(path.join(dir, ".githooks"), { recursive: true });
  copyFileSync(HOOK, path.join(dir, ".githooks", "pre-commit"));
  return dir;
}

describe("复合档 —— 判决面只在「本次改动」上的那一步（ISSUE #2224）", () => {
  it("带 `--staged` 的步骤照旧剥掉：判全量档，判决面还在", () => {
    const got = heavyGateArgv(["node", "scripts/check-dead-exports.cjs", "--staged"]);
    expect(got.ok).toBe(true);
    if (!got.ok) {
      return;
    }
    expect(got.argv).toEqual(["node", "scripts/check-dead-exports.cjs"]);
    expect(got.notRunCodes).toEqual([]);
  });

  it("check-format --staged ⇒ 换发 --changed（printWidth 迁移期全库档恒红，ISSUE #2729）", () => {
    const got = heavyGateArgv(["node", "scripts/check-format.cjs", "--staged"]);
    expect(got.ok).toBe(true);
    if (!got.ok) {
      return;
    }
    expect(got.argv).toEqual(["node", "scripts/check-format.cjs", "--changed"]);
    expect(got.via).toContain("改动面");
    expect(got.notRunCodes).toEqual([]);
    /* 对照：别的步骤不沾这个换发 —— 剥旗标进全库照旧。 */
    const other = heavyGateArgv(["node", "scripts/check-dead-exports.cjs", "--staged"]);
    expect(other.ok).toBe(true);
    if (!other.ok) {
      return;
    }
    expect(other.argv).toEqual(["node", "scripts/check-dead-exports.cjs"]);
  });

  it("拿得到基线 ⇒ 换成 `--base` 形态（真判，不再恒绿无声）", () => {
    const got = heavyGateArgv(["node", "scripts/shell-gate.mjs"], {
      env: { CNB_PULL_REQUEST_TARGET_SHA: "abc123" },
    });
    expect(got.ok).toBe(true);
    if (!got.ok) {
      return;
    }
    expect(got.argv).toEqual(["node", "scripts/shell-gate.mjs", "--base", "abc123"]);
    /* 这一族把「没跑起来」报成 2（仓库三态），这一档必须认它 —— 不然「拿不到
     * 基线」会被读成「判红」。 */
    expect(got.notRunCodes).toContain(2);
  });

  it("拿不到基线 ⇒ 这一条「没判」（不许计入绿）", () => {
    const got = heavyGateArgv(["node", "scripts/shell-gate.mjs"], {
      cwd: dirWithHook(),
      env: {},
    });
    expect(got.ok).toBe(false);
    if (got.ok) {
      return;
    }
    expect(got.reason).toContain("取不到");
  });

  it("有「没判」的那一条 ⇒ 退 2，且逐条点名（不许默默算绿）", () => {
    const lines: Array<string> = [];
    const code = main({
      cwd: dirWithHook(),
      argv: ["--only=桌面壳"],
      env: {},
      log: (line: string) => lines.push(line),
    });
    expect(code).toBe(2);
    const all = lines.join("\n");
    expect(all).toContain("没判");
    expect(all).toContain("桌面壳");
  });

  it("那一步自己报「没跑起来」（退 2）⇒ 这一格退 2，不读成「判红」", () => {
    const lines: Array<string> = [];
    const code = main({
      cwd: ROOT,
      argv: ["--only=桌面壳"],
      /* 这条 sha 不在对象库里 ⇒ `shell-gate --base` 取不到改动面 ⇒ 退 2。 */
      env: { CNB_PULL_REQUEST_TARGET_SHA: "no-such-sha-xyz" },
      log: (line: string) => lines.push(line),
    });
    expect(code).toBe(2);
    expect(lines.join("\n")).toContain("没跑起来");
  });
});

/**
 * 两处「红了却报绿」的形态（ISSUE #2367 现场：PR #2283 的 `cnb-k0n-1k5pajcdn`）。① `runHeavyGates()` 交出的
 * `unreadable` 没被 `main()` 解构 —— 「注册表读不到」与「没有判据要跑」逐字同形（`return 0`）；② 红步只转述
 * 尾部 12 行，而判决面与第一条失败行在前面，平台日志里一个字都没有。
 */
describe("重档 —— 「没有结论」不许走成「全绿」（ISSUE #2367）", () => {
  it("注册表读不到 ⇒ 退 2（不是「合计 0 条、全绿」）", () => {
    /* 一个没有 `.githooks/pre-commit` 的目录 ⇒ `readHookSteps()` 回空 ⇒
     * `runHeavyGates()` 的 `unreadable: true`。这一条此前被解构漏掉，一路走到
     * 最后那个 `return 0` —— 账面「合计 0 条」读起来像「今天没有判据要跑」。 */
    const dir = mkdtempSync(path.join(tmpdir(), "heavy-gates-nohook-"));
    temps.push(dir);
    const lines: Array<string> = [];
    const code = main({
      cwd: dir,
      argv: [],
      env: {},
      log: (line: string) => lines.push(line),
    });
    expect(code).toBe(2);
    expect(lines.join("\n")).toContain("没跑起来");
    expect(lines.join("\n")).toContain("不构成证据");
  });

  it("红步的输出不许只念尾部：头几行与结论都得在（现场是「红的那条连名字都没出现」）", () => {
    /* 现场（ISSUE #2367）：`依赖新鲜度` 判出「有漂移」，而平台日志里它的名字
     * 一次都没出现 —— 红步的输出此前只转述尾部 12 行，而这一档动手之后有几百行，
     * 判决面（「改动面来自 …」）与结论（`[deps-freshness] 有漂移`）都在前面。
     * 这里用一个四十行的假判据把两头都造出来。 */
    const dir = dirWithHook();
    appendFileSync(
      path.join(dir, ".githooks", "pre-commit"),
      [
        "",
        '  run "假判据-两头都要念" node -e "const a=[];for(let i=1;i<=40;i++)a.push(String(i));' +
          "for(const x of a)console.log(x);" +
          "console.log(String.fromCharCode(10007)+' 这一条红了');process.exit(1)\"",
        "",
      ].join("\n"),
    );
    const lines: Array<string> = [];
    const code = main({
      cwd: dir,
      argv: ["--only=假判据"],
      env: {},
      changedFiles: null,
      log: (line: string) => lines.push(line),
    });
    expect(code).toBe(1);
    const all = lines.join("\n");
    expect(all, "头几行被省掉了").toContain("1");
    expect(all, "结论被省掉了").toContain("这一条红了");
    /* 省略必须被读出来（ISSUE #2506：判决行走 `scripts/ci-log.mjs` 之后那句话是
     * 「上面是头 5 行 + 尾 15 行，中间省略 N 行」）—— 判的是**有那一句**，不是逐字。 */
    expect(all, "省略了多少行要说出来").toMatch(/中间省略 \d+ 行/);
  });
});

/**
 * 复合档**逐条按面收窄**（ISSUE #2255）。现场：那 13 条在平台那一格被 `ifModify` 收窄，复合档里却照跑全量
 * ⇒ 收窄白做（实测 22.9s，占逐条墙钟 10.5%）。三条边界：① 面取自**收窄登记表**（与平台同一份 glob，不手抄）；
 * ② **改动面取不到 ⇒ 一条都不跳**（「不知道」≠「没改」）；③ 跳过的逐条点名且不计入「绿」（跳过不是判过）。
 */
describe("复合档 —— 逐条按面收窄（ISSUE #2255）", () => {
  /** 跑一格，只看那一格的一条步骤（`--only` 按标签过滤）。 */
  const one = (
    only: string,
    changedFiles: { files: ReadonlyArray<string> } | null,
  ): { code: number; out: string } => {
    const lines: Array<string> = [];
    const code = main({
      cwd: ROOT,
      argv: [`--only=${only}`],
      env: {},
      log: (line: string) => lines.push(line),
      changedFiles,
    });
    return { code, out: lines.join("\n") };
  };

  it("改动面没碰到那条的面 ⇒ 这一条被跳过，且**逐条点名**", () => {
    const got = one("主题色扫描", { files: ["docs/README.md"] });
    /* 三态出口之后，跳过的那一行是 `[skip] <名字>（按面未触及：…）`——
     * 前缀本身就在说「这一条没判」（ISSUE #2506）。 */
    expect(got.out).toMatch(/\[skip\] 主题色扫描（按面未触及：/);
    /* 跳过不是判过 ⇒ 那一格不许把它算成绿。 */
    expect(got.out).toContain("判过 0");
    expect(got.code).toBe(0);
  });

  it("改动面碰到了那条的面 ⇒ 这一条照跑（不跳）", () => {
    const got = one("主题色扫描", { files: ["src/app/x.tsx"] });
    expect(got.out).toMatch(/\[ok\] 主题色扫描/);
    expect(got.out).not.toMatch(/按面未触及/);
    expect(got.out).toContain("判过 1");
  });

  it("改动面**取不到** ⇒ 一条都不跳（“不知道” ≠ “没改”）", () => {
    const got = one("主题色扫描", null);
    expect(got.out).toMatch(/\[ok\] 主题色扫描/);
    expect(got.out).not.toMatch(/按面未触及/);
  });

  it("改动面是**空清单** ⇒ 一条都不跳（空清单也是“不知道”）", () => {
    const got = one("主题色扫描", { files: [] });
    expect(got.out).toMatch(/\[ok\] 主题色扫描/);
    expect(got.out).not.toMatch(/按面未触及/);
  });

  it("面取自**收窄登记表**，不是手抄的第二份", () => {
    /* 反查：登记表里那一条的脚本 ⇒ 它的面就是登记表里那组 glob。 */
    const entry = INCREMENTAL_GATES.find((e) => e.script === "scripts/check-theme-colors.cjs");
    expect(entry, "收窄登记表里没有「主题色扫描」这一条").toBeTruthy();
    if (!entry) {
      return;
    }
    expect(narrowingEntryForScript("scripts/check-theme-colors.cjs")?.globs).toEqual(entry.globs);
    /* 不在登记表里的判据（这里拿一条没有收窄面的）⇒ 查不到 ⇒ 不许收窄。 */
    expect(narrowingEntryForScript("scripts/check-gate-executors.cjs")).toBeNull();
  });

  it("收窄判据按**判据脚本**查（不看标签名）", () => {
    expect(judgmentScriptOf(["node", "scripts/check-theme-colors.cjs"])).toBe(
      "scripts/check-theme-colors.cjs",
    );
    /* 参数里的路径不算判据本身 —— 取第一个才是。 */
    expect(judgmentScriptOf(["node", "scripts/check-a.cjs", "scripts/check-b.cjs"])).toBe(
      "scripts/check-a.cjs",
    );
    expect(judgmentScriptOf(["node", "-e", "1"])).toBeNull();
  });

  it("收窄**不能**把一条该跑的判据吞掉：面碰到 ⇒ 不跳（反向验证）", () => {
    const step = {
      label: "主题色扫描",
      argv: ["node", "scripts/check-theme-colors.cjs"],
    };
    const skipped = narrowingDecision(step, { files: ["docs/README.md"] });
    expect(skipped.skip).toBe(true);
    const ran = narrowingDecision(step, { files: ["src/app/x.tsx"] });
    expect(ran.skip).toBe(false);
  });

  it("面为空 ⇒ 不许收窄（宁可多跑）", () => {
    expect(faceTouched({ globs: [] }, ["docs/README.md"])).toBe(true);
  });
});

/**
 * 绿步的**读数也要有出口**（ISSUE #2256）。此前只转述红步 ⇒ 「exit 0、但自己说『我没有判任何东西』」在
 * 平台日志里一个字都不打，与「真的判过了」逐字同形。最实一例 `文档源 ⇄ 生成态镜像同批`：判的是空暂存区，
 * 打印「暂存区是空的 —— 没有什么可判（这不是「已通过」）」并退 0 ⇒ 计成绿，而那句话被丢掉。
 */
describe("复合档 —— 绿步的读数也要有出口（ISSUE #2256）", () => {
  it("绿步自己那一行读数被转述出来（此前一个字都不打）", () => {
    const lines: Array<string> = [];
    const code = main({
      cwd: ROOT,
      /* 这一条**不依赖分支状态**（ISSUE #2265 之后「文档源 ⇄ 生成态镜像同批」要按基线
       * 判，而基线相对本分支的改动面是逐次不同的 —— 拿它当例子，这条用例会在
       * 「分支上恰好改了个文档源而没带镜像」时红，而那与它要钉的东西无关）。 */
      argv: ["--only=判据自身"],
      env: {},
      log: (line: string) => lines.push(line),
      changedFiles: null,
    });
    const all = lines.join("\n");
    expect(code).toBe(0);
    /* 这一步是绿的（退出 0），但它自己打了读数 —— 那行读数必须在场。 */
    expect(all).toContain("[gate-thresholds]");
  });

  it("红步的转述口径：头 N 行 + 尾 M 行（两端都要，不许只取一行或只取尾部）", () => {
    /* 这一条钉的是**形态**（源码那一侧），行为那一侧由上面那组
     * 「红步的输出不许只念尾部」真跑一遍。两边各钉一头：
     *   · 只取最后一行 ⇒ 判决面（「改动面来自 …」）看不见，与「只转述一行」同病；
     *   · 只取尾部 12 行 ⇒ ISSUE #2367 的现场，红的那条连名字都没出现。 */
    const src = readFileSync(path.join(ROOT, "scripts", "ci-heavy-gates.mjs"), "utf8");
    expect(src).toContain("HEAD_LINES");
    expect(src).toContain("TAIL_LINES");
    expect(src).toContain(".slice(-TAIL_LINES)");
  });
});

/**
 * 形态档在平台上**没有判决面**（ISSUE #2265，#2256 的另一半）。空暂存区下 56 条里只有 2 条判决面不成立，
 * 却都被计成绿：`文档源 ⇄ 生成态镜像同批` 自认「暂存区空，无可判」退 0；`已知基线失败登记·自证` 一个字不打退 0。
 * 三条处置：① 换判决面 `--base <ref>`（判决链未改）；② 没判不是绿（退 2 单列）；③ 绿步零输出 ⇒ 那一格没判。
 */
describe("复合档 —— 形态档的判决面（ISSUE #2265）", () => {
  it("这一族拿 `--base`，而且**把 `--staged` 一起剥掉**（判据只该有一个判决面来源）", () => {
    const got = heavyGateArgv(["node", "scripts/check-doc-mirror-pairing.cjs", "--staged"], {
      env: { CNB_PULL_REQUEST_TARGET_SHA: "abc123" },
    });
    expect(got.ok).toBe(true);
    if (!got.ok) {
      return;
    }
    /* `--staged` 必须不在：这条判据「剥掉旗标之后判的仍是暂存集」，两个都挂着
     * 就分不清它到底按哪个面判。 */
    expect(got.argv).toEqual(["node", "scripts/check-doc-mirror-pairing.cjs", "--base", "abc123"]);
    expect(got.argv).not.toContain("--staged");
  });

  it("「已知基线失败登记·自证」也在这一族里（它连旗标都没有）", () => {
    const got = heavyGateArgv(["node", "scripts/known-failed-selftest-gate.mjs"], {
      env: { CNB_PULL_REQUEST_TARGET_SHA: "abc123" },
    });
    expect(got.ok).toBe(true);
    if (!got.ok) {
      return;
    }
    expect(got.argv).toEqual([
      "node",
      "scripts/known-failed-selftest-gate.mjs",
      "--base",
      "abc123",
    ]);
  });

  it("登记表是**一处**出处：这三条都在 `CHANGED_SCOPED` 里", () => {
    /* 反查：这两条判据若没登记，复合档就会对它们走「剥旗标 ⇒ 判全仓」那一手，
     * 而那对它们**无效**（剥掉旗标之后判的仍是暂存集）。 */
    expect(CHANGED_SCOPED).toContain("scripts/check-doc-mirror-pairing.cjs");
    expect(CHANGED_SCOPED).toContain("scripts/known-failed-selftest-gate.mjs");
    expect(CHANGED_SCOPED).toContain("scripts/shell-gate.mjs");
  });

  /**
   * `check-reformat-only.cjs` **不在 `CHANGED_SCOPED`**，但也不是「剥旗标判全仓」那一条（ISSUE #3035 / #3048）。
   * 它只认暂存区或显式 `--range`；剥掉 `--staged` 回落 `HEAD~1..HEAD`，平台转的是检出而非合并预览，区间只含
   * 自己最后一笔（`cnb-o9p-1k6d5ohhj`：170 里 118 纯格式化）。⇒ 走 `syntheticMergeRange()`，终点取 tip 不取合成提交，认不出 ⇒ 没判。
   */
  it("`check-reformat-only.cjs` 换发成合并预览的两个父，认不出就不许跑（#3048）", () => {
    expect(CHANGED_SCOPED).not.toContain("scripts/check-reformat-only.cjs");
    /* 三条形态各判一次，一条都不许落回「剥旗标 ⇒ 判 HEAD~1..HEAD」：
     *   ① 认得出合成提交 ⇒ `--range <另一父>..<CNB_COMMIT>`（终点是 tip，不是 HEAD）
     *   ② 没有 CNB_COMMIT / HEAD 不是合并提交 ⇒ `ok: false`（没判，不是绿） */
    const mergeRange = syntheticMergeRange({
      cwd: process.cwd(),
      env: { CNB_COMMIT: "1111111111111111111111111111111111111111" },
    });
    expect(mergeRange.ok).toBe(false);
    const got = heavyGateArgv(["node", "scripts/check-reformat-only.cjs", "--staged"], {
      env: { CNB_PULL_REQUEST_TARGET_SHA: "abc123" },
    });
    expect(got.ok).toBe(false);
    if (got.ok) {
      return;
    }
    expect(got.reason).toContain("判决面");
    /* 「没判」的两个退出码都在这条上：判据自己的 2 与命令找不到的 127。 */
    expect(got.notRunCodes).toEqual(expect.arrayContaining([2, 127]));
  });

  /**
   * **平台两种检出形态都要给判决面**（ISSUE #3038 现场：`cnb-2f9-1k6d890pk`）。只认合成合并预览的代价实测过：
   * 平台转的是 PR 头检出（HEAD 即源分支 tip、父提交只有一条），`syntheticMergeRange()` 判「不是合并提交」，
   * 这一条既不红也不绿 —— 那一格从没判过这个 PR。钉「头检出也算得出区间」：起点 `merge-base(目标 sha, HEAD)`、终点 `HEAD`。
   */
  it("PR 头检出（HEAD 就是源分支 tip）也递得出判决面（#3038）", () => {
    const { repo } = createGateRepo({
      script: "check-reformat-only.cjs",
      workdir: "head-face",
      setup: initSandboxRepo,
    });
    repo.git("checkout", "-q", "-b", "pr");
    repo.write("a.txt", "2\n");
    repo.git("add", ".");
    repo.commit("change");
    const head = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repo.dir,
      encoding: "utf8",
    }).trim();
    /* 目标分支在分叉点之后自己又落了一笔 —— 它**不该**进这个 PR 的分母，
     * 所以起点必须是分叉点而不是目标 sha 自己。 */
    repo.git("checkout", "-q", "master");
    repo.write("b.txt", "theirs\n");
    repo.git("add", ".");
    repo.commit("target moves on");
    const target = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repo.dir,
      encoding: "utf8",
    }).trim();
    /* 平台那一跑的形态：**检出本 PR 那一侧**（HEAD = 源分支 tip，父提交只有一条）。 */
    repo.git("checkout", "-q", "pr");

    const face = syntheticMergeRange({
      cwd: repo.dir,
      env: { CNB_COMMIT: head, CNB_PULL_REQUEST_TARGET_SHA: target },
    });
    expect(face.ok, JSON.stringify(face)).toBe(true);
    if (!face.ok) {
      return;
    }
    const forkPoint = execFileSync("git", ["merge-base", target, head], {
      cwd: repo.dir,
      encoding: "utf8",
    }).trim();
    expect(face.range).toBe(`${forkPoint}..${head}`);
  });

  it("认不出形态时仍然记成「没判」，不退回 HEAD~1..HEAD（#3038）", () => {
    const { repo } = createGateRepo({
      script: "check-reformat-only.cjs",
      workdir: "head-face-bad",
      setup: initSandboxRepo,
    });
    const head = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repo.dir,
      encoding: "utf8",
    }).trim();
    /* `CNB_COMMIT` 与 HEAD 对不上（并行会话推的另一种拼法）⇒ 不给面。 */
    const face = syntheticMergeRange({ cwd: repo.dir, env: { CNB_COMMIT: "f".repeat(40) } });
    expect(face.ok).toBe(false);
    /* 没有目标 sha（本地手跑）也拿不到可信的面 —— 恒绿的判据比红更贵。 */
    const noTarget = syntheticMergeRange({ cwd: repo.dir, env: { CNB_COMMIT: head } });
    expect(noTarget.ok).toBe(false);
  });

  it("绿步一个字都不打 ⇒ 那一格**没判**（退 2，不许计入绿）", () => {
    /* 造一条「退 0 但一个字都不打」的步骤：判据在场、结论静默变成放行 ——
     * 这一档必须自己把它认出来，而不是靠人逐条核对。 */
    const dir = dirWithHook();
    writeFileSync(path.join(dir, "silent.mjs"), "process.exit(0);\n", "utf8");
    const hookPath = path.join(dir, ".githooks", "pre-commit");
    appendFileSync(hookPath, '  run "静默那一步" node silent.mjs\n', "utf8");
    const lines: Array<string> = [];
    const code = main({
      cwd: dir,
      argv: ["--only=静默那一步"],
      env: {},
      log: (line: string) => lines.push(line),
      changedFiles: null,
    });
    expect(code).toBe(2);
    const all = lines.join("\n");
    expect(all).toContain("没判");
    expect(all).toContain("静默那一步");
    /* 没判不许混进「绿」里。 */
    expect(all).not.toContain("绿 1");
  });
});

/**
 * 三态前缀在屏幕上要**看得出来**（ISSUE #2748）。现场：转交时都带自己的 `out`，而 `ci-log.mjs` 的 `emit()`
 * 见到 `out` 就整行透传 —— 那条短路本意是给**抓文本**的调用方，却把「换个写法往 stdout 写」也短路：
 * `cnb-j9g-1k64gcftk` 的十五条 `[ok]` 与四条 `[skip]` 逐字同灰。两头各钉一侧：注入 log 干净文本，写 stdout 必带色号。
 */
describe("复合档 —— 三态前缀带颜色区分（ISSUE #2748）", () => {
  it("注入 io.log ⇒ 拿到的仍是干净行，即便 FORCE_COLOR 开着", () => {
    const lines: Array<string> = [];
    main({
      cwd: ROOT,
      argv: ["--only=判据自身"],
      /* 两枚旗标同时开着：注入 `io.log` 这一档要压过**任何一枚**（用例与抓文本的
       * 调用方拿到的仍是干净行）。 */
      env: { FORCE_COLOR: "1", COMFYAPP_CI_COLOR: "1" },
      log: (line: string) => lines.push(line),
      changedFiles: null,
    });
    expect(lines.length).toBeGreaterThan(0);
    /* 前缀在场、色号一个都不许多 —— 「给了 out」这一档仍是干净文本。 */
    expect(lines.some((l) => l.startsWith("[ok]"))).toBe(true);
    expect(lines.join("\n")).not.toContain("\u001b[");
  });

  /**
   * 真起一次子进程：`paintOn` 的判据里有「有没有注入 log」这一条，在进程内怎么调都只走干净那一路。
   * 用 `COMFYAPP_CI_COLOR` 而不是 `FORCE_COLOR`：子进程 stdout 是**管道**（非 TTY），正是平台那一档的拓扑，
   * 而这枚旗标就是为它开的（ISSUE #2755）。两条共识旗标都从环境里摘掉，否则开发机上的 `FORCE_COLOR` 会误通过。
   */
  function runHeavyChild(extraArgs: Array<string>) {
    const env: NodeJS.ProcessEnv = { ...process.env, COMFYAPP_CI_COLOR: "1" };
    delete env.NO_COLOR;
    delete env.FORCE_COLOR;
    /* `maxBuffer` 显式给：`--json` 那一支会把一格的全部判决行吐出来，而宿主带着
     * `FORCE_COLOR` 时每一行还多出几十个色号字节。超过默认的 1 MiB 时 `spawnSync`
     * 报的是 `ENOBUFS`，读起来却像「这一条红在超时」（PR #2990 的
     * `cnb-fvg-1k6botkg5` 里这条就是这么红成 `Test timed out in 60000ms` 的）。 */
    return spawnSync(
      process.execPath,
      ["scripts/ci-heavy-gates.mjs", "--only=判据自身", ...extraArgs],
      { cwd: ROOT, encoding: "utf8", env, timeout: 120_000, maxBuffer: 64 << 20 },
    );
  }

  it("自己往 stdout 写那一档 ⇒ 判决行与合计行都带色号（真起一次生产入口）", () => {
    const res = runHeavyChild([]);
    expect(res.status).toBe(0);
    const lines = (res.stdout || "").split(/\r?\n/);
    const verdict = lines.find((l) => l.includes("[ok] 判据自身"));
    expect(verdict).toBeDefined();
    expect(verdict ?? "").toContain("\u001b[");
    /* 合计行自己不带三态前缀，却要跟着判决走：这一跑全绿 ⇒ 绿。 */
    const tally = lines.find((l) => l.includes("合计"));
    expect(tally ?? "").toContain(`\u001b[${COLORS.ok}m`);
    /* 「去掉色号之后仍是那一行原文」不在这里重复钉 —— 那是 `paintLine()` 的判据，
     * 出处在 `tests/ci-log.test.ts`（这一条只证合成点真的接到了这一格上）。 */
  });

  it("`--json` 那一档整屏不着色（叙述行与 JSON 共用同一个 stdout）", () => {
    const res = runHeavyChild(["--json"]);
    expect(res.status).toBe(0);
    expect(res.stdout).not.toContain("\u001b[");
    expect(res.stdout).not.toContain("▌");
  });
});
