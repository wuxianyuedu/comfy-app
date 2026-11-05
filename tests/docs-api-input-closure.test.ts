/** `docs/api/**` 的输入面（ISSUE #2537，事故 #2528）：面判窄了就是**静默漏判** —— 被 `ifModify`
 * 跳过与「判过且通过」读数上无差别。旧面按 `typedoc.json` 的 `entryPoints` 算，但 typedoc **解析**的是
 * TS 程序（`tsconfig.json` 展开的根 ∪ 沿 import 走到的文件），`entryPoints` 只决定渲染哪几页 —— 于是
 * `scripts/publish-desktop-bundle.mjs`（被 `tests/**` import 进程序、不在三根、也不是入口点）漏在面外。
 * 本用例判「面 ⇄ 事实」两向 + 派生纯函数：事实面里每个文件都被面罩住；把面改窄 ⇒ 有文件罩不住 ⇒ 红；
 * 新增一个解析根里的新路径 ⇒ 派生面自动覆盖它。进固定清单：触发它的改动不在本用例的静态 import 图里。 */
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { INPUT_GLOBS, INPUT_RES, matchedInputs } from "../scripts/check-docs-api.cjs";
import {
  docsApiTriggerGlobs,
  globFaceForFiles,
  typedocConfig,
  typedocProgramFiles,
  typedocProgramRoots,
  typedocTsconfigPath,
} from "../scripts/docs-api-input-closure.mjs";
import { globToRe } from "../scripts/vitest-projects.cjs";

const ROOT = process.cwd();

/** 一个路径是否被某条 glob 罩住。glob → 正则复用 `scripts/vitest-projects.cjs` 已导出的那一份
 * （同一套 `**` / `*` / `{a,b}` 口径、带锚点）—— 不写第二套：抄一份就会漂，漂的形态是
 * 「面罩不住事实」＝静默漏判（§12.12 / §12.18）。
 * @param rel 仓库相对路径 / @param globs glob 清单 / @returns 是否被某一条罩住
 */
function coveredBy(rel: string, globs: ReadonlyArray<string>): boolean {
  return globs.some((g) => globToRe(g).test(rel));
}

/**
 * **事实面只算一次**：单次 ~4s（tsconfig 根 ∪ 沿 import 走到的文件），同一次运行算五次就是白付 20s，
 * 而它是**每次提交都跑**的固定清单成员。
 */
let cachedProgramFiles: ReadonlyArray<string> | null = null;
function programFiles(): ReadonlyArray<string> {
  cachedProgramFiles ??= typedocProgramFiles();
  return cachedProgramFiles;
}

/** 现场那个文件：`#2528` 新增、`tests/**` import 进程序、旧面里没有它。 */
const INCIDENT_FILE = "scripts/publish-desktop-bundle.mjs";

/**
 * 那份产物（`BackupResult` 在产物里的落点）在盘上吗？产物**不再进 git**（ISSUE #2231），只有跑过
 * `pnpm run docs` 的检出才有；平台「受影响用例」跑在「API 文档生成与自检」之前，那边也永远没有。
 * 所以依赖它的是**产物级条件断言**（`tests/conditional-skip-registry.test.ts`，tier=artifact）——
 * 「绿」与「产物级判据跑过」不是同一件事。
 */
const productPath = path.join(ROOT, "docs/api/functions/lib_db-backup_backup.createBackup.html");
const productOnDisk = fs.existsSync(productPath);

