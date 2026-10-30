/**
 * `scripts/check-gate-thresholds.cjs` 的判据（ISSUE #2156）。
 *
 * 这一格守的是「放宽判据这件事本身」，所以用例必须能喂**假账 + 假源码**跑出来：
 * 真仓里的数值只能证明"今天一致"，证明不了「方向反了会不会红」—— 而那恰恰是这本账
 * 唯一的技术难点（A 档越大越松、B 档越小越危险，`strictness` 记错一条就会把收紧判成放宽）。
 * 因此 `analyze()` 是纯函数，这里全走它；末了两条再拿真仓自证一次。
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { analyze, isLooser, num } from "../scripts/check-gate-thresholds.cjs";
import { gateChainScripts } from "../scripts/gate-chain-scripts.cjs";

/** 账里一条的形状（`group` / `movedFrom` / `movedIssue` 都是可选位）。 */
type Entry = {
  file: string;
  const: string;
  value: number;
  kind: string;
  strictness?: string;
  unit?: string;
  group?: string;
  movedFrom?: number;
  movedIssue?: string;
};

/** 一条 A 档阻断阈值 + 一条 B 档地板 + 一条 report，构成最小可判的账。 */
const baseEntries = (): Entry[] => [
  {
    file: "scripts/check-a.cjs",
    const: "SPLIT_LINES",
    value: 900,
    kind: "threshold",
    strictness: "larger-is-looser",
    unit: "行",
  },
  {
    file: "scripts/check-b.cjs",
    const: "MIN_DUTIES",
    value: 5,
    kind: "floor",
    strictness: "smaller-is-looser",
  },
  {
    file: "scripts/check-c.cjs",
    const: "PROBE_TIMEOUT_MS",
    value: 10000,
    kind: "report",
    strictness: "n/a",
  },
];

/**
 * 按 `file` 定点改一条。刻意不写下标访问：`noUncheckedIndexedAccess` 下
 * `entries[0]` 是 `Entry | undefined`，而这里的用例点名的都是唯一的那条。
 */
const patch = (list: Entry[], file: string, over: Partial<Entry>): Entry[] =>
  list.map((e) => (e.file === file ? { ...e, ...over } : e));

/** 按账造一份源码：默认与账一致，`over` 里点名的那条改成别的值。 */
function sources(over: Record<string, string> = {}) {
  const src: Record<string, string> = {
    "scripts/check-a.cjs": "const SPLIT_LINES = 900;\n",
    "scripts/check-b.cjs": "const MIN_DUTIES = 5;\n",
    "scripts/check-c.cjs": "const PROBE_TIMEOUT_MS = 10_000;\n",
  };
  for (const [k, v] of Object.entries(over)) src[k] = v;
  return (f: string) => src[f] ?? null;
}

const run = (
  entries: Entry[],
  over: Record<string, string> = {},
  masterEntries: Map<string, { value: number }> | null = null,
) =>
  analyze({
    entries,
    readSource: sources(over),
    // 主干那份账只被读 `value` 这一格 ⇒ 判据收的是 ReadonlyMap，这里不必再 cast 一次。
    masterEntries,
    minEntries: 1,
  });

describe("num：源码里的数值分隔写法要归成数字", () => {
  it("`10_000` 与 `0.75` 都读得出来", () => {
    expect(num("10_000")).toBe(10000);
    expect(num("0.75")).toBe(0.75);
  });
});

