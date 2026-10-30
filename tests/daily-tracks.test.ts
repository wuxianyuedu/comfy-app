/**
 * 「每天首次自证」从一档扩到三档（ISSUE #1282 的续）—— 规范 §11.8 / §13.5.4 / §13.5.12。
 *
 * 立案现场：平台流水线删掉（ISSUE #623）之后，`§13.5.3` 的欠账表里列着几条「**无自动执行者**」
 * 的判定档，其中两条此前唯一的执行者是文档里那句「按需手动跑」—— 而那句话没有任何东西在守：
 *   · **全量单测 + 覆盖率门槛**（`pnpm run test:coverage`，3000+ 用例 + 几十条按实测定的
 *     `coverage.thresholds`）—— 增量层（固定清单 + 受影响用例，2026-10-20 起归平台 PR 流水线的
 *     `受影响用例` 一格）**不跑覆盖率**，也判不了门槛；
 *   · **产物级护栏**（`pnpm run build` + `check-standalone-contents.cjs`）—— 它的失效形态
 *     恰好是「页面全 200、接口全 500」（硬规则 18）与「密钥明文进产物」（硬规则 17），
 *     两者都只在**真构建过一次**时才有结论。
 *
 * 判据分四头，缺一头这层就退化成一句好看的话：
 *   ① **档与档的区别是数据**：`FRESHNESS_TRACKS` 的三档都在，都按日历日判；
 *   ② **「改了就当天跑」**（`dirty` / `graceMs`）：三档「每天首次」的代价各不相同，
 *      十分钟量级的两档没必要每天都跑 —— 动过输入面就必须今天自证，没动过以宽限判；
 *   ③ **两条出路（`--skip` / `--dirty`）都留下能复核的事实**，占位理由一律被拦；
 *   ④ **接线在位**：各档的跑法脚本走同一份记账内核，钩子那一步真判了它们。
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path, { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { parseLedgerFlag } from "../scripts/daily-run.mjs";
import {
  shouldRecord as artifactRecords,
  planRun as artifactPlan,
} from "../scripts/artifact-run.mjs";
import {
  FULL_SUITE_TIMEOUT_MS,
  RERUN_TIMEOUT_MS,
  shouldRecord as suiteRecords,
  SUITE_JUNIT_RELATIVE,
  TRACK as SUITE_TRACK,
  classifyRerunOutcome,
  coverageGate,
  parseJunitPhaseCosts,
  planIsolatedRerun,
  planRun as suitePlan,
  rerunLaunches,
  suiteRanking,
  suitePhaseTax,
  toTransportSafePath,
} from "../scripts/full-suite-run.mjs";
import { abortedAdvice, classifyOutcome, hostUnsafeArgs } from "../scripts/launcher-core/shell.mjs";
import {
  FRESHNESS_TRACKS,
  dirtiesTrack,
  freshnessRecord,
  freshnessTrack,
  freshnessVerdict,
  gitUser,
  gitUserCandidates,
} from "../scripts/freshness-ledger.mjs";
import { dirtySinceToday, runGate, trackScopes } from "../scripts/freshness-gate.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

function readText(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

/** 一条写得全的记录（各条用例只改它要测的那一栏）。 */
const GOOD = freshnessRecord({
  key: "full",
  verifiedAt: "2026-10-09T00:30:00.000Z",
  who: "月读",
  how: "pnpm run test:coverage",
  trackedBy: "full",
});

const SAME_DAY = new Date("2026-10-09T06:00:00.000Z");

/**
 * 「今天」与「两天前」两个时刻，都从 `SAME_DAY` **推算**而不是写死日历日。
 *
 * 判据比的是 `isSameLocalDay`（**本地**日），而 `SAME_DAY` 是一个 UTC 瞬时：
 * 写死 `"2026-10-08T23:30:00.000Z"` 在 UTC+8 机器上落成本地 10-09 07:30 ——
 * 那**就是今天**，「昨天的豁免」这条用例会因为换台机器而结论翻转。
 * 偏移 -48h 在任何时区都至少跨过一个本地日界，而 +3d 之内仍在那两档的 7 天宽限里。
 * （这一族是本仓库的老对手：判据与平台/机器绑定、在别处测不出来。）
 */
const TODAY_AT = SAME_DAY.toISOString();
const TWO_DAYS_AGO = new Date(SAME_DAY.getTime() - 48 * 3_600_000).toISOString();

/** 夹具用的临时仓库（每条用例自建、跑完删掉，不动本仓库的提交历史）。 */
let workdir = "";

afterEach(() => {
  if (workdir) rmSync(workdir, { recursive: true, force: true });
  workdir = "";
});

/**
 * 判一档：省去各处重复的「平台就是它自己的 key」那句。
 *
 * ⚠️ 它判的是**本地拦截那一套口径**（`track: localTrack(kind)`，把 `ciStage` 清空）。
 * 三档从 2026-10-19 起都登记了平台侧执行者，按当前登记跑时「今天必须有凭证」那几支
 * 根本不会触发 —— 那样这里那批「⇒ 拦」的用例就会**因为走不到分支而恒绿**（恒绿与放行
 * 在断言上一模一样，但它是 §11.23 那一族「写了没有读者」的形状）。
 * 按当前登记判的那一档叫 `asRegistered()`，它判的正是「本地不拦」这一条新事实。
 */
function gate(kind: string, ledger: Record<string, unknown>, extra = {}) {
  return runGate({
    ledger,
    kind,
    keys: [freshnessTrack(kind).key],
    track: localTrack(kind),
    now: SAME_DAY,
    ...extra,
  });
}

/** 按**当前登记的形状**判一档（真实 `ciStage` ⇒ 本地那一层不该再出声）。 */
function asRegistered(kind: string, ledger: Record<string, unknown>, extra = {}) {
  return runGate({
    ledger,
    kind,
    keys: [freshnessTrack(kind).key],
    now: SAME_DAY,
    ...extra,
  });
}

/**
 * 把一档读成「**平台侧没有执行者**」的那一档。
 *
 * 为什么判据需要它：三档从 2026-10-19 起都登记了 `ciStage`（执行者 = 每日那一格），
 * 于是「今天动过面而账停在改动之前 ⇒ 拦」「过期 ⇒ 拦」「豁免过期 ⇒ 拦」这几支
 * 在真实档上再也走不到。它们不是废弃分支 —— 任何一档将来失去平台侧执行者时，
 * 清空 `ciStage` 就回到本地拦截的口径，而那时唯一还能证明「这支是活的」的东西
 * 就是这几条用例。拿合成档打它，与拿合成空面档打「dirty 为空必须忽略 dirtySince」
 * 是同一条理由（见上面那格）：**判据要能对当前登记之外的那种形状继续响**。
 */
function localTrack(kind: string) {
  return { ...freshnessTrack(kind), ciStage: "" };
}

