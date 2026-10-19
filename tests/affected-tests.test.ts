import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  attributeAffected,
  buildImportedBy,
  isSourcePath,
  isTestPath,
  resolveAffectedTests,
  specCandidates,
  wideFallbackNote,
} from "../scripts/affected-tests.mjs";
import { FIXED_STRUCTURAL_TESTS } from "../scripts/fixed-structural-tests.mjs";
/* #2022：固定清单里开了输入面那几条在增量档会缺席，所以本文件凡是「比整表」的断言
 * 都改成比「该跑的那些」—— 用同一个选择函数，而不是在测试里再抄一遍那 4 个名字。 */
import { selectFixedByFace } from "../scripts/fixed-gate-input-faces.mjs";
import { KNOWN_FAILED_FILES } from "../scripts/quality-gate-shared.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

/** 夹具：`files` 是「仓库相对路径 → 内容」；测试文件当输出候选，其余当 import 图节点。 */
function harness(
  files: Record<string, string>,
  opts: { knownFailed?: string[] } = {},
) {
  const keys = Object.keys(files);
  const testFiles = keys.filter(isTestPath);
  const sourceFiles = keys.filter(isSourcePath);
  return (changedPaths: string[]) =>
    resolveAffectedTests({
      changedPaths,
      testFiles,
      sourceFiles,
      knownFailed: opts.knownFailed,
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

  /**
   * wide 话术里那句「为什么不兜底跑全量」（ISSUE #1393）。
   *
   * 旧文本写「全量当前带别线基线红」，而重测下来真断言红是 0 条 —— 假前提每遇到一次
   * wide 提交就当着重印，就会变成所有人不动兜底的默认解释，所以它跟判据一样要有执行者。
   * 两条一起看：第一条钉文本内容，第二条钉「CLI 真的在打印这个函数」，
   * 否则第一条只是在守一段死代码。
   */
  it("wide 话术只写实测的拦路石，不许回到「带别线基线红」那句假前提", () => {
    const note = wideFallbackNote("门槛自身", 20);
    expect(note).toContain("32m35s"); // 耗时：wide 那档跑全量的实测墙钟
    expect(note).toContain("空参数"); // 机制：钩子刻意不接受「空参数=全跑」
    expect(note).not.toContain("基线红"); // 旧假前提不许回潮
    expect(note).toContain("§13.5.8");
  });

  it("这段话说明确实由 CLI 打印（导出了却没人调用 = 第一条在守死代码）", () => {
    const r = spawnSync(
      process.execPath,
      ["scripts/affected-tests.mjs", "--changed", "vitest.config.ts"],
      { cwd: ROOT, encoding: "utf8" },
    );
    expect(r.status).toBe(0);
    // 断言「后半句逐字同源」：清单条数与放弃原因都由 CLI 自己算，这里不抄常量。
    const tail = wideFallbackNote("X", 0)
      .split("只跑固定清单 0 个。")[1]
      ?.trim();
    expect(tail, "话术构造函数自己变了形").toBeTruthy();
    expect(r.stderr).toContain("放弃收窄");
    expect(r.stderr).toContain(tail ?? "");
  });

  it("只改文档 → 跑「固定清单里该跑的那些」，结果永不为空", () => {
    // 空集是最危险的形态：`vitest run` 不带位置参数=跑全量，
    // 于是「一次改 README 的提交」会变成「等十分钟并捡到别线的红」。
    const run = harness({ [UI_TEST]: "it('x', () => {});" });
    const res = run(["docs/README.md"]);
    expect(res.mode).toBe("subset");
    expect(res.tests.length).toBeGreaterThan(0);
    /* 与 #2022 之前唯一的差别：开了输入面那几条（现在是 4 条工具自检）在面没命中时
     * 缺席 —— 且**必须**在 `__faceSkipped` 里点名，所以这里比的是「该跑的那些」而不是
     * 整表。整表那条不变量挪到上面 wide 那一档（不过筛）与
     * `tests/fixed-gate-input-faces.test.ts`（名单封闭 + 每条都在固定清单里）。 */
    expect(res.tests).toEqual(
      selectFixedByFace(FIXED_STRUCTURAL_TESTS, ["docs/README.md"]).keep.sort(),
    );
    expect(String(res.reasons.__faceSkipped)).toContain("tests/base-check");
  });

  /**
   * 边④「按路径引用」的比对面必须是**剥注释之后**的代码文本（ISSUE #2022）。
   *
   * 这一条挡的是本仓自己造出来、又被自己踩中的形态：硬规则 15 要求门禁自测在文件头
   * 引用规范章节，于是「注释里写着这份文档的路径」与「运行期读了这份文档」在原文里
   * 逐字同形。实测只提交文档时，`docs/standards/13-提交与-code-review.md` 一个路径
   * 把 7 份门禁自测拉进增量面（上次账本逐文件读数合计 480.7s：`check-reformat-only`
   * 278.9s、`check-bundle-budget` 101.2s、`check-format` 52.0s…），而那七份里没有一份
   * 在运行期读那份 `.md` —— 「改到哪、测到哪」被反向用成了「改一句注释就陪跑九分钟」。
   */
  it("边④：注释里的路径引用不算消费方（文档提交不再陪跑门禁自测）", () => {
    const run = harness({
      [UI_TEST]:
        "/* 规范：docs/standards/13-提交与-code-review.md §13.5 */\nit('x', () => {});\n",
    });
    const res = run(["docs/standards/13-提交与-code-review.md"]);
    expect(res.reasons[UI_TEST]).toBeUndefined();
  });

  it("边④：同一份路径写在代码字面量里仍然命中（剥注释不许把真消费剥没）", () => {
    // 上两条合起来才钉住方向：只判「注释不命中」的话，把整个 ④ 删掉也能过。
    const run = harness({
      [UI_TEST]:
        "/* 规范：docs/standards/13-提交与-code-review.md */\nconst p = 'docs/standards/13-提交与-code-review.md';\nit('x', () => p);\n",
    });
    const res = run(["docs/standards/13-提交与-code-review.md"]);
    expect(res.reasons[UI_TEST]).toContain("按路径引用");
  });

  it("已知基线红只从增量面剔除，固定清单与其余受影响用例照跑", () => {
    const RED = "src/a/other-line-red.test.ts";
    const run = harness(
      {
        "src/a/leaf.ts": "export const leaf = 1;",
        "src/a/green.test.ts": "import { leaf } from '~/a/leaf';",
        [RED]: "import { leaf } from '~/a/leaf';",
      },
      { knownFailed: [RED] },
    );
    const res = run(["src/a/leaf.ts"]);
    expect(res.tests).toContain("src/a/green.test.ts");
    expect(res.tests).not.toContain(RED);
    // 剔除必须留痕：调用方（钩子）把它打印出来，不静默。
    expect(res.reasons.__skipped).toContain(RED);
    /* 同样按「该跑的那些」比：`src/a/leaf.ts` 不落在任何一条输入面里（面是各判各的，
     * 见 `tests/fixed-gate-input-faces.test.ts`），所以那几条工具自检此刻本就缺席。 */
    for (const fixed of selectFixedByFace(FIXED_STRUCTURAL_TESTS, [
      "src/a/leaf.ts",
    ]).keep)
      expect(res.tests).toContain(fixed);
  });

  it("固定清单里的文件就算被登记为基线红也不剔除", () => {
    // 那几条是全库不变量的唯一执行者，没有「先放行」的余地。
    const pinned = "tests/single-logger-channel.test.ts";
    expect(FIXED_STRUCTURAL_TESTS).toContain(pinned);
    const run = harness(
      { [UI_TEST]: "it('x', () => {});" },
      { knownFailed: [pinned] },
    );
    expect(run(["docs/README.md"]).tests).toContain(pinned);
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

  it("登记的已知基线红指向真实存在的文件", () => {
    // 写错一个路径 = 这一条**永远命中不了**，于是它挡住的东西悄悄放行，而清单看着
    // 还在。机制本身静默失效比少一条登记更难查，所以按存在性钉住。
    const missing = KNOWN_FAILED_FILES.filter(
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

describe("affected-tests：改动的**面**归因（拆小的那把尺）", () => {
  /** 夹具同 `harness`，但额外给出图 —— 归因要的是同一份 `importedBy`。 */
  function attrHarness(files: Record<string, string>) {
    const keys = Object.keys(files);
    const testFiles = keys.filter(isTestPath);
    const sourceFiles = keys.filter(isSourcePath);
    const readText = (rel: string) => files[rel] ?? null;
    const graph = buildImportedBy(
      new Set([...sourceFiles, ...testFiles]),
      readText,
    );
    return {
      graph,
      testFiles,
      sourceFiles,
      attribute: (changed: string[]) =>
        attributeAffected(changed, graph, testFiles, sourceFiles),
      resolve: (changed: string[]) =>
        resolveAffectedTests({
          changedPaths: changed,
          testFiles,
          sourceFiles,
          readText,
          graph,
        }),
    };
  }

  it("逐文件归因的数与主链**同一个量纲** —— 同一份输入两边必须相等", () => {
    // 这是本组最该钉住的一条：归因曾经是**照抄一份**判定（闭包 + 兄弟 + 路径引用），
    // 结果三个文件都多报一两份（「按路径引用」那一档在主链里只对增量面里尚未被其他
    // 原因选中的测试生效）。多报看着无害，实际是给了一条**对不上账**的建议。
    // 只断「归因有数」拦不住这种漂移 —— 必须逐文件与主链对拍。
    const files = {
      "src/lib/hub.ts": "export const h = 1;\n",
      "src/lib/hub.test.ts": "import { h } from '../../lib/hub';\n",
      "src/components/ui/wide.tsx": "export const W = 1;\n",
      "src/components/ui/wide.test.tsx": "import { W } from './wide';\n",
      "src/components/studio/panel.tsx":
        "import { W } from '../ui/wide';\nexport const P = W;\n",
      "src/components/studio/panel.test.tsx": "import { P } from './panel';\n",
    };
    const { attribute, resolve } = attrHarness(files);
    const changed = ["src/lib/hub.ts", "src/components/ui/wide.tsx"];
    const byFile = attribute(changed);
    for (const entry of byFile) {
      const alone = resolve([entry.file]);
      const affected = alone.tests.filter(
        (t) => !FIXED_STRUCTURAL_TESTS.includes(t),
      ).length;
      expect(entry.affected, `${entry.file} 的归因数与主链不一致`).toBe(
        affected,
      );
      expect(entry.total).toBe(alone.tests.length);
    }
  });

  it("归因按单独影响面**从大到小**排，同份数时按路径字典序（顺序稳定）", () => {
    const files = {
      // hub 是枢纽（两个测试经它间接可达），leaf 只有自己那一个测试。
      "src/lib/hub.ts": "export const h = 1;\n",
      "src/lib/hub.test.ts": "import { h } from '../../lib/hub';\n",
      "src/components/ui/mid.tsx": "import { h } from '../../lib/hub';\n",
      "src/components/ui/mid.test.tsx": "import { M } from './mid';\n",
      "src/lib/leaf.ts": "export const l = 1;\n",
      "src/lib/leaf.test.ts": "import { l } from '../../lib/leaf';\n",
    };
    const { attribute } = attrHarness(files);
    const sorted = attribute(["src/lib/leaf.ts", "src/lib/hub.ts"]);
    expect(sorted.map((e) => e.file)).toEqual([
      "src/lib/hub.ts",
      "src/lib/leaf.ts",
    ]);
    // 顺序稳定：同样的改动、反过来喂，输出必须一致（否则不同机器给出不同建议）
    expect(
      attribute(["src/lib/hub.ts", "src/lib/leaf.ts"]).map((e) => e.file),
    ).toEqual(["src/lib/hub.ts", "src/lib/leaf.ts"]);
  });

  it("归因的数**本身**是对的：拿手工数得出来的夹具硬钉，不靠与主链互证", () => {
    // 上一条钉的是「两处不漂」，它对**两边同时错**是瞎的（实测：把「按路径引用」
    // 那一档整体跳过，对拍照样全绿）。所以这一条拿一个能手算的图，把期望值写死。
    //
    // 图（箭头 = import）：
    //   hub.ts        ← hub.test.ts        （兄弟测试 + 闭包 1 跳）
    //   hub.ts        ← mid.tsx ← mid.test.tsx（闭包 2 跳）
    //   hub.ts        ← 被 notes.test.ts **按路径字面量**引用（不是 import，闭包抓不到）
    //   leaf.ts       ← leaf.test.ts
    const files = {
      "src/lib/hub.ts": "export const h = 1;\n",
      "src/lib/hub.test.ts": "import { h } from '../../lib/hub';\n",
      "src/lib/leaf.ts": "export const l = 1;\n",
      "src/lib/leaf.test.ts": "import { l } from '../../lib/leaf';\n",
      "src/components/ui/mid.tsx": "import { h } from '../../lib/hub';\n",
      "src/components/ui/mid.test.tsx": "import { M } from './mid';\n",
      "tests/notes.test.ts":
        'const P = "src/lib/hub.ts";\nexport const n = P;\n',
    };
    const { attribute } = attrHarness(files);
    // hub 单独影响：hub.test（自己）+ mid.test（闭包 2 跳）+ notes.test（按路径引用）
    const hubRows = attribute(["src/lib/hub.ts"]);
    expect(hubRows.map((e) => e.file)).toEqual(["src/lib/hub.ts"]);
    expect(hubRows[0]?.affected).toBe(3);
    const leafRows = attribute(["src/lib/leaf.ts"]);
    expect(leafRows[0]?.affected).toBe(1);
    // 多文件时两行都在，且 hub 在前
    expect(
      attribute(["src/lib/hub.ts", "src/lib/leaf.ts"]).map((e) => e.file),
    ).toEqual(["src/lib/hub.ts", "src/lib/leaf.ts"]);
  });

  it("空改动清单 → 空数组（不是抛异常，调用方靠它判「没有归因」）", () => {
    const { attribute } = attrHarness({ "src/lib/leaf.ts": "export {};\n" });
    expect(attribute([])).toEqual([]);
    expect(attribute(["   "])).toEqual([]);
  });

  it("真仓库上归因与主链对拍（三个真实文件的读数）", () => {
    // 夹具能测出「两处实现漂开」，但测不出「两边都算错」—— 所以再拿真检出跑一遍。
    const tracked = spawnSync("git", ["ls-files"], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 64 << 20,
    })
      .stdout.split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const testFiles = tracked.filter(isTestPath);
    const sourceFiles = tracked.filter(isSourcePath);
    const readText = (rel: string) => {
      try {
        return fs.readFileSync(path.join(ROOT, rel), "utf8");
      } catch {
        return null;
      }
    };
    const graph = buildImportedBy(
      new Set([...sourceFiles, ...testFiles]),
      readText,
    );
    for (const file of ["src/lib/endpoints.ts", "src/components/ui/hint.tsx"]) {
      const alone = resolveAffectedTests({
        changedPaths: [file],
        testFiles,
        sourceFiles,
        readText,
        graph,
      });
      const expected = alone.tests.filter(
        (t) => !FIXED_STRUCTURAL_TESTS.includes(t),
      ).length;
      const [entry] = attributeAffected([file], graph, testFiles, sourceFiles);
      expect(entry, `${file} 应当有归因行`).toBeTruthy();
      expect(entry?.affected, `${file} 在真仓库上与主链不一致`).toBe(expected);
    }
  });
});
