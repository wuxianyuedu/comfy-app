import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  FIXED_STRUCTURAL_TESTS,
  isSourcePath,
  isTestPath,
  resolveAffectedTests,
  specCandidates,
} from "../scripts/affected-tests.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

/** 夹具：`files` 是「仓库相对路径 → 内容」；测试文件当输出候选，其余当 import 图节点。 */
function harness(files: Record<string, string>) {
  const keys = Object.keys(files);
  const testFiles = keys.filter(isTestPath);
  const sourceFiles = keys.filter(isSourcePath);
  return (changedPaths: string[]) =>
    resolveAffectedTests({
      changedPaths,
      testFiles,
      sourceFiles,
      readText: (rel: string) => files[rel] ?? null,
    });
}

const UI_TEST = "src/components/ui/hint.test.tsx";
const UI_SRC = "src/components/ui/hint.tsx";

describe("affected-tests：路径判据", () => {
  it("只认 vitest include 的那两个目录里的 .test.ts(x)", () => {
    expect(isTestPath("src/a/b/x.test.ts")).toBe(true);
    expect(isTestPath("tests/x.test.tsx")).toBe(true);
    expect(isTestPath("src/x.ts")).toBe(false);
    expect(isTestPath("scripts/x.test.ts")).toBe(false);
    expect(isTestPath("e2e/x.spec.ts")).toBe(false);
  });

  it("相对说明符按**引用方所在文件**解析，不是按仓库根", () => {
    // 这一条是判据里最容易写错的地方：拿仓库根当基准时，`../util/helper`
    // 会解析到根外面去，于是「改了被相对 import 的模块」整类静默漏跑。
    const from = "src/deep/x/one.test.ts";
    expect(specCandidates("../util/helper", from)).toContain(
      "src/deep/util/helper.ts",
    );
    expect(specCandidates("./sibling", from)).toContain(
      "src/deep/x/sibling.ts",
    );
  });

  it("别名 ~/ 与 @/ 都落到 src/，裸包名不解析", () => {
    expect(specCandidates("~/lib/foo", UI_TEST)).toContain("src/lib/foo.ts");
    expect(specCandidates("@/lib/foo", UI_TEST)).toContain("src/lib/foo.ts");
    expect(specCandidates("~/lib", UI_TEST)).toContain("src/lib/index.ts");
    expect(specCandidates("vitest", UI_TEST)).toEqual([]);
  });
});

