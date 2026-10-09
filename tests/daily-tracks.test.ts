/**
 * 「每天首次自证」从一档扩到四档（ISSUE #1282 的续）—— 规范 §11.8 / §13.5.4 / §13.5.12。
 *
 * 立案现场：平台流水线删掉（ISSUE #623）之后，`§13.5.3` 的欠账表里列着几条「**无自动执行者**」
 * 的判定档，其中两条此前唯一的执行者是文档里那句「按需手动跑」—— 而那句话没有任何东西在守：
 *   · **全量单测 + 覆盖率门槛**（`pnpm run test:coverage`，3000+ 用例 + 几十条按实测定的
 *     `coverage.thresholds`）—— 提交门槛（C 组）只跑固定清单 + 受影响用例，**不跑覆盖率**；
 *   · **产物级护栏**（`pnpm run build` + `check-standalone-contents.cjs`）—— 它的失效形态
 *     恰好是「页面全 200、接口全 500」（硬规则 18）与「密钥明文进产物」（硬规则 17），
 *     两者都只在**真构建过一次**时才有结论。
 *
 * 判据分四头，缺一头这层就退化成一句好看的话：
 *   ① **档与档的区别是数据**：`FRESHNESS_TRACKS` 的四档都在，像素档不吃「每天首次」；
 *   ② **「改了就当天跑」**（`dirty` / `graceMs`）：三档「每天首次」的代价各不相同，
 *      十分钟量级的两档没必要每天都跑 —— 动过输入面就必须今天自证，没动过以宽限判；
 *   ③ **两条出路（`--skip` / `--dirty`）都留下能复核的事实**，占位理由一律被拦；
 *   ④ **接线在位**：四档各自的跑法脚本走同一份记账内核，钩子那一步真判了它们。
 */
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path, { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { parseLedgerFlag } from "../scripts/daily-run.mjs";
import {
  shouldRecord as artifactRecords,
  planRun as artifactPlan,
} from "../scripts/artifact-run.mjs";
import { gitUser } from "../scripts/pixel-run.mjs";
import {
  shouldRecord as suiteRecords,
  TRACK as SUITE_TRACK,
  planRun as suitePlan,
} from "../scripts/full-suite-run.mjs";
import {
  FRESHNESS_TRACKS,
  freshnessRecord,
  freshnessTrack,
  freshnessVerdict,
} from "../scripts/visual-baselines.mjs";
import {
  dirtySinceToday,
  runGate,
  trackScopes,
} from "../scripts/visual-freshness-gate.mjs";

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

/** 夹具用的临时仓库（每条用例自建、跑完删掉，不动本仓库的提交历史）。 */
let workdir = "";

afterEach(() => {
  if (workdir) rmSync(workdir, { recursive: true, force: true });
  workdir = "";
});

/** 判一档：省去各处重复的「平台就是它自己的 key」那句。 */
function gate(kind: string, ledger: Record<string, unknown>, extra = {}) {
  return runGate({
    ledger,
    kind,
    platforms: [freshnessTrack(kind).key],
    pending: [],
    now: SAME_DAY,
    ...extra,
  });
}

describe("四档的登记形状（§11.8）", () => {
  it("四档都在，且每一档的六个值都写全", () => {
    expect(Object.keys(FRESHNESS_TRACKS).sort()).toEqual([
      "artifact",
      "e2e",
      "full",
      "visual",
    ]);
    for (const [kind, track] of Object.entries(FRESHNESS_TRACKS)) {
      // 账文件 / 键 / 名字 / 命令是每条账的存在意义，缺一个这条记录就退化成一句空话。
      for (const field of ["ledger", "key", "label", "run"] as const) {
        expect(String(track[field]).length, `${kind}.${field}`).toBeGreaterThan(
          0,
        );
      }
      expect(track.ledger.endsWith(".json"), `${kind}.ledger`).toBe(true);
    }
  });

  it("四份账**不共用一个文件**，四个键也互不相同", () => {
    // 共用 = 跑 A 档的绿把 B 档的自证覆盖掉，而账面上完全正常（同一个日期、同一个人）。
    const ledgers = Object.values(FRESHNESS_TRACKS).map((t) => t.ledger);
    const keys = Object.values(FRESHNESS_TRACKS).map((t) => t.key);
    expect(new Set(ledgers).size).toBe(ledgers.length);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("像素档**不吃**「每天首次」（它不是 daily：结论只在录过基线的那台机器上成立）", () => {
    expect(freshnessTrack("visual").daily).toBe(false);
    for (const kind of ["e2e", "full", "artifact"]) {
      expect(freshnessTrack(kind).daily, kind).toBe(true);
    }
  });

  it("判决面**由登记表派生**：新增一档自动被纳入，不靠手抄一份清单", () => {
    /* 这段曾经是手抄的（`{kind: "e2e", platforms: ["e2e"], pending: []}`），
     * 于是「新增一档却忘了在这一处加一行」⇒ 那一档**谁都不判** —— 判据的覆盖面与它
     * 自称的不符，正是 §13.5.12 的立案现场。 */
    const kinds = trackScopes().map((s) => s.kind);
    expect(kinds.sort()).toEqual(Object.keys(FRESHNESS_TRACKS).sort());
    // 非像素档的「平台面」就是它自己的 key（现算，不是手抄的第二份真值）。
    for (const scope of trackScopes()) {
      if (scope.kind === "visual") continue;
      expect(scope.platforms).toEqual([freshnessTrack(scope.kind).key]);
      expect(scope.pending).toEqual([]);
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

  it("全量 e2e 那一档**不看** dirty：它的结论与改了哪几个文件无关，按日历日判", () => {
    const yesterday = {
      ...GOOD,
      key: "e2e",
      how: "pnpm test:e2e",
      trackedBy: "e2e",
      verifiedAt: "2026-10-08T00:30:00.000Z",
    };
    const result = gate("e2e", { e2e: yesterday });
    expect(result.exitCode).toBe(1);
    expect(result.problems.join("\n")).toContain("今天还没有自证");
    // 传了 dirtySince 也不改变结论（它不读那个输入）。
    expect(
      gate("e2e", { e2e: yesterday }, { dirtySince: new Date(0) }).exitCode,
    ).toBe(1);
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
    expect(
      freshnessVerdict({ track, at, now: SAME_DAY, dirtySince: null }),
    ).toBeNull();
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

describe("两条出路：豁免与非输入面（§11.8 豁免不是绕过）", () => {
  it("`--skip` / `--dirty` 的解析：没给 / 可用理由 / 占位理由三种形状", () => {
    // 两个开关共用一份解析（`daily-run.mjs` 的 `parseLedgerFlag`），所以边界只测一遍。
    expect(parseLedgerFlag(["node", "x"], "--skip")).toEqual({
      mode: "run",
      reason: null,
    });
    expect(
      parseLedgerFlag(["--dirty", "本次只改文档，不动产物链"], "--dirty"),
    ).toEqual({
      mode: "dirty",
      reason: "本次只改文档，不动产物链",
    });
    for (const bad of [undefined, "", "稍后", "TBD", "待定"]) {
      expect(parseLedgerFlag(["--skip", bad], "--skip").reason).toBe(null);
    }
    // 两个开关**互不串档**：给了 `--dirty` 时 `--skip` 仍是「没给」。
    expect(
      parseLedgerFlag(["--dirty", "本次只改文档，不动产物链"], "--skip").mode,
    ).toBe("run");
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
});

describe("跑法各自的命令核（§12.12：同形而不同命令）", () => {
  it("全量单测那一档跑的是 `test:coverage`（覆盖率门槛只在这一档判，§11.7）", () => {
    expect(suitePlan().args).toEqual(["run", "test:coverage"]);
    expect(SUITE_TRACK.run).toBe("pnpm run test:coverage");
    // 红的定性那句必须给出「跑过 ≠ 跑绿过」—— 记账语义靠它有据可依。
    expect(readText("scripts/full-suite-run.mjs")).toContain("不记账");
  });

  it("产物级护栏那一档走的是 `build` 那一行（两步都在里面，不另拼一遍）", () => {
    // 另拼一遍 = 两处各写一条产物链，漏掉「剥私有输入」那一步的表现是构建绿了、
    // 产物里那把刀却没跑（硬规则 17 判过的形态）。
    expect(artifactPlan().args).toEqual(["run", "build"]);
    const pkg = JSON.parse(readText("package.json")) as {
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
});

describe("接线在位（§13.5.12：判据要有人跑）", () => {
  it("`package.json` 的入口真的走这层通道（否则记账这一步没有执行者）", () => {
    const pkg = JSON.parse(readText("package.json")) as {
      scripts?: Record<string, string>;
    };
    // 按**入口**判而不是按命令长得像什么：裸 `vitest run --coverage` 也能跑出同样的用例，
    // 只有走这一层才会记账 —— 而「账上有没有日期」正是这一档存在的全部意义。
    expect(pkg.scripts?.["test:coverage:tracked"]).toContain(
      "scripts/full-suite-run.mjs",
    );
    expect(pkg.scripts?.["build:tracked"]).toContain(
      "scripts/artifact-run.mjs",
    );
    expect(pkg.scripts?.["test:coverage:dry"]).toContain("--dry-run");
    expect(pkg.scripts?.["build:tracked:dry"]).toContain("--dry-run");
  });

  it("钩子那一步真判了这几档（标签要点名 e2e，否则红出来会读成别人的事）", () => {
    const steps = [
      ...readText(".githooks/pre-commit").matchAll(
        /^ {2}run "([^"]+)" (.+)$/gm,
      ),
    ].map((m) => ({ label: m[1] ?? "", cmd: m[2] ?? "" }));
    const hit = steps.find((s) =>
      s.cmd.includes("scripts/visual-freshness-gate.mjs"),
    );
    expect(hit?.cmd).toBe("node scripts/visual-freshness-gate.mjs");
    expect(hit?.label).toContain("e2e");
    // 标签要说清它现在判的是**几档** —— 只写「像素基线」时，另三档红出来会被读成像素的事。
    expect(hit?.label).toContain("每日自证");
  });

  it("四档的记账走**同一份内核**（§12.12：不造第二轮子）", () => {
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

  it("记账要用的人名推导只有一份（`gitUser`，四档共用）", () => {
    // 各写一套时会出现「这一档记的是环境变量、那一档记的是 git config」，
    // 于是同一个人的四条记录名字不一样。
    expect(typeof gitUser("full")).toBe("string");
    for (const rel of [
      "scripts/full-suite-run.mjs",
      "scripts/artifact-run.mjs",
    ]) {
      expect(readText(rel), rel).toContain("gitUser");
    }
  });
});

describe("dirtySince 的取证（问不出来 ≠ 没动过）", () => {
  it("不吃输入面的档恒为 null（不白起一次 git）", () => {
    expect(dirtySinceToday(freshnessTrack("e2e"))).toBeNull();
    expect(dirtySinceToday(freshnessTrack("visual"))).toBeNull();
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
    const git = (...args: string[]) =>
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
    const sinceFor = (prefixes: string[]) => {
      let earliest: Date | null = null;
      let stamp: string | null = null;
      let hit = false;
      const flush = () => {
        if (hit && stamp) {
          const at = new Date(stamp);
          if (!Number.isNaN(at.getTime()) && (!earliest || at < earliest))
            earliest = at;
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
      return earliest as Date | null;
    };
    expect(sinceFor(["src/"])).not.toBeNull();
    expect(sinceFor(["scripts/"])).not.toBeNull();
    /* ⚠️ 这里原先断的是 `sinceFor(["src/"]) === sinceFor(["scripts/"])` —— 那是一条
     * **撞秒界就会红**的断言：夹具里两次提交只隔几十毫秒（mkdir + write + add + commit），
     * 而 `%cI` 只到秒，两个前缀各自命中的是不同的一条提交，所以「相等」只在两次提交
     * 落进同一秒时成立。它判的不是「空行怎么处理」这件事，判的是这台机器那一刻的时钟。
     * 换成**按提交自身的确切时刻**判：每个前缀都必须给出「碰过它的那条提交」的时间，
     * 这是同一条边界更强的说法（提前清段会让两边都变 null，命中错的提交会给出错的时刻），
     * 而且与秒边界无关。 */
    const stampOf = (prefix: string): string =>
      new Date(
        git("log", "-1", "--format=%cI", "--", prefix).trim(),
      ).toISOString();
    expect(sinceFor(["src/"])?.toISOString(), "src/").toBe(stampOf("src/"));
    expect(sinceFor(["scripts/"])?.toISOString(), "scripts/").toBe(
      stampOf("scripts/"),
    );
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
