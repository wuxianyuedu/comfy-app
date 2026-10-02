/**
 * `scripts/check-ui-logic-separation.cjs`（AGENTS 硬规则 10 的执行者）。
 *
 * 这条门禁挂在 `.githooks/pre-commit:107` 上跑 `--strict`，此前**零用例引用**
 * （`grep -rl "check-ui-logic-separation" tests/` = 0），而实测下来这个空格是有代价的：
 * `--update` 的上升检查写成 `if (before && after > before)` —— 基线总数为 0 时整个条件短路，
 * 上升检查根本不执行。真仓库的基线今天正是 `total: 0 / files: {}`（治理做完之后的状态），
 * 于是「往视图层新写一条 `fetch(` 再跑一次 `--update`」能把它收进基线。本文件把那扇门钉死，
 * 同时把此前从没被执行过的判决一次补齐。
 *
 * 形状照 `tests/check-code-duplication.test.ts`：脚本按 `__dirname/..` 定扫描根，所以把它
 * **复制进一次性 workspace 的 `scripts/`** 再 `execFileSync` —— 绝不往真仓库的 `src/` 里种文件
 * （本机有并行会话共用同一份检出，一瞬间的探针文件会喂给别人的 pre-commit）。
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = join(process.cwd(), "scripts", "check-ui-logic-separation.cjs");
const BASELINE_REL = join("scripts", ".ui-logic-baseline.json");

let workdir = "";

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "ui-logic-gate-"));
  mkdirSync(join(workdir, "scripts"), { recursive: true });
  copyFileSync(
    SCRIPT,
    join(workdir, "scripts", "check-ui-logic-separation.cjs"),
  );
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

/** 今天真仓库的基线形状：治理做完了，`total: 0 / files: {}`。 */
function writeBaseline(
  files: Record<string, Record<string, number>>,
  total = 0,
): void {
  writeFileSync(
    join(workdir, BASELINE_REL),
    JSON.stringify(
      { generatedAt: "2026-09-04", rules: {}, total, files },
      null,
      2,
    ),
    "utf8",
  );
}

function put(rel: string, body: string): void {
  const full = join(workdir, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body, "utf8");
}