describe("三档的登记形状（§11.8）", () => {
  it("三档都在，且每一档的六个值都写全", () => {
    expect(Object.keys(FRESHNESS_TRACKS).sort()).toEqual(["artifact", "e2e", "full"]);
    for (const [kind, track] of Object.entries(FRESHNESS_TRACKS)) {
      // 账文件 / 键 / 名字 / 命令是每条账的存在意义，缺一个这条记录就退化成一句空话。
      for (const field of /* SAFETY: 类型断言已复核 */ ["ledger", "key", "label", "run"] as const) {
        expect(String(track[field]).length, `${kind}.${field}`).toBeGreaterThan(0);
      }
      expect(track.ledger.endsWith(".json"), `${kind}.ledger`).toBe(true);
    }
  });

  it("每一档都登记了主体（判据主体分权）：只认 pr / master，且主体=master 的执行者落在每日档", () => {
    /* 主体答的是「**这一次是谁在判**」：`"pr"` = 本 PR（工作树那份账；PR 流水线与本地钩子
     * 都是它），`"master"` = 主干（每日档在 master HEAD 上跑出来的那一份；机器分支
     * `ci/freshness-ledger` 上是它的权威副本）。
     *
     * ⚠️ **主体=master ⇒ 那一档的账是主干的账** ⇒ 它的执行者必须落在**每日档**上：
     * 主干的账由每天 00:00 那一跑刷新，PR 流水线里没有、也不该有它的执行者。
     *
     * 这一条只判**登记层**（主体记对了没）；「那一格在不在每日清单里」由
     * `tests/no-platform-ci-config.test.ts` 的 `PR_MOVED_TO_DAILY` 那条与
     * `tests/doc-check-hook-wiring.test.ts` 的「每日侧有『每日新鲜度账』这一步」那条判
     * —— 三处各管一段，不在这里抄第二份清单解析器（§12.12 / §12.18）。 */
    for (const [kind, track] of Object.entries(FRESHNESS_TRACKS)) {
      const subject = String(track.subject ?? "").trim();
      expect(
        ["pr", "master"],
        `${kind}.subject 写成了「${subject}」—— 只认 pr / master（主体答的是「这一次是谁在判」）`,
      ).toContain(subject);
      if (subject !== "master") continue;
      expect(
        String(track.ciStage ?? "")
          .trim()
          .startsWith("每日"),
        `${kind}（主体=master）的执行者 ${track.ciStage} 不在每日档上 —— 主干的账只能由` +
          "每日那一跑刷新与判读",
      ).toBe(true);
    }
  });

  it("三份账**不共用一个文件**，三个键也互不相同", () => {
    // 共用 = 跑 A 档的绿把 B 档的自证覆盖掉，而账面上完全正常（同一个日期、同一个人）。
    const ledgers = Object.values(FRESHNESS_TRACKS).map((t) => t.ledger);
    const keys = Object.values(FRESHNESS_TRACKS).map((t) => t.key);
    expect(new Set(ledgers).size).toBe(ledgers.length);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("三档都按日历日判，且都不吃「有成套基线」那道闸", () => {
    /* 这道闸（`gatedByPending` / `dailyDemanded`）随像素档整档撤掉而消失：它的触发面
     * 是「还有平台档缺成套基线」，而像素层已经不在仓库里了。三档都按日历日判，
     * 「这一档今天要不要凭证」现在读的就是 `daily` 那一栏。 */
    for (const kind of ["e2e", "full", "artifact"]) {
      const track = freshnessTrack(kind);
      expect(track.daily, kind).toBe(true);
    }
  });

  it("每一档「今天不跑」那条出路都在登记里（`skipHow` 是判据话术的出处）", () => {
    /* 豁免不是装饰品：没有 `skipHow` 那一栏时，`writeSkipRecord` 直接抛「这一档没有
     * 豁免这条出路」，而钩子在拦人、却给不出一条出路。 */
    for (const kind of ["e2e", "full", "artifact"]) {
      expect(freshnessTrack(kind).skipHow, kind).toBeTruthy();
    }
  });

  it("判决面**由登记表派生**：新增一档自动被纳入，不靠手抄一份清单", () => {
    /* 这段曾经是手抄的（`{kind: "e2e", platforms: ["e2e"], pending: []}`），
     * 于是「新增一档却忘了在这一处加一行」⇒ 那一档**谁都不判** —— 判据的覆盖面与它
     * 自称的不符，正是 §13.5.12 的立案现场。 */
    const kinds = trackScopes().map((s) => s.kind);
    expect(kinds.sort()).toEqual(Object.keys(FRESHNESS_TRACKS).sort());
    // 每一档的「键面」就是它自己的 key（现算，不是手抄的第二份真值）。
    for (const scope of trackScopes()) {
      expect(scope.keys).toEqual([freshnessTrack(scope.kind).key]);
    }
  });
});

describe("「改了就当天跑」：dirty 档的判决（§11.8 / §13.5.4）", () => {
  it("今天已有自证 ⇒ 放行（当天第一次提交的代价不落到其余提交上）", () => {
    expect(gate("full", { full: GOOD }).exitCode).toBe(0);
  });

  it("**今天动过输入面**而账还停在改动之前 ⇒ 拦（这正是「改了就当天跑」）", () => {
    const old = { ...GOOD, verifiedAt: "2026-10-06T00:30:00.000Z" };
    const result = gate(
      "full",
      { full: old },
      {
        dirtySince: new Date("2026-10-09T05:00:00.000Z"),
      },
    );
    expect(result.exitCode).toBe(1);
    // 话术要同时给出「动了哪个目录」与「两条出路」——只说「要跑一次」等于把定位成本推走。
    const text = result.problems.join("\n");
    expect(text).toContain("src/");
    expect(text).toContain("pnpm run test:coverage");
    expect(text).toContain("--dirty");
  });

  it("没动输入面、且在宽限内 ⇒ 放行（十分钟量级的两档没必要每天都跑）", () => {
    const recent = { ...GOOD, verifiedAt: "2026-10-06T00:30:00.000Z" };
    expect(gate("full", { full: recent }).exitCode).toBe(0);
  });

  it("没动输入面、但超过宽限 ⇒ 拦（「没人动它」不等于「它可以一直不跑」）", () => {
    const stale = { ...GOOD, verifiedAt: "2026-09-01T00:30:00.000Z" };
    const result = gate("full", { full: stale });
    expect(result.exitCode).toBe(1);
    expect(result.problems.join("\n")).toContain("宽限");
  });

  it("「先跑后改」也放行：自证时刻晚于当天的第一次改动就算过了", () => {
    /* 两种顺序都是正当的 —— 早上跑完全量、下午再改代码，账不该在下午变成「没自证」。
     * 少这一条的话，「今天动过」会被实现成只看日界、把先跑后改的人全部误判。 */
    expect(
      gate(
        "full",
        { full: GOOD },
        {
          dirtySince: new Date("2026-10-09T00:00:10.000Z"),
        },
      ).exitCode,
    ).toBe(0);
  });

  /**
   * 全量 e2e 现在也吃输入面（钩子重构 4）。
   *
   * 立案现场：本检出最近 17 次提交里 6 次红，有 **3 次**是这条判据拦下的，而那三次改的
   * 都不是 `src/`（一笔只动 `.githooks/` 的编排改动、两笔文档/账）。旧口径「按本地日历日、
   * 不看面」让那些提交也欠一次全量 e2e 凭证，而**那次跑与不跑，被测链路的结论都不变** ——
   * 「同一份 spec 在任何改动上都该绿」这句话对改动本身成立，对「这一笔是不是那个改动」不成立。
   * 现在它与另两档同形：动了面 ⇒ 当天证；没动 ⇒ 7 天宽限。
   */
  it("`--ledger`（= `pnpm check:freshness`）把「欠不欠」一起打出来，但**不阻断**", () => {
    /* 这一档改过一次用途：它原本只印账面（时刻 / 距今 / 谁 + 命令）就 `continue`，
     * 于是「开工先看一眼」的人看得到上次是谁什么时候跑的，却看不到
     * **按今天这笔要提交的改动，我欠不欠一次自证** —— 而那正是这一眼要看的东西。
     * 现在它把同一份判决作为**待办**打出来（措辞是「欠」不是「✗」），退出码仍为 0：
     * 阻断的那一份在钩子里，两个读者各有各的出口（§13.5.12：别让一条读数线变成必经之路）。 */
    const src = readText("scripts/freshness-gate.mjs");
    const ledgerBranch = /if \(ledgerOnly\) \{[\s\S]*?\n {4}\}/.exec(src)?.[0] ?? "";
    expect(ledgerBranch, "读不出 --ledger 那一支").not.toBe("");
    // ① 判决要进去（`result.exitCode` 或 `problems` 被读出来才算「欠不欠」）
    expect(ledgerBranch).toContain("result.exitCode");
    expect(ledgerBranch).toContain("result.problems");
    expect(ledgerBranch).toContain("欠");
    // ② 反向：这一支**不许**碰 `failed`（那是钩子那一份的退出码来源）
    expect(ledgerBranch).not.toContain("failed");
    // ③ 入口要在 package.json 里挂着，否则这句话没人能找到
    expect(readText("package.json")).toMatch(
      /"check:freshness":\s*"node scripts\/freshness-gate\.mjs --ledger"/,
    );
  });

  it("e2e 吃了面之后：只动治理文件不欠凭证，动过 `src/` 就欠（两种顺序都判）", () => {
    const yesterday = {
      ...GOOD,
      key: "e2e",
      how: "pnpm test:e2e",
      trackedBy: "e2e",
      verifiedAt: "2026-10-08T00:30:00.000Z",
    };
    // 今天没动过这一档的面 ⇒ 1 天前的自证在 7 天宽限内，放行。
    expect(gate("e2e", { e2e: yesterday }, { dirtySince: null }).exitCode).toBe(0);
    // 今天动过面而账停在改动之前 ⇒ 拦，且话说清是哪一面。
    const owed = gate(
      "e2e",
      { e2e: yesterday },
      {
        dirtySince: new Date("2026-10-09T05:00:00.000Z"),
      },
    );
    expect(owed.exitCode).toBe(1);
    expect(owed.problems.join("\n")).toContain("输入面");
    expect(owed.problems.join("\n")).toContain("src/");
    // 先跑后改同样放行（自证时刻晚于当天第一次改动）。
    expect(
      gate(
        "e2e",
        { e2e: { ...yesterday, verifiedAt: "2026-10-09T06:00:00.000Z" } },
        { dirtySince: new Date("2026-10-09T05:00:00.000Z") },
      ).exitCode,
    ).toBe(0);
  });

  it("e2e 的面**不许被悄悄放宽成一切文件**，也不许收窄成只剩 spec", () => {
    /* 这一条钉的是清单的**内容**。放宽成 `[""]`（= 任何文件都命中）与收窄成都不会让
     * 任何别的判据红，只会让这条判据悄悄退回「按日历日」或「永远不拦」—— 而这两种
     * 都在账面留下完全正常的读数。正反两向各列具体路径：正 = 每一条都得真能命中
     *（前缀不是 glob，写错了是静默的），反 = 治理/文档/单测那一类必须不命中。 */
    const track = freshnessTrack("e2e");
    expect(track.dirty).toEqual([
      "src/",
      "e2e/",
      "playwright.config.ts",
      "next.config.js",
      "pnpm-lock.yaml",
    ]);
    for (const hit of [
      "src/app/(main)/page.tsx",
      "e2e/critical-flows.spec.ts",
      "playwright.config.ts",
      "next.config.js",
      "pnpm-lock.yaml",
    ]) {
      expect(dirtiesTrack(track, [hit]), hit).toBe(true);
    }
    for (const miss of [
      "docs/standards/13-提交与-code-review.md",
      "tests/hook-affected-launch.test.ts",
      "scripts/freshness-gate.mjs",
      ".githooks/pre-commit",
      "AGENTS.md",
      "changelog.d/0-x.md",
    ]) {
      expect(dirtiesTrack(track, [miss]), miss).toBe(false);
    }
  });

  it("`dirty` 为空的档**必须忽略** `dirtySince`（三档都吃面之后，机制由合成档判）", () => {
    /* 这条守的是机制而不是某一档的当前形状：若哪天新增一档忘了填 `dirty`，而判决照旧读
     * `dirtySince`，「今天动过一次任何文件」就会被读成「这一档已被自证」，日历日那条判据
     * 在有人动过代码的日子里**整个失效而账面一切正常**（`freshnessVerdict` 里那句注释）。
     * e2e 改成吃面之后登记表里没有现成的空面档，所以合成一份 —— 判据要能对被删掉的
     * 那一格继续响，否则它只是「此刻恰好没人这样填」的截图。 */
    const noFace = {
      ...freshnessTrack("e2e"),
      dirty: [],
      dirtyHow: null,
      graceMs: 0,
    };
    const at = new Date("2026-10-08T00:30:00.000Z");
    const problem = freshnessVerdict({
      track: noFace,
      at,
      now: SAME_DAY,
      dirtySince: new Date(0),
    });
    expect(problem, "空面档被 dirtySince 免掉了 —— 日历日那条判据已经失效").not.toBeNull();
    expect(problem).toContain("今天还没有自证");
    // 同一份 at / 同一个 dirtySince，换成吃面的档就走宽限那一支（放行）。
    expect(
      freshnessVerdict({
        track: freshnessTrack("e2e"),
        at,
        now: SAME_DAY,
        dirtySince: new Date(0),
      }),
    ).toBeNull();
  });

  it("`freshnessVerdict` 三种形态各自可被执行（判决抽成纯入口的意义）", () => {
    const track = freshnessTrack("full");
    const at = new Date("2026-10-06T00:30:00.000Z");
    expect(
      freshnessVerdict({
        track,
        at: GOOD.verifiedAt ? new Date("2026-10-09T00:30:00.000Z") : at,
        now: SAME_DAY,
        dirtySince: null,
      }),
    ).toBeNull();
    expect(freshnessVerdict({ track, at, now: SAME_DAY, dirtySince: null })).toBeNull();
    expect(
      freshnessVerdict({
        track,
        at,
        now: SAME_DAY,
        dirtySince: new Date("2026-10-09T05:00:00.000Z"),
      }),
    ).not.toBeNull();
  });
});

/**
 * `ciStage` —— 执行者挪到平台侧之后，本地那一层拦什么、不拦什么（2026-10-19 的口径）。
 *
 * 立案：用户那句是「新鲜度都不要本地跑，都 ci 跑」。这句话成立的前提是**平台侧真的有人跑**，
 * 而它一旦被满足，本地再要求「当天自证一次」就是同一条判据收两次钱，第二次的代价是
 * 10~25 分钟墙钟（本仓实测：组 C 中位 1108s、全量 e2e 十几分钟、`next build` 冷节点上
 * 比 118s 慢得多）。这一组判的四格缺一格都会漂：
 *   ① 三档都登记了 `ciStage`（否则「本地不拦」是一句没有主语的话）；
 *   ② 同一份「今天动过面而账停在改动之前」的输入，按当前登记判 ⇒ **不拦**；
 *      把 `ciStage` 清空 ⇒ 立刻回到拦（证明那条豁免是数据在起作用，不是判据被删）；
 *   ③ 豁免只豁免「今天必须有凭证」这一层：**账面的形状照旧判** —— 一条把 `trackedBy`
 *      抄混的记录仍然红。撤的是要求，不是让读数可以假；
 *   ④ 没有平台侧执行者时不许留空：`ciStage` 指向的那一格必须在
 *      `COMFYAPP_CI_DAILY_GATES` 里（那条判据写在 `tests/no-platform-ci-config.test.ts`，
 *      它判的是配置文件，这里只判判决）。
 */
describe("ciStage：执行者在平台侧的那些档（§11.8 / §13.5.23）", () => {
  it("① 三档都登记了非空 `ciStage`，且判决把它带回来给调用方", () => {
    for (const kind of ["e2e", "full", "artifact"]) {
      const stage = String(freshnessTrack(kind).ciStage ?? "").trim();
      expect(stage, `${kind} 没有登记平台侧执行者`).toBeTruthy();
      expect(
        asRegistered(kind, {}, {}).ciStage,
        `${kind}：runGate 没把 ciStage 带出去，钩子那一行就说不清「谁在跑这一档」`,
      ).toBe(stage);
    }
  });

  it("② 同一份「动过面而账旧」的输入：按当前登记不拦，清空 ciStage 立刻拦", () => {
    const old = { ...GOOD, verifiedAt: "2026-10-06T00:30:00.000Z" };
    const dirtySince = new Date("2026-10-09T05:00:00.000Z");
    const now = asRegistered("full", { full: old }, { dirtySince });
    expect(
      now.problems,
      `本地还在拦这一档（${now.problems.join("；")}）—— 执行者已在平台侧，` +
        "这一层再拦就是同一条判据收两次墙钟",
    ).toEqual([]);
    expect(now.exitCode).toBe(0);
    // 同一份输入换个登记形状，必须立刻回到「拦」—— 证明豁免读的是数据，不是删了分支。
    const local = gate("full", { full: old }, { dirtySince });
    expect(local.exitCode).toBe(1);
    expect(local.problems.join("\n")).toContain("今天的提交动过这一档的输入面");
  });

  it("② 顺带：本地**没有留痕**也不再是红，但读数照打（撤拦 ≠ 撤账）", () => {
    const empty = asRegistered(
      "full",
      {},
      {
        dirtySince: new Date("2026-10-09T05:00:00.000Z"),
      },
    );
    expect(
      empty.problems,
      "ci-owned 那一档「账里没有记录」不该再拦 —— 执行者在平台侧，本地这一格可以一直没人跑",
    ).toEqual([]);
    expect(
      empty.ages.join(""),
      "不拦不等于不打：「上一次本地自证是什么时候」是这一档唯一的能见度来源",
    ).toContain("无记录");
  });

  it("③ 撤的是「今天必须有凭证」，不是账面的形状 —— `trackedBy` 抄混照旧红", () => {
    /* 这一条是本组最要紧的一格：豁免写下去之后，「随便怎么写都算数」是最自然的滑坡。
     * 记录存在时它的形状判据**一条都不该跟着 ciStage 一起撤** —— 读数也得是真的。 */
    const mixed = {
      ...GOOD,
      verifiedAt: TODAY_AT,
      trackedBy: "e2e", // 挂在 full 的账上，却是 e2e 跑法写的
    };
    const result = asRegistered("full", { full: mixed });
    expect(result.exitCode).toBe(1);
    expect(result.problems.join("\n")).toContain("两条新鲜度账同形");
    // 同一条坏形状在本地口径下也红（两条腿共用同一份形状判据，不是各写一份）。
    expect(gate("full", { full: mixed }).exitCode).toBe(1);
  });
});

describe("两条出路：豁免与非输入面（§11.8 豁免不是绕过）", () => {
  it("`--skip` / `--dirty` 的解析：没给 / 可用理由 / 占位理由三种形状", () => {
    // 两个开关共用一份解析（`daily-run.mjs` 的 `parseLedgerFlag`），所以边界只测一遍。
    expect(parseLedgerFlag(["node", "x"], "--skip")).toEqual({
      mode: "run",
      reason: null,
    });
    expect(parseLedgerFlag(["--dirty", "本次只改文档，不动产物链"], "--dirty")).toEqual({
      mode: "dirty",
      reason: "本次只改文档，不动产物链",
    });
    for (const bad of [undefined, "", "稍后", "TBD", "待定"]) {
      expect(parseLedgerFlag(["--skip", bad], "--skip").reason).toBe(null);
    }
    // 两个开关**互不串档**：给了 `--dirty` 时 `--skip` 仍是「没给」。
    expect(parseLedgerFlag(["--dirty", "本次只改文档，不动产物链"], "--skip").mode).toBe("run");
  });

  it("账里的两种「不跑」互不等于：豁免与「不吃这一档」各占一栏", () => {
    /* 混成一栏的表现是：「这一档三个月没跑」与「这三个月每次都声明不吃它」长得一模一样，
     * 而那正是这张账要防的形态。所以 `--dirty` 写 `dirtyReason`、`--skip` 写 `skippedReason`。 */
    const dirty = freshnessRecord({
      key: "artifact",
      verifiedAt: "2026-10-09T00:30:00.000Z",
      who: "月读",
      how: "pnpm run build",
      trackedBy: "artifact",
      dirtyReason: "本次只改组件样式，不动产物链",
    });
    expect(dirty.skippedReason).toBeUndefined();
    expect(gate("artifact", { artifact: dirty }).exitCode).toBe(0);
    /* ⚠️ 这一条钉的是 `freshnessRecord` **必须透传 `dirtyReason`**：它只搬它认识的键，
     * 漏掉这一栏时 `--dirty` 写下的那句会**在这一步被静默丢掉**，账面上剩一条没有理由的
     * 记录、而 `verifiedAt` 是今天 ⇒ 判据当它「今天自证过」放行。一个看着正常的记录
     * 指的是另一件事 —— 正是本机制最不能有的形态。 */
    expect(dirty.dirtyReason).toBe("本次只改组件样式，不动产物链");
    // 占位理由照样拦（两种出走话术不同，判据同一条）。
    const placeholder = { ...dirty, dirtyReason: "稍后" };
    const result = gate("artifact", { artifact: placeholder });
    expect(result.exitCode).toBe(1);
    expect(result.problems.join("\n")).toContain("不吃这一档");
  });

  it("同日 `dirtyReason` 被当天的提交驳倒 ⇒ 拦（那句是**事实声明**，不是决定）", () => {
    /* 存量现场：`.full-suite-freshness.json` 里有一条「本 PR 只接机制
     * （scripts/ + tests/ + docs），未动 src/」，而这一档的输入面就是 ["src/","tests/"]。
     * 旧判据从不拿 `dirtySince` 去核这句话，于是整档当天免跑，而账面上一切正常
     * （合法日期 + 人名 + 一条读得通的理由）—— §11.23 那一族。 */
    const contradicted = {
      ...GOOD,
      verifiedAt: TODAY_AT,
      dirtyReason: "只改文档与注释，src/ 与 tests/ 一条没碰",
    };
    const result = gate(
      "full",
      { full: contradicted },
      { dirtySince: new Date("2026-10-09T05:00:00.000Z") },
    );
    expect(result.exitCode, result.problems.join("\n")).toBe(1);
    const text = result.problems.join("\n");
    expect(text).toContain("与事实相反");
    expect(text).toContain("src/");
    // 出路要给出**另一条出路**：只改文档时该写的是「今天故意不跑」，不是事实声明。
    expect(text).toContain("--skip");
  });

  it("同日 `skippedReason` 就算今天动过输入面也放行（决定不受事实反驳）", () => {
    /* 与上面那条是一对，缺它就分不出两种出路的分工：`skippedReason` 承认这一档相关、
     * 只声明今天没跑，代价是**明天要重写一次**；`dirtyReason` 声明的是一个可核的事实。
     * 把两者都拿去反驳 `dirtySince`，等于把「今天不跑」这条出路也堵死 —— 那会逼人
     * 去写那句更容易被驳倒的话（§11.18.4：会把人推向坏一侧的判据是有害的判据）。 */
    const decided = {
      ...GOOD,
      verifiedAt: TODAY_AT,
      skippedReason: "机器此刻满载，跑出来的比例不可归因",
    };
    expect(
      gate(
        "full",
        { full: decided },
        {
          dirtySince: new Date("2026-10-09T05:00:00.000Z"),
        },
      ).exitCode,
    ).toBe(0);
  });
  it("**昨天的豁免不再为今天作证**（豁免是一条关于某一天的话）", () => {
    /* 立案现场：`scripts/.e2e-freshness.json` 挂着一条 2026-10-08 的 `skippedReason`，
     * 而判据在这一支从不比 `verifiedAt` —— 一条理由一旦写下就替未来每一天作证，
     * 「每日自证」在没人跑的日子里一直是绿的。写入侧本来就是把 `verifiedAt` 戳成
     * 「此刻」（`writeSkipRecord`），`--skip` 的用法原文也写着「**今天**不跑」。 */
    const yesterdayWaiver = freshnessRecord({
      key: "e2e",
      verifiedAt: TWO_DAYS_AGO,
      who: "月读",
      how: "pnpm test:e2e",
      trackedBy: "e2e",
      skippedReason: "那次只解决合并冲突与文档同步，未动功能链路",
    });
    const result = gate(
      "e2e",
      { e2e: yesterdayWaiver },
      {
        /* 钩子重构 4 之后 e2e 吃输入面，所以这一格要的是「今天确实动过它的面」——
         * 日历日那一支（没动面、昨天豁免 ⇒ 今天回到自己的口径）由上面那条合成档用例守着，
         * 两边都留着才看得出「豁免只替当天作证」这条纪律没跟着口径一起被换掉。 */
        dirtySince: new Date("2026-10-09T01:00:00.000Z"),
      },
    );
    expect(result.exitCode, result.problems.join("\n")).toBe(1);
    const text = result.problems.join("\n");
    // 话术要同时给出「回到自己的口径」与「那是豁免不是凭证」，否则读起来像跑绿过。
    expect(text).toContain("输入面");
    expect(text).toContain("上一条是豁免");
    expect(text).toContain("不是跑绿的凭证");
  });

  it("**今天的豁免仍然放行**（这一档不许变成「每天必须跑」的仪式）", () => {
    const todayWaiver = freshnessRecord({
      key: "e2e",
      verifiedAt: TODAY_AT,
      who: "月读",
      how: "pnpm test:e2e",
      trackedBy: "e2e",
      skippedReason: "本机同机并行会话占着端口与 CPU，今天不跑，明天补",
    });
    expect(gate("e2e", { e2e: todayWaiver }).exitCode).toBe(0);
  });

  it("过期豁免**不是「过期即红」**：吃输入面的那档落回自己的宽限", () => {
    /* 这一条与上面那条是一对：过期之后判据把这一档**交回 `freshnessVerdict`**，
     * 于是 `dirty` / `graceMs` 继续说话 —— 全量单测那档两天前跑绿过、今天没动输入面，
     * 该放行。少了这一条，「豁免要过期」会被做成「每天都必须跑或每天都得写理由」，
     * 那就把 #1282 收掉的那层（「改了就当天跑」）又推回来了。 */
    const expired = {
      ...GOOD,
      verifiedAt: TWO_DAYS_AGO,
      skippedReason: "那两天只改文档与脚本注释，没动 src 也没动用例",
    };
    expect(gate("full", { full: expired }).exitCode).toBe(0);
    /* 而同一条过期豁免，在**今天动过输入面**时就要拦 —— 宽限只对「没人动它」成立。 */
    const dirtied = gate(
      "full",
      { full: expired },
      {
        dirtySince: new Date("2026-10-09T05:00:00.000Z"),
      },
    );
    expect(dirtied.exitCode).toBe(1);
    expect(dirtied.problems.join("\n")).toContain("今天的提交动过这一档的输入面");
  });
});

describe("跑法各自的命令核（§12.12：同形而不同命令）", () => {
  it("全量单测那一档跑的是 `test:coverage`（覆盖率门槛只在这一档判，§11.7）", () => {
    /* 并发是本档**自己**加的（`--maxWorkers`，ISSUE #1993 / §13.5.21）：
     * 位置固定在第 3 个参数、值由 `scripts/ci-load.mjs` 按现场核数给 —— 这里钉形状，
     * 不钉数字（核数会变，钉死它等于把「按事实降载」又写回一个常数）。 */
    const args = suitePlan().args;
    expect(args.slice(0, 2)).toEqual(["run", "test:coverage"]);
    expect(args[2]).toMatch(/^--maxWorkers=[1-9]\d*$/);
    /* 并发**不进** `extra`：进去了 `isWholeTrackRun` 会把每一次跑都判成「不是整档」，
     * 于是记账通道整个失效（那比不加并发严重得多）。 */
    expect(suiteRecords({ exitCode: 0, dryRun: false, extra: [] })).toBe(true);
    expect(SUITE_TRACK.run).toBe("pnpm run test:coverage");
    // 红的定性那句必须给出「跑过 ≠ 跑绿过」—— 记账语义靠它有据可依。
    expect(readText("scripts/full-suite-run.mjs")).toContain("不记账");
  });

  it("产物级护栏那一档走的是 `build` 那一行（两步都在里面，不另拼一遍）", () => {
    // 另拼一遍 = 两处各写一条产物链，漏掉「剥私有输入」那一步的表现是构建绿了、
    // 产物里那把刀却没跑（硬规则 17 判过的形态）。
    expect(artifactPlan().args).toEqual(["run", "build"]);
    const pkg = /* SAFETY: 类型断言已复核 */ JSON.parse(readText("package.json")) as {
      scripts?: Record<string, string>;
    };
    const build = pkg.scripts?.build ?? "";
    for (const step of [
      "next build",
      "standalone-private-inputs.mjs",
      "check-standalone-contents.cjs",
    ]) {
      expect(build, `build 里少了 ${step}`).toContain(step);
    }
  });

  it("两档都只在**绿了**才记账（红着记一条「我跑过」会把两件事混成一件）", () => {
    for (const record of [suiteRecords, artifactRecords]) {
      expect(record({ exitCode: 0, dryRun: false })).toBe(true);
      expect(record({ exitCode: 1, dryRun: false })).toBe(false);
      expect(record({ exitCode: 0, dryRun: true })).toBe(false);
    }
  });

  it("两档都不给**跑的不是整档**的一记（退 0 ≠ 整档绿；e2e 档实测被 `--help` 骗过一次）", () => {
    /* 三档共用同一条形状判据（`freshness-ledger.mjs` 的 `isWholeTrackRun`）：
     * `extra` 是按位置透传给底层命令的，所以 `--help` / `--list` 这类「打完字就退 0」
     * 与「只跑一个子集」都可能满足旧的记账条件（退出码 0 且非 dry-run）。
     * 这里逐档钉住，是因为这三份 `shouldRecord` 各自导出、各自被调用 ——
     * 只修一档的话，另外两档的账照样能被一条参数骗出来。 */
    for (const record of [suiteRecords, artifactRecords]) {
      expect(record({ exitCode: 0, dryRun: false })).toBe(true);
      expect(record({ exitCode: 0, dryRun: false, extra: [] })).toBe(true);
      expect(record({ exitCode: 0, dryRun: false, extra: ["--help"] })).toBe(false);
      expect(record({ exitCode: 0, dryRun: false, extra: ["tests/x.test.ts"] })).toBe(false);
      /* 不带 `extra` 的旧形态保持原语义（默认整档）。 */
      expect(record({ exitCode: 0, dryRun: false })).toBe(true);
    }
  });

  it("「绿了但不记账」那一拍的话术三档共用一份 —— 不许拿红的话术打退 0", () => {
    /* 接上形状判据之后多出来的一种形态：退出码 0，却因为透传了参数而不成账。
     * 这一拍**不是红**，若继续走「✗ 未通过（退出码 0）」那句，输出自相矛盾 ——
     * 下一个人会去查一条根本不存在的失败。所以它必须走 `notWholeTrackNotice`，
     * 且那条分支要显式判「退出码 0」（否则红的形态会误用话术、把真红说成没跑整档）。 */
    for (const rel of [
      "scripts/e2e-run.mjs",
      "scripts/full-suite-run.mjs",
      "scripts/artifact-run.mjs",
    ]) {
      const text = readText(rel);
      expect(text, `${rel} 没接上三档共用的话术`).toContain("notWholeTrackNotice");
      expect(text, `${rel} 的话术分支没先判退出码 0`).toContain("exitCode === 0 && !shouldRecord(");
    }
  });
});

describe("墙钟预算：**测量没发生**与「判据红」必须分得开（ISSUE #1834）", () => {
  /* 立案现场：全量档在 win32 检出上无争抢实测 ~10 分钟，而 `runPnpmSync` 的**缺省**
   * 预算是 600_000 —— 只要有任何并发（叠一次运行），子进程就在 600s 处被砍，
   * `res.status` 为 null。旧写法 `res.status ?? 1` 把它读成「退出码 1」，
   * 也就是「这批用例红了」；而下一个人据此去查用例，查到的是空气。 */
  it("`classifyOutcome`：没量到（起不来 / 被砍）与量到但非零，是两件事", () => {
    // 被预算砍：`spawnSync` 给 error=ETIMEDOUT、status=null
    expect(classifyOutcome({ status: null, error: { code: "ETIMEDOUT" } })).toBe("aborted");
    // 被信号打死：error 不在、status 也是 null
    expect(classifyOutcome({ status: null, error: null })).toBe("aborted");
    // 命令压根没起来
    expect(classifyOutcome({ status: null, error: { code: "ENOENT" } })).toBe("aborted");
    // 跑完了、非零 —— 这一个才是「判据红」
    expect(classifyOutcome({ status: 1, error: null })).toBe("ran");
    expect(classifyOutcome({ status: 0, error: null })).toBe("ran");
  });

  it("本档显式给了预算，且大于「实测 10 分钟量级」的并发余量", () => {
    expect(FULL_SUITE_TIMEOUT_MS).toBeGreaterThan(600_000);
    // 读的是**实际传给子进程**的那个数（不是只在常量上写一遍）。
    expect(readText("scripts/full-suite-run.mjs")).toContain("timeoutMs: FULL_SUITE_TIMEOUT_MS");
  });

  it("产物档走同一条分流（同源同病：缺省 600_000）", () => {
    expect(readText("scripts/artifact-run.mjs")).toContain("timeoutMs: ARTIFACT_TIMEOUT_MS");
    expect(readText("scripts/artifact-run.mjs")).toContain("classifyOutcome");
  });

  it("两档的红话术**不一样**：被砍时不许说「未通过 … 不记账」那一套", () => {
    /* 这条判的是「下一动作」：判据红 ⇒ 看用例名去修；被砍 ⇒ 看这台机器上还有谁在跑。
     * 两种收场共用一段话术时，读的人只能自己猜是哪一种 —— 那正是本单要治的形态。 */
    const advice = abortedAdvice({
      label: "全量单测 + 覆盖率",
      timeoutMs: FULL_SUITE_TIMEOUT_MS,
    });
    expect(advice).toContain("测量没发生");
    expect(advice).toContain("要修的不是用例");
    expect(advice).not.toContain("不记账");
  });
});

describe("接线在位（§13.5.12：判据要有人跑）", () => {
  it("`package.json` 的入口真的走这层通道（否则记账这一步没有执行者）", () => {
    const pkg = /* SAFETY: 类型断言已复核 */ JSON.parse(readText("package.json")) as {
      scripts?: Record<string, string>;
    };
    // 按**入口**判而不是按命令长得像什么：裸 `vitest run --coverage` 也能跑出同样的用例，
    // 只有走这一层才会记账 —— 而「账上有没有日期」正是这一档存在的全部意义。
    expect(pkg.scripts?.["test:coverage:tracked"]).toContain("scripts/full-suite-run.mjs");
    expect(pkg.scripts?.["build:tracked"]).toContain("scripts/artifact-run.mjs");
    expect(pkg.scripts?.["test:coverage:dry"]).toContain("--dry-run");
    expect(pkg.scripts?.["build:tracked:dry"]).toContain("--dry-run");
  });

  it("钩子那一步真判了这几档（标签要点名 e2e，否则红出来会读成别人的事）", () => {
    const steps = [...readText(".githooks/pre-commit").matchAll(/^ {2}run "([^"]+)" (.+)$/gm)].map(
      (m) => ({ label: m[1] ?? "", cmd: m[2] ?? "" }),
    );
    const hit = steps.find((s) => s.cmd.includes("scripts/freshness-gate.mjs"));
    expect(hit?.cmd).toBe("node scripts/freshness-gate.mjs");
    expect(hit?.label).toContain("e2e");
    // 标签要说清它现在判的是哪几档 —— 只写其中一档时，另一档红出来会被读成别人的事。
    expect(hit?.label).toContain("自证");
  });

  it("各档的记账走**同一份内核**（§12.12：不造第二轮子）", () => {
    // 「绿才记」「豁免下限」「账的形状」三条各被一条用例钉住，抄一份就多一处能悄悄漂的地方，
    // 而漂了不会红（账面上仍是合法的日期 + 人名 + 命令）。
    for (const rel of [
      "scripts/e2e-run.mjs",
      "scripts/full-suite-run.mjs",
      "scripts/artifact-run.mjs",
    ]) {
      expect(readText(rel), rel).toContain("daily-run.mjs");
    }
    expect(readText("scripts/daily-run.mjs")).toContain("writeSkipRecord");
    // `--dirty` 这条出路也必须走共用内核，不是各写一份。
    expect(readText("scripts/daily-run.mjs")).toContain("--dirty");
  });

  it("记账要用的人名推导只有一份（`gitUser`，各档共用）", () => {
    // 各写一套时会出现「这一档记的是环境变量、那一档记的是 git config」，
    // 于是同一个人的几条记录名字不一样。
    expect(typeof gitUser("full")).toBe("string");
    for (const rel of ["scripts/full-suite-run.mjs", "scripts/artifact-run.mjs"]) {
      expect(readText(rel), rel).toContain("gitUser");
    }
  });

  it("`who` 那栏在平台侧有人名可读 —— CNB 的内置变量排在 `git config` **之前**", () => {
    /* 平台侧的工作区是只读检出，`git config user.name` 要么是空的、要么是检出器留下的
     * 占位 —— 而 `who` 是这条账存在的意义（「谁、什么时候、按哪条命令」里那个「谁」），
     * 记成占位等于没记。所以平台侧那三个内置变量（官方「默认环境变量」文档：
     * `CNB_BUILD_USER_NICKNAME` / `CNB_BUILD_USER` / `CNB_COMMITTER`）必须排在
     * `git config user.name` **之前**，而 `GIT_AUTHOR_NAME` 仍排在最前
     * （它是「这一次是谁在写」这句话本身，不是从环境里猜的）。
     *
     * 用**注入环境**真跑一遍而不是读文本：候选清单是一份有序数组，而「顺序」正是
     * 这条判据要守的东西 —— 只 grep 有没有那几个名字，顺序反了照样绿。 */
    const saved = { ...process.env };
    try {
      process.env.GIT_AUTHOR_NAME = "显式身份";
      process.env.CNB_BUILD_USER_NICKNAME = "月读";
      process.env.CNB_BUILD_USER = "cnb.dQh7kaCfAPA";
      expect(gitUserCandidates().map((v) => String(v ?? "").trim())[0]).toBe("显式身份");
      delete process.env.GIT_AUTHOR_NAME;
      expect(gitUser(SUITE_TRACK.key)).toBe("月读");
      delete process.env.CNB_BUILD_USER_NICKNAME;
      expect(gitUser(SUITE_TRACK.key)).toBe("cnb.dQh7kaCfAPA");
    } finally {
      for (const k of ["GIT_AUTHOR_NAME", "CNB_BUILD_USER_NICKNAME", "CNB_BUILD_USER"]) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
    /* 兜底那一格仍要能答出一个说得清来路的字符串（环境全空时不许回空串 ——
     * 空串会被 `checkFreshnessLedger` 的 `who` 下限判红，而那条红读起来像
     * 「记录写不全」，不像「环境里没有身份」）。 */
    expect(typeof gitUser("full")).toBe("string");
    expect(gitUser("full").length).toBeGreaterThan(0);
  });
});

describe("dirtySince 的取证（问不出来 ≠ 没动过）", () => {
  it("面清单为空的**合成**档恒为 null（判据不许为它白起一次 git）", () => {
    /* 三档现在都吃输入面，所以「不吃面的档」在登记表里已经不存在了 —— 这一格改判合成档：
     * 它守的是 `dirtySinceToday` 那一侧的成本与语义（`dirty` 为空 ⇒ 连问都不问 git，
     * 更不许把「问不出来」当成「没动过」）。下一轮若真加了一档不吃面，这条照样管用。 */
    expect(dirtySinceToday({ ...freshnessTrack("e2e"), dirty: [] })).toBeNull();
    // 反过来：e2e 现在吃面，所以它**不**走那条早退（真仓库里返回 Date 或 null 都算走过 git）。
    expect(freshnessTrack("e2e").dirty.length).toBeGreaterThan(0);
  });

  it("**空行分隔的是「时刻与它的文件清单」**，不是两次提交（实测撞出来的一个静默失效）", () => {
    /* `git log --format=%cI --name-only` 的实际输出是 `…T14:10:05+08:00\n\nsrc/a.ts\n…`：
     * 空行夹在**时刻与文件之间**。第一版实现「遇空行就收段」，于是 `stamp` 会在文件行到达
     * **之前**被清掉 —— 判据**每一次**都判成「今天没动过这一档」，而话术里一个字都不会提
     * （正是 §13.5.12 那一族：判据在场、结论恒放行）。所以这里用**真 git 输出**的形状钉住它。
     *
     * 用临时仓库造现场（不是读本仓库的提交历史）：本仓库今天动过什么随提交变化，
     * 拿它当夹具的用例会在某个平常的提交上自己变红。 */
    const dir = mkdtempSync(join(tmpdir(), "dirty-since-"));
    workdir = dir;
    const git = (...args: Array<string>) =>
      execFileSync("git", args, { cwd: dir, encoding: "utf8" });
    git("init", "-q", ".");
    git("config", "user.email", "t@example.com");
    git("config", "user.name", "t");
    git("config", "commit.gpgsign", "false");
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "a.ts"), "x\n");
    git("add", "-A");
    git("commit", "-qm", "touch src");
    mkdirSync(join(dir, "scripts"), { recursive: true });
    writeFileSync(join(dir, "scripts", "x.mjs"), "y\n");
    git("add", "-A");
    git("commit", "-qm", "touch scripts");

    const out = git("log", "--format=%cI", "--name-only", "--");
    // 先钉住夹具的形状：空行确实夹在时刻与文件之间（改了 git 输出格式时这条先红）。
    expect(out).toMatch(/T\d{2}:\d{2}:\d{2}[^\n]*\n\n/);

    /* 状态机与 `dirtySinceToday` 逐字同源（那条函数读的是真仓库，没法在夹具上跑）。
     * 复刻它的唯一目的是让「空行怎么处理」这条边界**可被执行** —— 它是这段实现里
     * 唯一出错不会红的地方。 */
    const sinceFor = (prefixes: Array<string>) => {
      let earliest: Date | null = null;
      let stamp: string | null = null;
      let hit = false;
      const flush = () => {
        if (hit && stamp) {
          const at = new Date(stamp);
          if (!Number.isNaN(at.getTime()) && (!earliest || at < earliest)) earliest = at;
        }
        hit = false;
      };
      for (const line of out.split("\n")) {
        const t = line.trim();
        if (!t) continue;
        if (/^\d{4}-\d{2}-\d{2}T/.test(t)) {
          flush();
          stamp = t;
          continue;
        }
        if (prefixes.some((p) => t.startsWith(p))) hit = true;
      }
      flush();
      /* `earliest` 在闭包 `flush()` 里被赋值，TS 的控制流分析看不进去 ——
       * 不显式声明的话 `return` 会被收窄成初值 `null`，调用方的 `.toISOString()` 报 `never`。 */
      return /* SAFETY: 类型断言已复核 */ earliest as Date | null;
    };
    /* 两个提交各自命中自己那一行、各自解出一个时刻。
     * ⚠️ **不许拿「两者相等」当判据**：夹具是背靠背两次提交，而 `%cI` 的精度是
     * **秒** —— 它们只在**恰好落在同一秒**时才相等，跨秒就红（实测：全量并行档
     * 偶发，隔离重跑必绿）。那量的是机器的调度，不是状态机。
     * 这里改判**顺序关系**（`src/` 先提交 ⇒ 不晚于 `scripts/`），它不依赖两笔
     * 提交是否同秒 —— 而「空行没把 stamp 提前清掉」这件事照样被钉住：
     * 若 stamp 在文件行到达前被清，两边都会是 null。 */
    const srcAt = sinceFor(["src/"]);
    const scriptsAt = sinceFor(["scripts/"]);
    expect(srcAt).not.toBeNull();
    expect(scriptsAt).not.toBeNull();
    expect(srcAt!.getTime()).toBeLessThanOrEqual(scriptsAt!.getTime());
    // 没动过的输入面 ⇒ null（不是「今天没动过」以外的任何东西）。
    expect(sinceFor(["src-tauri/"])).toBeNull();
  });

  it("真检出上跑一次：返回值要么是今天的时刻、要么是 null（不许抛、不许伪造）", () => {
    /* 这条不问「今天到底动过没有」（那随提交变化），只钉住**形状**：日期解得开、
     * 且不晚于现在。它同时是「实现没在真实仓库上抛异常」的执行者 —— 而这一路
     * （`git log --since` 的输出解析）是纯文本状态机，最容易在真实输出上崩。 */
    const at = dirtySinceToday(freshnessTrack("full"));
    if (at !== null) {
      expect(at instanceof Date).toBe(true);
      expect(Number.isNaN(at.getTime())).toBe(false);
      expect(at.getTime()).toBeLessThanOrEqual(Date.now());
    }
  });
});

