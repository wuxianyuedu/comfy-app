/**
 * 全量 e2e「按需通道 + 新鲜度账」的判据 —— 规范 §11.8 / §13.5.4（ISSUE #1545 / #1547）。
 *
 * 立案现场：`pnpm test:e2e` 此前是「人记得就跑」，而没有**任何东西守它上一次是绿的**
 * —— 实测的形态是靠人手动把这条入口跑了一遍才发现它已经红了两天。
 *
 * 判据分三头，缺一条这层就退化成一句好看的话：
 *   ① **记账语义**：只有绿了才记、`--dry-run` 不记（记的是「上次真跑绿」这个**状态**，
 *      不是「我跑过」这个**动作**）。
 *   ② **几份账同形但不同键**：`FRESHNESS_TRACKS` 的四个值（账文件 / 键 / 名字 / 命令）
 *      各就各位，且各份账**不共用一个文件**（共用 = A 档的绿把 B 档的自证覆盖掉）。
 *   ③ **接线在位**：`package.json` 的 `test:e2e` 真的走这条通道（否则记账这一步
 *      一个执行者都没有 —— 那是 §13.5.12 的立案形态），且钩子那一步真判了它。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  E2E_DIR,
  TRACK,
  checkSchemaBeforeRun,
  parseSkip,
  planRun,
  schemaPreflightDecision,
  shouldRecord,
} from "../scripts/e2e-run.mjs";
import {
  FRESHNESS_TRACKS,
  freshnessRecord,
  freshnessTrack,
  isSameLocalDay,
  readFreshnessLedgerAt,
} from "../scripts/freshness-ledger.mjs";
import { runGate } from "../scripts/freshness-gate.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

function readText(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

/** 一条写得全的记录（各条用例只改它要测的那一栏）。 */
const GOOD = freshnessRecord({
  key: "e2e",
  verifiedAt: "2026-10-09T00:30:00.000Z",
  who: "月读",
  how: "pnpm test:e2e",
  trackedBy: "e2e",
});

/* 「今天」这条判据只对 `track.daily` 那一档成立，所以判 e2e 档的用例必须喂一个与记录
 * **同一个日历日**的时钟（`isSameLocalDay` 按本地日界算，用例里的时刻按 UTC 写，
 * 容器是 UTC 时两者同日）。「不是今天 ⇒ 仍然要拦」那一条另写。 */
