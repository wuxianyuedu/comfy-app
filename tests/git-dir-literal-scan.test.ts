import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { scanSource } from "../scripts/git-dir-literal-scan.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

describe("scripts/git-dir-literal-scan.mjs", () => {
  it('scripts/** 除 git-dir.mjs 外没有硬编码的 ".git" 路径拼接', () => {
    // 这条判据是 #2072 的护栏：「检出目录在哪」只许 scripts/git-dir.mjs 一处知道。
    // 其它脚本若顺手 `path.join(root, ".git", …)`，在链接工作树里 `.git` 是文件，
    // MERGE_HEAD / HEAD / FETCH_HEAD 永远查不到——而改那些脚本不会把这条带进受影响集，
    // 所以必须进固定清单（scripts/fixed-structural-tests.mjs），每次提交都跑。
    let stdout = "";
    expect(() => {
      stdout = execFileSync(process.execPath, ["scripts/git-dir-literal-scan.mjs"], {
        cwd: ROOT,
        encoding: "utf8",
      });
    }).not.toThrow();
    expect(stdout).toContain("OK");
  });

  /* ── 谓词本身（ISSUE #2785）───────────────────────────────────────────────
   *
   * 上面那条只答「现在真实仓库 0 命中」，它证不了任何一形：正例进不来、反例赶不走。
   * 而这一格的两个风险正好都在谓词上 —— 面漏了 `.cjs`（#2785 那一处就是 CJS，
   * 于是账面全绿地坏着），以及把「正当的 `.git` 字符串」也报成违例（那会让人
   * 往白名单里塞文件，而白名单是按**整份文件**豁免的）。所以逐形喂夹具。 */

  it('正例：`join` / `resolve` 的 ".git" 实参 —— .mjs 与 .cjs 两种宿主都报', () => {
    const mjs = 'const p = path.join(root, ".git", "MERGE_HEAD");\n';
    const cjs = 'const p = require("node:path").join(ROOT, ".git");\n';
    const resolved = "const p = path.resolve(dir, '.git', 'HEAD');\n";
    expect(scanSource("scripts/a.mjs", mjs)).toHaveLength(1);
    expect(scanSource("scripts/a.cjs", cjs)).toHaveLength(1);
    expect(scanSource("scripts/a.cjs", resolved)).toHaveLength(1);
    // 报出来的那一行要能指到位置与原文（报告靠它点名，读的人不用再去 grep）。
    expect(scanSource("scripts/a.mjs", `// 注释\n${mjs}`)[0]).toContain("scripts/a.mjs:2:");
  });

  it("反例：遍历跳过名单、注释、话术字符串都不算违例", () => {
    /* 这三形今天真实存在于 `scripts/**`（#2785 扩面时数的：把面从 .mjs 扩到 .cjs
     * 直接报 4 处，其中 3 处是下面这一族）。按整份文件白名单豁免它们 = 永久放弃
     * 这三份文件的这条判据，所以是**谓词**要收窄，不是名单要变长。 */
    expect(
      scanSource("scripts/a.cjs", 'const SKIP = new Set(["node_modules", ".git", ".next"]);\n'),
    ).toEqual([]);
    expect(
      scanSource("scripts/a.cjs", "// 不能硬拼 <根>/.git/MERGE_HEAD（链接工作树里读不到）\n"),
    ).toEqual([]);
    expect(scanSource("scripts/a.cjs", 'console.error("请删掉 .git/MERGE_HEAD 再试");\n')).toEqual(
      [],
    );
    // 没有 join / resolve 的普通字符串比较也不报（它答的不是「检出在哪」）。
    expect(scanSource("scripts/a.mjs", 'if (name === ".git") { continue; }\n')).toEqual([]);
  });

  it("已知盲区：拼接与模板形态不判（写出来，别让它被读成已覆盖）", () => {
    /* 要判它就得同时判「这个字符串是不是被当话术用的」—— 那是语义不是形状。
     * 历史四例（#2072）全是 `path.join` 形态，所以量程与学费对得上；
     * 这一条断言的作用是把盲区钉成**有人的**：将来扩谓词时它会红，逼着改的人
     * 同时改这段说明，而不是让下一份文档以为这一族都判了。 */
    expect(scanSource("scripts/a.mjs", 'const p = root + "/.git/MERGE_HEAD";\n')).toEqual([]);
  });
});
