/**
 * `scripts/check-gate-thresholds.cjs` 的判据（ISSUE #2156）。
 *
 * 这一格守的是「放宽判据这件事本身」，所以用例必须能喂**假账 + 假源码**跑出来：
 * 真仓里的数值只能证明"今天一致"，证明不了「方向反了会不会红」—— 而那恰恰是这本账
 * 唯一的技术难点（A 档越大越松、B 档越小越危险，`strictness` 记错一条就会把收紧判成放宽）。
 * 因此 `analyze()` 是纯函数，这里全走它；末了两条再拿真仓自证一次。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { analyze, isLooser, num } from "../scripts/check-gate-thresholds.cjs";

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
  masterEntries: Map<string, unknown> | null = null,
) =>
  analyze({
    entries,
    readSource: sources(over),
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
    expect(r.problems.some((p: string) => p.includes("找不到该常量声明"))).toBe(
      true,
    );
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
      "scripts/check-a.cjs":
        "const SPLIT_LINES = 900;\nconst NEW_GATE_LIMIT = 42;\n",
    });
    const hit = r.problems.find((p: string) => p.includes("NEW_GATE_LIMIT"));
    expect(hit, "未入账的新承重数值没被拦").toContain("report");
  });

  it("相对主干是放宽而账上没签字 ⇒ 红；写了 movedFrom + movedIssue ⇒ 放行", () => {
    const master = new Map([
      ["scripts/check-a.cjs#SPLIT_LINES", { value: 900, kind: "threshold" }],
    ]);
    const loose = patch(baseEntries(), "scripts/check-a.cjs", { value: 1500 });
    const unsigned = run(
      loose,
      { "scripts/check-a.cjs": "const SPLIT_LINES = 1500;\n" },
      master,
    );
    expect(
      unsigned.problems.some((p: string) => p.includes("相对主干是**放宽**")),
    ).toBe(true);

    const signed = patch(loose, "scripts/check-a.cjs", {
      movedFrom: 900,
      movedIssue: "#2156",
    });
    const okRun = run(
      signed,
      { "scripts/check-a.cjs": "const SPLIT_LINES = 1500;\n" },
      master,
    );
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
    const r = run(
      loose,
      { "scripts/check-a.cjs": "const SPLIT_LINES = 1500;\n" },
      master,
    );
    expect(r.problems.some((p: string) => p.includes("放宽"))).toBe(true);
  });
});

describe("真仓自证：这本账现在必须与源码一致", () => {
  it("账里每条都能在源码里定位到，且数值相等", () => {
    const root = path.resolve(__dirname, "..");
    const ledger = JSON.parse(
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