const SAME_DAY = new Date("2026-10-09T06:00:00.000Z");

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

  it("绿了但**跑的不是整档**也不记 —— 一条 `--help` 曾买到过一天的自证", () => {
    /* 这条是本档最坏的一种假：`extra` 按位置透传给 Playwright，而 `--help` / `--list`
     * 打完字就**退 0** —— 只看退出码时记账条件全满足，账上留下一条「今天全量 e2e 绿了」，
     * 而一次用例都没跑。实测本机就是这么写进去一条假绿的（`--help` 之后账面变成
     * 当天、无 `skippedReason`），所以两个方向都要钉：
     *   · 不带参数跑完整档且绿 ⇒ 记；
     *   · 任何形式的子集 / 不执行 ⇒ 不记，哪怕退出码是 0。 */
    expect(shouldRecord({ exitCode: 0, dryRun: false, extra: [] })).toBe(true);
    expect(shouldRecord({ exitCode: 0, dryRun: false, extra: ["--help"] })).toBe(
      false,
    );
    expect(
      shouldRecord({
        exitCode: 0,
        dryRun: false,
        extra: ["--grep", "@critical"],
      }),
    ).toBe(false);
    expect(
      shouldRecord({
        exitCode: 0,
        dryRun: false,
        extra: ["e2e/queue-monitor.spec.ts"],
      }),
    ).toBe(false);
    /* 既红又过滤：两个条件各拦各的，不许因为先撞上「红」就漏掉形状那一半。 */
    expect(
      shouldRecord({ exitCode: 1, dryRun: false, extra: ["--help"] }),
    ).toBe(false);
    /* 没给 `extra` 的旧调用形态（默认 `[]`）必须仍是「绿即记」—— 否则这条改动
     * 会把 `tests/daily-tracks.test.ts` 里那两处同名断言一起改掉而没人发现。 */
    expect(shouldRecord({ exitCode: 0, dryRun: false })).toBe(true);
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

describe("开跑前的 schema 预检（#1834 收尾的现场）", () => {
  /* 立案读数（win32 本机）：dev 库落后 schema 几个版本、pending 含
   * `DROP TABLE loraTrainingJob`，启动链路按设计不应用 → task 表缺 6 列 →
   * queue-monitor / main-journey 稳定红，报错说的却是「元素没出现」。
   * 这一卡把「跑 8 分钟红一片」换成「开跑前告诉你要跑 pnpm db:push」。 */
  const SAFE_BATCH = [
    "ALTER TABLE `task` ADD `progressNode` text;",
    "CREATE INDEX `task_claimed_by_idx` ON `task` (`status`,`claimedBy`);",
  ];
  const RISKY_BATCH = [
    ...SAFE_BATCH,
    "DROP TABLE `loraTrainingJob`;",
    "DROP INDEX `task_project_idx`;",
  ];

  it("指纹一致 ⇒ 放行（正常机器的常态，且零成本——不起 drizzle）", () => {
    const d = schemaPreflightDecision({
      probe: "ready",
      fingerprintMatch: true,
      pending: [],
      autoApplyable: false,
    });
    expect(d.verdict).toBe("proceed");
  });

  it("表还没建 / 读不到 ⇒ 放行（全新检出由启动链路自动建表）", () => {
    for (const probe of ["missing", "unknown"] as const) {
      expect(
        schemaPreflightDecision({
          probe,
          fingerprintMatch: false,
          pending: [],
          autoApplyable: false,
        }).verdict,
      ).toBe("proceed");
    }
  });

  it("指纹不一致但 dry-run 没有待执行语句 ⇒ 放行（指纹只是没登记）", () => {
    const d = schemaPreflightDecision({
      probe: "ready",
      fingerprintMatch: false,
      pending: [],
      autoApplyable: false,
    });
    expect(d.verdict).toBe("proceed");
    expect(d.reason).toContain("没有待执行语句");
  });

  it("待执行全是安全语句 ⇒ 放行（启动链路会后台应用，与不带这一卡时同行为）", () => {
    const d = schemaPreflightDecision({
      probe: "ready",
      fingerprintMatch: false,
      pending: SAFE_BATCH,
      autoApplyable: true,
    });
    expect(d.verdict).toBe("proceed");
  });

  it("待执行含丢数据语句 ⇒ **阻断**，且逐条列出（只给条数等于让人闭眼 db:push）", () => {
    const d = schemaPreflightDecision({
      probe: "ready",
      fingerprintMatch: false,
      pending: RISKY_BATCH,
      autoApplyable: false,
    });
    expect(d.verdict).toBe("abort");
    expect(d.risky).toEqual([
      "DROP TABLE `loraTrainingJob`;",
      "DROP INDEX `task_project_idx`;",
    ]);
    expect(d.reason).toContain("丢数据");
  });

  it("取证层在真仓库上判得出形状（不写死本机当前红绿——那会随库状态漂）", () => {
    /* 这一条只核「函数跑得通、返回的形状在判词里认得过来」：本机此刻红绿
     * 取决于 db.sqlite 同不同步，而那不是判据能钉的事实。 */
    const d = checkSchemaBeforeRun(ROOT);
    expect(["proceed", "abort"]).toContain(d.verdict);
    expect(typeof d.reason).toBe("string");
    if (d.verdict === "abort") expect(d.risky?.length ?? 0).toBeGreaterThan(0);
  });
});

describe("两条新鲜度账同形但不同键（§11.8 / §12.12）", () => {
  it("四个值各就各位：账文件 / 键 / 名字 / 命令", () => {
    /* 只核**本档的两栏与关键字**，不核「`FRESHNESS_TRACKS` 一共几个键」——
     * 那份清单是 `tests/daily-tracks.test.ts` 的事（它判四档全在、且互不重名），
     * 在这里再写一份会在**每次新增一档**时红，而红的原因与「e2e 的账有没有写对」
     * 毫无关系（`tests/gate-executors.test.ts` 把份数写死 `.toBe(44)` 那次同族）。
     *
     * 同理，四栏用**挑出来比**而不是 `toEqual` 比整条登记：整条比等于顺手断言
     * 「形状刚好这几栏」，而登记表**会**长栏 —— `daily` / `skipHow` / `dirty` /
     * `dirtyHow` / `graceMs` 进来时它把一次**新增**报成一次**抄错**（ISSUE #1553
     * 合并后就是这个形态）。差异那几栏各判各的，见下一条。 */
    expect(Object.keys(FRESHNESS_TRACKS)).toContain("e2e");
    const { ledger, key, label, run } = freshnessTrack("e2e");
    expect({ ledger, key, label, run }).toEqual({
      ledger: "scripts/.e2e-freshness.json",
      key: "e2e",
      label: "全量 e2e",
      run: "pnpm test:e2e",
    });
    // 另两档各有一份自己的账与键（不是同一个文件里的两个键）。
    expect(freshnessTrack("full").ledger).toBe("scripts/.full-suite-freshness.json");
    expect(freshnessTrack("artifact").ledger).toBe(
      "scripts/.artifact-freshness.json",
    );
  });

  it("各份账的差异都在数据里（`daily` / `skipHow` / 输入面），不是分支", () => {
    /* 「同形」有边界：差异栏各回答一个问题 ——
     *   · `daily`：这一档要不要按「每天首次」判；
     *   · `skipHow`：这一档「今天不跑」那条出路长什么样（每一档都有：没有这条出路
     *     就等于拦人而指不出退路）；
     *   · `dirty` / `graceMs`：吃输入面的档按「改了就当天跑」判，不吃的那一档两栏为空。
     * 逐档一起判：只有一侧变了就说明「同形」这句话已经不成立了。 */
    expect(freshnessTrack("e2e").daily).toBe(true);
    expect(freshnessTrack("e2e").skipHow).toBe(
      'node scripts/e2e-run.mjs --skip "<理由>"',
    );
    // e2e 不吃输入面：它的结论与改了哪几个文件无关。
    expect(freshnessTrack("e2e").dirty).toEqual([]);
    expect(freshnessTrack("e2e").dirtyHow).toBeNull();
    // 吃输入面的那两档反过来：有 dirty 清单，也有「不吃这一档」那条出路。
    for (const kind of ["full", "artifact"]) {
      const track = freshnessTrack(kind);
      expect(track.dirty.length, kind).toBeGreaterThan(0);
      expect(track.dirtyHow, kind).toBeTruthy();
    }
  });

  it("各份账**不共用一个文件**（共用 = 这一档的绿把那一档的自证覆盖掉）", () => {
    const ledgers = Object.values(FRESHNESS_TRACKS).map((t) => t.ledger);
    expect(new Set(ledgers).size).toBe(ledgers.length);
    // 键也不同：同一个文件里两个键的话，「这一档」在各份账里就不是一个概念。
    const keys = Object.values(FRESHNESS_TRACKS).map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("未登记的档名是编码错误：抛，而不是回落成一个能跑绿的空档", () => {
    // 回落的话，「新加一档却忘了登记」会表现成「按键名当档名」而照样绿。
    expect(() => freshnessTrack("nope")).toThrow(/未登记/);
    expect(freshnessTrack("e2e").key).toBe(TRACK.key);
  });

  it("`trackedBy` 抄混要被判红：几份账同形，账面上看不出异常", () => {
    /* 这是各份账唯一的形状差异，也是它们同形之后**新长出来的**静默失效面：
     * 把另一档的绿抄进这一档的账，日期合法、人名合法、命令是一条真命令 ——
     * 只有「这条记录由哪个跑法证出来」被搞错了，而账面上完全正常。 */
    const crossed = runGate({
      ledger: { e2e: { ...GOOD, trackedBy: "full" } },
      kind: "e2e",
      keys: ["e2e"],
      now: SAME_DAY,
    });
    expect(crossed.exitCode).toBe(1);
    // 话术要同时给出「写的是哪个跑法」与「这份账属于哪个跑法」——
    // 只说「抄混了」等于把定位成本推给下一个人。
    expect(crossed.problems.join("\n")).toContain("full");
    expect(crossed.problems.join("\n")).toContain("e2e");
  });

  it("写全的记录 ⇒ 放行，并报出「上次自证距今多久」", () => {
    const result = runGate({
      ledger: { e2e: GOOD },
      kind: "e2e",
      keys: ["e2e"],
      now: SAME_DAY,
    });
    expect(result.exitCode).toBe(0);
    /* 记录与 `SAME_DAY` 同在 2026-10-09（记录在 00:30Z、时钟在 06:00Z）：age 按整天向下取整
     * 所以是「今天」—— 也正是「每天首次」那条判据放行所需的形状。 */
    expect(result.ages).toEqual(["e2e：今天"]);
  });

  it("缺记录 ⇒ 阻断，话术里给出这条账自己的账文件与命令", () => {
    const result = runGate({
      ledger: {},
      kind: "e2e",
      keys: ["e2e"],
      now: SAME_DAY,
    });
    expect(result.exitCode).toBe(1);
    const text = result.problems.join("\n");
    expect(text).toContain(freshnessTrack("e2e").ledger);
    expect(text).toContain("pnpm test:e2e");
  });
});

describe("全量 e2e 的「每日自证」（ISSUE #1282：每天首次提交带一次凭证）", () => {
  const yesterday = { ...GOOD, verifiedAt: "2026-10-08T00:30:00.000Z" };

  it("昨天跑过 ⇒ **今天仍然要拦**（这正是「每天首次」的意思）", () => {
    const result = runGate({
      ledger: { e2e: yesterday },
      kind: "e2e",
      keys: ["e2e"],
      now: SAME_DAY,
    });
    expect(result.exitCode).toBe(1);
    expect(result.problems.join("\n")).toContain("今天还没有自证");
  });

  it("今天记了「写明理由的豁免」⇒ 放行（豁免是另一条出路，不是绕过）", () => {
    const result = runGate({
      ledger: {
        e2e: freshnessRecord({
          key: "e2e",
          verifiedAt: "2026-10-09T00:30:00.000Z",
          who: "月读",
          how: "pnpm test:e2e",
          trackedBy: "e2e",
          skippedReason: "本轮只解决合并冲突与文档同步，未动功能链路",
        }),
      },
      kind: "e2e",
      keys: ["e2e"],
      now: SAME_DAY,
    });
    expect(result.exitCode).toBe(0);
  });

  it("占位理由的豁免**不顶账**：稍后 / 待定照样拦", () => {
    const result = runGate({
      ledger: {
        e2e: freshnessRecord({
          key: "e2e",
          verifiedAt: "2026-10-09T00:30:00.000Z",
          who: "月读",
          how: "pnpm test:e2e",
          trackedBy: "e2e",
          skippedReason: "稍后",
        }),
      },
      kind: "e2e",
      keys: ["e2e"],
      now: SAME_DAY,
    });
    expect(result.exitCode).toBe(1);
    expect(result.problems.join("\n")).toContain("有人回答过");
  });

  it("`--skip` 的三种形状：没给 / 给了可用理由 / 给了不合用的理由", () => {
    /* 这一段判的是**命令行契约**：`--skip` 是「今天不跑」的唯一出路，它的判定
     * 抽成了纯入口（`parseSkip`）就是为了让「缺理由 / 占位理由」这两条边界
     * 能被真跑一次 —— 它们是「豁免不是绕过」这句话的机器形态。 */
    expect(parseSkip(["node", "e2e-run"])).toEqual({
      skipped: false,
      reason: null,
    });
    expect(parseSkip(["--skip", "本周只解决合并冲突，未动功能链路"])).toEqual({
      skipped: true,
      reason: "本周只解决合并冲突，未动功能链路",
    });
    /* `--skip` 后面什么都没有是**另一种 argv 形状**：`["--skip"]` 里 `argv[i + 1]` 是
     * `undefined`。它不能靠往 argv 数组里塞一个 `undefined` 来构造 —— 真实 argv 里
     * 不存在这种元素（`process.argv` 每一项都是 string），那样的用例判的是一份
     * 不可能出现的输入。 */
    expect(parseSkip(["--skip"]).reason).toBe(null);
    for (const bad of ["", "稍后", "TBD", "待定"]) {
      expect(parseSkip(["--skip", bad]).reason).toBe(null);
    }
  });

  it("「每天首次」按本地日历日判，不是滚动 24 小时", () => {
    /* 昨天 23:00 与今天 08:00 相差不到 24 小时，但**不是同一天** —— 滚动窗口会把
     * 今天早晨的第一次静默跳过，而人的节奏是按日历日走的。 */
    const lateYesterday = new Date("2026-10-08T23:00:00");
    const thisMorning = new Date("2026-10-09T08:00:00");
    expect(isSameLocalDay(lateYesterday, thisMorning)).toBe(false);
    expect(isSameLocalDay(thisMorning, new Date("2026-10-09T23:59:00"))).toBe(
      true,
    );
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
      s.cmd.includes("scripts/freshness-gate.mjs"),
    );
    expect(hit?.cmd).toBe("node scripts/freshness-gate.mjs");
    // 标签要能让人从这一行读出「判的是哪几档」—— 只写其中一档时，
    // 另一档红出来会被读成别人的事。
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
      keys: [TRACK.key],
    });
    expect(result.problems).toEqual([]);
    expect(result.exitCode).toBe(0);
  });
});
