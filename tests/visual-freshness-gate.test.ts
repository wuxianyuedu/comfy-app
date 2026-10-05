/**
 * 「每一档像素基线都有主」的判据（规范 §11.8）。
 *
 * 立案现场是本轮实测翻出来的另一条：**「录过一次」与「一直绿」是两件事**。入库的
 * `-linux.png` 有 4 张与当次环境差 1 像素（文字整体下移一行），而 linux 档此前的状态是
 * 「录过就算数」—— 没有任何东西记着这一档上次被跑绿是什么时候、下次该由谁跑。
 * 前一档（win32 缺几张）的账有 `PENDING_PLATFORMS`，这一档一条都没有。
 *
 * 判据分四头，缺一条这层就退化：
 *   ① **判决可被执行**：喂「缺记录 / 记录写不全 / 日期解不开 / 挂空档 / 齐全」五种形状；
 *   ② **pending 档不被要求**：缺几张基线的档记「上次自证」是句不成立的话，逼它填一条
 *      只会生产假读数（那是本节最不想有的东西）；
 *   ③ **记账可被观测**：`pixel-run.mjs` 跑绿即记、`--update` 不记、红着不记；
 *   ④ **钩子真的调它**：判据写在文件里而没人跑 = §13.5.12 那个「判据自称在跑」的形态。
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  FRESHNESS_LEDGER,
  freshnessAge,
  freshnessRecord,
} from "../scripts/visual-baselines.mjs";
import { runGate } from "../scripts/visual-freshness-gate.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

/** 一条写得全的记录（各条用例只改它要测的那一栏）。 */
const GOOD = freshnessRecord({
  platform: "linux",
  verifiedAt: "2026-10-05T00:00:00.000Z",
  who: "月读",
  how: "CI=true pnpm check:visual",
});

const NOW = new Date("2026-10-06T00:00:00.000Z");

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

describe("像素基线新鲜度判决（§11.8）", () => {
  it("每档都有写全的记录 ⇒ 放行，并报出「上次自证距今多久」", () => {
    /* `platforms` 喂**夹具**而不是真登记表：真表里 win32 挂在 `PENDING_PLATFORMS` 上
     * （缺 8 张、只能在那台机器上录），拿它当「非 pending」的样本会与那条登记打架。 */
    const result = runGate({
      ledger: { linux: GOOD, win32: GOOD },
      platforms: ["linux", "win32"],
      pending: [],
      now: NOW,
    });
    expect(result.exitCode).toBe(0);
    expect(result.problems).toEqual([]);
    expect(result.ages).toEqual(["linux：1 天前", "win32：1 天前"]);
  });

  it("一档都没有记录 ⇒ 阻断，话术指到「在那一档跑一次」与账文件", () => {
    const result = runGate({ ledger: {}, platforms: ["linux"], now: NOW });
    expect(result.exitCode).toBe(1);
    expect(result.problems.join("\n")).toContain("录过就算数");
    expect(result.problems.join("\n")).toContain(FRESHNESS_LEDGER);
  });

  it("记录写不全（who / how 空着）⇒ 各判一条 —— 「稍后补」在这里等于没写", () => {
    const short = freshnessRecord({
      platform: "linux",
      verifiedAt: "2026-10-05T00:00:00.000Z",
      who: "",
      how: "稍后",
    });
    const result = runGate({
      ledger: { linux: short },
      platforms: ["linux"],
      now: NOW,
    });
    expect(result.exitCode).toBe(1);
    expect(result.problems.join("\n")).toContain("who");
    expect(result.problems.join("\n")).toContain("how");
  });

  it("verifiedAt 不是一个日期 ⇒ 阻断（算不出「多久没跑」等于没记）", () => {
    const result = runGate({
      ledger: { linux: { ...GOOD, verifiedAt: "最近" } },
      platforms: ["linux"],
      now: NOW,
    });
    expect(result.exitCode).toBe(1);
    expect(result.problems.join("\n")).toContain("日期");
  });

  it("记录挂在**非登记**档上 ⇒ 阻断（删了平台的档就要同批抹账）", () => {
    const result = runGate({
      ledger: { linux: GOOD, darwin: GOOD },
      platforms: ["linux"],
      now: NOW,
    });
    expect(result.exitCode).toBe(1);
    expect(result.problems.join("\n")).toContain("darwin");
  });

  it("pending 档不被要求新鲜度记录，而以「待补录」出现在读数里", () => {
    /* 这一条是刻意的排除：`PENDING_PLATFORMS` 里那一档缺几张基线、只能在那档机器上录，
     * 记「上次跑绿」是句不成立的话。强行要求只会逼人填假读数。 */
    const result = runGate({ ledger: { linux: GOOD }, now: NOW, platforms: undefined });
    expect(result.exitCode).toBe(0);
    expect(result.ages.join("；")).toContain("linux：1 天前");
    expect(result.ages.join("；")).toContain("win32：待补录（PENDING_PLATFORMS）");
  });

  it("freshnessAge：日期解不开时返回 null（不许把「没记」读成「刚刚跑过」）", () => {
    expect(freshnessAge({ verifiedAt: "最近" }, NOW)).toBeNull();
    expect(freshnessAge(null, NOW)).toBeNull();
    expect(freshnessAge({ verifiedAt: "2026-10-06T00:00:00Z" }, NOW)).toBe("今天");
    // 未来时间（机器时钟漂了）不报一个负数天数 —— 那会读成「负 N 天前」。
    expect(freshnessAge({ verifiedAt: "2026-10-07T00:00:00Z" }, NOW)).toBeNull();
  });
});

describe("新鲜度账本身在仓库里（§11.8）", () => {
  it("仓库当前的账能通过自己的判决", async () => {
    const { readFreshnessLedger } = await import(
      "../scripts/visual-freshness-gate.mjs"
    );
    expect(runGate({ ledger: readFreshnessLedger() }).exitCode).toBe(0);
  });

  it("linux 档在账里（它是本仓库唯一能自证的档）", async () => {
    const { readFreshnessLedger } = await import(
      "../scripts/visual-freshness-gate.mjs"
    );
    const ledger = readFreshnessLedger();
    expect(Object.keys(ledger)).toContain("linux");
  });
});

describe("记账接线（§13.5.12：判据要有人跑）", () => {
  it("钩子真的调这个判据", () => {
    expect(read(".githooks/pre-commit")).toContain("visual-freshness-gate.mjs");
  });

  it("pixel-run 在**检查档跑绿**之后记账，`--update` 不记", () => {
    /* 「录基线」与「自证」是两件事：`--update` 只是「这次写成功了」，
     * 拿它去记「上次自证」正是本条要防的形态。 */
    const src = read("scripts/pixel-run.mjs");
    expect(src).toContain("recordFreshness");
    expect(src).toMatch(/if \(update\) return null;/);
  });
});