describe("analyze：账 ⇄ 源码", () => {
  it("一致时不红（默认那份假账就是绿的）", () => {
    const r = run(baseEntries());
    expect(r.problems).toEqual([]);
  });

  it("负控制①：源码把阈值调松而账没跟 ⇒ 红，且话术点名「变松」", () => {
    const r = run(baseEntries(), {
      "scripts/check-a.cjs": "const SPLIT_LINES = 1500;\n",
    });
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toContain("变松（放宽判据）");
    expect(r.problems[0]).toContain("movedFrom");
  });

  it("负控制②：源码调严而账没跟 ⇒ 也红（「顺手复原」同样要显形）", () => {
    const r = run(baseEntries(), {
      "scripts/check-a.cjs": "const SPLIT_LINES = 800;\n",
    });
    expect(r.problems[0]).toContain("变严");
  });

  it("方向逐条记：floor 那条**变小**才是变松（A 档的规则套上去会判反）", () => {
    expect(isLooser({ strictness: "smaller-is-looser" }, 5, 3)).toBe(true);
    expect(isLooser({ strictness: "smaller-is-looser" }, 5, 9)).toBe(false);
    const r = run(baseEntries(), {
      "scripts/check-b.cjs": "const MIN_DUTIES = 1;\n",
    });
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toContain("变松");
  });

  it("report 那一档漂移只报不拦：探测预算不该让这条判据红", () => {
    const r = run(baseEntries(), {
      "scripts/check-c.cjs": "const PROBE_TIMEOUT_MS = 5_000;\n",
    });
    expect(r.problems).toEqual([]);
    expect(r.notes.some((n: string) => n.includes("只报不拦"))).toBe(true);
  });

  it("负控制③：改名 / 搬走判据文件 ⇒ 红 —— 不能按「一致」念", () => {
    const r = run(baseEntries(), {
      "scripts/check-a.cjs": "const SPLIT_LINES_X = 900;\n",
    });
    expect(r.problems.some((p: string) => p.includes("找不到该常量声明"))).toBe(true);
  });

  it("负控制④：提取坏了（账被清空）⇒ 红，而不是两侧空集的恒绿", () => {
    const r = run([]);
    expect(r.problems.some((p: string) => p.includes("下限"))).toBe(true);
  });
});

describe("analyze：组内同数、未入账、相对主干签字", () => {
  it("同组只改一把尺子 ⇒ 红（半边失效）", () => {
    const entries = patch(baseEntries(), "scripts/check-a.cjs", {
      group: "r5",
    });
    const second: Entry = {
      file: "scripts/check-d.cjs",
      const: "SPLIT_LINES",
      value: 900,
      kind: "threshold",
      strictness: "larger-is-looser",
      group: "r5",
    };
    const r = analyze({
      entries: [...entries, second],
      readSource: sources({
        "scripts/check-d.cjs": "const SPLIT_LINES = 800;\n",
      }),
      minEntries: 1,
    });
    expect(r.problems.some((p: string) => p.includes("要求同数"))).toBe(true);
  });

  it("判据文件里冒出账上没有的顶层数值 ⇒ 红，并给出两条出路", () => {
    const r = run(baseEntries(), {
      "scripts/check-a.cjs": "const SPLIT_LINES = 900;\nconst NEW_GATE_LIMIT = 42;\n",
    });
    const hit = r.problems.find((p: string) => p.includes("NEW_GATE_LIMIT"));
    expect(hit, "未入账的新承重数值没被拦").toContain("report");
  });

  it("相对主干是放宽而账上没签字 ⇒ 红；写了 movedFrom + movedIssue ⇒ 放行", () => {
    const master = new Map([
      ["scripts/check-a.cjs#SPLIT_LINES", { value: 900, kind: "threshold" }],
    ]);
    const loose = patch(baseEntries(), "scripts/check-a.cjs", { value: 1500 });
    const unsigned = run(loose, { "scripts/check-a.cjs": "const SPLIT_LINES = 1500;\n" }, master);
    expect(unsigned.problems.some((p: string) => p.includes("相对主干是**放宽**"))).toBe(true);

    const signed = patch(loose, "scripts/check-a.cjs", {
      movedFrom: 900,
      movedIssue: "#2156",
    });
    const okRun = run(signed, { "scripts/check-a.cjs": "const SPLIT_LINES = 1500;\n" }, master);
    expect(
      okRun.problems.some((p: string) => p.includes("相对主干是**放宽**")),
      "签了字还在拦，等于把这条路堵死",
    ).toBe(false);
  });

  it("负控制：签字形状不对（movedIssue 写成裸数字）⇒ 仍然红", () => {
    const master = new Map([
      ["scripts/check-a.cjs#SPLIT_LINES", { value: 900, kind: "threshold" }],
    ]);
    const loose = patch(
      patch(baseEntries(), "scripts/check-a.cjs", { value: 1500 }),
      "scripts/check-a.cjs",
      { movedFrom: 900, movedIssue: "2156" },
    );
    const r = run(loose, { "scripts/check-a.cjs": "const SPLIT_LINES = 1500;\n" }, master);
    expect(r.problems.some((p: string) => p.includes("放宽"))).toBe(true);
  });
});

