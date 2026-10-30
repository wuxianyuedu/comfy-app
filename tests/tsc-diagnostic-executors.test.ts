/**
 * 「类型层声明 ⇄ 执行者」判据的门禁自测（规范 §13.5.14 / ISSUE #1591）。
 *
 * 判据 `scripts/check-tsc-diagnostic-executors.cjs` 的三向口径逐条钉住：
 *   ① 每条登记项的执行者在场（读者存在 + 与姊妹索引 `scripts/.declaration-readers.json` 逐行同源）
 *   ② 未登记的声明不许新增（零增量）
 *   ③ 登记项与事实脱钩即红（落点没了 / 关键词找不到了）
 *
 * 走项目共享的门禁自测夹具（`tests/helpers/gate-repo.ts`，§11.16.1）——
 * 不手搓临时仓库样板。
 *
 * ⚠️ 本判据的输入面**只有两份台账 + 被扫目录**，`import` 图一概追不到 ——
 * 所以「该拦的每一档」都只能在这里钉住，也必须进 C 组固定清单（`affected-tests.mjs`）。
 */
import { defineGateRepo } from "./helpers/gate-repo";
import type { GateRepo } from "./helpers/gate-repo";
import { expectActionableRefusal } from "./helpers/ratchet-refusal";
import { readFileSync } from "node:fs";
import path from "node:path";

const REAL_ROOT = process.cwd();
const LEDGER = path.join(REAL_ROOT, "scripts", ".tsc-diagnostic-executors.json");
const READERS = path.join(REAL_ROOT, "scripts", ".declaration-readers.json");

/** 真台账的一份深拷贝（用例里改完必须还原的那份）。 */
const REAL_LEDGER = /* SAFETY: 类型断言已复核 */ JSON.parse(readFileSync(LEDGER, "utf8")) as Ledger;
const REAL_READERS = /* SAFETY: 类型断言已复核 */ JSON.parse(readFileSync(READERS, "utf8")) as {
  carriers: Array<{ id: string; reader: string }>;
};

interface Entry {
  id: string;
  name: string;
  paths: Array<string>;
  markers?: Array<string>;
  reader: string;
  executor: { kind: string; test?: string; label?: string };
  baseline: Record<string, number>;
  section: string;
  /** 条目声称**执行者逐条核过**的面（选填；写了就要核，见判据的 ①′）。 */
  verifiedSurfaces?: Array<string>;
}
interface Ledger {
  entries: Array<Entry>;
}

const { test, expect } = defineGateRepo({
  script: "check-tsc-diagnostic-executors.cjs",
  dirs: ["src", "scripts", "tests"],
  copy: [
    /* 两份台账都要搬进来 —— 判据会与姊妹索引逐行同源核对，缺了那一份会走
     * 「读不到对侧 ⇒ 判失败」那一档，于是每条用例红的都是同一件事。 */
    {
      from: "scripts/.tsc-diagnostic-executors.json",
      to: "scripts/.tsc-diagnostic-executors.json",
    },
    {
      from: "scripts/.declaration-readers.json",
      to: "scripts/.declaration-readers.json",
    },
  ],
});

/**
 * 造一份「声明行数已知」的源文件，让对照可以逐字算。
 *
 * 第一行必须带上 `MARKER`：判据同时核「关键词还在不在」，只造裸声明会让
 * 每一条用例都先在那一格红掉、而看不见本用例真正要测的那一档。
 */
const MARKER = "__MARKER__";
const DECL = `export const ${MARKER} = 1;\nexport function f() {}\nexport const x = 1;\n`;

function writeBoth(repo: GateRepo, ledger: Ledger, readers = REAL_READERS) {
  repo.write("scripts/.tsc-diagnostic-executors.json", JSON.stringify(ledger, null, 2));
  repo.write("scripts/.declaration-readers.json", JSON.stringify(readers, null, 2));
}

/**
 * 真台账里那条「只含一个文件」的条目 —— 造变异时以它为骨架最省事。
 *
 * 用 `!` 而不是 `as Entry`：断言在这里只是把「`find` 可能返回 undefined」压下去，
 * 而真台账确实有这一条（下面「真台账非空」那条用例兜着它）。
 */
const SAMPLE = REAL_LEDGER.entries.find((e) => e.id === "expect-type-of")!;

/**
 * 真台账里那条**带 `verifiedSurfaces`** 的条目 —— ①′ 那一组用例要一个真实的
 * `reader` 路径（临时仓库里要把那份脚本也写出来）。
 */