/**
 * 「每日单元测试」那一档在 CI 上打的**分文件耗时榜**。
 *
 * 这一组判的几件事各自都会静默失效，所以不能只测 happy path：
 *  · 读数参数被塞进 `extra` ⇒ `isWholeTrackRun` 把每一次跑判成「不是整档」⇒ 记账通道关掉；
 *  · junit 没落盘时打「0 份」而不是「没有」⇒ 与「跑完了但一份都没计时」逐字同形；
 *  · 明细不限行数 ⇒ 平台单次构建日志硬上限 102400 字节，会把**后面所有 stage** 的日志挤掉；
 *  · 拼出来的 `--outputFile.junit=…` 里带冒号 ⇒ PowerShell 宿主在第一个冒号处把它切成两个
 *    参数，剩下一截变成 vitest 的位置过滤器，整跑以「No test files found」收场
 *    （CI 首跑 `cnb-2in-1k589j0kp`，边界表在 `launcher-core/shell.mjs`）。
 */
describe("CI 全量档的分文件耗时读数（与钩子那侧共用形状）", () => {
  const JUNIT = [
    '<?xml version="1.0" encoding="UTF-8" ?>',
    '<testsuites name="vitest tests" tests="3" failures="0" errors="0" time="61">',
    '    <testsuite name="tests/a.test.ts" hostname="H" tests="1" time="30.5"></testsuite>',
    '    <testsuite name="tests/b.test.ts" hostname="H" tests="1" time="30"></testsuite>',
    '    <testsuite name="tests/c.test.ts" hostname="H" tests="1" time="0.5"></testsuite>',
    "</testsuites>",
  ].join("\n");

  /* 落点在本档里**只能是仓库内的相对形态**，所以这里的入参用 `path.join(ROOT, …)` 造一个
   * 真实的仓库内绝对路径 —— 判的正是「绝对进、相对出」这一跳，而不是常量本身。 */
  const IN_REPO = path.join(ROOT, "node_modules/.cache/x.xml");

  it("读数走 planRun 的第三参，不进 extra —— 否则每一次跑都绿而不记账", () => {
    const withJunit = suitePlan([], 4, IN_REPO);
    expect(withJunit.args.slice(0, 3)).toEqual(["run", "test:coverage", "--maxWorkers=4"]);
    /* `--reporter=default` 必须在：只给 junit 会把人类可读的输出整个换掉，
     * 而真红那一屏是唯一能读的东西。 */
    expect(withJunit.args).toContain("--reporter=default");
    expect(withJunit.args).toContain("--reporter=junit");
    expect(withJunit.args).toContain("--outputFile.junit=node_modules/.cache/x.xml");
    // 人给的透传参数仍然排在最后（不被读数参数挤掉）。
    expect(suitePlan(["--foo"], 4, IN_REPO).args.at(-1)).toBe("--foo");
    // 记账判定只看 `extra`：加了读数参数仍然算整档。
    expect(suiteRecords({ exitCode: 0, dryRun: false, extra: [] })).toBe(true);
  });

  it("拼给 vitest 的那一个参数**过不了宿主谓词**就不许发出去（CI 首跑那次红的对案）", () => {
    /* `cnb-2in-1k589j0kp`：`--outputFile.junit=C:\WINDOWS\TEMP\…` 到达 vitest 时是
     * `--outputFile.junit=C` 加 `\WINDOWS\TEMP\…` 两个参数，后者成了位置过滤器
     * ⇒ 12.6s 退 1，看起来像「这个仓没有用例」，于是它后面三档全部 skipped。
     * 这里判的是**形状**（用宿主那一跳同一个谓词），不是话术。 */
    expect(hostUnsafeArgs(suitePlan([], 4, IN_REPO).args, true)).toEqual([]);
  });

  it("仓库外的落点**抛**并说清机制 —— 不静默换成一个可能不存在的位置", () => {
    /* 落点猜错的表现是「读数没有」，而「读数没有」与「这一档没跑过文件」在日志里同形；
     * 所以宁可在配置解析期就红，也不要在读数层留一个读不出原因的洞。 */
    expect(() => toTransportSafePath("/tmp/x.xml")).toThrow(/仓库内/);
    /* POSIX 上的 `/tmp` 就是「仓库外」，所以那一条走到的是**仓库外**话术。而
     * `C:\…` 这一条在 POSIX 上**根本不是绝对路径**（`path.isAbsolute` 为 false），
     * 于是它先被当成相对路径、撞上的是**冒号**那一条（两条话术各指各的下一动作，
     * 这点对得正好）。在 Windows 上同一行会走到「仓库外」。判据原先只认前者 ⇒
     * 整条用例在非 win32 宿主上必红（本地钩子的组 C 就是这么暴露的）。 */
    expect(() => toTransportSafePath("C:\\WINDOWS\\TEMP\\x.xml")).toThrow(
      process.platform === "win32" ? /仓库内/ : /冒号/,
    );
    expect(() => suitePlan([], 4, path.resolve(ROOT, "..", "outside.xml")).args).toThrow(/仓库内/);
    /* 仓库内但值里带冒号（相对路径里唯一还能拼出坏形状的东西）⇒ 抛的是**冒号**那一条，
     * 不是「仓库外」—— 两条话术各指各的下一动作，混成一条就会把人支去改目录。 */
    expect(() => toTransportSafePath("a:b.xml")).toThrow(/冒号/);
  });

  it("落点常量在仓库内、不含冒号，且**被 git 忽略**（不给检出留未跟踪文件）", () => {
    expect(hostUnsafeArgs([`--outputFile.junit=${SUITE_JUNIT_RELATIVE}`], true)).toEqual([]);
    expect(path.isAbsolute(SUITE_JUNIT_RELATIVE)).toBe(false);
    expect(toTransportSafePath(path.join(ROOT, SUITE_JUNIT_RELATIVE))).toBe(SUITE_JUNIT_RELATIVE);
    /* 「未跟踪文件」这一格不是形容词：R9 与 `.gitignore` 会真的拦下落在检出里的产物，
     * 所以这里问 git 本人「这个路径你忽略吗」。`check-ignore -q` 忽略→退 0 且不打印，
     * 不忽略→退 1，而 `execFileSync` 对非零退码抛 ⇒ 抛就是这条判据该红的时候。
     * （`encoding` 必须给：不给拿到的是 Buffer，`toBe("")` 会拿 Buffer 比字符串。） */
    expect(
      execFileSync("git", ["check-ignore", "-q", SUITE_JUNIT_RELATIVE], {
        cwd: ROOT,
        stdio: "pipe",
        encoding: "utf8",
      }),
    ).toBe("");
  });

  it("`hostUnsafeArgs` 判的是实测那条边界，不是「路径长得像绝对路径」", () => {
    /* 边界是本机逐形状跑出来的（表在 `PS_UNSAFE_ARG_RE` 头上）：坏的是
     * 「破折号开头 + `=` + 值里有冒号」这一交集。裸绝对路径与不带破折号的 `k=v:`
     * 都原样到达 —— **把它们也拦下就是拒掉一条本来能跑的命令**（`viaHost: false`
     * 那一半同理：非宿主形态没有这次切分）。 */
    const split = "--outputFile.junit=C:\\dir\\a.xml";
    expect(hostUnsafeArgs([split], true)).toEqual([split]);
    expect(hostUnsafeArgs([split], false)).toEqual([]);
    expect(hostUnsafeArgs(["--outputFile.junit=node_modules/.cache/a.xml"], true)).toEqual([]);
    // 冒号不一定要跟在驱动器字母后面：值里第一个冒号就是切点。
    expect(hostUnsafeArgs(["--out=1:\\x", "--out=./C:\\x"], true)).toEqual([
      "--out=1:\\x",
      "--out=./C:\\x",
    ]);
    // 下面三条都是**观察到的安全形状**，一条都不许被挑出来。
    expect(
      hostUnsafeArgs(
        ["C:\\dir\\a.xml", "out=C:\\dir\\a.xml", "/p=C:\\x", "a=b:c", "--out=C\\dir"],
        true,
      ),
    ).toEqual([]);
  });

  it("没给落点时一个字都不加（本地 pnpm test:coverage 的形态与此前逐字相同）", () => {
    expect(suitePlan(["--dry"], 4).args).toEqual([
      "run",
      "test:coverage",
      "--maxWorkers=4",
      "--dry",
    ]);
  });

  it("榜：降序、有界、明写「只算测试阶段」，合计与中位都在", () => {
    const lines = suiteRanking(JUNIT, { limit: 2, file: "/tmp/x.xml" });
    const text = lines.join("\n");
    expect(text).toContain("3 份、合计 61.0s");
    expect(text).toContain("只算测试阶段");
    expect(text).toContain("/tmp/x.xml");
    expect(text).toContain("30.5s  tests/a.test.ts");
    expect(text).toContain("中位 30.0s");
    // limit 是真生效的：3 份只打 2 行明细，其余折成一句合计。
    expect(text).toContain("tests/a.test.ts");
    expect(text).toContain("tests/b.test.ts");
    expect(text).not.toContain("tests/c.test.ts");
    expect(text).toContain("其余 1 份合计 0.5s");
  });

  it("junit 没落盘时打「没有」，不打「0 份」—— 拿不到测量 ≠ 测量结果是 0", () => {
    const text = suiteRanking("", { file: "/tmp/gone.xml" }).join("\n");
    expect(text).toContain("**没有**");
    expect(text).not.toMatch(/0 份、合计/);
  });

  /* ── 第二份榜：断言之外的「装载税」 ─────────────────────────────
   * vitest 收尾自报的相位分解，三次独立读数都是 `tests 46–51%, setup 23–24%,
   * environment 13–14%, import 12–13%`（`cnb-b0l-1k59op66t` 2442.43s /
   * `cnb-r0d-1k5a0348r` 2729.89s / 本地 1609.51s）—— 也就是这个 stage 只有一半时间在跑断言。
   * ⚠️ 但那份税**不在 junit 里**：本地对账量到「Σ文件总时长 2793.6s = 断言 2724.0s + 69.6s」，
   * 即 `<testsuite time>` 只含断言与文件内钩子，不含每文件各交一次的 environment / import。
   * 所以这一组判的是「文件内可见的那一份税」，它**不回答**「那 50% 归谁」—— 话术里必须
   * 这么写着，否则这份榜会被当成整笔税的分解。下面五格各钉一条会让它静默失效的边界。 */
  const JUNIT_WITH_CASES = [
    '<?xml version="1.0" encoding="UTF-8" ?>',
    '<testsuites name="vitest tests">',
    '    <testsuite name="tests/heavy-load.test.ts" tests="2" time="30.5">',
    '        <testcase classname="tests/heavy-load.test.ts" name="一" time="0.5"/>',
    '        <testcase classname="tests/heavy-load.test.ts" name="二" time="1"/>',
    "    </testsuite>",
    '    <testsuite name="tests/pure-assert.test.ts" tests="1" time="2">',
    '        <testcase classname="tests/pure-assert.test.ts" name="一" time="1.9"/>',
    "    </testsuite>",
    '    <testsuite name="tests/negative.test.ts" tests="1" time="1">',
    '        <testcase classname="tests/negative.test.ts" name="一" time="1.4"/>',
    "    </testsuite>",
    '    <testsuite name="vitest unhandled errors" tests="0" time="0"></testsuite>',
    "</testsuites>",
  ].join("\n");

  it("税 = 文件总时长 − Σ用例时长，并按税降序排（不是按谁跑得最久）", () => {
    const byName = new Map(parseJunitPhaseCosts(JUNIT_WITH_CASES).map((c) => [c.name, c]));
    expect(byName.get("tests/heavy-load.test.ts")).toEqual({
      name: "tests/heavy-load.test.ts",
      totalMs: 30500,
      testsMs: 1500,
      cases: 2,
    });
    const text = suitePhaseTax(JUNIT_WITH_CASES, { limit: 10 }).join("\n");
    /* 交税最多的是「总 30.5s / 断言 1.5s」那份，而不是断言最久的 —— 按总时长排就会
     * 把后者顶到第一名，那份榜读的就不再是「谁在交税」。 */
    expect(text.indexOf("heavy-load")).toBeLessThan(text.indexOf("pure-assert"));
    expect(text).toContain("33.5s");
    expect(text).toContain("4.8s");
    expect(text).toContain("28.7s");
  });

  it("税为负时照实打，不夹到 0 —— 夹了就是拿形状掩盖机制", () => {
    /* 用例时长是各自测的，`afterEach` 里等到的东西可能同时落进两份数 ⇒ 差值可以为负。
     * 那是「这两份数不是严格嵌套」的事实，不是脏数据。 */
    const text = suitePhaseTax(JUNIT_WITH_CASES, { limit: 10 }).join("\n");
    expect(text).toContain("-0.4s");
    expect(text).toContain("tests/negative.test.ts");
  });

  it("夹具里没有 <testcase> 时退化成「税 = 总时长」，而不是报「没有」", () => {
    /* 上面那份榜的夹具就是这个形状（只有 `<testsuite time>`）。退化可以，冒充没有不行 ——
     * 后者会让读的人以为这一档没跑，而它只是拿不到用例级明细。 */
    const text = suitePhaseTax(JUNIT, { limit: 3 }).join("\n");
    expect(text).toContain("装载/钩子 61.0s");
    expect(text).not.toContain("**没有**");
  });

  it("明细有界（日志 102400 字节上限），对账行只在给了墙钟时出现", () => {
    const bounded = suitePhaseTax(JUNIT_WITH_CASES, { limit: 1 });
    const detail = bounded.filter((l) => l.startsWith("  税 "));
    expect(detail).toHaveLength(1);
    expect(bounded.join("\n")).not.toContain("对账");
    const withWall = suitePhaseTax(JUNIT_WITH_CASES, {
      limit: 1,
      wallMs: 40_000,
    }).join("\n");
    expect(withWall).toContain("对账");
    /* 墙钟与 Σ文件总时长天生不相等（并发摊薄 + 非文件阶段）。这里钉的是**话术不许把它
     * 摊到文件上** —— 一旦有人拿它做除法，那个百分数就是假的。 */
    expect(withWall).toContain("不把它摊到任何一份文件上");
    expect(withWall).toContain("40.0s");
  });

  it("junit 读不到时税榜也打「没有」（与耗时榜同一条口径）", () => {
    const text = suitePhaseTax("", { file: "/tmp/gone.xml" }).join("\n");
    expect(text).toContain("**没有**");
    expect(parseJunitPhaseCosts("")).toEqual([]);
  });
});

