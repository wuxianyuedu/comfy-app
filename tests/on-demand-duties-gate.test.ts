/**
 * 「不进钩子的按需档 ⇄ 执行者」双向判据的门禁自测（规范 §13.5.4）。
 *
 * 判据 `scripts/check-on-demand-duties.cjs` 的价值全在**两个方向**都成立上：
 *   ① 索引里点名的机器事实必须仍然存在（档被删 / 改名 / 已接进钩子 ⇒ 过期承诺）；
 *   ② 每一个机器事实都必须被索引登记（新增一档却忘了登记 ⇒ 那一档**谁都不判**，
 *      正是 §13.5.12 的立案现场：判据的覆盖面与它自称的不符）。
 *
 * 两个方向各一组，外加「判据自己不许静默降级」那一档（索引解析不出 / 行数塌到
 * 下限以下时不许退化成「0 行、全绿」，同 §11.18.3 首版那个 `include: []` 退 0）。
 *
 * 事实从**既有出处**现算（`FRESHNESS_TRACKS` / `quality-gate.mjs` 的 `run:false` /
 * 按需召唤台账）—— 所以夹具必须把这三份**真的**摆好，判据才读得到（抄一份假的
 * 就等于在测另一个东西）。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, defineGateRepo } from "./helpers/gate-repo";

/* `test` 与 `expect` 都由夹具给出（`test` 带 `repo`；`expect` 是它转发的那一份，
 * 这样断言的实现与夹具同源）；`describe` 不随 `extend` 变，从夹具模块取。 */
const { test, expect } = defineGateRepo({
  script: "check-on-demand-duties.cjs",
  /* 判据靠 `__dirname/..` 定位仓库根，所以脚本必须落在 `scripts/` 下。 */
  dir: "scripts",
  workdir: "on-demand-duties",
  /* 两份「既有出处」要从源码仓库拷进来，判据才知道有哪些机器事实：
   *   · `freshness-ledger.mjs` —— 新鲜度档的键（判据 `import` 它）；它按 `scripts/**` 900 行
   *     硬闸把「机器分支回看 / 回写」拆到了 `freshness-ledger-sync.mjs`，所以那份也得一并
   *     拷进来，否则 `import` 链到半路 `ERR_MODULE_NOT_FOUND`、整组用例红。
   *   · `quality-gate.mjs`    —— `run: false` 的门禁项。
   *
   * **按需召唤台账刻意不拷真件**：那两份 tw4 条目只需一条在场就够（夹具要的是
   * 「台账里有东西」这个形状，不是那两份文件本身）。拷真件再覆盖的顺序由夹具决定
   * （`files` 在后），但那会让「夹具提供了什么」这件事不可读 —— 直接写更清楚。 */
  copy: [
    { from: "scripts/freshness-ledger.mjs", to: "scripts/freshness-ledger.mjs" },
    { from: "scripts/freshness-ledger-sync.mjs", to: "scripts/freshness-ledger-sync.mjs" },
    { from: "scripts/quality-gate.mjs", to: "scripts/quality-gate.mjs" },
  ],
  /* 台账与索引都按用例改写 —— 夹具给一份最小可用的。 */
  files: {
    "scripts/.gate-executor-ledger.json": JSON.stringify(
      { onDemand: { "tw4-canonical-report.mjs": { why: "起 Tailwind 引擎", who: "按需" } } },
      null,
      2,
    ),
  },
});

/** 索引里一行的形状（夹具按它造）。 */
interface DutyRow {
  executor: string;
  fact: { gate?: string; key?: string; kind: string; script?: string };
  id: string;
  name: string;
  notInHook: string;
}