function run(args: string[] = []): { code: number; output: string } {
  try {
    const output = execFileSync(
      process.execPath,
      [join(workdir, "scripts", "check-ui-logic-separation.cjs"), ...args],
      { cwd: workdir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return { code: 0, output };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return {
      code: typeof e.status === "number" ? e.status : 1,
      output: `${e.stdout ?? ""}${e.stderr ?? ""}`,
    };
  }
}

function readBaseline(): {
  total: number;
  files: Record<string, Record<string, number>>;
} {
  // `JSON.parse` 给 `any`，直接 return 会被 `no-unsafe-return` 拦 —— 标出来要的是
  // 「读回来的东西确实按基线形状用」，不是把规则关掉。
  return JSON.parse(readFileSync(join(workdir, BASELINE_REL), "utf8")) as {
    total: number;
    files: Record<string, Record<string, number>>;
  };
}

/** 三条指标各一条，写在同一个视图文件里。 */
const DIRTY = `export function C() {
  const a = fetch("/api/x");
  const b = vanillaApi.posts.list;
  const c = api.posts.list.useQuery();
  return [a, b, c];
}
`;

describe("三条指标与三类豁免（此前从未被执行过）", () => {
  it("S1 裸 fetch / S2 vanillaApi / S3 tRPC hook 各认一条，合计 3 并阻断", () => {
    writeBaseline({});
    put("src/components/Probe.tsx", DIRTY);
    const r = run();
    expect(r.code).toBe(1);
    expect(r.output).toContain("当前违规合计 3 处，涉及 1 个文件");
    for (const id of ["S1", "S2", "S3"])
      expect(r.output).toContain(`新违规 ${id}`);
  });

  it("Route Handler / hooks/ / 测试文件三类豁免都不计入", () => {
    writeBaseline({});
    put("src/app/api/x/route.ts", "export const R = () => fetch('/z');\n");
    put(
      "src/components/feat/hooks/useH.tsx",
      "export const H = () => fetch('/y');\n",
    );
    put("src/components/Fe.test.tsx", "export const T = () => fetch('/t');\n");
    const r = run();
    expect(r.output).toContain("当前违规合计 0 处");
    expect(r.code).toBe(0);
  });

  it("`src/lib` 引 React 是硬规则 H2，棘轮为 0 也拦", () => {
    writeBaseline({});
    put(
      "src/lib/LibThing.ts",
      'import { useState } from "react";\nexport const L = () => useState(1);\n',
    );
    const r = run();
    expect(r.code).toBe(1);
    expect(r.output).toContain("H2 src/lib 内禁止 React");
  });

  it("内联 async（S4）只提示、不计入棘轮 —— 不因为提示就红", () => {
    writeBaseline({});
    // 匹配式是 `= async(`，所以写成赋值形式的异步处理器（JSX 里的 `={async () => …}`
    // 中间夹着 `{`，不是这条提示要抓的形状）。
    put(
      "src/components/Btn.tsx",
      "export function B() {\n  const onClick = async () => {};\n  return onClick;\n}\n",
    );
    const r = run();
    expect(r.code).toBe(0);
    expect(r.output).toContain("内联 async 处理器（仅提示，不计入棘轮）");
    expect(r.output).toContain("内联 async 1 处");
    expect(r.output).not.toContain("违规（阻断）");
  });

  it("注释里写的 fetch( 也计入：宁多报不漏报（去注释会造假绿）", () => {
    // 这不是笔误而是取向：#1192 量过「裸的全局去行尾注释会造假绿」
    // （`const url = "http://a"; wfParam();` 被剥完就消失）。
    // 对这条棘轮，多报是几分钟解释成本，漏报是硬规则 10 失守。
    writeBaseline({});
    put(
      "src/components/Note.tsx",
      "// 治理时别直接写 fetch(x)，要走 hooks\nexport const A = 1;\n",
    );
    const r = run();
    expect(r.code).toBe(1);
    expect(r.output).toContain("新违规 S1");
  });
});

describe("检查路径的三种红", () => {
  it("基线文件缺失：判红并指路 --update（不能当「没有违规」）", () => {
    expect(existsSync(join(workdir, BASELINE_REL))).toBe(false);
    const r = run();
    expect(r.code).toBe(1);
    expect(r.output).toContain("基线文件缺失");
    expect(r.output).toContain("--update");
  });

  it("计数上升：报出「上升 1 → 2」而不是只说「有违规」", () => {
    writeBaseline({ "src/components/A.tsx": { S1: 1 } }, 1);
    put(
      "src/components/A.tsx",
      "export const A = () => { fetch('/a'); fetch('/b'); };\n",
    );
    const r = run();
    expect(r.code).toBe(1);
    expect(r.output).toContain("S1 上升 1 → 2 → src/components/A.tsx");
  });

  it("下降未收紧：非 --strict 只提示，--strict（pre-commit 用的那个）判红", () => {
    writeBaseline({ "src/components/A.tsx": { S1: 2 } }, 2);
    put("src/components/A.tsx", "export const A = () => fetch('/a');\n");
    const loose = run();
    expect(loose.code).toBe(0);
    expect(loose.output).toContain("检测到 1 处下降，请收紧基线");
    expect(loose.output).toContain("当前非 --strict，仅提示");
    const strict = run(["--strict"]);
    expect(strict.code).toBe(1);
    expect(strict.output).toContain("S1 2 → 1：src/components/A.tsx");
  });
});

describe("--update 的门：放宽一律不收（ISSUE #1359 的主案）", () => {
  it("基线总数为 0 时新增违规：拒绝（旧版在这里 0 → 1 静默收下）", () => {
    writeBaseline({});
    put("src/components/A.tsx", "export const A = () => fetch('/x');\n");
    const r = run(["--update"]);
    expect(r.code).toBe(1);
    expect(r.output).toContain("拒绝把放宽写进基线");
    expect(r.output).toContain("新增 S1");
    // 拒绝之后基线必须还是空的 —— 否则「红」和「已经写进去了」同时发生
    expect(readBaseline().files).toEqual({});
  });

  it("同总数换文件（修掉 A 同时新写 B）也拒绝：基线按 (文件, 指标) 记账，不按总数", () => {
    writeBaseline({ "src/components/A.tsx": { S1: 1 } }, 1);
    put("src/components/B.tsx", "export const B = () => fetch('/y');\n");
    const r = run(["--update"]);
    expect(r.code).toBe(1);
    expect(r.output).toContain("拒绝把放宽写进基线");
    expect(r.output).toContain("src/components/B.tsx");
    expect(readBaseline().files).toEqual({ "src/components/A.tsx": { S1: 1 } });
  });

  it("真下降：收下并写盘（棘轮只许降，不是禁止 --update）", () => {
    writeBaseline({ "src/components/A.tsx": { S1: 1 } }, 1);
    put("src/components/A.tsx", "export const A = 1;\n");
    const r = run(["--update"]);
    expect(r.code).toBe(0);
    expect(r.output).toContain("基线已更新：1 → 0");
    expect(readBaseline().files).toEqual({});
    expect(readBaseline().total).toBe(0);
  });

  it("首次建基线（文件不存在）：允许 —— 那是记账起点，不是放宽", () => {
    put("src/components/A.tsx", "export const A = 1;\n");
    const r = run(["--update"]);
    expect(r.code).toBe(0);
    expect(existsSync(join(workdir, BASELINE_REL))).toBe(true);
  });

  it("存在硬规则违规时拒绝 --update（不能把 H2 也一并记进基线）", () => {
    writeBaseline({});
    put(
      "src/lib/LibThing.ts",
      'import { useState } from "react";\nexport const L = () => useState(1);\n',
    );
    const r = run(["--update"]);
    expect(r.code).toBe(1);
    expect(r.output).toContain("存在硬规则违规，先修再更新基线");
    expect(readBaseline().files).toEqual({});
  });
});
