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
import { existsSync } from "node:fs";
import { join } from "node:path";
import { defineGateRepo, describe, type GateRepo } from "./helpers/gate-repo";

const { test, expect } = defineGateRepo({
  script: "check-ui-logic-separation.cjs",
});

const BASELINE_REL = "scripts/.ui-logic-baseline.json";

/** 今天真仓库的基线形状：治理做完了，`total: 0 / files: {}`。 */
function writeBaseline(
  repo: GateRepo,
  files: Record<string, Record<string, number>>,
  total = 0,
): void {
  repo.write(
    BASELINE_REL,
    JSON.stringify(
      { generatedAt: "2026-09-04", rules: {}, total, files },
      null,
      2,
    ),
  );
}

/** 在工作区里放一个文件（自动建父目录）。 */
function put(repo: GateRepo, rel: string, body: string): void {
  repo.write(rel, body);
}

/** 读回基线 —— 形状固定，标出来要的是「按基线形状用」，不是把规则关掉。 */
function readBaseline(repo: GateRepo): {
  total: number;
  files: Record<string, Record<string, number>>;
} {
  return JSON.parse(repo.read(BASELINE_REL)) as {
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
  test("S1 裸 fetch / S2 vanillaApi / S3 tRPC hook 各认一条，合计 3 并阻断", ({
    repo,
  }) => {
    writeBaseline(repo, {});
    put(repo, "src/components/Probe.tsx", DIRTY);
    const r = repo.run();
    expect(r.code).toBe(1);
    expect(r.output).toContain("当前违规合计 3 处，涉及 1 个文件");
    for (const id of ["S1", "S2", "S3"])
      expect(r.output).toContain(`新违规 ${id}`);
  });

  test("Route Handler / hooks/ / 测试文件三类豁免都不计入", ({ repo }) => {
    writeBaseline(repo, {});
    put(
      repo,
      "src/app/api/x/route.ts",
      "export const R = () => fetch('/z');\n",
    );
    put(
      repo,
      "src/components/feat/hooks/useH.tsx",
      "export const H = () => fetch('/y');\n",
    );
    put(
      repo,
      "src/components/Fe.test.tsx",
      "export const T = () => fetch('/t');\n",
    );
    const r = repo.run();
    expect(r.output).toContain("当前违规合计 0 处");
    expect(r.code).toBe(0);
  });

  test("`src/lib` 引 React 是硬规则 H2，棘轮为 0 也拦", ({ repo }) => {
    writeBaseline(repo, {});
    put(
      repo,
      "src/lib/LibThing.ts",
      'import { useState } from "react";\nexport const L = () => useState(1);\n',
    );
    const r = repo.run();
    expect(r.code).toBe(1);
    expect(r.output).toContain("H2 src/lib 内禁止 React");
  });

  test("内联 async（S4）只提示、不计入棘轮 —— 不因为提示就红", ({ repo }) => {
    writeBaseline(repo, {});
    // 匹配式是 `= async(`，所以写成赋值形式的异步处理器（JSX 里的 `={async () => …}`
    // 中间夹着 `{`，不是这条提示要抓的形状）。
    put(
      repo,
      "src/components/Btn.tsx",
      "export function B() {\n  const onClick = async () => {};\n  return onClick;\n}\n",
    );
    const r = repo.run();
    expect(r.code).toBe(0);
    expect(r.output).toContain("内联 async 处理器（仅提示，不计入棘轮）");
    expect(r.output).toContain("内联 async 1 处");
    expect(r.output).not.toContain("违规（阻断）");
  });

  test("注释里写的 fetch( 也计入：宁多报不漏报（去注释会造假绿）", ({
    repo,
  }) => {
    // 这不是笔误而是取向：#1192 量过「裸的全局去行尾注释会造假绿」
    // （`const url = "http://a"; wfParam();` 被剥完就消失）。
    // 对这条棘轮，多报是几分钟解释成本，漏报是硬规则 10 失守。
    writeBaseline(repo, {});
    put(
      repo,
      "src/components/Note.tsx",
      "// 治理时别直接写 fetch(x)，要走 hooks\nexport const A = 1;\n",
    );
    const r = repo.run();
    expect(r.code).toBe(1);
    expect(r.output).toContain("新违规 S1");
  });
});