/* ── 扫描根来自磁盘，不是从账里推（ISSUE #2188）──────────────────────────
 *
 * 这三条判的是「这条判据自己会不会漏看一份文件」，所以它们比上面那些更脆：
 * 只测「账里点名的文件」时，一份整体没入账的新判据永远不在循环里 —— 那种漏
 * 表现为绿，没有任何一条红会指向它。三条各钉一个方向：红 / 补一条就绿 /
 * **不给扫描根时测不到**（最后那条是变异证明：它证明「面从磁盘来」这件事承重，
 * 而不是断言恰好被别的路径顺带满足了）。
 */
describe("analyze：整份未入账的判据文件（扫描根 = 磁盘现算）", () => {
  /** 一份账上完全没有的新判据文件，里面只有一个顶层具名数值。 */
  const NEW_FILE = "scripts/check-brand-new.cjs";
  const newFileSources = () => ({
    [NEW_FILE]: "const LIMIT = 42;\n",
  });
  const withNewFile = (over: Record<string, string> = {}) =>
    sources({ ...newFileSources(), ...over });

  it("含顶层数值而账里一条都没有 ⇒ 红，点名那份文件与数名", () => {
    const r = analyze({
      entries: baseEntries(),
      readSource: withNewFile(),
      minEntries: 1,
      scanFiles: [...Object.keys(newFileSources()), "scripts/check-a.cjs"],
    });
    const hit = r.problems.find(
      (p: string) => p.includes("check-brand-new") && p.includes("LIMIT"),
    );
    expect(hit, "整份未入账的新判据没被拦").toContain("一条都没有");
    /* 只报数名、不报数值：数值要在账里才对读者可见。 */
    expect(hit).not.toContain("42");
  });

  it("出路真的能走通：给它补一条 report 条目 ⇒ 绿", () => {
    const entries: Entry[] = [
      ...baseEntries(),
      {
        file: NEW_FILE,
        const: "LIMIT",
        value: 42,
        kind: "report",
        strictness: "n/a",
      },
    ];
    const r = analyze({
      entries,
      readSource: withNewFile(),
      minEntries: 1,
      scanFiles: [NEW_FILE, "scripts/check-a.cjs"],
    });
    expect(r.problems, r.problems.join("\n")).toEqual([]);
  });

  it("变异自证：不给扫描根（退回旧那半张面孔）⇒ 那份文件压根不被扫", () => {
    const r = analyze({
      entries: baseEntries(),
      readSource: withNewFile(),
      minEntries: 1,
    });
    expect(
      r.problems.some((p: string) => p.includes("check-brand-new")),
      "输入面若仍从账里推，这一格就测不到 —— 上面两条会一起变成恒绿",
    ).toBe(false);
  });

  it("自指面在扫描根里，且真仓在这张面上今天全绿", () => {
    const root = path.resolve(__dirname, "..");
    const ledger = /* SAFETY: 类型断言已复核 */ JSON.parse(
      readFileSync(path.join(root, "scripts/.gate-thresholds.json"), "utf8"),
    ) as { entries: Entry[] };
    /* glob 写错的失效形态是「面为空 ⇒ 整格恒绿」，所以这里按磁盘自己数一遍：
       扫描根必须非空、必须含这份判据自己（`MIN_ENTRIES` 那条自证的下限在账里），
       否则「覆盖面」这句话只是断言里的一个装饰。 */
    const scanned = readdirSync(path.join(root, "scripts"))
      .filter((n) => /^check-.*\.cjs$/.test(n))
      .map((n) => `scripts/${n}`);
    expect(scanned.length).toBeGreaterThan(10);
    expect(scanned).toContain("scripts/check-gate-thresholds.cjs");
    const r = analyze({
      entries: ledger.entries,
      readSource: (f: string) => {
        try {
          return readFileSync(path.join(root, f), "utf8");
        } catch {
          return null;
        }
      },
      masterEntries: new Map(),
      scanFiles: scanned,
    });
    expect(r.problems, r.problems.join("\n")).toEqual([]);
  });
});

/* ── `export const` 也在覆盖面内（ISSUE #2236）───────────────────────────────
 *
 * 「一条阈值承不承重」与「它被不被别的文件 import」是两件事。旧写法的两处正则都只认
 * 行首 `const`，于是 `export const` 形态整体在面外 —— 本仓自己先撞上：新常量先写成
 * `export const`，账一个字都没念它，改成非导出才进得来。
 * 两处消费必须同一把尺子：只放宽扫面会造出「这份文件被扫到了，但账上那条找不到」这种
 * 自相矛盾的红；只放宽取值则永远不会新抓到东西。所以三个方向各测一次。
 */
