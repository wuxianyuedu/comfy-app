/**
 * 「全量 e2e 每天首次提交要有凭证」这条判据（规范 §11.8）。
 *
 * 它补的是 #1282 收尾时点名的那个洞：`pnpm test:e2e` 是按需召唤那一层的成员，
 * 而「按需」在它身上一直**没有执行者** —— 现场是入库的 linux 档基线被别线的产品改动
 * （`#1327` 改导航顺序）作废，**躺了两天**，唯一的发现方式是「有人在 Issue 里点头让
 * NPC 手动跑一遍」。像素档那边早就有「每档都有主」的判据，这一档一条都没有。
 *
 * 判据分四头，缺一条这层就会退化：
 *   ① **判决可被执行**：喂「无记录 / 今天跑过 / 昨天跑过 / 今天记了豁免 / 日期坏掉」
 *      五种形状，逐条核退出码与话术指向；
 *   ② **豁免不是绕过**：写清理由的 `--skip` 放行，占位理由（「稍后」）被拦；
 *   ③ **记账可被观测**：跑绿即记、红着不记、豁免记的是理由；
 *   ④ **钩子真的调它**：判据写在文件里而没人跑 = §13.5.12 那个「判据自称在跑」的形态。
 */
import { existsSync, readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  E2E_COMMAND,
  E2E_LEDGER,
  E2E_TIER,
  e2eRecord,
  e2eSkipRecord,
  isUsableSkipReason,
  judgeE2eFreshness,
  readE2eLedger,
  recordRun,
  recordSkip,
  writeE2eLedger,
} from "../scripts/e2e-freshness-lib.mjs";
import { runGate } from "../scripts/e2e-freshness-gate.mjs";
import { isSameLocalDay } from "../scripts/fresh-ledger.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const HOOK = ".githooks/pre-commit";
const GATE = "scripts/e2e-freshness-gate.mjs";

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

/** D 组步骤 = 钩子里 `  run "<标签>" <命令>` 那些行（行首锚定，注释掉的不算在场）。 */
function dGroupSteps(hookText: string) {
  return [...hookText.matchAll(/^ {2}run "([^"]+)" (.+)$/gm)].map((m) => ({
    label: m[1] ?? "",
    cmd: m[2] ?? "",
  }));
}

const NOW = new Date("2026-10-09T10:00:00");
const TODAY = new Date("2026-10-09T08:30:00");
const YESTERDAY = new Date("2026-10-08T20:00:00");

const runs = (at: Date) =>
  e2eRecord({ now: at, who: "月读", how: E2E_COMMAND });

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function tmpLedger(): string {
  const dir = mkdtempSync(join(tmpdir(), "e2e-freshness-"));
  dirs.push(dir);
  return join(dir, ".e2e-freshness.json");
}

describe("全量 e2e 的每日自证判决（§11.8）", () => {
  it("账里一条记录都没有 ⇒ 阻断，话术给两条修法", () => {
    const res = judgeE2eFreshness({ ledger: {}, now: NOW });
    expect(res.exitCode).toBe(1);
    expect(res.problem).toContain(E2E_COMMAND);
    expect(res.problem).toContain("--skip");
  });

  it("今天跑过 ⇒ 放行，并报出「距今多久」", () => {
    const res = judgeE2eFreshness({
      ledger: { [E2E_TIER]: runs(TODAY) },
      now: NOW,
    });
    expect(res.exitCode).toBe(0);
    expect(res.problem).toBeNull();
    expect(res.age).toBe("今天");
  });

  it("昨天跑过 ⇒ **今天仍然要拦**（这正是「每天首次」的意思）", () => {
    const res = judgeE2eFreshness({
      ledger: { [E2E_TIER]: runs(YESTERDAY) },
      now: NOW,
    });
    expect(res.exitCode).toBe(1);
    // 昨天 20:00 与今天 10:00 不足 24 小时，所以 `freshnessAge` 读作「今天」——
    // 那正是这一档刻意**不拿 24 小时窗口**做判据的现场：拦不拦看的是日历日，
    // 而「多久没跑」只是一个给人看的读数。
    expect(res.age).toBe("今天");
    expect(res.problem).toContain("第一次提交");
  });

  it("今天记了「本次跳过」+ 理由 ⇒ 放行，并把理由回读出来", () => {
    const rec = e2eSkipRecord({
      now: TODAY,
      who: "月读",
      reason: "本次只改文档",
    });
    const res = judgeE2eFreshness({ ledger: { [E2E_TIER]: rec }, now: NOW });
    expect(res.exitCode).toBe(0);
    expect(res.skipped).toBe("本次只改文档");
  });

  it("**昨天**记的跳过不顶今天的账（豁免也是一天一签）", () => {
    const rec = e2eSkipRecord({
      now: YESTERDAY,
      who: "月读",
      reason: "昨天只改文档",
    });
    expect(
      judgeE2eFreshness({ ledger: { [E2E_TIER]: rec }, now: NOW }).exitCode,
    ).toBe(1);
  });

  it("日期不是一个能解析的时刻 ⇒ 阻断（「每天首次」整条挂在它上面）", () => {
    const res = judgeE2eFreshness({
      ledger: { [E2E_TIER]: { ...runs(TODAY), verifiedAt: "最近" } },
      now: NOW,
    });
    expect(res.exitCode).toBe(1);
    expect(res.problem).toContain("verifiedAt");
  });

  it("形状不对（不是对象）⇒ 阻断，不静默放行", () => {
    const res = judgeE2eFreshness({
      ledger: { [E2E_TIER]: ["not-an-object"] },
      now: NOW,
    });
    expect(res.exitCode).toBe(1);
    expect(res.problem).toContain("freshnessRecord");
  });

  it("宽限期：账文件不在 ⇒ 不阻断（基线为 0 的硬闸不许拦住所有人）", () => {
    const res = runGate({ ledger: {}, now: NOW, hasLedger: false });
    expect(res.exitCode).toBe(0);
    expect(res.grace).toBe(true);
  });

  it("宽限期只对「没有账文件」成立：账在而记录旧 ⇒ 照拦", () => {
    const res = runGate({
      ledger: { [E2E_TIER]: runs(YESTERDAY) },
      now: NOW,
      hasLedger: true,
    });
    expect(res.exitCode).toBe(1);
    expect(res.grace).toBe(false);
  });
});

