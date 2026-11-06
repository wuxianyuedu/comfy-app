/**
 * 全量 e2e「按需通道 + 新鲜度账」的判据 —— 规范 §11.8 / §13.5.4（ISSUE #1545 / #1547）。立案：`pnpm test:e2e`
 * 此前「人记得就跑」，没有任何东西守它上一次是绿的（实测靠人手动跑才发现已红两天）。判三头：① 只有绿才记、
 * `--dry-run` 不记（记「上次真跑绿」状态而非「跑过」）；② 四份账同形不同键、不共用文件；③ `test:e2e` 真走这条通道。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { PYTHON_PREFLIGHT_ENV_KEY } from "../e2e/support/preflight-python.mjs";
import {
  E2E_DIR,
  TRACK,
  makePreflightCollectors,
  parseSkip,
  planRun,
  resolvePlaywrightInvocation,
  runChild,
  runPreflightReadings,
  spawnFailureLine,
  shouldRecord,
  stripArgvSeparator,
} from "../scripts/e2e-run.mjs";
/* schema 预检那三张卡在 #1956 这一批里从 `e2e-run.mjs` 拆到了
 * `e2e-schema-preflight.mjs`（R5 的 900 行硬闸，出口只有按职责拆）。判据直接指着
 * 定义它们的那一份，不跟着走「转出去再用」的路 —— 多一层转发就多一处「改了实现
 * 忘了改出口」的缝。 */