/** 一份「最小但双向都成立」的索引：六条按需档（下限是 5，留一格余量）。 */
function ledgerDuties(overrides: { extra?: Array<DutyRow> } = {}): {
  duties: Array<DutyRow>;
  why: string;
} {
  return {
    why: "测试夹具",
    duties: [
      {
        id: "e2e",
        name: "全量 e2e",
        notInHook: "起 webServer + 浏览器",
        fact: { kind: "freshness-track", key: "e2e" },
        executor: "钩子 D 组",
      },
      {
        id: "full",
        name: "全量单测",
        notInHook: "十分钟量级",
        fact: { kind: "freshness-track", key: "full" },
        executor: "钩子 D 组",
      },
      {
        id: "artifact",
        name: "产物护栏",
        notInHook: "分钟量级",
        fact: { kind: "freshness-track", key: "artifact" },
        executor: "钩子 D 组",
      },
      {
        /* 这一条是**下限的余量**：判据的 `MIN_DUTIES` 是 5，而「方向②」那一条要
         * 删掉一行 —— 删完仍须 ≥ 下限，否则先撞的是「解析坏了」那条，把真正要测的
         * 方向盖住（实测踩过）。 */
        id: "dependency-audit",
        name: "依赖漏洞扫描",
        notInHook: "网络请求",
        fact: { kind: "gate-in-all", gate: "dependencyAudit" },
        executor: "pnpm check:all 的默认档",
      },
      {
        /* 台账类事实：夹具的文件里真有一条（见 `files`）—— 不写它的话，
         * 这一类事实永远没有行，而判据的方向②要求「每一个机器事实都被登记」。 */
        id: "tw4-canonical-report",
        name: "CSS 等价改写汇总",
        notInHook: "要起 Tailwind 引擎",
        fact: { kind: "on-demand-ledger", script: "tw4-canonical-report.mjs" },
        executor: "按需召唤 + 棘轮",
      },
      {
        /* 这一行跟着**真 `quality-gate.mjs`** 走（夹具拷的是真件，见 `copy`）：
         * 那边每新增一个 `run: false` 的档，方向② 就要求这里也有一行 ——
         * 这正是该判据要的形态（「新增一档却忘了登记 ⇒ 那一档谁都不判」），
         * 所以这一行不是补齐夹具，是**夹具跟着事实走**。 */
        id: "premerge-fixed-action",
        name: "合并前的固定动作",
        notInHook: "平台侧 squash 不跑本地钩子",
        fact: { kind: "gate-not-in-all", gate: "premerge" },
        executor: "pnpm check:premerge",
      },
      {
        /* 同上：跟着真 `quality-gate.mjs` 的 `bundleBudget`（`run: false`）走。
         * ISSUE #1781 —— 测量对象是 `next build` 的产物、构建本身半分钟级，
         * 所以它是**按需入口**而不是 `all` 的一档。 */
        id: "bundle-budget",
        name: "bundle 体积预算",
        notInHook: "测量对象是 next build 的产物，构建半分钟级",
        fact: { kind: "gate-not-in-all", gate: "bundleBudget" },
        executor: "pnpm check:bundle（也挂在 pnpm build 收尾）",
      },
      {
        /* 同上：跟着真 `quality-gate.mjs` 的 `dailyAttendance`（`run: false`）走。
         * ISSUE #2114 出路 1 —— 判据要上网问平台，所以它是**按需入口**而不是 `all`
         * 的一档（把网络请求放进每次完整验证是另一回事）。 */
        id: "daily-attendance",
        name: "每日那一跑的出勤",
        notInHook: "要上网问平台",
        fact: { kind: "gate-not-in-all", gate: "dailyAttendance" },
        executor: "pnpm check:daily-attendance",
      },
      ...(overrides.extra ?? []),
    ],
  };
}

/** 真实仓库里的三份事实读数 —— 夹具的断言按它来，避免写死会漂的数字。 */
const REAL = /* SAFETY: 类型断言已复核 */ JSON.parse(
  readFileSync(join(process.cwd(), "scripts", ".on-demand-duties.json"), "utf8"),
) as { duties: Array<unknown> };