describe("账的覆盖面：export 前缀不是挡箭牌", () => {
  const NEW_FILE = "scripts/check-exported-gate.cjs";
  const entry: Entry = {
    file: NEW_FILE,
    const: "GATE_LIMIT",
    value: 42,
    kind: "threshold",
    strictness: "larger-is-looser",
  };
  const runWith = (src: string, entries: Entry[]) =>
    analyze({
      entries,
      readSource: sources({ [NEW_FILE]: src }),
      minEntries: 1,
      scanFiles: [NEW_FILE, "scripts/check-a.cjs"],
    });

  it("未入账的 `export const` ⇒ 红并点名那个数", () => {
    const r = runWith("export const GATE_LIMIT = 42;\n", baseEntries());
    expect(
      r.problems.some((p: string) => p.includes("GATE_LIMIT")),
      "`export const` 形态的阈值仍在面外（#2236 那一格）",
    ).toBe(true);
  });

  it("已入账的它被改大 ⇒ 漂移红且念成「变松」（取值那一路也认 export）", () => {
    const r = runWith("export const GATE_LIMIT = 90;\n", [...baseEntries(), entry]);
    const drift = r.problems.find((p: string) => p.includes("GATE_LIMIT"));
    expect(drift, "取值不认 export 时，放宽后的面会恒红").toBeTruthy();
    expect(drift).toContain("源码 90 ≠ 账 42");
    expect(drift).toContain("变松");
  });

  it("账与源码一致时不许有红（同一把尺子的第三向）", () => {
    const r = runWith("export const GATE_LIMIT = 42;\n", [...baseEntries(), entry]);
    expect(r.problems, r.problems.join("\n")).toEqual([]);
  });
});

describe("真仓自证：这本账现在必须与源码一致", () => {
  it("账里每条都能在源码里定位到，且数值相等", () => {
    const root = path.resolve(__dirname, "..");
    const ledger = /* SAFETY: 类型断言已复核 */ JSON.parse(
      readFileSync(path.join(root, "scripts/.gate-thresholds.json"), "utf8"),
    ) as { entries: Entry[] };
    const r = analyze({
      entries: ledger.entries,
      readSource: (f: string) => {
        try {
          return readFileSync(path.join(root, f), "utf8");
        } catch {
          return null;
        }
      },
      // 主干上还没有这本账（第一次落地），签字那一判用空账比 = 只跑本机这几判。
      masterEntries: new Map(),
    });
    expect(r.problems, r.problems.join("\n")).toEqual([]);
    expect(ledger.entries.length).toBeGreaterThanOrEqual(15);
  });
});

describe("扫描根：门禁链按名字调起的判定脚本也要进面（ISSUE #2383）", () => {
  const root = path.resolve(__dirname, "..");
  const chain = new Set(gateChainScripts());

  it("共享实现只有一份：两个消费方都 require gate-chain-scripts.cjs（§12.12）", () => {
    for (const consumer of [
      "scripts/check-gate-executors.cjs",
      "scripts/check-gate-thresholds.cjs",
    ]) {
      expect(
        readFileSync(path.join(root, consumer), "utf8"),
        `${consumer} 应当从 gate-chain-scripts.cjs 取链`,
      ).toContain('require("./gate-chain-scripts.cjs")');
    }
  });

  it("名字不叫 check- 的链上判据在扫描根里（#1444 残活 A / #1451 的那两份）", () => {
    expect(chain.has("shell-gate.mjs")).toBe(true);
    expect(chain.has("storybook-check.mjs")).toBe(true);
    /* 链上的每份脚本都应被 scanJudgeFiles 收进 —— 用真仓的判定脚本入口跑一遍，
     * 断的是「扩面之后链外没有藏带顶层数值的判据」这一格由共享实现保证。 */
    const filesToScan = new Set([
      ...[...chain].map((n) => `scripts/${n}`),
      ...readdirSync(path.join(root, "scripts"))
        .filter((f) => /^check-.*\.cjs$/.test(f))
        .map((f) => `scripts/${f}`),
    ]);
    expect(filesToScan.has("scripts/shell-gate.mjs")).toBe(true);
    expect(filesToScan.has("scripts/check-file-structure.cjs")).toBe(true);
  });
});