import { canAutoApply, pendingStatements, pushBlockedByTty } from "../scripts/db-push-core.mjs";
import {
  checkSchemaBeforeRun,
  dryRunConcluded,
  ensureSchemaBeforeRun,
  schemaPreflightDecision,
} from "../scripts/e2e-schema-preflight.mjs";
import {
  FRESHNESS_TRACKS,
  freshnessRecord,
  freshnessStamp,
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

/**
 * 把 e2e 这一档读成「**平台侧还没有执行者**」的登记形状（`ciStage: ""`）。2026-10-19 起真实登记为 `每日全量E2E`，
 * 于是「缺记录 / 今天动过面而账停在改动之前 / 超出宽限」三种红在真实档上走不到（本地那层整层跳过，§11.8）。
 * 仍要用合成档打它：判据要能对当前登记之外的形状继续响（同 `daily-tracks.test.ts`），ciStage 完整矩阵在那份判。
 */
const localE2e = { ...freshnessTrack("e2e"), ciStage: "" };

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
    /* 这条是本档最坏的一种假：`extra` 按位置透传给 Playwright，而 `--help` / `--list` 打完字就**退 0** ——
     * 只看退出码时记账条件全满足，账上留下「今天全量 e2e 绿了」，而一次用例都没跑。实测本机就这么写进过
     * 一条假绿（`--help` 之后账面变成当天、无 `skippedReason`），所以两个方向都要钉：不带参数跑完整档且绿
     * ⇒ 记；任何形式的子集 / 不执行 ⇒ 不记，哪怕退出码是 0。 */
    expect(shouldRecord({ exitCode: 0, dryRun: false, extra: [] })).toBe(true);
    expect(shouldRecord({ exitCode: 0, dryRun: false, extra: ["--help"] })).toBe(false);
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
    expect(shouldRecord({ exitCode: 1, dryRun: false, extra: ["--help"] })).toBe(false);
    /* 没给 `extra` 的旧调用形态（默认 `[]`）必须仍是「绿即记」—— 否则这条改动
     * 会把 `tests/daily-tracks.test.ts` 里那两处同名断言一起改掉而没人发现。 */
    expect(shouldRecord({ exitCode: 0, dryRun: false })).toBe(true);
  });

  it("本次跑的是什么：一次 `playwright test`，且额外参数按位置透传", () => {
    expect(planRun().args).toEqual(["test"]);
    expect(planRun(["--grep", "@critical"]).args).toEqual(["test", "--grep", "@critical"]);
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

  /* 两份 drizzle 的**原话**，临时副本上真跑抓下来的（仓库与活库未碰），逐行照抄
   * （`[⣷]` 那行的 spinner 与 ANSI 清行序列对判据无影响，这里省掉）。
   * 它们一起把「空清单」的两种成因钉死：条数相同，差别只在有没有那句终态。 */
  const NO_CHANGES_OUTPUT = `No config path provided, using default 'drizzle.config.ts'
Reading config file 'drizzle.config.ts'
[✓] Pulling schema from database...

[i] No changes detected`;
  const BLOCKED_BEFORE_ENUMERATING_OUTPUT = `No config path provided, using default 'drizzle.config.ts'
Reading config file 'drizzle.config.ts'
[✓] Pulling schema from database...

Error: Interactive prompts require a TTY terminal (process.stdin.isTTY or process.stdout.isTTY is false). This can happen when running in CI, piped input, or non-interactive shells.
    at render10 (…/drizzle-kit/bin.cjs:1450:31)
    at promptNamedWithSchemasConflict (…/drizzle-kit/bin.cjs:32812:65)
    at tablesResolver (…/drizzle-kit/bin.cjs:32001:60)
    at applySqliteSnapshotsDiff (…/drizzle-kit/bin.cjs:29837:17)
    at prepareSQLitePush (…/drizzle-kit/bin.cjs:32652:58)
    at async sqlitePush (…/drizzle-kit/bin.cjs:82786:26)`;

  it("指纹一致 ⇒ 放行（正常机器的常态，且零成本——不起 drizzle）", () => {
    const d = schemaPreflightDecision({
      probe: "ready",
      fingerprintMatch: true,
      pending: [],
      autoApplyable: false,
    });
    expect(d.verdict).toBe("proceed");
  });

  it("表还没建 / 读不到 ⇒ **不是放行，是先建齐**（ISSUE #1948）", () => {
    /* 立案现场：这一档此前对空库说「建表那一批启动链路会自动应用」然后放行，
     * 而启动链路的同步是**后台 detached** 的（`spawnSchemaSync`），Playwright
     * 等的又只是 webServer 的 URL 可访问 —— 于是冒烟档的健康检查在建表完成前
     * 打过去，全新检出的现场是 `db: "empty"` ⇒ 503 ⇒ 那条 `@critical` 必红。
     * 现在空库是一个**要等**的动作（`ensure`），由本档在起 Playwright 之前做掉。 */
    /* SAFETY: 类型断言已复核 */
    for (const probe of ["missing", "unknown"] as const) {
      const d = schemaPreflightDecision({
        probe,
        fingerprintMatch: false,
        pending: [],
        autoApplyable: false,
      });
      expect(d.verdict).toBe("ensure");
      // 话术要把「为什么不能交给启动链路」说出来，否则下一个人会把它改回 proceed。
      expect(d.reason).toContain("后台");
    }
  });

  it("指纹不一致、dry-run 交出终态却没有待执行语句 ⇒ 放行（指纹只是没登记）", () => {
    const d = schemaPreflightDecision({
      probe: "ready",
      fingerprintMatch: false,
      pending: [],
      autoApplyable: false,
      /* 「清单是空的」在这一档的含义是 drizzle 说 `No changes detected` —— 它答了，
       * 答案是「没差异」。下一档是它根本没答。 */
      measured: true,
    });
    expect(d.verdict).toBe("proceed");
    expect(d.reason).toContain("没有待执行语句");
  });

  it("指纹不一致、**清单没拿到** ⇒ 阻断，不许读成「库本来就对」（ISSUE #1956）", () => {
    /* 立案现场（在临时副本上真跑复现，活库未碰）：库里那张 `workflowTemplate` 被改名走，diff 撞上「这是改名
     * 还是新建+删除」的询问 —— 它在**列出语句之前**就要人回答，无 TTY 时当场抛，`about to execute` 那句
     * 根本不出现。于是 `pendingStatements` 交出空清单，而旧判决把「没读到」读成「库本来就对」放行：
     * 这一卡存在的理由（#1834「库落后 → 接口 500 → 用例报元素没出现」）恰恰被它自己放进了来。口径同
     * §13.6.2「拿不到测量 ≠ 测量结果是红的」，反过来也不成立。 */
    const d = schemaPreflightDecision({
      probe: "ready",
      fingerprintMatch: false,
      pending: [],
      autoApplyable: false,
      measured: false,
    });
    expect(d.verdict).toBe("abort");
    expect(d.reason).toContain("没交出语句清单");
    /* 缺省方向：调用方**没写** measured 时也必须落阻断侧，不许默认成「拿到了」。 */
    const omitted = schemaPreflightDecision({
      probe: "ready",
      fingerprintMatch: false,
      pending: [],
      autoApplyable: false,
    });
    expect(omitted.verdict).toBe("abort");
  });

  it("空清单的两种成因由 drizzle 的**原话**分开，不是由条数分开（#1956 的判据）", () => {
    /* ① 库本来就对、只是指纹没登记 ⇒ 必须继续放行。堵掉它就是把 #1834 的解药
     *    变成新的 blocker，所以这一形和下面那一形**同一条用例里**判。 */
    const noChangesPending = pendingStatements(NO_CHANGES_OUTPUT);
    expect(noChangesPending).toEqual([]);
    expect(dryRunConcluded(NO_CHANGES_OUTPUT, noChangesPending)).toBe(true);
    expect(
      schemaPreflightDecision({
        probe: "ready",
        fingerprintMatch: false,
        pending: noChangesPending,
        autoApplyable: canAutoApply(noChangesPending),
        measured: dryRunConcluded(NO_CHANGES_OUTPUT, noChangesPending),
      }).verdict,
    ).toBe("proceed");

    /* ② 它在**列出语句之前**就要人回答（改名撞上重命名询问）⇒ 没拿到，不许放行。
     *    与 ① 同样的空清单、同样的条数。 */
    const blockedPending = pendingStatements(BLOCKED_BEFORE_ENUMERATING_OUTPUT);
    expect(blockedPending).toEqual([]);
    expect(pushBlockedByTty(BLOCKED_BEFORE_ENUMERATING_OUTPUT)).toBe(true);
    expect(dryRunConcluded(BLOCKED_BEFORE_ENUMERATING_OUTPUT, blockedPending)).toBe(false);
    expect(
      schemaPreflightDecision({
        probe: "ready",
        fingerprintMatch: false,
        pending: blockedPending,
        autoApplyable: canAutoApply(blockedPending),
        measured: dryRunConcluded(BLOCKED_BEFORE_ENUMERATING_OUTPUT, blockedPending),
      }).verdict,
    ).toBe("abort");

    /* ③ 第三种「没拿到」：命令压根没起来（`pushSchema` 走 invocationFailed 那支时
     *    firstOutput 是空的）。空文本也不是「库本来就对」。 */
    expect(dryRunConcluded("", [])).toBe(false);
  });

  it("接线：那一趟 dry-run 的输出**真的**过了 `dryRunConcluded`（不是被写成常量 true）", () => {
    /* 上一条判的是纯函数，这一条判的是**调用点认不认它** —— 只判纯函数的话，
     * 有人把 `measured` 直接写成 `true`（那就是旧行为）一条用例都不会红。
     * 三处读数注进来，两份原话各驱一遍整条链，不碰库也不起 drizzle。 */
    const drive = (output: string) =>
      checkSchemaBeforeRun(ROOT, {
        sync: () => "ready",
        fresh: () => ({ state: "outdated", detail: "指纹对不上" }),
        dryRun: () => ({ firstOutput: output }),
      });
    const proceedRun = drive(NO_CHANGES_OUTPUT);
    expect(proceedRun.verdict).toBe("proceed");
    const blockedRun = drive(BLOCKED_BEFORE_ENUMERATING_OUTPUT);
    expect(blockedRun.verdict).toBe("abort");
    expect(blockedRun.reason).toContain("没交出语句清单");
    /* 拦下那一档**没有** risky 清单（没读到语句，编不出逐条），所以出口话术里
     * 那句「这是要人做『丢不丢得起』决定的变更」不许被套上来 —— 给没测到的东西
     * 编一个诊断，和放行那一档是同一个错的两半。 */
    expect(blockedRun.risky ?? []).toEqual([]);
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
    expect(d.risky).toEqual(["DROP TABLE `loraTrainingJob`;", "DROP INDEX `task_project_idx`;"]);
    expect(d.reason).toContain("丢数据");
  });

  it("取证层在真仓库上判得出形状（不写死本机当前红绿——那会随库状态漂）", () => {
    /* 这一条只核「函数跑得通、返回的形状在判词里认得过来」：本机此刻红绿
     * 取决于 db.sqlite 同不同步，而那不是判据能钉的事实。
     * 三档都要认得：`ensure` 是空库那一档（ISSUE #1948 之后新增的判决）。 */
    const d = checkSchemaBeforeRun(ROOT);
    expect(["proceed", "ensure", "abort"]).toContain(d.verdict);
    expect(typeof d.reason).toBe("string");
    /* abort 有两条来路（#1956 之后）：**拿到清单且含丢数据语句**才带 risky；
     * **没拿到清单**那条带不出语句 —— 拿「risky 必非空」判它等于把新那一档判成
     * 用例红。这里按语义钉：有 risky 就逐条给全，没有就必须在 reason 里说清
     * 「是读不出而不是库没问题」。 */
    if (d.verdict === "abort") {
      if ((d.risky?.length ?? 0) > 0) {
        expect(d.reason).toContain("丢数据");
      } else {
        expect(d.reason).toContain("没交出语句清单");
      }
    }
  });
});

