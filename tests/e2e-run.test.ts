/**
 * 全量 e2e「按需通道 + 新鲜度账」的判据 —— 规范 §11.8 / §13.5.4（ISSUE #1545 / #1547）。
 *
 * 立案现场：**像素档的触发条件是嵌套在全量 e2e 里的**（`playwright.config.ts` 的
 * `testMatch` 把 `*.visual.spec.ts` 与普通 spec 收进同一次 `playwright test`），
 * 而 `pnpm check:visual` 只跑 `e2e/visual` 那半边。于是「像素档红了」有两条到达路径，
 * 两条此前都没有账：实测的形态是 linux 档基线过期**两天**没被发现（`#1327` 改了导航
 * 顺序、基线未同批重录），而**没有任何东西守 `pnpm test:e2e` 上一次是绿的** ——
 * 那次是靠人手动把这条入口跑了一遍才发现的。
 *
 * 判据分三头，缺一条这层就退化成一句好看的话：
 *   ① **记账语义**：只有绿了才记、`--dry-run` 不记（记的是「上次真跑绿」这个**状态**，
 *      不是「我跑过」这个**动作**）。
 *   ② **两条账同形但不同键**：`FRESHNESS_TRACKS` 的四个值（账文件 / 键 / 名字 / 命令）
 *      各就各位，且两条账**不共用一个文件**（共用 = e2e 的绿把像素档的自证覆盖掉）。
 *   ③ **接线在位**：`package.json` 的 `test:e2e` 真的走这条通道（否则记账这一步
 *      一个执行者都没有 —— 那是 §13.5.12 的立案形态），且钩子那一步真判了它。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { E2E_DIR, TRACK, planRun, shouldRecord } from "../scripts/e2e-run.mjs";
import {
  FRESHNESS_TRACKS,
  freshnessRecord,
  freshnessTrack,
  readFreshnessLedgerAt,
} from "../scripts/visual-baselines.mjs";
import { runGate } from "../scripts/visual-freshness-gate.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

function readText(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

/** 一条写得全的记录（各条用例只改它要测的那一栏）。 */
const GOOD = freshnessRecord({
  key: "e2e",
  verifiedAt: "2026-10-08T00:00:00.000Z",
  who: "月读",
  how: "pnpm test:e2e",
  trackedBy: "e2e",
});

describe("全量 e2e 的记账语义（§11.8）", () => {
  it("绿了才记：红了不记（跑过 ≠ 跑绿过）", () => {
    expect(shouldRecord({ exitCode: 0, dryRun: false })).toBe(true);
    expect(shouldRecord({ exitCode: 1, dryRun: false })).toBe(false);
    // 信号打断（`status` 为 null ⇒ 调用方给 1）同样不算绿。
    expect(shouldRecord({ exitCode: 1, dryRun: false })).toBe(false);
  });

  it("`--dry-run` 不记（无副作用的问一遍，不该产生一条自证）", () => {
    expect(shouldRecord({ exitCode: 0, dryRun: true })).toBe(false);
  });

  it("本次跑的是什么：一次 `playwright test`，且额外参数按位置透传", () => {
    expect(planRun().args).toEqual(["test"]);
    expect(planRun(["--grep", "@critical"]).args).toEqual([
      "test",
      "--grep",
      "@critical",
    ]);
    // 目录清单不在这里抄一份：`testMatch` 是 `playwright.config.ts` 的事。
    expect(planRun().args).not.toContain(E2E_DIR);
  });
});