const REAL_SAMPLE = REAL_LEDGER.entries.find((e) => e.id === "a11y-rule-switch")!;

/* ── 基线：真台账在真文件上应该是绿的 ──────────────────────── */

test("真台账在真落点上判绿（当前状态自查）", ({ repo }) => {
  repo.write("scripts/check-type-assertion-executor.cjs", DECL.repeat(19)); // 57 行声明
  const ledger: Ledger = {
    entries: [
      {
        ...SAMPLE,
        paths: ["scripts/check-type-assertion-executor.cjs"],
        markers: [MARKER],
        baseline: { "scripts/check-type-assertion-executor.cjs": 57 },
      },
    ],
  };
  writeBoth(repo, ledger);
  const { code, output } = repo.run();
  expect(code, output).toBe(0);
  expect(output).toContain("执行者都在场");
});

/* ── ② 零增量：未登记的声明不许新增 ────────────────────────── */

test("② 声明行数涨上去 → 阻断，且出口必须是**人写得下的动作**", ({ repo }) => {
  repo.write("scripts/check-type-assertion-executor.cjs", DECL.repeat(20)); // 60 行
  writeBoth(repo, {
    entries: [
      {
        ...SAMPLE,
        paths: ["scripts/check-type-assertion-executor.cjs"],
        markers: [MARKER],
        baseline: { "scripts/check-type-assertion-executor.cjs": 57 },
      },
    ],
  });
  const { code, output } = repo.run();
  expect(code).toBe(1);
  expect(output).toContain("声明新增");
  expect(output).toContain("从 57 涨到 60");
  /* 出口必须是**人写得下的动作**，不是一条命令。
   * 这一格原来断的是 `toContain("--update")` —— 它把一条**做不到的事**当成出路钉住了：
   * 同一个脚本的 `--update` 那一支对「上涨」是 `exit 2` 拒绝写入（本仓 §11.25 的
   * 判据就是判这个方向），所以照着红话跑一遍只会再吃一次红，而「谁在敲这条声明」
   * 这个真问题一次都没被回答。红话与机制相反，比没有红话更糟（§11.18.4）。 */
  expect(output).toContain("手工");
  /* 反向断言取的是**那句指令的形状**，不是字面量「--update」：红话里现在会明确写
   * 「这一步不给 `--update`」，那是在**否认**这条出路，用 `not.toContain("--update")`
   * 会把这句否认本身判成违规（判据报错了对象，正是 §11.2.1 说的「断言抄的是实现」）。 */
  expect(output).not.toMatch(/再跑 `node scripts\/check-tsc-diagnostic-executors\.cjs --update`/);
  expect(output).toContain("这一步**不给");
  // 也不许把人推向「放宽判据」那一侧。
  expect(output).toContain("为了让这一步变绿");
  /* 这一族就是从这里被发现是死路的（红话把人指回同一个会拒绝的旗标）。
   * 上面那些断言判的是这句话的具体形状，下面这条判的是它属于四种自洽写法之一，
   * 判据与其余三家共用同一份实现。 */
  expectActionableRefusal(output, "check-tsc-diagnostic-executors.cjs");
});

test("② 声明行数降下去 → 不阻断，但提示收紧基线", ({ repo }) => {
  repo.write("scripts/check-type-assertion-executor.cjs", DECL.repeat(10)); // 30 行
  writeBoth(repo, {
    entries: [
      {
        ...SAMPLE,
        paths: ["scripts/check-type-assertion-executor.cjs"],
        markers: [MARKER],
        baseline: { "scripts/check-type-assertion-executor.cjs": 57 },
      },
    ],
  });
  const { code, output } = repo.run(["--report"]);
  expect(code).toBe(0);
  expect(output).toContain("收紧：");
  expect(output).toContain("降到 30");
});

/* ── ③ 台账与事实脱钩 ──────────────────────────────────────── */

test("③ 落点文件上扫不到任何声明行 → 阻断（台账是负债不是赦免名单）", ({ repo }) => {
  repo.write("scripts/check-type-assertion-executor.cjs", "// 只有注释，没有声明\n");
  writeBoth(repo, {
    entries: [
      {
        ...SAMPLE,
        paths: ["scripts/check-type-assertion-executor.cjs"],
        markers: [],
        baseline: { "scripts/check-type-assertion-executor.cjs": 57 },
      },
    ],
  });
  const { code, output } = repo.run();
  expect(code).toBe(1);
  expect(output).toContain("扫不到任何声明行");
});