/* ── 每日那一跑的「超时指纹 → 隔离复跑」（§13.6.4 / §13.6.4.1）────────────
 * 触发事实：`cnb-b0l-1k59op66t` —— `每日单元测试` 里只有
 * `tests/deps-freshness-gate.test.ts:166` 一条 `Test timed out in 30000ms`
 * （没有任何断言报错），就把后面的 `每日生产构建` / `每日浏览器安装` /
 * `每日全量E2E` 三格全部 skip。组 C 有这一档而每日档没有，
 * 于是「排不上调度」在每日链上长得和「代码回归了」一模一样。 */
describe("每日全量档的超时指纹复跑（档位表与组 C 同一条判决链）", () => {
  const TIMEOUT_JUNIT = [
    '<testsuites name="vitest tests" tests="2" failures="1">',
    '  <testsuite name="tests/deps-freshness-gate.test.ts" failures="1" errors="0">',
    '    <testcase name="红了就点名">',
    '      <failure message="Test timed out in 30000ms.">Test timed out in 30000ms.</failure>',
    "    </testcase>",
    "  </testsuite>",
    "</testsuites>",
  ].join("\n");
  const ASSERTION_JUNIT = [
    '<testsuite name="tests/real.test.ts" failures="1" errors="0">',
    '  <failure message="expected 1 to be 2">AssertionError</failure>',
    "</testsuite>",
  ].join("\n");

  it("绿的那次不复跑（没有要定性的红）", () => {
    expect(planIsolatedRerun({ exitCode: 0, junitText: TIMEOUT_JUNIT })).toEqual({
      retry: false,
      files: [],
      why: "这一跑是绿的，没有要定性的红",
    });
  });

  it("红而**不带**超时指纹 ⇒ 一次都不复跑（真红照拦，这一格最该守住）", () => {
    const plan = planIsolatedRerun({ exitCode: 1, junitText: ASSERTION_JUNIT });
    expect(plan.retry).toBe(false);
    expect(plan.why).toContain("按真红处置");
    /* 反向复算：把同一个 exitCode 换成带指纹的读数，结论当场变成复跑。
       没有这一句，「不复跑」可能只是判据没接上（恒 false）而不是判对了。 */
    expect(planIsolatedRerun({ exitCode: 1, junitText: TIMEOUT_JUNIT }).retry).toBe(true);
  });

  it("带指纹时**只复跑失败的那几份**，名单取自 junit（不拖整档重跑）", () => {
    const plan = planIsolatedRerun({ exitCode: 1, junitText: TIMEOUT_JUNIT });
    expect(plan.retry).toBe(true);
    expect(plan.files).toEqual(["tests/deps-freshness-gate.test.ts"]);
    expect(plan.why).toContain("1 份");
  });

  it("带指纹但读不出名单 ⇒ **退回整档**（方向单边化：宁可多跑，不许漏跑）", () => {
    const plan = planIsolatedRerun({
      exitCode: 1,
      junitText: "Failed to start forks worker",
    });
    expect(plan.retry).toBe(true);
    expect(plan.files).toEqual([]);
    expect(plan.why).toContain("退回整档");
  });

  it("第 2 遍的三态：绿=负载假红 / 仍带指纹=未校验 / 指纹消失=真红", () => {
    expect(classifyRerunOutcome({ exitCode: 0, output: "" })).toBe("load-flake");
    expect(
      classifyRerunOutcome({
        exitCode: 1,
        output: "Test timed out in 30000ms",
      }),
    ).toBe("unverified");
    expect(classifyRerunOutcome({ exitCode: 1, output: "expected 1 to be 2" })).toBe("real-red");
  });

  it("复跑命令行带 `--no-file-parallelism` 而**绝不带 `--coverage`**", () => {
    const args = rerunLaunches({ files: ["a.test.ts", "b.test.ts"] });
    expect(args).toEqual([["run", "--no-file-parallelism", "a.test.ts", "b.test.ts"]]);
    for (const launch of args) {
      expect(launch.join(" ")).not.toContain("--coverage");
    }
    /* 覆盖率门槛（`vitest.config.ts` 的 `coverage.thresholds`）判的是整档的分子分母：
       拿一份子集去跑覆盖率必然跌破，那等于把「负载假红」换成一条**新的假红**。 */
    expect(rerunLaunches({ files: [] })).toEqual([["run", "--no-file-parallelism"]]);
  });

  it("复跑的墙钟预算严格小于整档那一跑（复跑不许比整档更宽）", () => {
    expect(RERUN_TIMEOUT_MS).toBeLessThan(FULL_SUITE_TIMEOUT_MS);
  });

  it("这一档不重写指纹清单：脚本里不许出现第二份超时正则", () => {
    const src = readFileSync(path.join(ROOT, "scripts/full-suite-run.mjs"), "utf8");
    expect(src).toContain('from "./affected-launch-load-retry.mjs"');
    /* 「Test timed out」在本仓只能是**被引用**的话术，不该在这里被重新定义成一份正则。
       两份清单漂移的代价由 `tests/hook-affected-launch.test.ts` 钉在组 C 那一侧。 */
    expect(/\/Test timed out in[^/]*\/i/.test(src)).toBe(false);
  });
});