describe("两条新鲜度账同形但不同键（§11.8 / §12.12）", () => {
  it("四个值各就各位：账文件 / 键 / 名字 / 命令", () => {
    /* 只核**本档的两栏与关键字**，不核「`FRESHNESS_TRACKS` 一共几个键」—— 那份清单是 `daily-tracks.test.ts`
     * 的事（它判四档全在、互不重名），再写一份会在**每次新增一档**时红，而原因与「e2e 的账有没有写对」
     * 无关（`gate-executors.test.ts` 写死 `.toBe(44)` 那次同族）。同理四栏用**挑出来比**而非 `toEqual` 比整条：
     * 整条比等于顺手断言「形状刚好这几栏」，而登记表**会**长栏 —— `daily`/`skipHow`/`dirty`/`graceMs` 进来时
     * 它把一次**新增**报成一次**抄错**（ISSUE #1553 合并后就是这个形态）。差异那几栏各判各的，见下一条。 */
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
    expect(freshnessTrack("artifact").ledger).toBe("scripts/.artifact-freshness.json");
  });

  it("各份账的差异都在数据里（`daily` / `skipHow` / 输入面），不是分支", () => {
    /* 「同形」有边界：差异栏各回答一个问题 —— `daily`：这一档要不要按「每天首次」判；`skipHow`：这一档
     * 「今天不跑」那条出路长什么样（每档都有：没有这条出路就等于拦人而指不出退路）；`dirty` / `graceMs`：
     * 吃输入面的档按「改了就当天跑」判，不吃的那一档两栏为空。逐档一起判：只有一侧变了就说明「同形」
     * 这句话已经不成立了。 */
    expect(freshnessTrack("e2e").daily).toBe(true);
    /* 这一档的执行者现在是平台侧那一格（2026-10-19：「新鲜度都不要本地跑，都 CI 跑」）。
     * 名字写在这里而不是别处：`e2e-run.mjs` 是那一格的入口，而「那一格真在每日清单里」
     * 由 `tests/no-platform-ci-config.test.ts` 判 —— 两侧合起来才是「本地不拦」这句豁免
     * 的完整前提；少任何一侧，「不拦」都会变成「谁都不跑」。 */
    expect(freshnessTrack("e2e").ciStage).toBe("每日全量E2E");
    expect(freshnessTrack("e2e").skipHow).toBe('node scripts/e2e-run.mjs --skip "<理由>"');
    // e2e 现在也吃输入面（钩子重构 4），于是它也有「这次改动不吃这一档」那条出路。
    expect(freshnessTrack("e2e").dirty.length).toBeGreaterThan(0);
    expect(freshnessTrack("e2e").dirtyHow).toBe('node scripts/e2e-run.mjs --dirty "<理由>"');
    /* 三档**都**要有出路：没有 `skipHow` / `dirtyHow` 就等于拦人而指不出退路，
     * 而下一个人做的事会是 `--no-verify`（§13.5.4 那条边界）。逐档一起判，
     * 只有一侧变了就说明「同形」这句话已经不成立了。 */
    for (const kind of ["e2e", "full", "artifact"]) {
      const track = freshnessTrack(kind);
      expect(track.dirty.length, kind).toBeGreaterThan(0);
      expect(track.dirtyHow, kind).toBeTruthy();
      expect(track.skipHow, kind).toBeTruthy();
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

  it("写全的记录 ⇒ 放行，并报出「上次自证距今多久」+ 具体时刻", () => {
    const result = runGate({
      ledger: { e2e: GOOD },
      kind: "e2e",
      keys: ["e2e"],
      now: SAME_DAY,
    });
    expect(result.exitCode).toBe(0);
    /* 记录与 `SAME_DAY` 同在 2026-10-09（记录在 00:30Z、时钟在 06:00Z）：age 按整天向下取整
     * 所以是「今天」—— 也正是「每天首次」那条判据放行所需的形状。 */
    /*
     * ⚠️ **时刻那一半不写死字面量**（ISSUE #1979）：它是**本地时间**（判据判本地日历日，用 UTC 在东八区会把
     * 00:30 的提交显示成昨天），写死 `2026-10-09 08:30 (+08:00)` 就等于把用例绑在「跑它的那台机器的 TZ」上
     * （本机实测 +08:00、CI 容器可能是 UTC）。所以断言的是形状与内容：这句里带着那个时间点、且带显式偏移。
     */
    expect(result.ages).toEqual([`e2e：今天（${freshnessStamp(GOOD)}）`]);
    expect(result.ages[0]).toMatch(
      /^e2e：今天（\d{4}-\d{2}-\d{2} \d{2}:\d{2} \([+-]\d{2}:\d{2}\)）$/,
    );
    // `stamps` 是同一件事的机器可读那一栏 —— 没有时刻时它是 null，不是空串。
    expect(result.stamps).toEqual([freshnessStamp(GOOD)]);
  });

  it("「上次自证」那一句必须带具体时刻，不能只有天数", () => {
    /* 这一条守的是 ISSUE #1979 的诉求本身：账面此前只打 `今天` / `1 天前`，
     * 而「今天 08:45 跑过」与「今天 23:50 才跑过」在那种读数下**同形** ——
     * 排障时最需要的那一格（哪一小时）恰好被抹掉了。 */
    const result = runGate({
      ledger: { e2e: GOOD },
      kind: "e2e",
      keys: ["e2e"],
      now: SAME_DAY,
    });
    // 天数那一半还在（扫一眼就知道新不新），时刻接在它后面。
    expect(result.ages[0]).toContain("今天");
    expect(result.ages[0]).toContain(freshnessStamp(GOOD));
    // 时刻里要带上偏移量：只写 `2026-10-09 08:30` 在时区不同的两个人眼里是两个瞬间。
    expect(result.ages[0]).toMatch(/\([+-]\d{2}:\d{2}\)/);
  });

  it("`who` / `how` 一并给出去 —— 账面三栏都要能被看见", () => {
    /* 账存在的全部意义是「谁、什么时候、按哪条命令复核的」。此前输出只打第三栏的
     * 半句，要核另外两栏就得自己开 JSON —— 「账面被看见」只成了一半。 */
    const result = runGate({
      ledger: { e2e: GOOD },
      kind: "e2e",
      keys: ["e2e"],
      now: SAME_DAY,
    });
    expect(result.records).toEqual([{ key: "e2e", who: "月读", how: "pnpm test:e2e" }]);
  });

  it("缺记录 ⇒ 阻断，话术里给出这条账自己的账文件与命令", () => {
    const result = runGate({
      ledger: {},
      kind: "e2e",
      track: localE2e,
      keys: ["e2e"],
      now: SAME_DAY,
    });
    expect(result.exitCode).toBe(1);
    const text = result.problems.join("\n");
    expect(text).toContain(freshnessTrack("e2e").ledger);
    expect(text).toContain("pnpm test:e2e");
  });
});

describe("全量 e2e 的自证账（ISSUE #1282 立「每天首次」→ 钩子重构 4 改成吃输入面）", () => {
  const yesterday = { ...GOOD, verifiedAt: "2026-10-08T00:30:00.000Z" };

  it("昨天跑过 + 今天动过这一档的面 ⇒ **仍然要拦**（欠的就是欠的）", () => {
    const result = runGate({
      ledger: { e2e: yesterday },
      kind: "e2e",
      track: localE2e,
      keys: ["e2e"],
      now: SAME_DAY,
      dirtySince: new Date("2026-10-09T01:00:00.000Z"),
    });
    expect(result.exitCode).toBe(1);
    expect(result.problems.join("\n")).toContain("输入面");
  });

  it("昨天跑过 + 今天没动面 ⇒ **放行**（钩子重构 4 要的那一格：一笔只动 `.githooks/` 的提交不再欠全量 e2e）", () => {
    /* 立案现场：本检出最近 17 次提交里 6 次红，3 次由这条判据拦下，而那三次改的都不是
     * `src/`。旧口径按本地日历日判，于是「跑与不跑结论都不变」的那一次也要人付十几分钟。
     * 这一格正面钉住新语义 —— 没有它，「吃输入面」这件事随时可以被悄悄改回去，
     * 而账面读数完全正常。 */
    const result = runGate({
      ledger: { e2e: yesterday },
      kind: "e2e",
      keys: ["e2e"],
      now: SAME_DAY,
      dirtySince: null,
    });
    expect(result.exitCode, result.problems.join("\n")).toBe(0);
  });

  it("超出宽限（14 天没跑，且今天没动面）⇒ 照样拦 —— 放宽的是触发面，不是时限", () => {
    const stale = { ...yesterday, verifiedAt: "2026-09-25T00:30:00.000Z" };
    const result = runGate({
      ledger: { e2e: stale },
      kind: "e2e",
      track: localE2e,
      keys: ["e2e"],
      now: SAME_DAY,
      dirtySince: null,
    });
    expect(result.exitCode).toBe(1);
    expect(result.problems.join("\n")).toContain("宽限");
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

  it("两条出路的三种形状：没给 / 可用理由 / 不合用的理由（`--skip` 与 `--dirty` 同形）", () => {
    /* 这一段判的是**命令行契约**：`--skip`（今天故意不跑）与 `--dirty`（这次改动不吃这一档）是这个入口仅有的
     * 两条出路，抽成纯入口就是为了让「缺理由 / 占位理由」两条边界能被真跑一次 —— 它们是「豁免不是绕过」的
     * 机器形态。`mode` 跟着返回：落账要按它分栏（`skippedReason` / `dirtyReason`），两栏读的是两件不同的事
     * —— 混成一片之后「三个月没跑」与「三个月每次都声明不吃它」在账面上长得一模一样。 */
    expect(parseSkip(["node", "e2e-run"])).toEqual({
      skipped: false,
      mode: "run",
      reason: null,
    });
    expect(parseSkip(["--skip", "本周只解决合并冲突，未动功能链路"])).toEqual({
      skipped: true,
      mode: "skip",
      reason: "本周只解决合并冲突，未动功能链路",
    });
    expect(parseSkip(["--dirty", "本次只改编排钩子，没碰 src/ 与 spec"], "--dirty")).toEqual({
      skipped: true,
      mode: "dirty",
      reason: "本次只改编排钩子，没碰 src/ 与 spec",
    });
    // 两个开关互不串档：只给了 `--dirty` 时按 `--skip` 读就是「没给」。
    expect(parseSkip(["--dirty", "本次只改编排钩子"], "--skip").skipped).toBe(false);
    /* `--skip` 后面什么都没有是**另一种 argv 形状**：`["--skip"]` 里 `argv[i + 1]` 是
     * `undefined`。它不能靠往 argv 数组里塞一个 `undefined` 来构造 —— 真实 argv 里
     * 不存在这种元素（`process.argv` 每一项都是 string），那样的用例判的是一份
     * 不可能出现的输入。 */
    expect(parseSkip(["--skip"]).reason).toBe(null);
    expect(parseSkip(["--dirty"], "--dirty").reason).toBe(null);
    for (const bad of ["", "稍后", "TBD", "待定"]) {
      expect(parseSkip(["--skip", bad]).reason).toBe(null);
      expect(parseSkip(["--dirty", bad], "--dirty").reason).toBe(null);
    }
  });

  it("main 在起 Playwright **之前**认两条出路（`--dirty` 不许被悄悄丢掉）", () => {
    /* 解析层认得 `--dirty` 与调用点走到它是两件事：本档历史上只有一次 `--skip`，
     * 于是「补了 `parseSkip` 的能力、main 里仍只传 --skip」会长成一个完全安静的形状
     * —— 出路少一条不会红，只会让人在钩子里被拦之后自己去找命令（那就是 §13.5.12
     * 那一族：判据在场、没人敲）。顺手钉住「出路先于起跑」：给了出路还去起 webServer，
     * 既白付十几分钟，又会把「不跑」那一条账记成跑绿的。 */
    const src = readText("scripts/e2e-run.mjs");
    const loopAt = src.indexOf('["--skip", "--dirty"]');
    expect(loopAt, "main 里那两条出路只剩一条了？").toBeGreaterThan(-1);
    const launchAt = src.indexOf("= planRun(");
    expect(launchAt, "读不出 main 里那一步起跑").toBeGreaterThan(-1);
    expect(loopAt, "出路那一支必须排在起跑之前").toBeLessThan(launchAt);
    // 落账时把 mode 原样传下去（不许在调用点再判一次旗标 —— 那是第二份口径）。
    expect(src).toContain("mode: exit.mode");
  });

  it("「每天首次」按本地日历日判，不是滚动 24 小时", () => {
    /* 昨天 23:00 与今天 08:00 相差不到 24 小时，但**不是同一天** —— 滚动窗口会把
     * 今天早晨的第一次静默跳过，而人的节奏是按日历日走的。 */
    const lateYesterday = new Date("2026-10-08T23:00:00");
    const thisMorning = new Date("2026-10-09T08:00:00");
    expect(isSameLocalDay(lateYesterday, thisMorning)).toBe(false);
    expect(isSameLocalDay(thisMorning, new Date("2026-10-09T23:59:00"))).toBe(true);
  });
});

describe("接线在位（§13.5.12：判据要有人跑）", () => {
  it("`pnpm test:e2e` 真的走这条通道（否则记账这一步没有执行者）", () => {
    /* SAFETY: 类型断言已复核 */
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
      ...readText(".githooks/pre-commit").matchAll(/^ {2}run "(?<label>[^"]+)" (?<cmd>.+)$/gm),
    ].map((m) => ({ label: m.groups?.label ?? "", cmd: m.groups?.cmd ?? "" }));
    const hit = steps.find((s) => s.cmd.includes("scripts/freshness-gate.mjs"));
    expect(hit?.cmd).toBe("node scripts/freshness-gate.mjs");
    // 标签要能让人从这一行读出「判的是哪几档」—— 只写其中一档时，
    // 另一档红出来会被读成别人的事。
    expect(hit?.label).toContain("e2e");
  });

  it("账文件真的读同一个落点（读接口与登记表同源）", () => {
    const live = readFreshnessLedgerAt(ROOT, TRACK.ledger);
    expect(Object.keys(live)).toContain(TRACK.key);
    // 这份记录是**真跑**过的（本轮的 `node scripts/e2e-run.mjs`），不是手写的一行。
    /* SAFETY: 类型断言已复核 */
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

/**
 * ISSUE #1948：把「容器 / 全新检出里跑 e2e 会踩的三件事」变成三条机器判据 —— 共同形态是**红得看不出真因**：
 * 浏览器缺一半 ⇒ 每条都报同一个 launch 失败（看着像 81 个问题）；空库 ⇒ 健康检查红而话术说「表还没建好」，
 * 实际是这一档把建表甩在后台；`-- ` 吃掉位置参数 ⇒ 想跑 3 条跑成 81 条，退出码与输出里没一处说这件事。
 */
describe("开跑前的三档前置（ISSUE #1948）", () => {
  it("`--` 分隔符被剥掉：位置参数不再被吃掉（想跑冒烟跑的就是冒烟）", () => {
    /* 立案现场：`pnpm test:e2e -- e2e/smoke.spec.ts` 打出来的计划是
     * `playwright test -- e2e/smoke.spec.ts`，而 Playwright 把 `--` 之后的
     * 位置参数**当不了用例筛选** —— 实测 `--list` 列 81 条（本仓全档），
     * 不带 `--` 时列 3 条。跑错档而账面看不出来，正是这一条要拦的形态。 */
    expect(planRun(["--", "e2e/smoke.spec.ts"]).args).toEqual(["test", "e2e/smoke.spec.ts"]);
    // 不带分隔符的旧写法不受影响。
    expect(planRun(["--grep", "@critical"]).args).toEqual(["test", "--grep", "@critical"]);
    // 只丢恰好的那一项：别处出现的 `--` 不再是分隔符（参数名里带它不该被吞）。
    expect(stripArgvSeparator(["--grep", "@critical", "--", "a.ts"])).toEqual([
      "--grep",
      "@critical",
      "a.ts",
    ]);
    expect(stripArgvSeparator(["--", "--", "a.ts"])).toEqual(["--", "a.ts"]);
    expect(stripArgvSeparator([])).toEqual([]);
  });

  it("空库 ⇒ `ensure`：本档自己建齐，且复核它真的落地了", () => {
    /* 两个方向都要钉：建成了才放行；没建成（`missing` / `stale`）要**阻断**并
     * 给出人的出口 —— 否则「空库」会退化成「跑下去，让冒烟档去红」。 */
    const calls: Array<string> = [];
    const synced = ensureSchemaBeforeRun({
      root: ROOT,
      ensure: () => {
        calls.push("ensure");
        return { state: "synced" };
      },
    });
    expect(calls).toEqual(["ensure"]);
    expect(synced.verdict).toBe("proceed");
    expect(synced.state).toBe("synced");

    // 已经是齐的（并发窗口里别人先做完了 / 本来就在）：放行，报 ready。
    expect(ensureSchemaBeforeRun({ root: ROOT, ensure: () => ({ state: "ready" }) }).verdict).toBe(
      "proceed",
    );

    // 没建成 ⇒ 阻断，出口是 `pnpm db:push`（那是人的决定，别替它做）。
    /* SAFETY: 类型断言已复核 */
    for (const state of ["missing", "stale"] as const) {
      const blocked = ensureSchemaBeforeRun({
        root: ROOT,
        ensure: () => ({ state, detail: "现场原因" }),
      });
      expect(blocked.verdict, state).toBe("abort");
      expect(blocked.reason, state).toContain("pnpm db:push");
    }

    /* `unknown` 不阻断：拿不到结论 ≠ 库是坏的（`checkSchemaBeforeRun` 那两处
     * 判据失效也是同一条口径）。 */
    expect(
      ensureSchemaBeforeRun({
        root: ROOT,
        ensure: () => ({ state: "unknown" }),
      }).verdict,
    ).toBe("proceed");
  });

  it("浏览器缺件 ⇒ 判红并给出**它期望的那条路径**与补它的命令", async () => {
    const { checkBrowserReady, parseMissingExecutable, describeBrowserMissing } =
      await import("../e2e/support/preflight-browser.mjs");

    /* 判据是「真起一次」而不是「按路径猜一下」：headless 档要的二进制由
     * Playwright 内部决议，`chromium.executablePath()` 返回的是**另一个**
     * （本机实测：它给 `…/chromium-1243/chrome-linux64/chrome`，而真缺的是
     * `chromium_headless_shell-1243/…`）。所以这里喂一个真的会抛的 launch。 */
    const missing = await checkBrowserReady({
      launch: () =>
        Promise.resolve({
          ok: false,
          error: new Error(
            "browserType.launch: Executable doesn't exist at /tmp/x/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell\nCall log: ...",
          ),
        }),
    });
    expect(missing.verdict).toBe("missing");
    expect(missing.executablePath).toBe(
      "/tmp/x/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell",
    );
    // 出口必须是一条**能直接跑**的命令，且点名 headless shell（只装 chromium 不够）。
    expect(missing.installHint).toContain("playwright install");
    expect(missing.installHint).toContain("chromium-headless-shell");
    const text = describeBrowserMissing(missing);
    expect(text).toContain(missing.executablePath);
    expect(text).toContain(missing.installHint);

    // 起得来 ⇒ ready，且不产生任何话术噪音（happy path 上不打扰）。
    expect(await checkBrowserReady({ launch: () => Promise.resolve({ ok: true }) })).toEqual({
      verdict: "ready",
    });

    // 不是缺文件（权限 / 缺系统库）也归这一档，但**不猜路径** —— 抠不出来就报原文。
    const other = await checkBrowserReady({
      launch: () =>
        Promise.resolve({
          ok: false,
          error: new Error("browserType.launch: Target page, context or browser has been closed"),
        }),
    });
    expect(other.verdict).toBe("missing");
    expect(other.executablePath).toBeUndefined();
    expect(other.installHint).toBeTruthy();

    // 抠路径那一层的边界：Playwright 换了话术就返回 null，而不是拼一条假的出来。
    expect(parseMissingExecutable("something else entirely")).toBeNull();
    expect(parseMissingExecutable("Executable doesn't exist at /a/b")).toBe("/a/b");
  });
});

/**
 * 起 Playwright 那一跳：**不带缓冲**、env 是「本档算好的那一份」（ISSUE #1998）。现场：`E2E 关键流程` 在平台侧
 * 36 分钟被 stage 墙钟 kill（`cnb-m0t-1k54oljem`），日志**零行** —— 真因是 `spawnSync` 把输出攒进 `res.stdout`
 * （本文件从不读），被 kill 时随进程消失（§13.5.3「第十二处」同形态）。本地跑看不见，故钉 `stdio` 形状 + 一条真跑。
 */
describe("起 Playwright 的那一跳：不缓存输出（ISSUE #1998）", () => {
  /* SAFETY: 类型断言已复核 */
  const ENV = {
    E2E_PREFLIGHT: "{}",
    E2E_PYTHON_PREFLIGHT: "{}",
  } as unknown as NodeJS.ProcessEnv;

  it("形态：`spawn` 那一份里 `stdio` 是 inherit —— 缓存掉了就是零行日志", () => {
    const inv = resolvePlaywrightInvocation({
      entry: "/pw/cli.js",
      argv: ["test", "--grep=@critical"],
      env: ENV,
      execPath: "/usr/bin/node",
    });
    expect(inv.command).toBe("/usr/bin/node");
    expect(inv.args).toEqual(["/pw/cli.js", "test", "--grep=@critical"]);
    // 这一条就是本条全部的意义：不是 "pipe"（那会把输出收进 Buffer）。
    expect(inv.options.stdio).toBe("inherit");
    expect(inv.options.cwd).toBe(ROOT);
  });

  it("env 是**拷一份**：本档那两条 preflight 结论跟着进子进程，且不改原对象", () => {
    const env = { ...ENV };
    const inv = resolvePlaywrightInvocation({
      entry: "/pw/cli.js",
      argv: [],
      env,
    });
    expect(inv.options.env).toEqual(ENV);
    // 拷贝而不是同一个对象：子进程环境里的后续改动不该回写调用方的 env。
    expect(inv.options.env).not.toBe(env);
  });

  it("`runChild` 真等到了结论（不是空壳）：退出码原样带出来", async () => {
    const res = await runChild({
      command: process.execPath,
      args: ["-e", "process.exit(3)"],
      options: { stdio: "ignore" },
    });
    expect(res.status).toBe(3);
  });

  it("起不来（ENOENT）交 `status: null` 而不是抛 —— 调用方转非零退出码", async () => {
    /* `origin: "test"`：本条**要的就是**那条失败路径，打出来的那一行必须是 `[e2e-run/test]` 一族 —— 否则它与
     * 「这一跑真起不来」共用一行，读 CI 日志的人得先猜这行是不是某条用例造的。`origin` 是 `runChild()` 第二
     * 个参数的字段（不是 invocation 的 —— 它不描述「起什么」，只描述「**谁**在要它起」）。 */
    const res = await runChild(
      {
        command: path.join(ROOT, "no-such-playwright-runner"),
        args: [],
        options: { stdio: "ignore" },
      },
      { origin: "test" },
    );
    expect(res.status).toBeNull();
  });

  it("起不来那一行自报家门：判据造的失败与真故障前缀不同（`spawnFailureLine`）", () => {
    const command = path.join(ROOT, "no-such-playwright-runner");
    const real = spawnFailureLine({ command, code: "ENOENT" });
    const byTest = spawnFailureLine({
      command,
      code: "ENOENT",
      origin: "test",
    });

    /* 三件事同时在：真实形态保持原样（运维照旧照这一行找线索）、
     * 判据形态换前缀、并明说「不是这一跑起不来」。 */
    expect(real.startsWith("[e2e-run] ✗ 起不了 Playwright")).toBe(true);
    expect(real).not.toContain("判据按设计造的失败");
    expect(byTest.startsWith("[e2e-run/test] ✗ 起不了 Playwright")).toBe(true);
    expect(byTest).toContain("判据按设计造的失败");
    /* 取证本身一个字都不许少 —— 收掉它才是真把线索丢了。 */
    for (const line of [real, byTest]) {
      expect(line).toContain("ENOENT");
      expect(line).toContain(command);
      expect(line).toContain("resolveCommandInvocation");
    }
    /* 失败码缺失时不编一个出来（`undefined` 会被念成 "undefined"）。 */
    expect(spawnFailureLine({ command })).toContain("失败码 未知");
  });

  it("跑法脚本里不再有 `spawnSync` 起 Playwright 的那一行（缓存就藏在它身上）", () => {
    /* 按**调用形态**判而不是按字面：要拦的形态是「某一行里真的调了 spawnSync」，
     * 而函数头注里那句来历（`` * ## 为什么不是 `spawnSync(process.execPath, …)``` ）
     * 与 `--dry-run` 的用法说明都会被字面判据误伤。 */
    const src = readText("scripts/e2e-run.mjs");
    expect(src).toContain("await runChild(invocation)");
    const calls = src
      .split("\n")
      .filter((line) => !line.trim().startsWith("*") && !line.startsWith("//"))
      .filter((line) => line.includes("spawnSync("));
    expect(calls, "起 Playwright 那一跳不许再有 spawnSync（它会把输出攒进 res.stdout）").toEqual(
      [],
    );
  });
});

/**
 * 开跑前的读数**按序全部说出来**（ISSUE #1998）。判据是「顺序」与「第一条阻断生效」两件事，而真去起一遍
 * 浏览器 / drizzle 不适合每条用例都跑 —— 所以 `runPreflightReadings` 收一个 `collect`，
 * `makePreflightCollectors` 的三份判决用注入的假判决喂进来。
 */
describe("开跑前的读数：按序说出来，再拦（ISSUE #1998）", () => {
  const touched: Array<string> = [];

  it("三步各说一句；全绿时一条都不拦", async () => {
    touched.length = 0;
    const { abort } = await runPreflightReadings({
      collect: (step) => {
        touched.push(step);
        return Promise.resolve({ say: `[${step}]\n` });
      },
    });
    expect(abort).toBeNull();
    expect(touched).toEqual(["ports", "python", "schema", "browser"]);
  });

  it("第一条阻断就停，且它之前那几步的读数**已经说过了**", async () => {
    touched.length = 0;
    const { abort } = await runPreflightReadings({
      collect: (step) => {
        touched.push(step);
        if (step === "schema") {
          return Promise.resolve({ abort: "库没建齐" });
        }
        return Promise.resolve({ say: `[${step}]\n` });
      },
    });
    expect(abort).toBe("库没建齐");
    // 浏览器那一步**没有**被执行（短路生效），而它前面三步都执行过。
    expect(touched).toEqual(["ports", "python", "schema"]);
  });

  it("`collect` 回 null 的步骤被跳过（端口那条已在别处算过，不重复探）", async () => {
    touched.length = 0;
    await runPreflightReadings({
      collect: (step) => {
        touched.push(step);
        return Promise.resolve(step === "ports" ? null : { say: "x\n" });
      },
    });
    expect(touched).toContain("ports");
  });

  it("Python 缺件 ⇒ 拦，且**结论已经写进 env**（`playwright.config.ts` 读它）", async () => {
    /* SAFETY: 类型断言已复核 */
    const env = {} as NodeJS.ProcessEnv;
    const collectors = makePreflightCollectors({
      env,
      cwd: ROOT,
      python: () => ({
        /* SAFETY: 类型断言已复核 */
        verdict: "missing" as const,
        interpreter: null,
        detail: "没有解释器",
      }),
    });
    const { abort } = await runPreflightReadings({
      collect: (step) => Promise.resolve(step === "python" ? collectors.python() : null),
    });
    expect(abort).toContain("没有解释器");
    // 缺件那一档也要把结论带过去：否则 `playwright.config.ts` 退回「不知道」。
    expect(env[PYTHON_PREFLIGHT_ENV_KEY]).toBeTruthy();
  });

  it("schema 判成 abort ⇒ 拦下，且逐条列出丢数据的语句", () => {
    const collectors = makePreflightCollectors({
      /* SAFETY: 类型断言已复核 */
      env: {} as NodeJS.ProcessEnv,
      cwd: ROOT,
      schema: () => ({
        /* SAFETY: 类型断言已复核 */
        verdict: "abort" as const,
        reason: "含丢数据语句",
        risky: ["DROP TABLE loraTrainingJob"],
      }),
    });
    const result = collectors.schema();
    expect(result.abort).toContain("含丢数据语句");
    expect(result.abort).toContain("DROP TABLE loraTrainingJob");
    // 出口是可执行的：`pnpm db:push`（不是一句「请同步数据库」）。
    expect(result.abort).toContain("pnpm db:push");
  });

  it("浏览器 ready / 拿不到结论都只是读数，不拦", async () => {
    for (const verdict of [
      /* SAFETY: 类型断言已复核 */
      { verdict: "ready" as const },
      /* SAFETY: 类型断言已复核 */
      { verdict: "unknown" as const, detail: "探不动" },
    ]) {
      const collectors = makePreflightCollectors({
        /* SAFETY: 类型断言已复核 */
        env: {} as NodeJS.ProcessEnv,
        cwd: ROOT,
        browser: () => Promise.resolve(verdict),
      });
      // oxlint-disable-next-line no-await-in-loop -- 用例逐轮 await 以保持断言顺序与桩状态
      const result = await collectors.browser();
      expect(result.abort).toBeUndefined();
      expect(result.say).toContain("浏览器预检");
    }
  });
});