describe("on-demand-duties —— 双向", () => {
  test("索引与实际机器事实一致 ⇒ 通过", ({ repo }) => {
    /* 把真实索引原样摆进去，但把它的 fact 收窄到本夹具能提供的事实上 ——
     * 夹具里只有 FRESHNESS_TRACKS 的三档 + quality-gate 的 premerge。
     * 真实索引还登记了 dependencyAudit / tw4 等条目（需要真实 quality-gate 与台账），
     * 所以这里不直接用真索引，而是用最小的那份。 */
    repo.write("scripts/.on-demand-duties.json", JSON.stringify(ledgerDuties(), null, 2));
    const { code, output } = repo.run();
    expect(code).toBe(0);
    expect(output).toContain("双向核对通过");
  });

  test("方向①：点名一个不存在的档 ⇒ 红（过期承诺）", ({ repo }) => {
    repo.write(
      "scripts/.on-demand-duties.json",
      JSON.stringify(
        ledgerDuties({
          extra: [
            {
              id: "ghost",
              name: "已经删掉的档",
              notInHook: "——",
              fact: { kind: "freshness-track", key: "已经没了" },
              executor: "某处",
            },
          ],
        }),
        null,
        2,
      ),
    );
    const { code, output } = repo.run();
    expect(code).toBe(1);
    expect(output).toContain("不存在");
  });

  test("方向②：机器事实没被登记 ⇒ 红（那一档谁都不判）", ({ repo }) => {
    /* 抹掉 e2e 那一行 —— 事实还在，登记没了。 */
    const led = ledgerDuties();
    led.duties = led.duties.filter((d: DutyRow) => d.id !== "e2e");
    repo.write("scripts/.on-demand-duties.json", JSON.stringify(led, null, 2));
    const { code, output } = repo.run();
    expect(code).toBe(1);
    expect(output).toContain("freshness-track:e2e");
    expect(output).toContain("没有被本索引登记");
  });

  test("方向②：新增的按需台账条目没登记 ⇒ 红", ({ repo }) => {
    repo.write("scripts/.on-demand-duties.json", JSON.stringify(ledgerDuties(), null, 2));
    repo.write(
      "scripts/.gate-executor-ledger.json",
      JSON.stringify(
        { onDemand: { "some-new-report.mjs": { why: "起引擎", who: "按需" } } },
        null,
        2,
      ),
    );
    const { code, output } = repo.run();
    expect(code).toBe(1);
    expect(output).toContain("on-demand-ledger:some-new-report.mjs");
  });
});

describe("on-demand-duties —— 判据自己不许静默降级", () => {
  test("索引不存在 ⇒ 红（不是「没有档要查、于是放过」）", ({ repo }) => {
    const { code, output } = repo.run();
    expect(code).toBe(1);
    expect(output).toContain("索引不存在");
  });

  test("索引不是合法 JSON ⇒ 红", ({ repo }) => {
    repo.write("scripts/.on-demand-duties.json", "{ 这不是 json");
    const { code, output } = repo.run();
    expect(code).toBe(1);
    expect(output).toContain("不是合法 JSON");
  });

  test("duties 为空数组 ⇒ 红（空索引 = 把门禁关掉）", ({ repo }) => {
    repo.write("scripts/.on-demand-duties.json", JSON.stringify({ why: "", duties: [] }, null, 2));
    const { code, output } = repo.run();
    expect(code).toBe(1);
    expect(output).toContain("duties");
  });

  test("行数塌到下限以下 ⇒ 红（解析规则坏了）」", ({ repo }) => {
    repo.write(
      "scripts/.on-demand-duties.json",
      JSON.stringify(
        { why: "", duties: [{ id: "a", name: "a", fact: { kind: "x" }, executor: "e" }] },
        null,
        2,
      ),
    );
    const { code, output } = repo.run();
    expect(code).toBe(1);
    expect(output).toContain("下限");
  });

  test("行缺字段 ⇒ 红（id / name / fact.kind / executor 都要有）", ({ repo }) => {
    const led = ledgerDuties();
    /* 造「缺字段」那一档 —— 用 `Partial` 表达「这一行故意缺了 executor」。 */
    const broken = /* SAFETY: 类型断言已复核 */ { ...led.duties[0] } as Partial<DutyRow>;
    delete broken.executor;
    led.duties = [/* SAFETY: 类型断言已复核 */ broken as DutyRow, ...led.duties.slice(1)];
    repo.write("scripts/.on-demand-duties.json", JSON.stringify(led, null, 2));
    const { code, output } = repo.run();
    expect(code).toBe(1);
    expect(output).toContain("缺字段");
  });

  test("--report 只出清单、不判失败", ({ repo }) => {
    const { code } = repo.run(["--report"]);
    expect(code).toBe(0);
  });
});

describe("on-demand-duties —— 真实索引在场（本仓库）", () => {
  test("真索引至少登记了 §13.5.4 点名的那些档", () => {
    /* 这一条守的是「本索引别被顺手删空」—— 它的执行者是 C 组固定清单。 */
    expect(REAL.duties.length).toBeGreaterThanOrEqual(5);
  });
});
