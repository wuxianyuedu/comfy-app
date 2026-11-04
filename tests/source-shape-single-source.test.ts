/**
 * 「读源码做形态断言」需先归一化控制流花括号（见 `tests/helpers/source-shape.ts` 头注），否则 `curly` 会让
 * `toContain('if (cond) stmt;')` 失配；唯一实现即该助手（§12.18）。只判两件事：新文件出现本地副本 = 红；
 * 台账里某份已无本地定义 = 红（防 stale）。拼接待搜串以免本文件把自己算成命中（自匹配是首个失效模式）。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");

const LAYERS = ["src", "tests", "scripts"];
const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  "dist",
  "coverage",
  "temp",
  "log",
  "public",
  "out",
]);
const SOURCE_EXT = /\.(ts|tsx|cjs|mjs)$/;

/** 唯一实现所在，它出现这个名字是允许的。 */
const CANONICAL = "tests/helpers/source-shape.ts";
const DEFINITION_MARK = "func" + "tion normalizeControlFlow(";

function sourceFiles(): Array<string> {
  const out: Array<string> = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const abs = path.join(dir, entry);
      const stat = statSync(abs);
      if (stat.isDirectory()) {
        if (!SKIP_DIRS.has(entry) && !entry.startsWith(".")) {
          walk(abs);
        }
        continue;
      }
      if (!SOURCE_EXT.test(entry)) {
        continue;
      }
      out.push(path.relative(ROOT, abs).split(path.sep).join("/"));
    }
  };
  for (const layer of LAYERS) {
    const abs = path.join(ROOT, layer);
    if (statSync(abs, { throwIfNoEntry: false })?.isDirectory() === true) {
      walk(abs);
    }
  }
  return out.sort();
}

/** 排除 helper 本人之后，仍然带着本地定义的文件。 */
const definedIn = sourceFiles()
  .filter((rel) => rel !== CANONICAL)
  .filter((rel) => readFileSync(path.join(ROOT, rel), "utf8").includes(DEFINITION_MARK));

/** 现存本地副本台账（目前只有 canonical 一份，故为空；新增加一份就红）。 */
const LEDGER: Array<string> = [];

describe("normalizeControlFlow 的唯一实现（§12.18 复用优先）", () => {
  it("helper 本人在位，且导出 normalizeControlFlow", () => {
    const src = readFileSync(path.join(ROOT, CANONICAL), "utf8");
    expect(src).toContain("export function normalizeControlFlow");
  });

  it("扫到的副本数与台账一致（多一处 = 红；少一处 = 收紧台账）", () => {
    expect(
      definedIn.filter((rel) => !LEDGER.includes(rel)),
      `又多出 ${definedIn.filter((r) => !LEDGER.includes(r)).length} 份 normalizeControlFlow 的本地实现：` +
        `${definedIn.filter((r) => !LEDGER.includes(r)).join("、")}。` +
        "改用 ./helpers/source-shape（§12.18）；它不满足你的形状就**给它加一个模式**，" +
        "别再抄一份。",
    ).toEqual([]);

    const gone = LEDGER.filter((rel) => !definedIn.includes(rel));
    expect(
      gone,
      `台账挂着但本地已经没有定义的 ${gone.length} 份：${gone.join("、")}。` +
        "它已经换成共享件 —— 把它从 LEDGER 里删掉（这条判据要的是「只许降」）。",
    ).toEqual([]);
  });
});