test("③ 登记的关键词已经找不到了 → 阻断", ({ repo }) => {
  repo.write("scripts/check-type-assertion-executor.cjs", DECL.repeat(19));
  writeBoth(repo, {
    entries: [
      {
        ...SAMPLE,
        paths: ["scripts/check-type-assertion-executor.cjs"],
        markers: ["这个关键词早就不在了"],
        baseline: { "scripts/check-type-assertion-executor.cjs": 57 },
      },
    ],
  });
  const { code, output } = repo.run();
  expect(code).toBe(1);
  expect(output).toContain("已经找不到了");
});

/* ── ①′ 条目声称的「核验面」要在自己的执行者里逐字存在（#1623） ── */

/** 造一份「读者脚本」—— 里面具名出现 `judge` / `normalize`，而 `bogus` 不在。 */
const READER_SRC =
  "function judge() {}\nfunction normalize() {}\nmodule.exports = { judge, normalize };\n";

test("①′ 声称核过的面在读者脚本里找不到 → 阻断（台账那句话与事实脱钩）", ({ repo }) => {
  repo.write("scripts/check-type-assertion-executor.cjs", DECL.repeat(19));
  repo.write(REAL_SAMPLE.reader, READER_SRC);
  writeBoth(repo, {
    entries: [
      {
        ...SAMPLE,
        reader: REAL_SAMPLE.reader,
        paths: ["scripts/check-type-assertion-executor.cjs"],
        markers: [MARKER],
        baseline: { "scripts/check-type-assertion-executor.cjs": 57 },
        verifiedSurfaces: ["judge", "normalize", "这个面根本不存在"],
      },
    ],
  });
  const { code, output } = repo.run();
  expect(code).toBe(1);
  expect(output).toContain("这个面根本不存在");
  expect(output).toContain("找不到");
});

test("①′ 声称核过的面都在读者脚本里 → 放过（正面清单不是摆设）", ({ repo }) => {
  repo.write("scripts/check-type-assertion-executor.cjs", DECL.repeat(19));
  repo.write(REAL_SAMPLE.reader, READER_SRC);
  /* 姊妹索引也要认这条 reader —— 不然先在同源核对上红掉，
   * 就看不见本用例真正要测的那一格（造变异时的常规顺序）。 */
  writeBoth(
    repo,
    {
      entries: [
        {
          ...SAMPLE,
          reader: REAL_SAMPLE.reader,
          paths: ["scripts/check-type-assertion-executor.cjs"],
          markers: [MARKER],
          baseline: { "scripts/check-type-assertion-executor.cjs": 57 },
          verifiedSurfaces: ["judge", "normalize"],
        },
      ],
    },
    { carriers: [{ id: SAMPLE.id, reader: REAL_SAMPLE.reader }] },
  );
  const { code, output } = repo.run();
  expect(code, output).toBe(0);
});

test("①′ 空数组 / 重复名字 → 阻断（写了就要核，重复是两份清单开始分叉）", ({ repo }) => {
  repo.write("scripts/check-type-assertion-executor.cjs", DECL.repeat(19));
  repo.write(REAL_SAMPLE.reader, READER_SRC);
  const base = {
    ...SAMPLE,
    reader: REAL_SAMPLE.reader,
    paths: ["scripts/check-type-assertion-executor.cjs"],
    markers: [MARKER],
    baseline: { "scripts/check-type-assertion-executor.cjs": 57 },
  };
  const empty = repo.run();
  void empty;
  writeBoth(repo, { entries: [{ ...base, verifiedSurfaces: [] }] });
  expect(repo.run().code).toBe(1);
  expect(repo.run().output).toContain("非空数组");

  writeBoth(repo, {
    entries: [{ ...base, verifiedSurfaces: ["judge", "judge"] }],
  });
  expect(repo.run().code).toBe(1);
  expect(repo.run().output).toContain("重复");
});

/* ── ① 与姊妹索引逐行同源 ──────────────────────────────────── */