describe("两条新鲜度账同形但不同键（§11.8 / §12.12）", () => {
  it("四个值各就各位：账文件 / 键 / 名字 / 命令", () => {
    expect(Object.keys(FRESHNESS_TRACKS).sort()).toEqual(["e2e", "visual"]);
    expect(freshnessTrack("e2e")).toEqual({
      ledger: "scripts/.e2e-freshness.json",
      key: "e2e",
      label: "全量 e2e",
      run: "pnpm test:e2e",
    });
    expect(freshnessTrack("visual").ledger).toBe(
      "scripts/.visual-baseline-freshness.json",
    );
    expect(freshnessTrack("visual").key).toBe("linux");
  });

  it("两条账**不共用一个文件**（共用 = e2e 的绿把像素档的自证覆盖掉）", () => {
    const ledgers = Object.values(FRESHNESS_TRACKS).map((t) => t.ledger);
    expect(new Set(ledgers).size).toBe(ledgers.length);
    // 键也不同：同一个文件里两个键的话，「这一档」在两条账里就不是一个概念。
    const keys = Object.values(FRESHNESS_TRACKS).map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("未登记的档名是编码错误：抛，而不是回落成一个能跑绿的空档", () => {
    // 回落的话，「新加一档却忘了登记」会表现成「按键名当档名」而照样绿。
    expect(() => freshnessTrack("nope")).toThrow(/未登记/);
    expect(freshnessTrack("e2e").key).toBe(TRACK.key);
  });

  it("`trackedBy` 抄混要被判红：两条账同形，账面上看不出异常", () => {
    /* 这是两条账唯一的形状差异，也是它们同形之后**新长出来的**静默失效面：
     * 把 e2e 的绿抄进像素档的账，日期合法、人名合法、命令是一条真命令 ——
     * 只有「这条记录由哪个跑法证出来」被搞错了，而账面上完全正常。 */
    const crossed = runGate({
      ledger: { e2e: { ...GOOD, trackedBy: "visual" } },
      kind: "e2e",
      platforms: ["e2e"],
      pending: [],
      now: new Date("2026-10-09T00:00:00.000Z"),
    });
    expect(crossed.exitCode).toBe(1);
    // 话术要同时给出「写的是哪个跑法」与「这份账属于哪个跑法」——
    // 只说「抄混了」等于把定位成本推给下一个人。
    expect(crossed.problems.join("\n")).toContain("visual");
    expect(crossed.problems.join("\n")).toContain("e2e");
  });

  it("写全的记录 ⇒ 放行，并报出「上次自证距今多久」", () => {
    const result = runGate({
      ledger: { e2e: GOOD },
      kind: "e2e",
      platforms: ["e2e"],
      pending: [],
      now: new Date("2026-10-09T00:00:00.000Z"),
    });
    expect(result.exitCode).toBe(0);
    expect(result.ages).toEqual(["e2e：1 天前"]);
  });

  it("缺记录 ⇒ 阻断，话术里给出这条账自己的账文件与命令", () => {
    const result = runGate({
      ledger: {},
      kind: "e2e",
      platforms: ["e2e"],
      pending: [],
      now: new Date("2026-10-09T00:00:00.000Z"),
    });
    expect(result.exitCode).toBe(1);
    const text = result.problems.join("\n");
    expect(text).toContain(freshnessTrack("e2e").ledger);
    expect(text).toContain("pnpm test:e2e");
  });
});

describe("接线在位（§13.5.12：判据要有人跑）", () => {
  it("`pnpm test:e2e` 真的走这条通道（否则记账这一步没有执行者）", () => {
    const pkg = JSON.parse(readText("package.json")) as {
      scripts?: Record<string, string>;
    };
    /* 按**入口**判而不是按命令长得像什么：`playwright test` 与
     * `node scripts/e2e-run.mjs` 都能跑出同样的用例，只有后者会记账 ——
     * 而「账上有没有日期」正是这一档存在的全部意义。 */
    expect(pkg.scripts?.["test:e2e"]).toContain("scripts/e2e-run.mjs");
    expect(pkg.scripts?.["test:e2e:dry"]).toContain("--dry-run");
  });

  it("钩子那一步真判了这条账（每次提交都看得见它的日期）", () => {
    // `cmd` 逐字相等而不是 `toContain`：把这一行注掉时行首锚定的解析已经不认它
    // ——「把这一步静音」正是这一族要拦的动作（§13.5.8）。
    const steps = [
      ...readText(".githooks/pre-commit").matchAll(/^ {2}run "([^"]+)" (.+)$/gm),
    ].map((m) => ({ label: m[1] ?? "", cmd: m[2] ?? "" }));
    const hit = steps.find((s) =>
      s.cmd.includes("scripts/visual-freshness-gate.mjs"),
    );
    expect(hit?.cmd).toBe("node scripts/visual-freshness-gate.mjs");
    // 标签要说清它现在判两档 —— 标签里只写「像素基线」时，e2e 那一档红出来
    // 会读成「像素的事」，而两者动作不同。
    expect(hit?.label).toContain("e2e");
  });

  it("账文件真的读同一个落点（读接口与登记表同源）", () => {
    const live = readFreshnessLedgerAt(ROOT, TRACK.ledger);
    expect(Object.keys(live)).toContain(TRACK.key);
    // 这份记录是**真跑**过的（本轮的 `node scripts/e2e-run.mjs`），不是手写的一行。
    const rec = live[TRACK.key] as Record<string, unknown> | undefined;
    expect(String(rec?.trackedBy)).toBe("e2e");
  });

  it("仓库里这条账能通过自己的判决（改完脚本后别让它自己红）", () => {
    const ledger = readFreshnessLedgerAt(ROOT, TRACK.ledger);
    const result = runGate({
      ledger,
      kind: "e2e",
      platforms: [TRACK.key],
      pending: [],
    });
    expect(result.problems).toEqual([]);
    expect(result.exitCode).toBe(0);
  });
});
