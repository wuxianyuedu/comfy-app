/**
 * `docs/api/**` 的输入面闭包（ISSUE #2223）。
 *
 * ── 这条判据守的是什么 ────────────────────────────────────────────────────
 *
 * `docs/api/**` 是 typedoc 的产物。平台侧那一格（`API 文档生成与自检`）按
 * `ifModify` 收窄 ⇒ **面判窄了就是漏判**，而漏判是静默的：被 `ifModify` 跳过的形态
 * 与「判过且通过」在读数上无差别 —— 本仓最恨的那一族。
 *
 * 收窄面原先是三根（`src/lib` / `src/server` / `src/trpc`），判据的文件头当时写着
 * 「这**不是启发式收窄**，是『产物只由这些输入决定』的直接映射：输入没变，产物不可能
 * 漂」。**那句话是错的**：typedoc 沿 import 走，三根之外的文件也会进产物 ——
 * `BackupResult` 定义在 `scripts/db-backup-core.mjs`，它出现在
 * `docs/api/functions/lib_db-backup_backup.createBackup.html` 里 ⇒ 改那份文件会改
 * 产物，可它不在面里 ⇒ 那一类改动**永远不会被判到**，而且读数上完全看不出来。
 *
 * 于是这里判四件事：
 *   ① **根是真的**：从 `typedoc.json` 的 `entryPoints` 导出，不手抄第二份；
 *   ② **闭包是真的**：取反括号（`!(*.test)`）与 `exclude` 都生效，测试文件不是入口点；
 *   ③ **面罩得住闭包**：闭包算出来的每一个叶子都被收窄面罩住（漏了就红）；
 *   ④ **面里没有编出来的条目**：收窄面声明的那批叶子每一个都在闭包里。
 *
 * ── 为什么这条用例进固定清单（`scripts/fixed-structural-tests.mjs`）──────────
 *
 * 触发它的改动面是「`src/lib/**` 里的某一行新 import 了一个根外的文件」—— 那条改动
 * **不在本用例的静态 import 图里**（它改的是别的模块），于是「只在受影响时才跑」等于
 * 让它随下一次新增 import 过去。表现不是红，是面判窄了而没人看见 —— 与
 * `tests/ci-incremental-gates.test.ts` 同因：那一条守的是「登记表 ⇄ 配置」，这一条守
 * 的是「**面 ⇄ 事实**」。
 */
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { CLOSURE_LEAVES, INPUT_GLOBS } from "../scripts/check-docs-api.cjs";
import {
  docsApiInputClosure,
  entryPointExtension,
  isGlobEntryPoint,
  negatedBasenamePattern,
  rootOfEntryPoint,
  typedocEntryPoints,
  typedocExcludes,
  typedocRootGlobs,
  typedocRoots,
} from "../scripts/docs-api-input-closure.mjs";
import { globToRe } from "../scripts/vitest-projects.cjs";

const ROOT = process.cwd();

/**
 * 一个路径是否被某条 glob 罩住。
 *
 * glob → 正则**复用** `scripts/vitest-projects.cjs` 已导出的那一份（同一套 `**` / `*` /
 * `{a,b}` 口径，且带锚点）—— 不在本文件写第二套 glob 匹配（§12.12 / §12.18：抄一份就会
 * 漂，而漂的形态是「面罩不住闭包」＝静默漏判）。
 *
 * @param rel 仓库相对路径
 * @param globs glob 清单
 * @returns 是否被某一条罩住
 */
function coveredBy(rel: string, globs: readonly string[]): boolean {
  return globs.some((g) => globToRe(g).test(rel));
}

/**
 * 闭包**只算一次**。
 *
 * 每次计算都要把三根走一遍（入口点判定 + 传递闭包），实测单次 ~0.8s —— 同一次运行里
 * 算五次就是白付 4s，而它是**每次提交都跑**的固定清单成员。
 */