describe("affected-tests：五条命中判据", () => {
  it("① 改动的测试文件自身一定跑", () => {
    const run = harness({ [UI_TEST]: "it('x', () => {});" });
    expect(run([UI_TEST]).tests).toContain(UI_TEST);
  });

  it("② 改源码跑它的兄弟测试（含 .tsx 源码，不能拼成 x.tsx.test.ts）", () => {
    const run = harness({
      [UI_SRC]: "export const a = 1;",
      [UI_TEST]: "import { a } from '~/components/ui/hint';",
    });
    expect(run([UI_SRC]).tests).toContain(UI_TEST);
  });

  it("②' 快照文件按其宿主测试算", () => {
    const run = harness({
      "src/app/page.test.tsx": "it('x', () => {});",
      "src/app/__snapshots__/page.test.tsx.snap": "exports[`x`] = `1`;",
    });
    expect(run(["src/app/__snapshots__/page.test.tsx.snap"]).tests).toContain(
      "src/app/page.test.tsx",
    );
  });

  it("③ 反向 import 闭包：静态 / 动态 / vi.mock 都算消费", () => {
    // 夹具里 `vi.mock` 的说明符必须是**真实存在**的模块：全库门禁
    // `tests/test-mock-targets.test.ts` 会扫所有测试源码里的字面量 mock 目标，
    // 写个假路径它会直接把钩子拦下（本层自己的用例也在它的扫描面里）。
    const run = harness({
      "src/lib/clamp.ts": "export const clamp = 1;",
      "src/a/static.test.ts": "import { clamp } from '~/lib/clamp';",
      "src/a/dyn.test.ts": "const m = await import('~/lib/clamp');",
      "src/a/mock.test.ts": "vi.mock('~/lib/clamp', () => ({}));",
      "src/a/unrelated.test.ts": "import os from 'node:os';",
    });
    const tests = run(["src/lib/clamp.ts"]).tests;
    expect(tests).toContain("src/a/static.test.ts");
    expect(tests).toContain("src/a/dyn.test.ts");
    expect(tests).toContain("src/a/mock.test.ts");
    expect(tests).not.toContain("src/a/unrelated.test.ts");
  });

  it("③' 传递依赖：测试 → 组件 → 改动的文件，两跳也要抓到", () => {
    // 视图层的常态就是这个形状。只走一跳时改 `leaf.ts` 会解析出「受影响 0 个
    // 用例」，那句「改到哪、测到哪」就成了空话 —— 本条钉住闭包。
    const run = harness({
      "src/a/leaf.ts": "export const leaf = 1;",
      "src/a/panel.tsx": "import { leaf } from '~/a/leaf';",
      "src/a/panel.test.tsx": "import { Panel } from '~/a/panel';",
      "src/a/other.test.tsx": "import { Other } from '~/a/other';",
    });
    const res = run(["src/a/leaf.ts"]);
    expect(res.tests).toContain("src/a/panel.test.tsx");
    expect(res.tests).not.toContain("src/a/other.test.tsx");
    expect(res.reasons["src/a/panel.test.tsx"]).toContain("2 跳");
  });

  it("③'' barrel 只在「出口真的转出去」时才算消费（不是同目录就拉进来）", () => {
    const run = harness({
      "src/lib/core/index.ts":
        "export * from './errors';\nexport * from './impl';",
      "src/lib/core/impl.ts": "export const a = 1;",
      "src/lib/core/hidden.ts": "export const b = 2;",
      "src/x/uses-barrel.test.ts": "import { a } from '~/lib/core';",
    });
    // `impl` 被 index 转出去 → 改它要跑用 barrel 的那个测试
    expect(run(["src/lib/core/impl.ts"]).tests).toContain(
      "src/x/uses-barrel.test.ts",
    );
    // `hidden` 没被转出去 → 按图就该不算它（同目录不是消费关系）
    expect(run(["src/lib/core/hidden.ts"]).tests).not.toContain(
      "src/x/uses-barrel.test.ts",
    );
    // 改 barrel 自己也照样算
    expect(run(["src/lib/core/index.ts"]).tests).toContain(
      "src/x/uses-barrel.test.ts",
    );
  });

  it("③''' 被删掉的文件不在索引清单里，它的消费方仍要被拉进来", () => {
    // `git ls-files` 读的是索引：暂存删除之后这个路径已经查无此文件，
    // 而「谁还 import 着它」正是这次改动最直接的破坏面 —— 图按键建、
    // 不按「目标是否存在」过滤，就是为了这一条。
    const run = harness({
      "src/a/consumer.test.ts": "import { gone } from '~/lib/gone';",
    });
    expect(run(["src/lib/gone.ts"]).tests).toContain("src/a/consumer.test.ts");
  });

  it("④ 路径以字面量出现（门禁起子进程、按路径读资源）与脚本同名回归", () => {
    const run = harness({
      "scripts/check-x.cjs": "console.log(1);",
      "tests/check-x.test.ts": "execFileSync(process.execPath, [SCRIPT]);",
      "src/a/spawn.test.ts":
        'execFileSync(process.execPath, ["scripts/check-x.cjs"]);',
      "src/a/plain.test.ts": "it('x', () => {});",
    });
    const res = run(["scripts/check-x.cjs"]);
    expect(res.tests).toContain("src/a/spawn.test.ts");
    expect(res.tests).toContain("tests/check-x.test.ts");
    expect(res.tests).not.toContain("src/a/plain.test.ts");
    expect(res.reasons["src/a/spawn.test.ts"]).toContain("按路径引用");
  });
});