test("① 姊妹索引里缺同 id 的条目 → 阻断", ({ repo }) => {
  repo.write("scripts/check-type-assertion-executor.cjs", DECL.repeat(19));
  writeBoth(
    repo,
    {
      entries: [
        {
          ...SAMPLE,
          paths: ["scripts/check-type-assertion-executor.cjs"],
          markers: [MARKER],
          baseline: { "scripts/check-type-assertion-executor.cjs": 57 },
        },
      ],
    },
    {
      carriers: [{ id: "别的条目", reader: "scripts/check-type-assertion-executor.cjs" }],
    },
  );
  const { code, output } = repo.run();
  expect(code).toBe(1);
  expect(output).toContain("没有对应条目");
});

test("① 两处的 reader 写成不同脚本 → 阻断（同源核对拦的就是这一处漂移）", ({ repo }) => {
  repo.write("scripts/check-type-assertion-executor.cjs", DECL.repeat(19));
  writeBoth(
    repo,
    {
      entries: [
        {
          ...SAMPLE,
          paths: ["scripts/check-type-assertion-executor.cjs"],
          markers: [MARKER],
          baseline: { "scripts/check-type-assertion-executor.cjs": 57 },
        },
      ],
    },
    {
      carriers: [{ id: SAMPLE.id, reader: "scripts/check-别的脚本.cjs" }],
    },
  );
  const { code, output } = repo.run();
  expect(code).toBe(1);
  expect(output).toContain("读者在两处不一致");
});

/* ── 字段完整性 ────────────────────────────────────────────── */

test("条目字段不全（缺 reader） → 阻断并点名", ({ repo }) => {
  repo.write("scripts/check-type-assertion-executor.cjs", DECL.repeat(19));
  const broken = {
    ...SAMPLE,
    reader: "",
    paths: ["scripts/check-type-assertion-executor.cjs"],
  };
  writeBoth(repo, { entries: [broken] });
  const { code, output } = repo.run();
  expect(code).toBe(1);
  expect(output).toContain("字段不全");
});

test("缺 baseline → 阻断（没有基线时零增量那一档会静默失效）", ({ repo }) => {
  repo.write("scripts/check-type-assertion-executor.cjs", DECL.repeat(19));
  writeBoth(repo, {
    entries: [
      {
        ...SAMPLE,
        paths: ["scripts/check-type-assertion-executor.cjs"],
        markers: [],
        baseline: {},
      },
    ],
  });
  const { code, output } = repo.run();
  expect(code).toBe(1);
  expect(output).toContain("缺少");
  expect(output).toContain("基线");
});

test("id 重复 → 阻断", ({ repo }) => {
  repo.write("scripts/check-type-assertion-executor.cjs", DECL.repeat(19));
  const one = {
    ...SAMPLE,
    paths: ["scripts/check-type-assertion-executor.cjs"],
    markers: [MARKER],
    baseline: { "scripts/check-type-assertion-executor.cjs": 57 },
  };
  writeBoth(repo, { entries: [one, { ...one }] });
  const { code, output } = repo.run();
  expect(code).toBe(1);
  expect(output).toContain("id 重复");
});

/* ── 判据自己不许静默降级（§11.23.3 同款） ──────────────────── */

test("台账不存在 → 判失败，不按「没有声明要查」放过", ({ repo }) => {
  repo.remove("scripts/.tsc-diagnostic-executors.json");
  const { code, output } = repo.run();
  expect(code).toBe(1);
  expect(output).toContain("不可读");
});

test("台账不是合法 JSON → 判失败", ({ repo }) => {
  repo.write("scripts/.tsc-diagnostic-executors.json", "{ 这不是 json");
  const { code, output } = repo.run();
  expect(code).toBe(1);
  expect(output).toContain("不可读");
});

test("entries 不是数组 → 判失败", ({ repo }) => {
  repo.write("scripts/.tsc-diagnostic-executors.json", JSON.stringify({ entries: {} }));
  const { code, output } = repo.run();
  expect(code).toBe(1);
  expect(output).toContain("不是数组");
});

test("空表 → 判失败（空表是最像全绿的那种失效）", ({ repo }) => {
  repo.write("scripts/.tsc-diagnostic-executors.json", JSON.stringify({ entries: [] }));
  const { code, output } = repo.run();
  expect(code).toBe(1);
  expect(output).toContain("台账是空的");
});

