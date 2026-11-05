/** 独立 YAML 解析校验的判据（脚本本体见 `scripts/check-ci-yaml-parse.mjs` 头注）。
 * 守「真解析器能读下来」这层：仓库自带判据按文本形状解析 `.cnb.yml`，语法/锚点断掉时可能给出误导性的红
 * 或静默漏过；这里用 `yaml` 包独立复算。
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

import { describe, expect, it } from "vitest";

import { checkYamlFile, main } from "../scripts/check-ci-yaml-parse.mjs";

const ROOT = process.cwd();

describe("CI YAML 独立解析校验", () => {
  it("真仓：.cnb.yml 与 .github/workflows 全部可解析、锚点合法、stage 形态完整", () => {
    const problems = main(ROOT);
    expect(problems, `YAML 解析校验发现问题：\n${problems.join("\n")}`).toEqual([]);
  });

  it("负控制：断掉的别名引用 ⇒ 红（锚点解析不是空转）", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ci-yaml-"));
    writeFileSync(path.join(dir, ".cnb.yml"), "base: &a 1\nuse: *missing\n", "utf8");
    expect(checkYamlFile(dir, ".cnb.yml").join("\n")).toContain("锚点 / 别名解析失败");
  });

  it("负控制：stage 缺 script ⇒ 红（基本形态不是空转）", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ci-yaml-"));
    writeFileSync(
      path.join(dir, ".cnb.yml"),
      "main:\n  stages:\n    - name: 只有名字\n",
      "utf8",
    );
    expect(checkYamlFile(dir, ".cnb.yml").join("\n")).toContain("缺非空 script");
  });

});
