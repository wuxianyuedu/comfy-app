/**
 * 提交门槛自检：把 `scripts/check-barrel-heavy-deps.cjs` 当黑盒跑在临时工作区上，
 * 验证「入口的**静态**可达图里不许出现重依赖」这条规范（§12.19 / 02 §2.9）
 * 真的会阻断提交，而不是只写在文档里。
 *
 * 规范：docs/standards/12-代码组织与文件结构.md §12.19、
 *       docs/standards/02-性能规范.md §2.9
 *
 * ## 为什么这条判据必须有「它真的会响」的负例
 *
 * 本判据的三格（静态边 / `import type` 不算边 / `import()` 不算边）都是**解析口径**，
 * 而解析口径写错时的表现是**永远绿**——判据看着在、结论恒为「没问题」。本仓已经
 * 栽过同族（`ui/file-picker.tsx` 的门槛写着 100、报告里查无此文件；`core/index` 的
 * `export *` 承诺与现状相反）。所以下面每一格都配一个正例 + 一个负例：
 *
 *   · 静态 `import` 一条重依赖的模块 → 红（且报告要给出整条链）；
 *   · `import type` 同一条 → **绿**（类型边编译后不存在；不排除它判据会长期假阳性）；
 *   · `React.lazy(() => import("…"))` 同一条 → **绿**（懒加载正是本判据要的行为）；
 *   · 登记入口不存在 → 红（登记项静默失效是这一类清单最典型的死法）。
 */
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { defineGateRepo, describe } from "./helpers/gate-repo";

/* 判据脚本被 pre-commit 以 `node scripts/xxx.cjs` 调用，且内部用 `process.cwd()`
 * 定位扫描根 —— 临时工作区与 `run` / `write` 由 `tests/helpers/gate-repo.ts` 提供。
 * 登记清单（`.barrel-heavy-deps.json`）与脚本同目录、是它的**真实输入**，
 * 所以必须一起搬进工作区，否则跑起来读不到配置（表现是 exit 2，像「门禁坏了」）。 */
const SCRIPT = join(process.cwd(), "scripts", "check-barrel-heavy-deps.cjs");

const { test, expect } = defineGateRepo({
  script: "check-barrel-heavy-deps.cjs",
  dir: "root",
  dirs: ["src/app", "src/components"],
  copy: [{ from: "scripts/.barrel-heavy-deps.json", to: "scripts/.barrel-heavy-deps.json" }],
});

/** 把登记清单换成「一个入口 + 一条重依赖 + 一条必须懒加载的模块」。 */
function seedConfig(repo: { write: (rel: string, s: string) => void }) {
  repo.write(
    "scripts/.barrel-heavy-deps.json",
    JSON.stringify({
      entries: ["src/app/entry.tsx"],
      heavyDeps: ["@xyflow/react"],
      lazyMustBeDynamicFromEntry: [],
    }),
  );
}

/** 三个文件的常态：入口静静态 import 中转层，中转层 import 一个便宜的模块。 */
function seedCheapChain(repo: {
  write: (rel: string, s: string) => void;
}) {
  repo.write("src/app/entry.tsx", 'import { mid } from "~/components/mid";\nexport const e = mid;\n');
  repo.write("src/components/mid.ts", 'import { leaf } from "./leaf";\nexport const mid = leaf;\n');
  repo.write("src/components/leaf.ts", "export const leaf = 1;\n");
}