/**
 * 覆盖率门槛：**判定是开关，登记是账**（ISSUE #2669，业主口径）。
 *
 * 背景读数：每日那一格天天红而用例一条没红，红在两维目录级门槛上
 * （`production 93.33 < 95` / `process 94.73 < 96`，`cnb-040-1k62o8qa1`）。
 * 那种红不产生可执行结论，还把整档凭证永久卡在「不记账」上。裁决是
 * 「整体覆盖率只上报，不要让 CI 红；该红的是 patch coverage；趋势用棘轮不当门禁」。
 *
 * 落地形态刻意选「开关 + 登记处不挪」，所以这几条判的都是**形状**：
 * 谁在念档位、旗标有没有漏进 `extra`（漏了就会「绿了不记账」——自我拆账）、
 * 以及门槛那份登记处还剩谁在算（没执行者就退回「写在配置里、没人判」那个原病）。
 */
describe("覆盖率门槛的档位与接线（ISSUE #2669）", () => {
  it("默认档念的是「没判」并给出硬档出口，而不是冒充「已通过」", () => {
    const gate = coverageGate([]);
    expect(gate.enforce).toBe(false);
    expect(gate.reading).toContain("没判");
    /* 下一动作必须在话术里（§13.5.3.5.1）：只说「没判」而不说怎么判，
       下一个人只能去翻配置。 */
    expect(gate.reading).toContain("--enforce-coverage");
    /* 降档必须自带否认（§13.5.25「不许被读成『全套过了』」）。判「含那句否认」而不是
       「不含『已通过』」—— 后者会被这句自否认自己判红，形状也不如前者硬。 */
    expect(gate.reading).toContain("这不是「门槛已通过」");
  });

  it("旗标与环境变量两处来源都认；硬档那句不许仍念「没判」", () => {
    expect(coverageGate(["--enforce-coverage"]).enforce).toBe(true);
    expect(
      coverageGate([], { COMFY_COVERAGE_ENFORCE: "1" }).enforce,
      "环境变量那条路没接上 —— CI 之外的人没法开硬档",
    ).toBe(true);
    const hard = coverageGate(["--enforce-coverage"]);
    expect(hard.reading).toContain("判");
    expect(hard.reading).not.toContain("没判");
  });

  it("旗标不进 `extra`：带硬档旗标的那次仍然算整档、仍然记账", () => {
    /* `isWholeTrackRun(extra)` 把「透传了任何参数」判成「跑的不是整档」。所以
       自己的旗标若漏进 `extra`，每一次硬档跑绿都不记账 —— 那是把出口做成自我拆账。
       判法用 `--dry-run` 的**真实打印**（它念的就是 `extra` 拼出来的那条命令），
       比读源码里的 filter 一行更硬：拼错、漏摘、被 `planRun` 二次注入都当场红。 */
    const out = execFileSync(
      process.execPath,
      ["scripts/full-suite-run.mjs", "--dry-run", "--enforce-coverage"],
      { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    expect(out).toContain("覆盖率门槛：**判**");
    const commandLine = out.split("\n").find((l) => l.includes("→ pnpm run"));
    expect(commandLine, "dry-run 没念出那条命令").toBeTruthy();
    expect(commandLine).not.toContain("--enforce-coverage");
  });

  it("两个执行者各就各位：CI 档交给子进程，本地 `check:all` 显式开硬档", () => {
    /* 这条判的是「登记处不是死配置」（§11.7 / 台账 E2 的原病）：
       CI 那一档改成只上报之后，必须还剩一个真的按门槛算退码的执行者 ——
       `quality-gate.mjs` 的 `test` 条目（`pnpm check:all`，本地按需完整验证档）。
       两处都只**引用**那一个判点（`coverageGate` / 同一个环境变量名），
       不在调用点重抄一份判定（§12.18）。 */
    const suite = readFileSync(join(ROOT, "scripts/full-suite-run.mjs"), "utf8");
    expect(suite).toContain('env.COMFY_COVERAGE_ENFORCE === "1"');
    expect(suite).toContain('COMFY_COVERAGE_ENFORCE: "1"');
    expect(suite).toContain("env: gate.enforce");
    const gate = readFileSync(join(ROOT, "scripts/quality-gate.mjs"), "utf8");
    expect(gate).toMatch(/key === "test"[\s\S]{0,120}COMFY_COVERAGE_ENFORCE: "1"/);
    /* 反向：CI 的清单里**不许**有人顺手把硬档写进 `.cnb.yml` —— 那会把本单修掉的
       那个红灯原样装回去。 */
    const cnb = readFileSync(join(ROOT, ".cnb.yml"), "utf8");
    expect(cnb).not.toContain("COMFY_COVERAGE_ENFORCE");
  });
});
