/**
 * `scripts/check-ui-logic-separation.cjs`（AGENTS 硬规则 10 的执行者）。ISSUE #1811 收尾时从棘轮翻成硬闸：
 * S* 存量清零，`--update` / `--strict` 与基线文件已删（连带 #1359 的「0 基线短路」门），故用例判「命中即退 1」。
 * 同 `check-code-duplication`：复制进一次性 workspace 的 `scripts/` 再 `execFileSync`，绝不往真 `src/` 种文件（并行会话共用检出）。
 */
import { defineGateRepo, describe, type GateRepo } from "./helpers/gate-repo";

const { test, expect } = defineGateRepo({
  script: "check-ui-logic-separation.cjs",
});

/** 在工作区里放一个文件（自动建父目录）。 */
function put(repo: GateRepo, rel: string, body: string): void {
  repo.write(rel, body);
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
  test("S1 裸 fetch / S2 vanillaApi / S3 tRPC hook 各认一条，合计 3 并阻断", ({ repo }) => {
    put(repo, "src/components/Probe.tsx", DIRTY);
    const r = repo.run();
    expect(r.code).toBe(1);
    expect(r.output).toContain("违规 3 处 · 1 个文件");
    for (const id of ["S1", "S2", "S3"]) {
      expect(r.output).toContain(id);
    }
  });

  test("Route Handler / hooks/ / 测试文件三类豁免都不计入", ({ repo }) => {
    put(repo, "src/app/api/x/route.ts", "export const R = () => fetch('/z');\n");
    put(repo, "src/components/feat/hooks/useH.tsx", "export const H = () => fetch('/y');\n");
    put(repo, "src/components/Fe.test.tsx", "export const T = () => fetch('/t');\n");
    const r = repo.run();
    expect(r.output).toContain("[ok] UI/逻辑分离");
    expect(r.code).toBe(0);
  });

  test("`src/lib` 引 React 是硬规则 H2", ({ repo }) => {
    put(
      repo,
      "src/lib/LibThing.ts",
      'import { useState } from "react";\nexport const L = () => useState(1);\n',
    );
    const r = repo.run();
    expect(r.code).toBe(1);
    expect(r.output).toContain("H2 src/lib 内禁止 React");
  });

  test("内联 async（S4）只提示、不计入 —— 不因为提示就红", ({ repo }) => {
    // 匹配式是 `= async(`，所以写成赋值形式的异步处理器（JSX 里的 `={async () => …}`
    // 中间夹着 `{`，不是这条提示要抓的形状）。
    put(
      repo,
      "src/components/Btn.tsx",
      "export function B() {\n  const onClick = async () => {};\n  return onClick;\n}\n",
    );
    const r = repo.run();
    expect(r.code).toBe(0);
    expect(r.output).toContain("内联 async 处理器（仅提示，不计入）");
    expect(r.output).toContain("内联 async 1 处");
    expect(r.output).not.toContain("违规（阻断）");
  });

  test("注释里写的 fetch( 也计入：宁多报不漏报（去注释会造假绿）", ({ repo }) => {
    // 这不是笔误而是取向：#1192 量过「裸的全局去行尾注释会造假绿」
    // （`const url = "http://a"; wfParam();` 被剥完就消失）。
    // 对这条判据，多报是几分钟解释成本，漏报是硬规则 10 失守。
    put(
      repo,
      "src/components/Note.tsx",
      "// 治理时别直接写 fetch(x)，要走 hooks\nexport const A = 1;\n",
    );
    const r = repo.run();
    expect(r.code).toBe(1);
    expect(r.output).toContain("S1");
  });
});

describe("检查路径（硬闸）", () => {
  test("命中即退 1，且不需要任何基线文件在场", ({ repo }) => {
    put(repo, "src/components/A.tsx", "export const A = () => fetch('/a');\n");
    const r = repo.run();
    expect(r.code).toBe(1);
    expect(r.output).toContain("S1");
    expect(r.output).toContain("src/components/A.tsx");
  });

  test("合规时放行（反向：判据不是恒红）", ({ repo }) => {
    put(repo, "src/components/A.tsx", "export const A = 1;\n");
    const r = repo.run();
    expect(r.code).toBe(0);
    expect(r.output).toContain("[ok] UI/逻辑分离");
  });

  test("翻硬闸后 --update / --strict 是断头的（不许有隐藏放宽通道）", ({ repo }) => {
    /* 少了这一格，「删了 --update」与「--update 还在但没人调」看起来一样。
     * 这里刻意留一处**违规**：两个旗标都不得把它判绿，也不得落盘任何基线。 */
    put(repo, "src/components/A.tsx", "export const A = () => fetch('/x');\n");
    for (const flag of ["--update", "--strict"]) {
      const r = repo.run([flag]);
      expect(r.code, `${flag} 不该放行违规`).toBe(1);
      /* 出路不该是执行 `--update`：判据的输出里只该有「本判据是硬闸
       * （无基线、无 --update）」这半句声明，不该给出把 `--update` 当下一步的指示。 */
      expect(r.output, `${flag} 的出路不该指向 --update`).not.toContain(
        "执行 node scripts/check-ui-logic-separation.cjs --update",
      );
    }
  });
});
