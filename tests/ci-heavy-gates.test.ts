/**
 * 平台侧「重档静态判据」那一格（`scripts/ci-heavy-gates.mjs`）。
 *
 * 这一格治的是 ISSUE #2224 的现场：**判决面只在「本次改动」上的那一步，在平台侧
 * 恒绿且一个字都不打** —— 平台那一格跑在干净快照上（索引里没有本次改动），`shell-gate`
 * 读的是那份空清单 ⇒
 * `touchesShell` 恒假 ⇒ 硬规则 5 那两条（改了壳必须重编 / 壳内那批 `#[test]`）
 * 在平台侧**一个执行者都没有**，而账面全绿。
 *
 * 这里钉的是三件事：
 *   ① 带 `--staged` 的步骤**照旧剥掉**（判全量档，判决面还在）；
 *   ② 判决面只在「本次改动」上的那一步 ⇒ **换成基线**（`--base`），真判，不再恒绿；
 *   ③ 换不了（拿不到基线）⇒ 这一条**「没判」**，单列退 2，**不许计入「绿」**。
 *
 * 外加 ISSUE #2255 的那一族：这一格**逐条按面收窄**（面取自收窄登记表，与平台那一格
 * 同一份 glob）⇒ 那 13 条「在平台那一格被 `ifModify` 跳过」的判据不再在这一格照跑全量。
 * 收窄的两条边界在这里钉住：**改动面取不到 ⇒ 一条都不跳**、**跳过的逐条点名且不计入绿**。
 */
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
import {
  heavyGateArgv,
  judgmentScriptOf,
  main,
  narrowingDecision,
} from "../scripts/ci-heavy-gates.mjs";
import {
  faceTouched,
  INCREMENTAL_GATES,
  narrowingEntryForScript,
} from "../scripts/ci-incremental-gates.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
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
    if (!got.ok) return;
    expect(got.argv).toEqual(["node", "scripts/check-dead-exports.cjs"]);
    expect(got.notRunCodes).toEqual([]);
  });

  it("check-format --staged ⇒ 换发 --changed（printWidth 迁移期全库档恒红，ISSUE #2729）", () => {
    const got = heavyGateArgv(["node", "scripts/check-format.cjs", "--staged"]);
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.argv).toEqual(["node", "scripts/check-format.cjs", "--changed"]);
    expect(got.via).toContain("改动面");
    expect(got.notRunCodes).toEqual([]);
    /* 对照：别的步骤不沾这个换发 —— 剥旗标进全库照旧。 */
    const other = heavyGateArgv(["node", "scripts/check-dead-exports.cjs", "--staged"]);
    expect(other.ok).toBe(true);
    if (!other.ok) return;
    expect(other.argv).toEqual(["node", "scripts/check-dead-exports.cjs"]);
  });

  it("拿得到基线 ⇒ 换成 `--base` 形态（真判，不再恒绿无声）", () => {
    const got = heavyGateArgv(["node", "scripts/shell-gate.mjs"], {
      env: { CNB_PULL_REQUEST_TARGET_SHA: "abc123" },
    });
    expect(got.ok).toBe(true);
    if (!got.ok) return;
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
    if (got.ok) return;
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
 * 两处「红了却报绿」的形态（ISSUE #2367 的现场）。
 *
 * 现场（PR #2283 的 `cnb-k0n-1k5pajcdn`）：`依赖新鲜度` 判出「有漂移」，账面写的是
 * 「红 0、没跑起来 1、绿 54」—— 红的那一条**连名字都没出现**，而整格照样往下走。
 * 成因两条，各自独立：
 *   ① `runHeavyGates()` 交出来的 `unreadable` **没被 `main()` 解构** ——
 *      「注册表读不到」于是与「没有判据要跑」逐字同形（`return 0`）；
 *   ② 红步的输出只转述尾部 12 行，而这一档的输出是几百行，判决面与第一条失败行
 *      **在前面**，平台日志里一个字都没有。
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
 * 复合档**逐条按面收窄**（ISSUE #2255）。
 *
 * 现场：那 13 条判据在平台那一格被 `ifModify` 收窄（面没被本次改动碰到 ⇒ 那一格不执行），
 * 在复合档里却**照跑全量** ⇒ 收窄白做（本机实测 22.9s / 复合档逐条墙钟的 10.5%）。
 *
 * 这里钉的是收窄的**三条边界**，外加「面从哪儿来」：
 *   ① 面取自**收窄登记表**（与平台那一格同一份 glob）—— 不手抄第二份；
 *   ② **改动面取不到 ⇒ 一条都不跳**（“不知道” ≠ “没改”）；
 *   ③ 跳过的**逐条点名**且**不计入「绿」**（跳过不是判过 —— 静默跳过与静默放行同族）。
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
    if (!entry) return;
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
 * 绿步的**读数也要有出口**（ISSUE #2256）。
 *
 * 现场：这一格此前**只转述红步的输出** ⇒ 「exit 0、但自己说了『我没有判任何东西』」
 * 的那类形状在平台日志里一个字都不打 —— 那一格与「真的判过了」逐字同形。
 * 最实的一例是 `文档源 ⇄ 生成态镜像同批`：它在平台上判的是**空暂存区**
 * （判据的「不带 `--staged` 那一档」判的仍是暂存集），于是打印
 * 「暂存区是空的 —— 没有什么可判（这不是「已通过」）」并退 0 ⇒ 计成绿，而那句话被丢掉。
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
 * 形态档在平台上**没有判决面**（ISSUE #2265，#2256 的另一半）。
 *
 * 现场（空暂存区 = 平台同形态，`node scripts/ci-heavy-gates.mjs --no-narrow` 逐条读数）：
 * 56 条里**只有 2 条**的判决面不成立，而它们都被计成了「绿」——
 *   · `文档源 ⇄ 生成态镜像同批`：自认「暂存区是空的 —— 没有什么可判」并退 0；
 *   · `已知基线失败登记·自证`：**一个字都不打**就退 0。
 *
 * 这里钉的是三条处置：
 *   ① **换判决面**：这一族拿 `--base <ref>`（相对基线改了什么），判决链一字未改；
 *   ② **没判不是绿**：判决面取不到 ⇒ 退 2 ⇒ 单列「没判」，不许计入「绿」；
 *   ③ **机械兜底**：绿步一个字都不打 ⇒ 那一格没判（这条不靠逐条核对）。
 */
describe("复合档 —— 形态档的判决面（ISSUE #2265）", () => {
  it("这一族拿 `--base`，而且**把 `--staged` 一起剥掉**（判据只该有一个判决面来源）", () => {
    const got = heavyGateArgv(["node", "scripts/check-doc-mirror-pairing.cjs", "--staged"], {
      env: { CNB_PULL_REQUEST_TARGET_SHA: "abc123" },
    });
    expect(got.ok).toBe(true);
    if (!got.ok) return;
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
    if (!got.ok) return;
    expect(got.argv).toEqual([
      "node",
      "scripts/known-failed-selftest-gate.mjs",
      "--base",
      "abc123",
    ]);
  });

  it("登记表是**一处**出处：三条都在 `CHANGED_SCOPED` 里", () => {
    /* 反查：这两条判据若没登记，复合档就会对它们走「剥旗标 ⇒ 判全仓」那一手，
     * 而那对它们**无效**（剥掉旗标之后判的仍是暂存集）。 */
    expect(CHANGED_SCOPED).toContain("scripts/check-doc-mirror-pairing.cjs");
    expect(CHANGED_SCOPED).toContain("scripts/known-failed-selftest-gate.mjs");
    expect(CHANGED_SCOPED).toContain("scripts/shell-gate.mjs");
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