describe("同一天的口径（本地日界，不是滚动 24 小时）", () => {
  it("同一日历日算同一天，跨零点算另一天", () => {
    expect(
      isSameLocalDay(
        new Date("2026-10-09T00:05:00"),
        new Date("2026-10-09T23:55:00"),
      ),
    ).toBe(true);
    expect(
      isSameLocalDay(
        new Date("2026-10-09T23:55:00"),
        new Date("2026-10-10T00:05:00"),
      ),
    ).toBe(false);
  });

  it("昨天 23:00 与今天 08:00 **不算**同一天（滚动窗口会把这天早晨的第一次静默跳过）", () => {
    const res = judgeE2eFreshness({
      ledger: { [E2E_TIER]: runs(new Date("2026-10-08T23:00:00")) },
      now: new Date("2026-10-09T08:00:00"),
    });
    expect(res.exitCode).toBe(1);
  });
});

describe("豁免账不是绕过（「有人回答过」与「没回答」要长得不一样）", () => {
  it("占位理由一律不算：稍后 / 待定 / 空 / 太短", () => {
    for (const bad of ["", "  ", "稍后", "待定", "TBD", "n/a", "回头", "无"]) {
      expect(isUsableSkipReason(bad), bad).toBe(false);
    }
  });

  it("写清了一条能复核的理由才算", () => {
    for (const ok of [
      "本次只改文档",
      "已在本机跑过，见 PR #1234",
      "e2e 无法在本机起浏览器",
    ]) {
      expect(isUsableSkipReason(ok), ok).toBe(true);
    }
  });

  it("recordSkip 用占位理由时不落盘（拒绝发生在写文件之前）", () => {
    const file = tmpLedger();
    const res = recordSkip({ who: "月读", reason: "稍后", file });
    expect(res.ok).toBe(false);
    expect(existsSync(file)).toBe(false);
  });
});

describe("记账接线（§13.5.12：判据要有人跑）", () => {
  it("跑绿即记：recordRun 写下的记录当场能被判决读到并放行", () => {
    const file = tmpLedger();
    const res = recordRun({ who: "月读", how: E2E_COMMAND, file });
    expect(res.ok).toBe(true);
    const ledger = readE2eLedger(file);
    expect(ledger[E2E_TIER]).toMatchObject({ who: "月读", how: E2E_COMMAND });
    expect(judgeE2eFreshness({ ledger }).exitCode).toBe(0);
  });

  it("记账失败只提示、不把「跑绿」这个结论也一起作废", () => {
    // 用一个不可能写成功的路径（目录当文件）制造失败。
    const res = recordRun({
      who: "月读",
      how: E2E_COMMAND,
      file: join(tmpdir(), "no-such-dir-x", "y.json"),
    });
    expect(res.ok).toBe(false);
    expect(res.note).toContain("记账失败");
  });

  it("`--skip` 落的账里 `how` 带 skip: 前缀，判决据此认出「豁免」而不是「跑过」", () => {
    const file = tmpLedger();
    recordSkip({ who: "月读", reason: "本次只改文档", file });
    const entry = readE2eLedger(file)[E2E_TIER] as { how: string };
    expect(entry.how.startsWith("skip:")).toBe(true);
  });

  it("钩子真的调这个判据（被注释掉的行不算在场）", () => {
    const hit = dGroupSteps(read(HOOK)).find((s) => s.cmd.includes(GATE));
    expect(hit, `D 组里没有这一步 —— 判据写在文件里而没人跑`).toEqual({
      label: "全量 e2e 每日自证（凭证账）",
      cmd: "node scripts/e2e-freshness-gate.mjs",
    });
  });

  it("账文件与像素那份**分开**（两者的档、命令与时效都不同，混用会让两边互相覆盖）", () => {
    expect(E2E_LEDGER).not.toBe("scripts/.visual-baseline-freshness.json");
    expect(E2E_LEDGER).toBe("scripts/.e2e-freshness.json");
  });

  it("跑 e2e 的入口**只有一处**（package.json 与判据话术点的是同一条命令）", () => {
    const pkg = JSON.parse(read("package.json")) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts?.["check:e2e"]).toContain("scripts/e2e-run.mjs");
    expect(E2E_COMMAND).toBe("pnpm check:e2e");
  });
});

describe("账形状与像素那份同族（共用内核，不各写一份）", () => {
  it("记录形状来自 fresh-ledger 的唯一实现（本档的 tier 字段与那边的 platform 同职）", () => {
    const rec = runs(TODAY);
    expect(Object.keys(rec).sort()).toEqual([
      "how",
      "tier",
      "verifiedAt",
      "who",
    ]);
    expect(rec.tier).toBe(E2E_TIER);
  });

  it("写出来的账是「档名 → 记录」的对象（与像素那份同一个读法）", () => {
    const file = tmpLedger();
    writeE2eLedger(runs(TODAY), file);
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Record<
      string,
      unknown
    >;
    expect(Object.keys(parsed)).toEqual([E2E_TIER]);
    expect(JSON.parse(readFileSync(file, "utf8"))).toHaveProperty(
      `${E2E_TIER}.verifiedAt`,
    );
  });
});