describe("检查路径的三种红", () => {
  test("基线文件缺失：判红并指路 --update（不能当「没有违规」）", ({
    repo,
  }) => {
    expect(existsSync(join(repo.dir, BASELINE_REL))).toBe(false);
    const r = repo.run();
    expect(r.code).toBe(1);
    expect(r.output).toContain("基线文件缺失");
    expect(r.output).toContain("--update");
  });

  test("计数上升：报出「上升 1 → 2」而不是只说「有违规」", ({ repo }) => {
    writeBaseline(repo, { "src/components/A.tsx": { S1: 1 } }, 1);
    put(
      repo,
      "src/components/A.tsx",
      "export const A = () => { fetch('/a'); fetch('/b'); };\n",
    );
    const r = repo.run();
    expect(r.code).toBe(1);
    expect(r.output).toContain("S1 上升 1 → 2 → src/components/A.tsx");
  });

  test("下降未收紧：非 --strict 只提示，--strict（pre-commit 用的那个）判红", ({
    repo,
  }) => {
    writeBaseline(repo, { "src/components/A.tsx": { S1: 2 } }, 2);
    put(repo, "src/components/A.tsx", "export const A = () => fetch('/a');\n");
    const loose = repo.run();
    expect(loose.code).toBe(0);
    expect(loose.output).toContain("检测到 1 处下降，请收紧基线");
    expect(loose.output).toContain("当前非 --strict，仅提示");
    const strict = repo.run(["--strict"]);
    expect(strict.code).toBe(1);
    expect(strict.output).toContain("S1 2 → 1：src/components/A.tsx");
  });
});

describe("--update 的门：放宽一律不收（ISSUE #1359 的主案）", () => {
  test("基线总数为 0 时新增违规：拒绝（旧版在这里 0 → 1 静默收下）", ({
    repo,
  }) => {
    writeBaseline(repo, {});
    put(repo, "src/components/A.tsx", "export const A = () => fetch('/x');\n");
    const r = repo.run(["--update"]);
    expect(r.code).toBe(1);
    expect(r.output).toContain("拒绝把放宽写进基线");
    expect(r.output).toContain("新增 S1");
    // 拒绝之后基线必须还是空的 —— 否则「红」和「已经写进去了」同时发生
    expect(readBaseline(repo).files).toEqual({});
  });

  test("同总数换文件（修掉 A 同时新写 B）也拒绝：基线按 (文件, 指标) 记账，不按总数", ({
    repo,
  }) => {
    writeBaseline(repo, { "src/components/A.tsx": { S1: 1 } }, 1);
    put(repo, "src/components/B.tsx", "export const B = () => fetch('/y');\n");
    const r = repo.run(["--update"]);
    expect(r.code).toBe(1);
    expect(r.output).toContain("拒绝把放宽写进基线");
    expect(r.output).toContain("src/components/B.tsx");
    expect(readBaseline(repo).files).toEqual({
      "src/components/A.tsx": { S1: 1 },
    });
  });

  test("真下降：收下并写盘（棘轮只许降，不是禁止 --update）", ({ repo }) => {
    writeBaseline(repo, { "src/components/A.tsx": { S1: 1 } }, 1);
    put(repo, "src/components/A.tsx", "export const A = 1;\n");
    const r = repo.run(["--update"]);
    expect(r.code).toBe(0);
    expect(r.output).toContain("基线已更新：1 → 0");
    expect(readBaseline(repo).files).toEqual({});
    expect(readBaseline(repo).total).toBe(0);
  });

  test("首次建基线（文件不存在）：允许 —— 那是记账起点，不是放宽", ({
    repo,
  }) => {
    put(repo, "src/components/A.tsx", "export const A = 1;\n");
    const r = repo.run(["--update"]);
    expect(r.code).toBe(0);
    expect(existsSync(join(repo.dir, BASELINE_REL))).toBe(true);
  });

  test("存在硬规则违规时拒绝 --update（不能把 H2 也一并记进基线）", ({
    repo,
  }) => {
    writeBaseline(repo, {});
    put(
      repo,
      "src/lib/LibThing.ts",
      'import { useState } from "react";\nexport const L = () => useState(1);\n',
    );
    const r = repo.run(["--update"]);
    expect(r.code).toBe(1);
    expect(r.output).toContain("存在硬规则违规，先修再更新基线");
    expect(readBaseline(repo).files).toEqual({});
  });
});