test("姊妹索引读不到 → 判失败，而不是跳过同源核对", ({ repo }) => {
  repo.write("scripts/check-type-assertion-executor.cjs", DECL.repeat(19));
  repo.remove("scripts/.declaration-readers.json");
  writeBoth(repo, {
    entries: [
      {
        ...SAMPLE,
        paths: ["scripts/check-type-assertion-executor.cjs"],
        markers: [MARKER],
        baseline: { "scripts/check-type-assertion-executor.cjs": 57 },
      },
    ],
  });
  repo.remove("scripts/.declaration-readers.json");
  const { code, output } = repo.run();
  expect(code).toBe(1);
  expect(output).toContain("姊妹索引不存在");
});

/* ── 扫描规则本身：声明行的识别口径 ────────────────────────── */

test("声明行只认 JSDoc 类型位与 TS 声明头，字符串里的不算站点", ({ repo }) => {
  /* 夹具字符串里的 `@param {string}` 若是被算成站点，计数就会随文案变化 ——
   * 而「声明落后于实现」这条判据里，文案与实现是两件事（§11.18.3.1 同款取舍）。 */
  repo.write(
    "scripts/check-type-assertion-executor.cjs",
    'const fixture = "@param {string} nope";\n/** 不是类型位的一行 */\n' +
      "// export function commented() {}\n" +
      "// @param {number} 注释里的类型位\n" +
      DECL.repeat(18) +
      // 只补 1 行声明：撇掉注释行、夹具字符串与那一行裸 `const fixture`
      // 之后，总数必须仍然落在 57 那一条基线上。
      "export const y = 2;\n",
  );
  writeBoth(repo, {
    entries: [
      {
        ...SAMPLE,
        paths: ["scripts/check-type-assertion-executor.cjs"],
        markers: [MARKER],
        baseline: { "scripts/check-type-assertion-executor.cjs": 57 },
      },
    ],
  });
  const { code, output } = repo.run();
  expect(code, output).toBe(0);
});

/* ── `--update` 只许降不许升 ───────────────────────────────── */

test("--update 收紧变短的基线 → 退 0 且真的写回台账", ({ repo }) => {
  repo.write("scripts/check-type-assertion-executor.cjs", DECL.repeat(10)); // 30 行
  writeBoth(repo, {
    entries: [
      {
        ...SAMPLE,
        paths: ["scripts/check-type-assertion-executor.cjs"],
        markers: [MARKER],
        baseline: { "scripts/check-type-assertion-executor.cjs": 57 },
      },
    ],
  });
  const { code } = repo.run(["--update"]);
  expect(code).toBe(0);
  const written = /* SAFETY: 类型断言已复核 */ JSON.parse(
    repo.read("scripts/.tsc-diagnostic-executors.json"),
  ) as { entries: Array<{ baseline: Record<string, number> }> };
  expect(written.entries[0]!.baseline["scripts/check-type-assertion-executor.cjs"]).toBe(30);
});

test("--update 遇到基线**上涨**时拒绝写入并退 2", ({ repo }) => {
  repo.write("scripts/check-type-assertion-executor.cjs", DECL.repeat(20)); // 60 行
  writeBoth(repo, {
    entries: [
      {
        ...SAMPLE,
        paths: ["scripts/check-type-assertion-executor.cjs"],
        markers: [MARKER],
        baseline: { "scripts/check-type-assertion-executor.cjs": 57 },
      },
    ],
  });
  const { code, output } = repo.run(["--update"]);
  expect(code).toBe(2);
  expect(output).toContain("只许降不许升");
  /* 台账必须原样不动 —— 「顺手把上涨记进基线」正是零增量那一档的失效形态。 */
  const written = /* SAFETY: 类型断言已复核 */ JSON.parse(
    repo.read("scripts/.tsc-diagnostic-executors.json"),
  ) as { entries: Array<{ baseline: Record<string, number> }> };
  expect(written.entries[0]!.baseline["scripts/check-type-assertion-executor.cjs"]).toBe(57);
});

/* ── 真仓库自查：盘面够不够、仓库现状是否绿 ────────────────── */

test("真台账非空、且真仓库判绿", async () => {
  expect(REAL_LEDGER.entries.length).toBeGreaterThanOrEqual(8);
  /* 真仓库那一次走「本判据在真根上真跑」—— 临时仓库里没有那一批真文件，
   * 判绿的语义只有真仓上才成立（同 `a11y-rules-gate.test.ts` 的取舍）。 */
  const { execFileSync } = await import("node:child_process");
  const out = execFileSync(
    process.execPath,
    [path.join(REAL_ROOT, "scripts", "check-tsc-diagnostic-executors.cjs")],
    { cwd: REAL_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  expect(out).toContain("执行者都在场");
});
