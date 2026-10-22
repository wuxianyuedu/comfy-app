import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("scripts/git-dir-literal-scan.mjs", () => {
  it('scripts/** 除 git-dir.mjs 外没有硬编码的 ".git" 路径拼接', () => {
    // 这条判据是 #2072 的护栏：「检出目录在哪」只许 scripts/git-dir.mjs 一处知道。
    // 其它脚本若顺手 `path.join(root, ".git", …)`，在链接工作树里 `.git` 是文件，
    // MERGE_HEAD / HEAD / FETCH_HEAD 永远查不到——而改那些脚本不会把这条带进受影响集，
    // 所以必须进固定清单（scripts/fixed-structural-tests.mjs），每次提交都跑。
    let stdout = "";
    expect(() => {
      stdout = execFileSync(
        process.execPath,
        ["scripts/git-dir-literal-scan.mjs"],
        {
          cwd: ROOT,
          encoding: "utf8",
        },
      );
    }).not.toThrow();
    expect(stdout).toContain("OK");
  });
});
