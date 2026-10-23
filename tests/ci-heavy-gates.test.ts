/**
 * 平台侧「重档静态判据」那一格（`scripts/ci-heavy-gates.mjs`）。
 *
 * 这一格治的是 ISSUE #2224 的现场：**判决面只在「本次改动」上的那一步，在平台侧
 * 恒绿且一个字都不打** —— 平台上没有暂存区，`shell-gate` 读的是那份空清单 ⇒
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
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

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

const temps: string[] = [];
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
    const got = heavyGateArgv([
      "node",
      "scripts/check-dead-exports.cjs",
      "--staged",
    ]);
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.argv).toEqual(["node", "scripts/check-dead-exports.cjs"]);
    expect(got.notRunCodes).toEqual([]);
  });

  it("拿得到基线 ⇒ 换成 `--base` 形态（真判，不再恒绿无声）", () => {
    const got = heavyGateArgv(["node", "scripts/shell-gate.mjs"], {
      env: { CNB_PULL_REQUEST_TARGET_SHA: "abc123" },
    });
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.argv).toEqual([
      "node",
      "scripts/shell-gate.mjs",
      "--base",
      "abc123",
    ]);
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
    const lines: string[] = [];
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
    const lines: string[] = [];
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
    changedFiles: { files: readonly string[] } | null,
  ): { code: number; out: string } => {
    const lines: string[] = [];
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
    expect(got.out).toMatch(/按面未触及 ⇒ 跳过：主题色扫描/);
    /* 跳过不是判过 ⇒ 那一格不许把它算成绿。 */
    expect(got.out).toContain("绿 0");
    expect(got.code).toBe(0);
  });

  it("改动面碰到了那条的面 ⇒ 这一条照跑（不跳）", () => {
    const got = one("主题色扫描", { files: ["src/app/x.tsx"] });
    expect(got.out).toContain("ok 主题色扫描");
    expect(got.out).not.toMatch(/按面未触及 ⇒ 跳过/);
    expect(got.out).toContain("绿 1");
  });

  it("改动面**取不到** ⇒ 一条都不跳（“不知道” ≠ “没改”）", () => {
    const got = one("主题色扫描", null);
    expect(got.out).toContain("ok 主题色扫描");
    expect(got.out).not.toMatch(/按面未触及 ⇒ 跳过/);
  });

  it("改动面是**空清单** ⇒ 一条都不跳（空清单也是“不知道”）", () => {
    const got = one("主题色扫描", { files: [] });
    expect(got.out).toContain("ok 主题色扫描");
    expect(got.out).not.toMatch(/按面未触及 ⇒ 跳过/);
  });

  it("面取自**收窄登记表**，不是手抄的第二份", () => {
    /* 反查：登记表里那一条的脚本 ⇒ 它的面就是登记表里那组 glob。 */
    const entry = INCREMENTAL_GATES.find(
      (e) => e.script === "scripts/check-theme-colors.cjs",
    );
    expect(entry, "收窄登记表里没有「主题色扫描」这一条").toBeTruthy();
    if (!entry) return;
    expect(narrowingEntryForScript("scripts/check-theme-colors.cjs")?.globs).toEqual(
      entry.globs,
    );
    /* 不在登记表里的判据（这里拿一条没有收窄面的）⇒ 查不到 ⇒ 不许收窄。 */
    expect(narrowingEntryForScript("scripts/check-gate-executors.cjs")).toBeNull();
  });

  it("收窄判据按**判据脚本**查（不看标签名）", () => {
    expect(judgmentScriptOf(["node", "scripts/check-theme-colors.cjs"])).toBe(
      "scripts/check-theme-colors.cjs",
    );
    /* 参数里的路径不算判据本身 —— 取第一个才是。 */
    expect(
      judgmentScriptOf(["node", "scripts/check-a.cjs", "scripts/check-b.cjs"]),
    ).toBe("scripts/check-a.cjs");
    expect(judgmentScriptOf(["node", "-e", "1"])).toBeNull();
  });

  it("收窄**不能**把一条该跑的判据吞掉：面碰到 ⇒ 不跳（反向验证）", () => {
    const step = { label: "主题色扫描", argv: ["node", "scripts/check-theme-colors.cjs"] };
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
    const lines: string[] = [];
    const code = main({
      cwd: ROOT,
      argv: ["--only=文档源"],
      env: {},
      log: (line: string) => lines.push(line),
      changedFiles: null,
    });
    const all = lines.join("\n");
    expect(code).toBe(0);
    /* 这一步是绿的（退出 0），但它自己打了读数 —— 那行读数必须在场。 */
    expect(all).toContain("[doc-mirror-pairing]");
  });

  it("红步的转述口径不变（尾部若干行）", () => {
    /* 红步那边取的是尾部若干行；这一条钉住「没把红步改成只取最后一行」。 */
    const src = readFileSync(
      path.join(ROOT, "scripts", "ci-heavy-gates.mjs"),
      "utf8",
    );
    expect(src).toContain(".slice(-12)");
  });
});