let cachedClosure: ReturnType<typeof docsApiInputClosure> | null = null;
function closure(): ReturnType<typeof docsApiInputClosure> {
  cachedClosure ??= docsApiInputClosure();
  return cachedClosure;
}

/**
 * 那份产物（`BackupResult` 在产物里的落点）在盘上吗？
 *
 * 产物**不再进 git**（ISSUE #2231）⇒ 只有跑过 `pnpm run docs` 的检出才有它；
 * 平台上「受影响用例」那一格跑在「API 文档生成与自检」之前 ⇒ 那边也永远没有。
 * 于是依赖它的那一条是**产物级条件断言**（登记在 `tests/conditional-skip-registry.test.ts`，
 * tier=artifact）—— 「绿」与「产物级判据跑过」不是同一件事。
 */
const productPath = path.join(
  ROOT,
  "docs/api/functions/lib_db-backup_backup.createBackup.html",
);
const productOnDisk = fs.existsSync(productPath);

describe("docs/api 输入面的传递闭包（ISSUE #2223）", () => {
  it("根从 typedoc.json 的 entryPoints 导出，不手抄第二份", () => {
    const c = closure();
    expect(c.roots).toEqual(["src/lib", "src/server", "src/trpc"]);
    expect(typedocRoots()).toEqual(c.roots);
    expect(c.rootGlobs).toEqual(typedocRootGlobs());
    /* 每条 entryPoint 的根都落在 roots 里 —— 根集合与 entryPoints 一一对应，
     * 否则「根」就是另一份手抄的东西。 */
    /* 只有 **glob 形态**的 entryPoint 划根（ISSUE #2444）：单文件入口没有「根」
     * （否则 `scripts/db-backup-core.mjs` 会把 `scripts` 整个目录划进去），
     * 它自己是一个根外叶子。 */
    const rootsOfEntryPoints = [
      ...new Set(
        typedocEntryPoints()
          .filter(isGlobEntryPoint)
          .map(rootOfEntryPoint),
      ),
    ];
    expect(rootsOfEntryPoints.sort()).toEqual(c.roots);
    /* 三根的 glob 形态必须都在收窄面里：面罩不住根 = 根下的改动全漏判。 */
    for (const g of c.rootGlobs) {
      expect(INPUT_GLOBS, `收窄面里没有 ${g}`).toContain(g);
    }
  });

  it("typedoc 的取反括号与 exclude 都被认出来（测试文件不是入口点）", () => {
    const eps = typedocEntryPoints();
    expect(eps.length, "typedoc.json 里一条 entryPoint 都没有 —— 根算出来是空的").toBeGreaterThan(0);
    for (const ep of eps) {
      if (isGlobEntryPoint(ep)) {
        expect(
          negatedBasenamePattern(ep),
          `${ep} 里没有取反括号 —— 取反失效会让测试文件变成入口点`,
        ).not.toBeNull();
        expect(
          [".ts", ".tsx"],
          `${ep} 的扩展名认错了`,
        ).toContain(entryPointExtension(ep));
      } else {
        /* 单文件入口（ISSUE #2444）：没有取反括号形态可言，但它本身必须
         * 在盘上且带扩展名 —— typedoc 真读它，读不到就是配置漂了。 */
        expect(entryPointExtension(ep), `${ep} 的扩展名认错了`).not.toBe("");
        expect(fs.existsSync(path.join(ROOT, ep)), `单文件入口 ${ep} 不在盘上`).toBe(true);
      }
    }
    expect(typedocExcludes()).toContain("**/*.test.ts");
  });

  it("闭包叶子集：每个都在盘上、都不在三根里、都不是测试文件", () => {
    const c = closure();
    expect(
      c.leaves.length,
      "闭包一个根外文件都没算出来 —— 那说明入口点判定坏了（不是「没有外溢」）",
    ).toBeGreaterThan(0);
    for (const leaf of c.leaves) {
      expect(fs.existsSync(path.join(ROOT, leaf)), `叶子 ${leaf} 不在盘上`).toBe(true);
      expect(
        c.roots.some((r) => leaf === r || leaf.startsWith(`${r}/`)),
        `叶子 ${leaf} 其实在三根里`,
      ).toBe(false);
      expect(leaf.endsWith(".test.ts"), `叶子 ${leaf} 是测试文件 —— typedoc 不读它`).toBe(false);
    }
    /* typedoc 的 exclude 与取反括号都生效：测试文件可达的 `tests/helpers/**` 不进闭包。 */
    expect(
      c.leaves.filter((l) => l.startsWith("tests/")),
      "测试文件可达的 `tests/` 下的东西进了闭包 —— typedoc 明确不读它们",
    ).toEqual([]);
  });

  it("现场那个文件真的在闭包里：`scripts/db-backup-core.mjs`（BackupResult 的定义处）", () => {
    const c = closure();
    expect(c.leaves).toContain("scripts/db-backup-core.mjs");
    /* 它**确实定义着**那个类型 —— 这一条是「它确实是输入」的现场证据，不是「闭包算得对」的
     * 自证（自证只能证明算法自洽，证明不了面罩得住真相）。
     *
     * ⚠️ 断言落在**源文件**上而不是产物上（ISSUE #2231 之后）：产物**不再进 git**，本机没跑过
     * `pnpm run docs` 时盘上根本没有它 ⇒ 断言盘上的产物会在「没生成过」的检出上恒红
     * （平台侧「受影响用例」那一格跑在「API 文档生成与自检」之前，也是这个形态）。 */
    const source = path.join(ROOT, "scripts/db-backup-core.mjs");
    expect(fs.existsSync(source), `源文件 ${source} 不在盘上`).toBe(true);
    expect(fs.readFileSync(source, "utf8")).toContain("BackupResult");
  });

  it.skipIf(!productOnDisk)("它定义的类型真的出现在产物里（产物不在 git 里 ⇒ 本机没生成就没有）", () => {
    /* 这一条是**产物级**断言：产物在盘上才判。产物出库（ISSUE #2231）之后它是一档
     * 条件跳过（tier=artifact），登记在 `tests/conditional-skip-registry.test.ts` ——
     * 「绿」与「产物级判据跑过」不是同一件事，那张表就是这句话的账。 */
    expect(fs.readFileSync(productPath, "utf8")).toContain("BackupResult");
  });

  it("面罩得住闭包：闭包算出来的每一个叶子都被收窄面罩住（面判窄了 = 漏判）", () => {
    const c = closure();
    const uncovered = c.leaves.filter((l) => !coveredBy(l, INPUT_GLOBS));
    expect(
      uncovered,
      `闭包里有 ${uncovered.length} 个文件不在收窄面里 —— 改它们会改产物，却不会被判到：` +
        uncovered.join(", "),
    ).toEqual([]);
  });

  it("收窄面声明的那批叶子每一个都在闭包里（不是拍脑袋写的）", () => {
    const leaves = new Set(closure().leaves);
    const phantom = CLOSURE_LEAVES.filter((l) => !leaves.has(l));
    expect(
      phantom,
      `收窄面里这 ${phantom.length} 条已经不在闭包里了（要么没人引用，要么被 typedoc 排除了）：` +
        phantom.join(", "),
    ).toEqual([]);
  });

  it("闭包里不在那批叶子里的，必须被别的 glob 罩住（当前只有 package.json）", () => {
    const c = closure();
    const others = INPUT_GLOBS.filter((g) => !CLOSURE_LEAVES.includes(g));
    const orphans = c.leaves.filter(
      (l) => !CLOSURE_LEAVES.includes(l) && !coveredBy(l, others),
    );
    expect(
      orphans,
      `闭包里有 ${orphans.length} 个文件既不在那批叶子里、也不被别的 glob 罩住：` +
        orphans.join(", "),
    ).toEqual([]);
  });
});