describe("docs/api 输入面：typedoc 真解析面 ⇄ 门禁触发面（ISSUE #2537）", () => {
  it("触发面从 typedoc 的解析根派生，不是第二份手抄 glob", () => {
    expect(INPUT_GLOBS).toEqual(docsApiTriggerGlobs(ROOT));
    /* tsconfig 是 typedoc 的解析根出处；`typedoc.json` 没写 `tsconfig` 时缺省 `tsconfig.json`。 */
    expect(typedocTsconfigPath(ROOT)).toBe("tsconfig.json");
    expect(typedocConfig(ROOT).entryPoints, "typedoc.json 里没有 entryPoints").toBeDefined();
    /* 三根 + 事故文件所在的目录都必须在面里；`docs/**` 不在（只改文档的 PR 不跑这一格）。 */
    for (const g of [
      "src/**",
      "tests/**",
      "scripts/**",
      "e2e/**",
      ".storybook/**",
      "tools/**",
      "*.ts",
      "*.mjs",
    ]) {
      expect(INPUT_GLOBS, `触发面里没有 ${g}`).toContain(g);
    }
    expect(INPUT_GLOBS).not.toContain("docs/**");
  });

  it("typedoc 解析的是 TS 程序（含 tests/** 与 scripts/**），不是 entryPoints 那几页", () => {
    const roots = typedocProgramRoots(ROOT).files;
    expect(roots.length, "tsconfig 一个文件都没展开出来 —— 解析根坏了").toBeGreaterThan(0);
    /* 根里就有测试与脚本：这不是「闭包外溢」，是 typedoc 本来就读它们。 */
    expect(roots).toContain("tests/publish-desktop-bundle.test.ts");
    expect(roots).toContain("src/app/page.tsx");
    const files = programFiles();
    expect(files).toContain(INCIDENT_FILE);
    expect(fs.existsSync(path.join(ROOT, INCIDENT_FILE)), `${INCIDENT_FILE} 不在盘上`).toBe(true);
    expect(
      files.filter((f) => f.startsWith("tests/")).length,
      "事实面里没有 tests/** —— 那说明根不是 tsconfig 展开",
    ).toBeGreaterThan(0);
  });

  it("正向：事实面（typedoc 程序内每一个仓库文件）都被触发面罩住", () => {
    const uncovered = programFiles().filter((f) => !coveredBy(f, INPUT_GLOBS));
    expect(
      uncovered,
      `事实面里有 ${uncovered.length} 个文件不在触发面里 —— 改它们会改 typedoc 的解析结果，却不会被判到：${uncovered
        .slice(0, 10)
        .join(", ")}`,
    ).toEqual([]);
  });

  it("反向：把面手工改窄 ⇒ 事实面有文件罩不住 ⇒ 红（本用例就是那条判据）", () => {
    for (const narrow of ["tests/**", "scripts/**", "src/**"]) {
      const face = INPUT_GLOBS.filter((g) => g !== narrow);
      const uncovered = programFiles().filter((f) => !coveredBy(f, face));
      expect(
        uncovered.length,
        `去掉 ${narrow} 之后仍没有文件罩不住 —— 反向判据失效了（那等于任何窄面都能过）`,
      ).toBeGreaterThan(0);
    }
    /* 事故文件必须被面罩住：它正是旧逻辑的漏判点。 */
    expect(coveredBy(INCIDENT_FILE, INPUT_GLOBS)).toBe(true);
    /* 手加一条与 typedoc 解析面无关的面（`docs/**`）不会罩住任何事实文件 ⇒ 会被反向判据看出。 */
    expect(programFiles().some((f) => coveredBy(f, ["docs/**"]))).toBe(false);
  });

  it("新增一个会被 typedoc 读的路径 ⇒ 派生面自动覆盖它（纯函数）", () => {
    const face = globFaceForFiles(["src/lib/a.ts", "newdir/b.ts", "next-env.d.ts"]);
    expect(face).toContain("newdir/**");
    expect(face).toContain("src/**");
    expect(face).toContain("*.ts");
    expect(coveredBy("newdir/b.ts", face)).toBe(true);
    expect(coveredBy("next-env.d.ts", face)).toBe(true);
  });

  it("只改 docs 的 PR 不跑这一格（不得把触发面放宽成全库）", () => {
    expect(matchedInputs(["docs/standards/13-提交与-code-review.md", "README.md"])).toEqual([]);
    expect(INPUT_RES.length).toBe(INPUT_GLOBS.length);
  });

  it("现场那个文件真的定义着被产物引用的类型：`scripts/db-backup-core.mjs`（BackupResult）", () => {
    expect(programFiles()).toContain("scripts/db-backup-core.mjs");
    /* 它**确实定义着**那个类型 —— 这是「它确实是输入」的现场证据，不是「闭包算得对」的自证。
     * ⚠️ 断言落在**源文件**上而不是产物上（ISSUE #2231）：产物不再进 git，没跑过 `pnpm run docs`
     * 的检出上盘里根本没有它 ⇒ 断产物会恒红（平台「受影响用例」也跑在文档生成之前，同形态）。 */
    const source = path.join(ROOT, "scripts/db-backup-core.mjs");
    expect(fs.existsSync(source), `源文件 ${source} 不在盘上`).toBe(true);
    expect(fs.readFileSync(source, "utf8")).toContain("BackupResult");
  });

  it.skipIf(!productOnDisk)(
    "它定义的类型真的出现在产物里（产物不在 git 里 ⇒ 本机没生成就没有）",
    () => {
      /* 这一条是**产物级**断言：产物在盘上才判。产物出库（ISSUE #2231）之后它是一档
       * 条件跳过（tier=artifact），登记在 `tests/conditional-skip-registry.test.ts` ——
       * 「绿」与「产物级判据跑过」不是同一件事，那张表就是这句话的账。 */
      expect(fs.readFileSync(productPath, "utf8")).toContain("BackupResult");
    },
  );
});