describe("check-barrel-heavy-deps.cjs（提交门槛）", () => {
  test("没有重依赖的世界：放行", ({ repo }) => {
    seedConfig(repo);
    seedCheapChain(repo);
    const { code, output } = repo.run();
    expect(code).toBe(0);
    expect(output).toContain("入口静态图里没有重依赖");
  });

  /* ── ① 静态边：判据的本体（也正是本条的立案现场）──────────────────────── */
  test("静态可达的重依赖被阻断，且报告给出整条链", ({ repo }) => {
    seedConfig(repo);
    seedCheapChain(repo);
    /* 把「便宜的叶子」换成「import 了画布引擎的叶子」—— 入口离它两跳。 */
    repo.write(
      "src/components/leaf.ts",
      'import { ReactFlow } from "@xyflow/react";\nexport const leaf = ReactFlow;\n',
    );
    const { code, output } = repo.run();
    expect(code).toBe(1);
    expect(output).toContain("src/components/leaf.ts");
    expect(output).toContain("@xyflow/react");
    /* 链必须逐跳打出来 —— 「红了但不知道谁拉的」等于没判据。 */
    expect(output).toContain("src/app/entry.tsx");
    expect(output).toContain("src/components/mid.ts");
  });

  /* ── ② `import type` 不是边：这条格写错 = 判据长期假阳性 ──────────────── */
  test("纯类型 import 不算静态边（编译后擦除，不是运行时依赖）", ({ repo }) => {
    seedConfig(repo);
    seedCheapChain(repo);
    /* · `leaf` 静态可达，但它对重依赖只有**类型**关系 —— 编译后一条边都不剩；
     * · `type-only-heavy` 整个文件只被类型引用（`import type`），所以它自己
     *   也不该进静态图。两条口径各覆盖一格。 */
    repo.write(
      "src/components/leaf.ts",
      'import type { ReactFlowProps } from "@xyflow/react";\n' +
        "export const leaf = 1;\nexport type P = ReactFlowProps;\n",
    );
    repo.write(
      "src/components/type-only-heavy.ts",
      'import type { ReactFlowProps } from "@xyflow/react";\nexport type Q = ReactFlowProps;\n',
    );
    const { code, output } = repo.run();
    expect(code, `纯类型 import 被当成静态边了：\n${output}`).toBe(0);
  });

  /* ── ③ `import()` 不是边：懒加载正是本判据要的行为 ───────────────────── */
  test("懒加载（import()）不算静态边 —— 重依赖模块不在静态图里", ({ repo }) => {
    seedConfig(repo);
    seedCheapChain(repo);
    /* 重依赖只出现在**懒加载**的目标里：`lazy-heavy.ts` 不在静态图上，所以
     * 判据根本不该看到 `@xyflow/react`。叶子那边照旧是纯的。 */
    repo.write(
      "src/components/lazy-heavy.ts",
      'export async function load() {\n  return import("@xyflow/react");\n}\n',
    );
    const { code, output } = repo.run();
    expect(code, `import() 被当成静态边了：\n${output}`).toBe(0);
  });

  test("React.lazy 包装层也不算静态边（实测过的那一格）", ({ repo }) => {
    seedConfig(repo);
    seedCheapChain(repo);
    /* `React.lazy(() => import("x").then(...))` —— 文本里出现 `import`、
     * 又出现 `from`（比如下面同一文件里另有一句真静态 import）。早期解析器用
     * `[^;]*?from` 跨过括号去配对，会把懒加载那句也吃成静态边。 */
    repo.write(
      "src/components/lazy-heavy.ts",
      'import React from "react";\n' +
        'export const Lazy = React.lazy(() =>\n' +
        '  import("@xyflow/react").then((m) => ({ default: m.ReactFlow })),\n);\n',
    );
    const { code, output } = repo.run();
    expect(code, `React.lazy 里的 import() 被当成静态边了：\n${output}`).toBe(0);
  });

  /* ── ④ 必须懒加载的模块清单 ──────────────────────────────────────────── */
  test("静态可达的「必须懒加载」模块被阻断", ({ repo }) => {
    seedConfig(repo);
    seedCheapChain(repo);
    repo.write(
      "scripts/.barrel-heavy-deps.json",
      JSON.stringify({
        entries: ["src/app/entry.tsx"],
        heavyDeps: [],
        lazyMustBeDynamicFromEntry: ["src/components/leaf.ts"],
      }),
    );
    const { code, output } = repo.run();
    expect(code).toBe(1);
    expect(output).toContain("必须懒加载");
    expect(output).toContain("src/components/leaf.ts");
  });

  /* ── ⑤ 登记项自身的失效 ─────────────────────────────────────────────── */
  test("登记为入口的文件不存在时判红（登记项静默失效是最典型的死法）", ({
    repo,
  }) => {
    seedConfig(repo);
    seedCheapChain(repo);
    repo.remove("src/app/entry.tsx");
    const { code, output } = repo.run();
    expect(code).toBe(1);
    expect(output).toContain("不存在");
  });

  test("--json 给机器读的结论（reports + findings）", ({ repo }) => {
    seedConfig(repo);
    seedCheapChain(repo);
    repo.write(
      "src/components/leaf.ts",
      'import { ReactFlow } from "@xyflow/react";\nexport const leaf = ReactFlow;\n',
    );
    const { code, output } = repo.run(["--json"]);
    expect(code).toBe(1);
    const parsed = /* SAFETY: 类型断言已复核 */ JSON.parse(output) as {
      reports: { entry: string; reachable: number }[];
      findings: { entry: string; module: string; dep?: string; chain?: string[] }[];
    };
    expect(parsed.reports[0]?.entry).toBe("src/app/entry.tsx");
    expect(parsed.reports[0]?.reachable).toBeGreaterThan(0);
    expect(parsed.findings[0]?.module).toBe("src/components/leaf.ts");
    expect(parsed.findings[0]?.dep).toBe("@xyflow/react");
    expect(parsed.findings[0]?.chain).toContain("src/app/entry.tsx");
  });

  /* ── 真实仓库：判据在**当前**源码上必须是绿的（这就是日常那一档）──────── */
  test("真实仓库：入口静态图当前无重依赖", () => {
    const result = execFileSync(process.execPath, [SCRIPT], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    expect(result).toContain("入口静态图里没有重依赖");
  });
});