describe("affected-tests：兜底方向", () => {
  it("公共地基被改 → 明确放弃收窄，且理由写在 __note 里", () => {
    const run = harness({ [UI_TEST]: "it('x', () => {});" });
    const res = run(["vitest.config.ts", UI_SRC]);
    expect(res.mode).toBe("all");
    expect(res.reasons.__note).toContain("全局测试配置");
    // 放弃收窄时**不**把受影响面塞进去 —— 那正是本层判定不了的部分。
    expect(res.tests).toEqual([...FIXED_STRUCTURAL_TESTS].sort());
  });

  it("只改文档 → 仍然只跑固定清单，结果永不为空", () => {
    // 空集是最危险的形态：`vitest run` 不带位置参数=跑全量，
    // 于是「一次改 README 的提交」会变成「等十分钟并捡到别线的红」。
    const run = harness({ [UI_TEST]: "it('x', () => {});" });
    const res = run(["docs/README.md"]);
    expect(res.mode).toBe("subset");
    expect(res.tests.length).toBeGreaterThan(0);
    expect(res.tests).toEqual([...FIXED_STRUCTURAL_TESTS].sort());
  });

  it("改动清单为空 → 同样只给固定清单", () => {
    const res = resolveAffectedTests({
      changedPaths: [],
      testFiles: [UI_TEST],
      sourceFiles: [],
      readText: () => null,
    });
    expect(res.tests).toEqual([...FIXED_STRUCTURAL_TESTS].sort());
  });
});

describe("affected-tests：与仓库现状的漂移守卫", () => {
  it("固定清单里每个文件都真实存在", () => {
    // 用例改名/删掉时，写死的清单会**静默**不再守任何东西 —— 这条就是拦这个。
    const missing = FIXED_STRUCTURAL_TESTS.filter(
      (rel) => !fs.existsSync(path.join(ROOT, rel)),
    );
    expect(missing).toEqual([]);
  });

  it("isTestPath 与 vitest.config.ts 的 include 仍是同一口径", () => {
    const cfg = fs.readFileSync(path.join(ROOT, "vitest.config.ts"), "utf8");
    expect(cfg).toContain('"src/**/*.test.{ts,tsx}"');
    expect(cfg).toContain('"tests/**/*.test.{ts,tsx}"');
  });

  it("真跑一遍：仓库真实 import 图上的两个形状", () => {
    const tracked = ["src", "tests", "scripts", "tools"].flatMap((dir) =>
      fs
        .readdirSync(path.join(ROOT, dir), { recursive: true })
        .map((p) => `${dir}/${String(p).replace(/\\/g, "/")}`),
    );
    const testFiles = tracked.filter(isTestPath);
    const sourceFiles = tracked.filter(isSourcePath);
    expect(testFiles).toContain(UI_TEST);
    const run = (changedPaths: string[]) =>
      resolveAffectedTests({
        changedPaths,
        testFiles,
        sourceFiles,
        readText: (rel) => {
          try {
            return fs.readFileSync(path.join(ROOT, rel), "utf8");
          } catch {
            return null;
          }
        },
      });

    // ① 一跳：改基元跑它自己的用例
    const hint = run([UI_SRC]);
    expect(hint.mode).toBe("subset");
    expect(hint.tests).toContain(UI_TEST);

    // ② 两跳：改日志筛选条，用例在「渲染整块面板」那一层 —— 只走一跳的解析器
    // 在这里会给出「受影响 0 个用例」，本条就是把它拽回真实形状。
    const bar = run(["src/components/studio/logs/LogFilterBar.tsx"]);
    expect(bar.tests).toContain("src/components/studio/logs/LogPanel.test.tsx");
  });
});
